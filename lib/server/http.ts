// Route-handler glue: error mapping, zod parsing, rate limits, auth resolution, Idempotency-Key, origin checks.
//
//   export const GET  = route(async (req, { sql, params }) => …)                      // public
//   export const POST = sessionRoute(async (req, { session }) => …)                   // signed-in wallet
//   export const GET  = merchantRoute(async (req, { merchant }) => …)                 // signed-in merchant owner
//   export const POST = apiRoute(async (req, { merchant, apiKey }) => …, { permission: "payment_intents:write" })

import { createHash } from "node:crypto";
import { z, ZodError } from "zod";
import type { ApiError } from "@/lib/api-types";
import { getDb, type Sql } from "./db";
import { addSeconds, clock } from "./clock";
import { env } from "./env";
import {
  DbUnavailableError,
  HttpError,
  badRequest,
  conflict,
  forbidden,
  isDbUnavailableError,
  isUniqueViolation,
  tooMany,
  unauthorized,
} from "./errors";
import { readCookie, requireSession, SESSION_COOKIE, unsignSessionCookie, type Session } from "./auth";
import { merchantForUser, type MerchantRow } from "./merchants";
import { authenticateApiKey, requirePermission, type ApiKeyAuth, type ApiPermission } from "./api-keys";

export interface RouteOptions {
  /** Requests per window per client IP (and per session / API key when present). */
  rateLimit?: { bucket: string; limit: number; windowSec?: number };
  /** Honour the Idempotency-Key header (POST only; 2xx JSON responses are replayed, same key + other body → 409). */
  idempotent?: boolean;
}

type Params = Record<string, string>;

export interface BaseCtx<P extends Params = Params> {
  params: P;
  sql: Sql;
}
export interface SessionCtx<P extends Params = Params> extends BaseCtx<P> {
  session: Session;
  actor: string;
}
export interface MerchantCtx<P extends Params = Params> extends SessionCtx<P> {
  merchant: MerchantRow;
}
export interface ApiCtx<P extends Params = Params> extends BaseCtx<P> {
  merchant: MerchantRow;
  apiKey: ApiKeyAuth;
  actor: string;
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), {
    ...init,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...(init.headers ?? {}) },
  });
}

export function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) {
    const body: ApiError = { error: { code: e.code, message: e.message, ...(e.details !== undefined ? { details: e.details } : {}) } };
    const headers: Record<string, string> = e.status === 429 ? { "retry-after": "60" } : {};
    return json(body, { status: e.status, headers });
  }
  if (e instanceof ZodError) {
    const body: ApiError = {
      error: {
        code: "validation_error",
        message: e.issues[0] ? `${e.issues[0].path.join(".") || "body"}: ${e.issues[0].message}` : "Invalid request",
        details: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
    };
    return json(body, { status: 400 });
  }
  if (isDbUnavailableError(e)) {
    console.error("[api] database unavailable:", (e as Error)?.message);
    const body: ApiError = { error: { code: "service_unavailable", message: "The service is temporarily unavailable. Please retry shortly." } };
    return json(body, { status: 503, headers: { "retry-after": "5" } });
  }
  if (isUniqueViolation(e)) {
    const body: ApiError = { error: { code: "conflict", message: "This resource already exists or was changed concurrently." } };
    return json(body, { status: 409 });
  }
  console.error("[api] unhandled", e);
  const body: ApiError = { error: { code: "internal", message: "Something went wrong on our side. Please try again." } };
  return json(body, { status: 500 });
}

export function clientIp(req: Request): string {
  // x-real-ip is set by the platform proxy (Vercel/Render) and can't be prepended to by the client.
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0].trim() || "unknown";
  return "unknown";
}

/** Fixed-window counter in `rate_limits`. Throws 429 when exceeded. */
export async function rateLimit(sql: Sql, key: string, limit: number, windowSec = 60): Promise<void> {
  const now = clock.now();
  const windowStartCutoff = addSeconds(now, -windowSec);
  const [row] = await sql<{ count: number }>`
    INSERT INTO rate_limits (key, window_start, count) VALUES (${key}, ${now}, 1)
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_limits.window_start < ${windowStartCutoff}::timestamptz THEN 1 ELSE rate_limits.count + 1 END,
      window_start = CASE WHEN rate_limits.window_start < ${windowStartCutoff}::timestamptz THEN ${now}::timestamptz ELSE rate_limits.window_start END
    RETURNING count`;
  if (Number(row?.count ?? 0) > limit) throw tooMany();
}

