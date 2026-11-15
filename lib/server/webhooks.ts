// Merchant webhook delivery: at-least-once, HMAC-SHA256 signed, SSRF-guarded (pinned DNS, no redirects, 5 s timeout).
// Headers: MezoCommerce-Signature: t=<unix>,v1=<hex hmac_sha256(secret, `${t}.${rawBody}`)>
//          MezoCommerce-Event-Id, MezoCommerce-Event-Type

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from "node:dns";
import { request as httpsRequest } from "node:https";
import type { WebhookDeliveryDTO, WebhookEndpointDTO, CreatedWebhookEndpointDTO } from "@/lib/api-types";
import { WEBHOOK_EVENT_TYPES, type WebhookEventType } from "@/lib/chain/payment-state";
import type { Sql } from "./db";
import { int, iso, isoOrNull, json, str, strOrNull } from "./db/rows";
import { addSeconds, clock } from "./clock";
import { env } from "./env";
import { HttpError, badRequest, notFound } from "./errors";
import { audit } from "./audit";
import { emitEvent } from "./events";

export const WEBHOOK_MAX_ATTEMPTS = 5;
export const WEBHOOK_TIMEOUT_MS = 5000;
const BASE_BACKOFF_SECONDS = 30;

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString("hex")}`;
}

export function signWebhook(secret: string, body: string, t: number = Math.floor(clock.now().getTime() / 1000)): string {
  const v1 = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

/** Reference verifier for merchants (and tests). Rejects timestamps older than `toleranceSec`. */
export function verifyWebhookSignature(secret: string, body: string, header: string, toleranceSec = 300, nowSec = Math.floor(Date.now() / 1000)): boolean {
  const parts: Record<string, string> = {};
  for (const p of (header || "").split(",")) {
    const i = p.indexOf("=");
    if (i > 0) parts[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  }
  const t = Number(parts.t);
  if (!Number.isFinite(t) || !parts.v1 || Math.abs(nowSec - t) > toleranceSec) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${body}`).digest();
  if (!/^[0-9a-f]{64}$/i.test(parts.v1)) return false;
  const got = Buffer.from(parts.v1, "hex");
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/** Exponential backoff after `attempts` failed deliveries: 30s, 60s, 120s, 240s (5 attempts in total). */
export function webhookBackoffSeconds(attempts: number): number {
  return BASE_BACKOFF_SECONDS * 2 ** Math.max(0, attempts - 1);
}

// ---------------------------------------------------------------- SSRF guard

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
}
function inV4(ip: string, cidr: string): boolean {
  const [base, bits] = cidr.split("/");
  const mask = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}
const V4_BLOCKED = [
  "0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12", "192.0.0.0/24",
  "192.0.2.0/24", "192.88.99.0/24", "192.168.0.0/16", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24",
  "224.0.0.0/4", "240.0.0.0/4", "255.255.255.255/32",
];

export function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return V4_BLOCKED.some((c) => inV4(ip, c));
  if (v === 6) {
    const x = ip.toLowerCase();
    if (x === "::" || x === "::1") return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x);
    if (mapped) return isPrivateIp(mapped[1]);
    if (/^::ffff:/.test(x)) return true; // hex-form mapped addresses: refuse
    if (/^f[cd]/.test(x)) return true; // fc00::/7 ULA
    if (/^fe[89ab]/.test(x)) return true; // fe80::/10 link-local
    if (/^ff/.test(x)) return true; // multicast
    if (/^(64:ff9b|2001:db8|2001:0?:|2002:)/.test(x)) return true; // NAT64 / docs / Teredo / 6to4
    return false;
  }
  return true;
}

/** Synchronous shape check used when a merchant saves a URL. */
export function validateWebhookUrlShape(raw: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "Not a valid URL" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "Webhook URL must use https" };
  if (url.username || url.password) return { ok: false, reason: "Credentials in the URL are not allowed" };
  if (url.port && url.port !== "443") return { ok: false, reason: "Only the default https port is allowed" };
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return { ok: false, reason: "Webhook host must be a public hostname" };
  }
  if (isIP(host) && isPrivateIp(host)) return { ok: false, reason: "Webhook host resolves to a private address" };
  return { ok: true, url };
}

/** Full check at delivery time: shape + every DNS answer must be public. */
export async function assertPublicWebhookUrl(
  raw: string,
  resolve: (host: string) => Promise<string[]> = async (h) => (await lookup(h, { all: true })).map((a) => a.address),
): Promise<URL> {
  const shape = validateWebhookUrlShape(raw);
  if (!shape.ok) throw new Error(shape.reason);
  const host = shape.url.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [host] : await resolve(host);
  if (addrs.length === 0 || addrs.some(isPrivateIp)) throw new Error("Webhook host resolves to a private address");
  return shape.url;
}

// ---------------------------------------------------------------- pinned transport (no DNS-rebinding window)

/**
 * dns.lookup replacement handed to https.request: every answer is checked at CONNECT time, so the address that
 * was validated is the address that is dialled (a second, unchecked resolution never happens).
 */
export function safeLookup(
  hostname: string,
  options: LookupOptions,
  cb: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
): void {
  dnsLookup(hostname, { all: true }, (err, addrs) => {
    if (err) return cb(err, "", 0);
    const list = addrs as LookupAddress[];
    if (list.length === 0 || list.some((a) => isPrivateIp(a.address))) {
      const e = new Error("Webhook host resolves to a private address") as NodeJS.ErrnoException;
      e.code = "EPRIVATEADDR";
      return cb(e, "", 0);
    }
    if (options?.all) return cb(null, list);
    cb(null, list[0].address, list[0].family);
  });
}

/** Minimal fetch-compatible POST over https with the pinned lookup, no redirects, hard timeout. */
export const pinnedFetch = ((input: string, init: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) =>
  new Promise<{ status: number }>((resolve, reject) => {
    const req = httpsRequest(
      input,
      { method: init.method ?? "POST", headers: init.headers, lookup: safeLookup as never, signal: init.signal },
      (res) => {
        res.resume(); // drain; body is ignored
        res.on("end", () => resolve({ status: res.statusCode ?? 0 }));
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end(init.body);
  })) as unknown as typeof fetch;

// ---------------------------------------------------------------- local dev endpoints

function isLocalDevUrl(raw: string): boolean {
  if (!env.allowLocalWebhooks()) return false;
  try {
    const u = new URL(raw);
    return u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname);
  } catch {
    return false;
  }
}

export function validateEndpointUrl(raw: string): string {
  if (isLocalDevUrl(raw)) return raw;
  const shape = validateWebhookUrlShape(raw);
  if (!shape.ok) throw new HttpError(400, "invalid_webhook_url", shape.reason);
  return shape.url.toString();
}

// ---------------------------------------------------------------- endpoints CRUD

const MAX_ENDPOINTS = 10;

export function toEndpointDTO(r: Record<string, unknown>): WebhookEndpointDTO {
  return {
    id: str(r.id),
    url: str(r.url),
    event_types: json<WebhookEndpointDTO["event_types"]>(r.event_types, ["*"]),
    status: str(r.status) as WebhookEndpointDTO["status"],
    created_at: iso(r.created_at),
  };
}

export async function listEndpoints(sql: Sql, merchantId: string): Promise<WebhookEndpointDTO[]> {
  const rows = await sql`SELECT * FROM webhook_endpoints WHERE merchant_id = ${merchantId} AND status = 'active' ORDER BY created_at DESC`;
  return rows.map(toEndpointDTO);
}

export async function createEndpoint(
  sql: Sql,
  merchantId: string,
  input: { url: string; event_types?: (WebhookEventType | "*")[] },
  actor: string,
): Promise<CreatedWebhookEndpointDTO> {
  const url = validateEndpointUrl(input.url);
  const types = input.event_types?.length ? Array.from(new Set(input.event_types)) : ["*"];
  for (const t of types) if (t !== "*" && !(WEBHOOK_EVENT_TYPES as readonly string[]).includes(t)) throw badRequest(`Unknown event type: ${t}`);
  const [{ n }] = await sql<{ n: number }>`SELECT count(*)::int AS n FROM webhook_endpoints WHERE merchant_id = ${merchantId} AND status = 'active'`;
  if (Number(n) >= MAX_ENDPOINTS) throw new HttpError(409, "too_many_endpoints", `At most ${MAX_ENDPOINTS} webhook endpoints`);
  const secret = generateWebhookSecret();
  const [row] = await sql`INSERT INTO webhook_endpoints (merchant_id, url, secret, event_types, status, created_at)
                          VALUES (${merchantId}, ${url}, ${secret}, ${types}::jsonb, 'active', ${clock.now()}) RETURNING *`;
  await audit(sql, { merchantId, actor, action: "webhook_endpoint.created", resourceId: str(row.id), metadata: { url, event_types: types } });
  return { ...toEndpointDTO(row), secret };
}

export async function disableEndpoint(sql: Sql, merchantId: string, id: string, actor: string): Promise<WebhookEndpointDTO> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Webhook endpoint not found");
  const [row] = await sql`UPDATE webhook_endpoints SET status = 'disabled' WHERE id = ${id} AND merchant_id = ${merchantId} RETURNING *`;
  if (!row) throw notFound("Webhook endpoint not found");
  await sql`UPDATE webhook_deliveries SET status = 'failed', last_error = 'endpoint disabled', next_retry_at = ${clock.now()}
            WHERE endpoint_id = ${id} AND status = 'pending'`;
  await audit(sql, { merchantId, actor, action: "webhook_endpoint.disabled", resourceId: id });
  return toEndpointDTO(row);
}