/** Reject cross-site state-changing requests (defence in depth on top of SameSite=Lax). */
function checkOrigin(req: Request) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return;
  const origin = req.headers.get("origin");
  if (!origin || origin === "null") return;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    throw forbidden("Bad origin");
  }
  const allowed = new Set<string>();
  const reqHost = req.headers.get("x-forwarded-host") || req.headers.get("host");
  if (reqHost) allowed.add(reqHost);
  try {
    allowed.add(new URL(env.appUrl()).host);
  } catch {
    /* ignore */
  }
  if (!allowed.has(host)) throw forbidden("Cross-site request blocked");
}

const MAX_BODY = 64_000;

export async function parseBody<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  let raw: unknown = {};
  const text = await req.text();
  if (text.length > MAX_BODY) throw badRequest("Request body too large");
  if (text.trim()) {
    try {
      raw = JSON.parse(text);
    } catch {
      throw badRequest("Body must be JSON");
    }
  }
  return schema.parse(raw);
}

export function parseQuery<T extends z.ZodType>(req: Request, schema: T): z.infer<T> {
  const url = new URL(req.url);
  return schema.parse(Object.fromEntries(url.searchParams.entries()));
}

/**
 * Sign-in domain/URI. In production the domain is pinned to NEXT_PUBLIC_APP_URL (plus optional
 * SIWE_EXTRA_DOMAINS, comma-separated, e.g. a Vercel preview host): request headers are never trusted there,
 * so a message signed on a phishing origin is rejected. In development the request host is accepted too.
 */
export function siweOrigin(req: Request): { domain: string; uri: string; allowedDomains: string[] } {
  const app = new URL(env.appUrl());
  const extra = (process.env.SIWE_EXTRA_DOMAINS || "").split(",").map((d) => d.trim()).filter(Boolean);
  if (process.env.NODE_ENV === "production") {
    return { domain: app.host, uri: app.origin, allowedDomains: Array.from(new Set([app.host, ...extra])) };
  }
  const reqHost = req.headers.get("host") || new URL(req.url).host;
  const proto = new URL(req.url).protocol.replace(":", "");
  return { domain: reqHost, uri: `${proto}://${reqHost}`, allowedDomains: Array.from(new Set([reqHost, app.host, ...extra])) };
}

// ---------------------------------------------------------------- core wrapper

interface Resolved<C> {
  ctx: C;
  /** Who the Idempotency-Key and per-principal rate limit are scoped to. */
  scope: string | null;
}

async function openDb(): Promise<Sql> {
  try {
    return await getDb();
  } catch (e) {
    throw new DbUnavailableError(e);
  }
}