// ---------------------------------------------------------------- deliveries

export function toDeliveryDTO(r: Record<string, unknown>): WebhookDeliveryDTO {
  return {
    id: str(r.id),
    event_id: str(r.event_id),
    event_type: str(r.event_type) as WebhookEventType,
    endpoint_url: str(r.endpoint_url),
    status: str(r.status) as WebhookDeliveryDTO["status"],
    attempt_count: int(r.attempt_count),
    response_status: r.response_status === null || r.response_status === undefined ? null : int(r.response_status),
    last_error: strOrNull(r.last_error),
    next_retry_at: str(r.status) === "pending" ? isoOrNull(r.next_retry_at) : null,
    delivered_at: isoOrNull(r.delivered_at),
    created_at: iso(r.created_at),
  };
}

export async function listDeliveries(sql: Sql, merchantId: string, page: number, pageSize: number) {
  const [{ n }] = await sql<{ n: number }>`
    SELECT count(*)::int AS n FROM webhook_deliveries d JOIN webhook_endpoints e ON e.id = d.endpoint_id WHERE e.merchant_id = ${merchantId}`;
  const rows = await sql`
    SELECT d.*, e.url AS endpoint_url, ev.event_type FROM webhook_deliveries d
    JOIN webhook_endpoints e ON e.id = d.endpoint_id JOIN webhook_events ev ON ev.id = d.event_id
    WHERE e.merchant_id = ${merchantId} ORDER BY d.created_at DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;
  return { data: rows.map(toDeliveryDTO), page, page_size: pageSize, total: int(n) };
}

async function deliveryById(sql: Sql, merchantId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await sql`
    SELECT d.*, e.url AS endpoint_url, ev.event_type FROM webhook_deliveries d
    JOIN webhook_endpoints e ON e.id = d.endpoint_id JOIN webhook_events ev ON ev.id = d.event_id
    WHERE d.id = ${id} AND e.merchant_id = ${merchantId}`;
  return row ?? null;
}

/** Manual retry from the dashboard: one more attempt now. */
export async function retryDelivery(sql: Sql, merchantId: string, id: string, actor: string): Promise<WebhookDeliveryDTO> {
  const row = await deliveryById(sql, merchantId, id);
  if (!row) throw notFound("Delivery not found");
  if (str(row.status) === "delivered") throw new HttpError(409, "already_delivered", "This delivery already succeeded");
  await sql`UPDATE webhook_deliveries SET status = 'pending', next_retry_at = ${clock.now()}, locked_until = NULL,
            attempt_count = LEAST(attempt_count, ${WEBHOOK_MAX_ATTEMPTS - 1}) WHERE id = ${id}`;
  await audit(sql, { merchantId, actor, action: "webhook_delivery.retry", resourceId: id });
  await deliverPendingWebhooks(sql, {}, 1, id);
  return toDeliveryDTO((await deliveryById(sql, merchantId, id))!);
}

/** Send a `ping` event to one endpoint immediately. */
export async function sendTestEvent(sql: Sql, merchantId: string, endpointId: string, actor: string, deps: DeliverDeps = {}): Promise<WebhookDeliveryDTO> {
  if (!/^[0-9a-f-]{36}$/i.test(endpointId)) throw notFound("Webhook endpoint not found");
  const [ep] = await sql`SELECT id FROM webhook_endpoints WHERE id = ${endpointId} AND merchant_id = ${merchantId} AND status = 'active'`;
  if (!ep) throw notFound("Webhook endpoint not found");
  const eventId = await emitEvent(sql, { merchantId, type: "ping", dedupeKey: `ping:${endpointId}:${clock.now().getTime()}:${Math.random()}`, intentId: null, onlyEndpointId: endpointId });
  await audit(sql, { merchantId, actor, action: "webhook_endpoint.test", resourceId: endpointId });
  const [d] = await sql`SELECT id FROM webhook_deliveries WHERE event_id = ${eventId} AND endpoint_id = ${endpointId}`;
  await deliverPendingWebhooks(sql, deps, 1, str(d.id));
  return toDeliveryDTO((await deliveryById(sql, merchantId, str(d.id)))!);
}

export interface DeliverDeps {
  fetchImpl?: typeof fetch;
  resolve?: (host: string) => Promise<string[]>;
}

/**
 * Deliver due webhook rows. Each row is leased (locked_until) before sending so two workers never send the same
 * delivery concurrently. 2xx → delivered; otherwise retried with exponential backoff, failed after 5 attempts.
 */
export async function deliverPendingWebhooks(
  sql: Sql,
  deps: DeliverDeps = {},
  limit = 25,
  onlyId?: string,
): Promise<{ delivered: number; failed: number; retried: number }> {
  const now = clock.now();
  const lease = addSeconds(now, 30);
  const claimed = onlyId
    ? await sql`UPDATE webhook_deliveries SET locked_until = ${lease}
                WHERE id = ${onlyId} AND status = 'pending' AND (locked_until IS NULL OR locked_until < ${now}) RETURNING id`
    : await sql`UPDATE webhook_deliveries SET locked_until = ${lease}
                WHERE id IN (SELECT id FROM webhook_deliveries WHERE status = 'pending' AND next_retry_at <= ${now}
                             AND (locked_until IS NULL OR locked_until < ${now}) ORDER BY next_retry_at ASC LIMIT ${limit})
                AND (locked_until IS NULL OR locked_until < ${now}) RETURNING id`;
  const res = { delivered: 0, failed: 0, retried: 0 };
  for (const c of claimed) {
    const id = str(c.id);
    const [r] = await sql`
      SELECT d.id, d.attempt_count, d.event_id, e.url, e.secret, e.status AS endpoint_status, ev.event_type, ev.payload
      FROM webhook_deliveries d JOIN webhook_endpoints e ON e.id = d.endpoint_id JOIN webhook_events ev ON ev.id = d.event_id
      WHERE d.id = ${id}`;
    if (!r) continue;
    if (str(r.endpoint_status) !== "active") {
      await sql`UPDATE webhook_deliveries SET status = 'failed', last_error = 'endpoint disabled', locked_until = NULL WHERE id = ${id}`;
      res.failed++;
      continue;
    }
    const body = JSON.stringify(json<Record<string, unknown>>(r.payload, {}));
    const attempts = int(r.attempt_count) + 1;
    const url = str(r.url);
    let status: number | null = null;
    let error: string | null = null;
    try {
      const local = isLocalDevUrl(url);
      const target = local ? new URL(url) : await assertPublicWebhookUrl(url, deps.resolve);
      const fetchImpl = deps.fetchImpl ?? (local ? fetch : pinnedFetch);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), WEBHOOK_TIMEOUT_MS);
      try {
        const resp = await fetchImpl(target.toString(), {
          method: "POST",
          redirect: "manual", // never follow redirects (SSRF)
          signal: ctrl.signal,
          headers: {
            "content-type": "application/json",
            "user-agent": "MezoCommerce-Webhooks/1",
            "MezoCommerce-Event-Id": str(r.event_id),
            "MezoCommerce-Event-Type": str(r.event_type),
            "MezoCommerce-Signature": signWebhook(str(r.secret), body),
          },
          body,
        });
        status = resp.status;
        if (resp.status < 200 || resp.status >= 300) error = `HTTP ${resp.status}`;
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      error = (e as Error).name === "AbortError" ? "timeout" : ((e as Error).message || "request failed").slice(0, 200);
    }
    const t = clock.now();
    if (!error) {
      await sql`UPDATE webhook_deliveries SET status = 'delivered', attempt_count = ${attempts}, response_status = ${status},
                last_error = NULL, delivered_at = ${t}, locked_until = NULL WHERE id = ${id}`;
      res.delivered++;
    } else if (attempts >= WEBHOOK_MAX_ATTEMPTS) {
      await sql`UPDATE webhook_deliveries SET status = 'failed', attempt_count = ${attempts}, response_status = ${status},
                last_error = ${error}, locked_until = NULL WHERE id = ${id}`;
      res.failed++;
    } else {
      await sql`UPDATE webhook_deliveries SET attempt_count = ${attempts}, response_status = ${status}, last_error = ${error},
                next_retry_at = ${addSeconds(t, webhookBackoffSeconds(attempts))}, locked_until = NULL WHERE id = ${id}`;
      res.retried++;
    }
  }
  return res;
}