function core<P extends Params, C>(
  resolve: (req: Request, base: BaseCtx<P>) => Promise<Resolved<C>>,
  fn: (req: Request, ctx: C) => Promise<unknown>,
  opts: RouteOptions,
) {
  return async (incoming: Request, rctx?: { params?: Promise<P> | P }): Promise<Response> => {
    let sqlForCleanup: Sql | null = null;
    let idemKey: string | null = null;
    try {
      checkOrigin(incoming);
      // Read the body once so it can be hashed for idempotency and re-read by the handler.
      let req = incoming;
      let bodyText = "";
      if (incoming.method !== "GET" && incoming.method !== "HEAD") {
        bodyText = await incoming.text();
        if (bodyText.length > MAX_BODY) throw badRequest("Request body too large");
        req = new Request(incoming.url, { method: incoming.method, headers: incoming.headers, body: bodyText || undefined });
      }
      const sql = await openDb();
      sqlForCleanup = sql;
      const params = ((await rctx?.params) ?? {}) as P;
      if (opts.rateLimit) {
        const { bucket, limit, windowSec } = opts.rateLimit;
        await rateLimit(sql, `${bucket}:ip:${clientIp(req)}`, limit, windowSec);
      }
      const { ctx, scope } = await resolve(req, { params, sql });
      if (opts.rateLimit && scope) {
        const { bucket, limit, windowSec } = opts.rateLimit;
        await rateLimit(sql, `${bucket}:${scope}`, limit, windowSec);
      }

      const idemHeader = opts.idempotent && req.method === "POST" ? req.headers.get("idempotency-key") : null;
      if (idemHeader !== null) {
        if (idemHeader.length < 1 || idemHeader.length > 200) throw badRequest("Idempotency-Key must be 1–200 characters");
        const path = new URL(req.url).pathname;
        idemKey = `${scope ?? `ip:${clientIp(req)}`}:${path}:${idemHeader}`;
        const requestHash = createHash("sha256").update(bodyText).digest("hex");
        const cutoff = addSeconds(clock.now(), -86400);
        await sql`DELETE FROM idempotency_keys WHERE key = ${idemKey} AND created_at < ${cutoff}`;
        const claimed = await sql`
          INSERT INTO idempotency_keys (key, request_hash, status_code, response, created_at)
          VALUES (${idemKey}, ${requestHash}, 0, ${{}}::jsonb, ${clock.now()})
          ON CONFLICT (key) DO NOTHING RETURNING key`;
        if (claimed.length === 0) {
          const [hit] = await sql<{ request_hash: string; status_code: number; response: unknown }>`
            SELECT request_hash, status_code, response FROM idempotency_keys WHERE key = ${idemKey}`;
          idemKey = null; // never delete someone else's row in the catch below
          if (hit && hit.request_hash !== requestHash) {
            throw conflict("idempotency_key_reused", "This Idempotency-Key was already used with a different request body");
          }
          if (!hit || Number(hit.status_code) === 0) {
            throw conflict("idempotency_in_progress", "A request with this Idempotency-Key is still being processed");
          }
          const body = typeof hit.response === "string" ? JSON.parse(hit.response) : hit.response;
          return json(body, { status: Number(hit.status_code), headers: { "idempotent-replayed": "true" } });
        }
      }

      const result = await fn(req, ctx);
      if (result instanceof Response) {
        if (idemKey) await sql`DELETE FROM idempotency_keys WHERE key = ${idemKey} AND status_code = 0`;
        return result;
      }
      if (idemKey) {
        const stored = JSON.stringify(result ?? {}, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
        await sql`UPDATE idempotency_keys SET status_code = 200, response = ${stored}::jsonb WHERE key = ${idemKey}`;
      }
      return json(result);
    } catch (e) {
      if (idemKey && sqlForCleanup) {
        await sqlForCleanup`DELETE FROM idempotency_keys WHERE key = ${idemKey} AND status_code = 0`.catch(() => undefined);
      }
      return errorResponse(e);
    }
  };
}

/** Public route (no auth). Session-scoped rate limit applies when a session cookie is present. */
export function route<P extends Params = Params>(fn: (req: Request, ctx: BaseCtx<P>) => Promise<unknown>, opts: RouteOptions = {}) {
  return core<P, BaseCtx<P>>(
    async (req, base) => {
      const sid = unsignSessionCookie(readCookie(req.headers.get("cookie"), SESSION_COOKIE));
      return { ctx: base, scope: sid ? `s:${sid.slice(0, 16)}` : null };
    },
    fn,
    opts,
  );
}

/** Signed-in wallet (merchant profile not required). */
export function sessionRoute<P extends Params = Params>(fn: (req: Request, ctx: SessionCtx<P>) => Promise<unknown>, opts: RouteOptions = {}) {
  return core<P, SessionCtx<P>>(
    async (req, base) => {
      const session = await requireSession(base.sql, req);
      return { ctx: { ...base, session, actor: session.address }, scope: `u:${session.userId}` };
    },
    fn,
    opts,
  );
}

/** Signed-in merchant owner. 404 `merchant_not_found` until the profile exists. */
export function merchantRoute<P extends Params = Params>(fn: (req: Request, ctx: MerchantCtx<P>) => Promise<unknown>, opts: RouteOptions = {}) {
  return core<P, MerchantCtx<P>>(
    async (req, base) => {
      const session = await requireSession(base.sql, req);
      const merchant = await merchantForUser(base.sql, session.userId);
      if (!merchant) throw new HttpError(404, "merchant_not_found", "Create your merchant profile first");
      return { ctx: { ...base, session, merchant, actor: session.address }, scope: `m:${merchant.id}` };
    },
    fn,
    opts,
  );
}

/** Public v1 API (Authorization: Bearer mc_test_sk_…). Merchant isolation comes from the key. */
export function apiRoute<P extends Params = Params>(
  fn: (req: Request, ctx: ApiCtx<P>) => Promise<unknown>,
  opts: RouteOptions & { permission: ApiPermission },
) {
  return core<P, ApiCtx<P>>(
    async (req, base) => {
      const auth = req.headers.get("authorization") || "";
      const m = /^Bearer\s+(\S+)$/i.exec(auth);
      if (!m) throw unauthorized("Missing API key (Authorization: Bearer mc_test_sk_…)");
      const { key, merchant } = await authenticateApiKey(base.sql, m[1]);
      requirePermission(key, opts.permission);
      return { ctx: { ...base, merchant, apiKey: key, actor: `api:${key.prefix}` }, scope: `m:${merchant.id}` };
    },
    fn,
    opts,
  );
}

// ---------------------------------------------------------------- shared zod pieces

export const zTxHash = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "must be a 32-byte 0x hash") as unknown as z.ZodType<`0x${string}`>;
export const zAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x address");
export const zPage = z.coerce.number().int().min(1).max(10_000).default(1);
export const zPageSize = z.coerce.number().int().min(1).max(100).default(20);
