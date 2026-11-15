// Shopify adapter: custom app + manual payment method (NOT a Shopify Payments gateway).
//   connect → orders/create webhook → intent per eligible order → /pay/shopify/:shop/:orderId → worker orderMarkAsPaid once.
// Pricing policy: orders in USD are charged 1 USD = 1 MUSD; any other currency is skipped with a reason.
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { ConnectShopifyRequest, ShopifyConnectionDTO, ShopifyOrderDTO } from "@/lib/api-types";
import type { IntentStatus } from "@/lib/chain/payment-state";
import type { Sql } from "./db";
import { int, iso, isoOrNull, str, strOrNull } from "./db/rows";
import type { ChainAdapter } from "./chain";
import { audit } from "./audit";
import { addSeconds, clock } from "./clock";
import { decryptSecret, encryptSecret } from "./crypto";
import { env } from "./env";
import { HttpError, badRequest, conflict, notFound } from "./errors";
import { notify } from "./events";
import { findIntent } from "./dto";
import { createPaymentIntent } from "./intents";
import { merchantById, merchantBySlug, type MerchantRow } from "./merchants";

export const SHOPIFY_API_VERSION = "2025-07";
export const SHOP_DOMAIN_RE = /^[a-z0-9][a-z0-9-]{0,60}\.myshopify\.com$/;
const MAX_SYNC_ATTEMPTS = 8;

// ---------------------------------------------------------------- Admin GraphQL

type FetchLike = typeof fetch;
let fetchImpl: FetchLike | null = null;
export function setShopifyFetchForTests(f: FetchLike | null) {
  fetchImpl = f;
}

export class ShopifyApiError extends Error {
  constructor(
    message: string,
    public status: number | null,
  ) {
    super(message);
    this.name = "ShopifyApiError";
  }
}

export async function adminGraphql<T>(shop: string, token: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  if (!SHOP_DOMAIN_RE.test(shop)) throw new ShopifyApiError("Invalid shop domain", null);
  const f = fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  let res: Response;
  try {
    res = await f(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-shopify-access-token": token },
      body: JSON.stringify({ query, variables }),
      redirect: "manual",
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new ShopifyApiError((e as Error).name === "AbortError" ? "Shopify request timed out" : "Could not reach Shopify", null);
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401 || res.status === 403) throw new ShopifyApiError("Shopify rejected the Admin API token", res.status);
  if (!res.ok) throw new ShopifyApiError(`Shopify returned HTTP ${res.status}`, res.status);
  const body = (await res.json()) as { data?: T; errors?: { message: string }[] | string };
  if (body.errors) {
    const msg = typeof body.errors === "string" ? body.errors : body.errors.map((e) => e.message).join("; ");
    throw new ShopifyApiError(`Shopify GraphQL error: ${msg}`.slice(0, 300), res.status);
  }
  return body.data as T;
}

// ---------------------------------------------------------------- connection

export interface ConnectionRow {
  id: string;
  merchant_id: string;
  shop_domain: string;
  access_token_enc: string;
  webhook_secret_enc: string;
  payment_method_name: string;
  status: ShopifyConnectionDTO["status"];
  last_error: string | null;
  created_at: string;
}

function toConnRow(r: Record<string, unknown>): ConnectionRow {
  return {
    id: str(r.id),
    merchant_id: str(r.merchant_id),
    shop_domain: str(r.shop_domain),
    access_token_enc: str(r.access_token_enc),
    webhook_secret_enc: str(r.webhook_secret_enc),
    payment_method_name: str(r.payment_method_name),
    status: str(r.status) as ConnectionRow["status"],
    last_error: strOrNull(r.last_error),
    created_at: iso(r.created_at),
  };
}

export function toConnectionDTO(c: ConnectionRow, m: MerchantRow): ShopifyConnectionDTO {
  return {
    shop_domain: c.shop_domain,
    payment_method_name: c.payment_method_name,
    status: c.status,
    last_error: c.last_error,
    webhook_url: `${env.appUrl()}/api/integrations/shopify/webhook/${m.slug}`,
    pay_link_template: `${env.appUrl()}/pay/shopify/${c.shop_domain}/{{ order.id }}`,
    created_at: c.created_at,
  };
}

export const zConnectShopify = z.object({
  shop_domain: z.string().trim().toLowerCase().max(100),
  admin_access_token: z.string().trim().min(10).max(200),
  webhook_secret: z.string().trim().min(8).max(200),
  payment_method_name: z.string().trim().min(1).max(100).optional(),
}) satisfies z.ZodType<ConnectShopifyRequest, unknown>;

export function normalizeShopDomain(raw: string): string {
  const s = raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!SHOP_DOMAIN_RE.test(s)) throw new HttpError(400, "invalid_shop_domain", "Shop domain must look like your-store.myshopify.com");
  return s;
}

export async function getConnection(sql: Sql, merchantId: string): Promise<ConnectionRow | null> {
  const [r] = await sql`SELECT * FROM shopify_connections WHERE merchant_id = ${merchantId}`;
  return r ? toConnRow(r) : null;
}

export async function connectShopify(sql: Sql, m: MerchantRow, input: z.infer<typeof zConnectShopify>, actor: string): Promise<ShopifyConnectionDTO> {
  const shop = normalizeShopDomain(input.shop_domain);
  const [taken] = await sql`SELECT merchant_id FROM shopify_connections WHERE shop_domain = ${shop} AND merchant_id <> ${m.id} AND status <> 'disconnected'`;
  if (taken) throw conflict("shop_already_connected", "This shop is connected to another merchant");
  try {
    await adminGraphql<{ shop: { name: string } }>(shop, input.admin_access_token, "{ shop { name } }");
  } catch (e) {
    throw new HttpError(422, "shopify_auth_failed", e instanceof ShopifyApiError ? e.message : "Could not verify the Shopify token");
  }
  const now = clock.now();
  const name = input.payment_method_name || "Pay with MUSD";
  // A disconnected row of another merchant may still hold the unique shop_domain: release it.
  await sql`DELETE FROM shopify_connections WHERE shop_domain = ${shop} AND merchant_id <> ${m.id} AND status = 'disconnected'
            AND NOT EXISTS (SELECT 1 FROM shopify_orders o WHERE o.connection_id = shopify_connections.id)`;
  await sql`
    INSERT INTO shopify_connections (merchant_id, shop_domain, access_token_enc, webhook_secret_enc, payment_method_name, status, created_at, updated_at)
    VALUES (${m.id}, ${shop}, ${encryptSecret(input.admin_access_token)}, ${encryptSecret(input.webhook_secret)}, ${name}, 'active', ${now}, ${now})
    ON CONFLICT (merchant_id) DO UPDATE SET shop_domain = EXCLUDED.shop_domain, access_token_enc = EXCLUDED.access_token_enc,
      webhook_secret_enc = EXCLUDED.webhook_secret_enc, payment_method_name = EXCLUDED.payment_method_name, status = 'active',
      last_error = NULL, updated_at = EXCLUDED.updated_at`;
  await audit(sql, { merchantId: m.id, actor, action: "shopify.connected", resourceId: shop, metadata: { payment_method_name: name } });
  return toConnectionDTO((await getConnection(sql, m.id))!, m);
}

export async function disconnectShopify(sql: Sql, m: MerchantRow, actor: string): Promise<{ disconnected: true }> {
  const c = await getConnection(sql, m.id);
  if (!c) throw notFound("Shopify is not connected");
  // Wipe the credentials; keep the row (orders reference it).
  await sql`UPDATE shopify_connections SET status = 'disconnected', access_token_enc = '', webhook_secret_enc = '', updated_at = ${clock.now()}
            WHERE id = ${c.id}`;
  await audit(sql, { merchantId: m.id, actor, action: "shopify.disconnected", resourceId: c.shop_domain });
  return { disconnected: true };
}

// ---------------------------------------------------------------- orders

interface OrderFacts {
  id: string; // numeric
  name: string;
  currency: string;
  financialStatus: string; // lowercase REST style: pending|paid|…
  gateways: string[];
  total: string; // decimal
  statusUrl: string | null;
}

export type Eligibility = { ok: true } | { ok: false; reason: string; ignore?: boolean };

export function orderEligibility(c: ConnectionRow, o: OrderFacts): Eligibility {
  const method = c.payment_method_name.trim().toLowerCase();
  if (!o.gateways.some((g) => g.trim().toLowerCase() === method)) return { ok: false, reason: "payment_method_not_selected", ignore: true };
  if (o.financialStatus !== "pending") return { ok: false, reason: `financial_status_${o.financialStatus || "unknown"}` };
  if (o.currency !== "USD") return { ok: false, reason: `unsupported_currency_${o.currency || "unknown"} (only USD orders are charged 1 USD = 1 MUSD)` };
  if (!/^\d+(\.\d{1,2})?$/.test(o.total) || Number(o.total) <= 0) return { ok: false, reason: "invalid_total" };
  return { ok: true };
}

function fromWebhook(p: Record<string, unknown>): OrderFacts {
  return {
    id: String(p.id ?? ""),
    name: String(p.name ?? `#${p.order_number ?? p.id}`),
    currency: String(p.currency ?? p.presentment_currency ?? "").toUpperCase(),
    financialStatus: String(p.financial_status ?? "").toLowerCase(),
    gateways: Array.isArray(p.payment_gateway_names) ? (p.payment_gateway_names as unknown[]).map(String) : [],
    total: String(p.current_total_price ?? p.total_price ?? ""),
    statusUrl: typeof p.order_status_url === "string" ? p.order_status_url : null,
  };
}

const ORDER_QUERY = `query($id: ID!) { order(id: $id) { id name currencyCode displayFinancialStatus paymentGatewayNames statusPageUrl
  totalPriceSet { shopMoney { amount currencyCode } } } }`;

interface GqlOrder {
  id: string;
  name: string;
  currencyCode: string;
  displayFinancialStatus: string | null;
  paymentGatewayNames: string[];
  statusPageUrl: string | null;
  totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
}

async function fetchOrder(c: ConnectionRow, orderId: string): Promise<OrderFacts | null> {
  const data = await adminGraphql<{ order: GqlOrder | null }>(c.shop_domain, decryptSecret(c.access_token_enc), ORDER_QUERY, {
    id: `gid://shopify/Order/${orderId}`,
  });
  const o = data.order;
  if (!o) return null;
  return {
    id: orderId,
    name: o.name,
    currency: (o.totalPriceSet?.shopMoney?.currencyCode || o.currencyCode || "").toUpperCase(),
    financialStatus: String(o.displayFinancialStatus ?? "").toLowerCase(),
    gateways: o.paymentGatewayNames ?? [],
    total: String(Number(o.totalPriceSet?.shopMoney?.amount ?? "0").toFixed(2)),
    statusUrl: o.statusPageUrl,
  };
}

/** Normalise "12.5" / "12.50" totals to a 2-dp decimal string. */
function usdToMusd(total: string): string {
  const [w, f = ""] = total.split(".");
  return `${w}.${(f + "00").slice(0, 2)}`;
}

/** Upsert the shopify_orders row and (when eligible) create the intent. Returns the row id + intent id. */
async function ingestOrder(sql: Sql, chain: ChainAdapter, c: ConnectionRow, m: MerchantRow, o: OrderFacts, actor: string): Promise<{ intentId: string | null; reason: string | null }> {
  const elig = orderEligibility(c, o);
  if (!elig.ok && elig.ignore) return { intentId: null, reason: elig.reason };
  const now = clock.now();
  const [row] = await sql`
    INSERT INTO shopify_orders (connection_id, shopify_order_id, order_name, sync_status, last_error, created_at)
    VALUES (${c.id}, ${o.id}, ${o.name.slice(0, 100)}, ${elig.ok ? "pending" : "skipped"}, ${elig.ok ? null : elig.reason}, ${now})
    ON CONFLICT (connection_id, shopify_order_id) DO UPDATE SET order_name = EXCLUDED.order_name
    RETURNING *`;
  if (!elig.ok) {
    if (str(row.sync_status) === "pending" && !row.payment_intent_id) {
      await sql`UPDATE shopify_orders SET sync_status = 'skipped', last_error = ${elig.reason} WHERE id = ${str(row.id)}`;
    }
    await audit(sql, { merchantId: m.id, actor, action: "shopify.order_skipped", resourceId: o.id, metadata: { reason: elig.reason } });
    return { intentId: null, reason: elig.reason };
  }
  // Existing open/paid intent → reuse.
  if (row.payment_intent_id) {
    const i = await findIntent(sql, str(row.payment_intent_id), m.id);
    if (i && i.status !== "expired" && i.status !== "cancelled" && !(i.expires_at.getTime() < now.getTime() && ["created", "awaiting_payment", "submitted"].includes(i.status))) {
      return { intentId: i.id, reason: null };
    }
  }
  try {
    const dto = await createPaymentIntent(sql, chain, {
      merchant: m,
      source: "shopify",
      actor,
      input: {
        merchant_order_id: `shopify:${o.id}`,
        amount: usdToMusd(o.total),
        description: `Shopify order ${o.name}`.slice(0, 500),
        return_url: o.statusUrl && o.statusUrl.startsWith("https://") ? o.statusUrl : null,
        metadata: { shopify_order_id: o.id, shopify_order_name: o.name.slice(0, 100), shop: c.shop_domain, pricing: "1 USD = 1 MUSD" },
      },
    });
    await sql`UPDATE shopify_orders SET payment_intent_id = ${dto.id}, sync_status = 'pending', last_error = NULL WHERE id = ${str(row.id)}`;
    return { intentId: dto.id, reason: null };
  } catch (e) {
    if (e instanceof HttpError && e.code === "order_has_open_intent") {
      const existing = (e.details as { payment_intent?: { id: string } } | undefined)?.payment_intent;
      if (existing) {
        await sql`UPDATE shopify_orders SET payment_intent_id = ${existing.id} WHERE id = ${str(row.id)}`;
        return { intentId: existing.id, reason: null };
      }
    }
    const reason = e instanceof HttpError ? e.code : "intent_creation_failed";
    await sql`UPDATE shopify_orders SET last_error = ${reason} WHERE id = ${str(row.id)}`;
    await audit(sql, { merchantId: m.id, actor, action: "shopify.intent_failed", resourceId: o.id, metadata: { reason } });
    if (e instanceof HttpError) return { intentId: null, reason };
    throw e;
  }
}

// ---------------------------------------------------------------- webhook receiver

export function verifyShopifyHmac(secret: string, rawBody: string, header: string | null): boolean {
  if (!header) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  let got: Buffer;
  try {
    got = Buffer.from(header, "base64");
  } catch {
    return false;
  }
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export async function handleShopifyWebhook(
  sql: Sql,
  chain: ChainAdapter,
  merchantSlug: string,
  headers: Headers,
  rawBody: string,
): Promise<{ ok: true; status: string; payment_intent_id?: string | null; reason?: string | null }> {
  const m = await merchantBySlug(sql, merchantSlug);
  const c = m ? await getConnection(sql, m.id) : null;
  if (!m || !c || c.status === "disconnected" || !c.webhook_secret_enc) throw new HttpError(404, "not_found", "Unknown Shopify integration");
  if (!verifyShopifyHmac(decryptSecret(c.webhook_secret_enc), rawBody, headers.get("x-shopify-hmac-sha256"))) {
    throw new HttpError(401, "invalid_hmac", "Invalid Shopify webhook signature");
  }
  const shop = (headers.get("x-shopify-shop-domain") || "").toLowerCase();
  if (shop && shop !== c.shop_domain) throw new HttpError(401, "shop_mismatch", "Webhook came from a different shop");
  const webhookId = headers.get("x-shopify-webhook-id") || headers.get("x-shopify-event-id");
  const topic = headers.get("x-shopify-topic") || "";
  if (!webhookId) throw badRequest("Missing X-Shopify-Webhook-Id");
  const fresh = await sql`INSERT INTO shopify_webhook_receipts (webhook_id, topic, received_at) VALUES (${webhookId.slice(0, 200)}, ${topic.slice(0, 100)}, ${clock.now()})
                          ON CONFLICT (webhook_id) DO NOTHING RETURNING webhook_id`;
  if (fresh.length === 0) return { ok: true, status: "duplicate" };
  if (topic !== "orders/create") return { ok: true, status: "ignored_topic" };
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    throw badRequest("Body must be JSON");
  }
  const o = fromWebhook(payload);
  if (!/^\d{1,20}$/.test(o.id)) throw badRequest("Order id missing");
  const r = await ingestOrder(sql, chain, c, m, o, "shopify");
  return { ok: true, status: r.intentId ? "intent_ready" : "skipped", payment_intent_id: r.intentId, reason: r.reason };
}

// ---------------------------------------------------------------- pay link

/** GET /pay/shopify/:shop/:orderId → checkout URL (creates the intent on demand from the Admin API). */
export async function resolvePayLink(sql: Sql, chain: ChainAdapter, shopRaw: string, orderId: string): Promise<{ url: string } | { error: string; status: number }> {
  let shop: string;
  try {
    shop = normalizeShopDomain(shopRaw);
  } catch {
    return { status: 404, error: "This payment link is not valid." };
  }
  if (!/^\d{1,20}$/.test(orderId)) return { status: 404, error: "This payment link is not valid." };
  const [cr] = await sql`SELECT * FROM shopify_connections WHERE shop_domain = ${shop} AND status <> 'disconnected'`;
  if (!cr) return { status: 404, error: "This store does not accept MUSD payments through MezoCommerce." };
  const c = toConnRow(cr);
  const m = await merchantById(sql, c.merchant_id);
  if (!m) return { status: 404, error: "Store not found." };

  const [row] = await sql`SELECT * FROM shopify_orders WHERE connection_id = ${c.id} AND shopify_order_id = ${orderId}`;
  if (row?.payment_intent_id) {
    const i = await findIntent(sql, str(row.payment_intent_id), m.id);
    const stale = i && (i.status === "expired" || i.status === "cancelled" || (["created", "awaiting_payment", "submitted"].includes(i.status) && i.expires_at.getTime() < clock.now().getTime()));
    if (i && !stale) return { url: i.checkout_url };
  }
  if (row && str(row.sync_status) === "skipped") return { status: 409, error: `This order can't be paid with MUSD (${str(row.last_error) || "not eligible"}).` };
  let o: OrderFacts | null;
  try {
    o = await fetchOrder(c, orderId);
  } catch (e) {
    await sql`UPDATE shopify_connections SET status = 'error', last_error = ${(e as Error).message.slice(0, 300)}, updated_at = ${clock.now()} WHERE id = ${c.id}`;
    return { status: 502, error: "We couldn't load this order from the store. Please try again shortly." };
  }
  if (!o) return { status: 404, error: "Order not found." };
  const r = await ingestOrder(sql, chain, c, m, o, "shopify_pay_link");
  if (!r.intentId) return { status: 409, error: `This order can't be paid with MUSD (${r.reason ?? "not eligible"}).` };
  const i = await findIntent(sql, r.intentId, m.id);
  return i ? { url: i.checkout_url } : { status: 500, error: "Something went wrong." };
}

// ---------------------------------------------------------------- dashboard list

export async function listShopifyOrders(sql: Sql, merchantId: string, page: number, pageSize: number) {
  const c = await getConnection(sql, merchantId);
  if (!c) return { data: [] as ShopifyOrderDTO[], page, page_size: pageSize, total: 0 };
  const [{ n }] = await sql<{ n: number }>`SELECT count(*)::int AS n FROM shopify_orders WHERE connection_id = ${c.id}`;
  const rows = await sql`SELECT o.*, i.status AS intent_status FROM shopify_orders o LEFT JOIN payment_intents i ON i.id = o.payment_intent_id
                         WHERE o.connection_id = ${c.id} ORDER BY o.created_at DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;
  const data: ShopifyOrderDTO[] = rows.map((r) => ({
    shopify_order_id: str(r.shopify_order_id),
    order_name: str(r.order_name),
    payment_intent_id: strOrNull(r.payment_intent_id),
    intent_status: (strOrNull(r.intent_status) as IntentStatus | null) ?? null,
    sync_status: str(r.sync_status) as ShopifyOrderDTO["sync_status"],
    last_error: strOrNull(r.last_error),
    marked_paid_at: isoOrNull(r.marked_paid_at),
    created_at: iso(r.created_at),
  }));
  return { data, page, page_size: pageSize, total: int(n) };
}

// ---------------------------------------------------------------- worker: mark paid once

const MARK_PAID = `mutation($input: OrderMarkAsPaidInput!) { orderMarkAsPaid(input: $input) { order { id displayFinancialStatus } userErrors { field message } } }`;
const STATUS_QUERY = `query($id: ID!) { order(id: $id) { id displayFinancialStatus } }`;
const ALREADY_PAID = new Set(["PAID", "PARTIALLY_REFUNDED", "REFUNDED"]);

export function shopifyBackoffSeconds(attempts: number): number {
  return Math.min(60 * 2 ** Math.max(0, attempts - 1), 6 * 3600);
}

/**
 * For each paid intent whose Shopify order is still `pending`: claim the row (next_sync_at lease), read
 * displayFinancialStatus first, call orderMarkAsPaid only if not already paid, then record marked_paid. Never twice.
 */
export async function runShopifySync(sql: Sql, limit = 20): Promise<{ marked: number; failed: number; retried: number }> {
  const now = clock.now();
  const out = { marked: 0, failed: 0, retried: 0 };
  const due = await sql`
    SELECT o.id FROM shopify_orders o JOIN payment_intents i ON i.id = o.payment_intent_id
    JOIN shopify_connections c ON c.id = o.connection_id
    WHERE o.sync_status = 'pending' AND i.status IN ('paid', 'partially_refunded', 'refunded') AND c.status <> 'disconnected'
      AND (o.next_sync_at IS NULL OR o.next_sync_at <= ${now})
    ORDER BY o.created_at ASC LIMIT ${limit}`;
  for (const d of due) {
    const id = str(d.id);
    const claimed = await sql`UPDATE shopify_orders SET next_sync_at = ${addSeconds(now, 300)}
                              WHERE id = ${id} AND sync_status = 'pending' AND (next_sync_at IS NULL OR next_sync_at <= ${now}) RETURNING *`;
    if (!claimed.length) continue;
    const o = claimed[0];
    const [cr] = await sql`SELECT * FROM shopify_connections WHERE id = ${str(o.connection_id)}`;
    const c = toConnRow(cr);
    const gid = `gid://shopify/Order/${str(o.shopify_order_id)}`;
    try {
      const token = decryptSecret(c.access_token_enc);
      const st = await adminGraphql<{ order: { displayFinancialStatus: string | null } | null }>(c.shop_domain, token, STATUS_QUERY, { id: gid });
      if (!st.order) throw new ShopifyApiError("Order no longer exists in Shopify", 404);
      if (!ALREADY_PAID.has(String(st.order.displayFinancialStatus))) {
        const r = await adminGraphql<{ orderMarkAsPaid: { userErrors: { message: string }[] } }>(c.shop_domain, token, MARK_PAID, { input: { id: gid } });
        const errs = r.orderMarkAsPaid?.userErrors ?? [];
        if (errs.length) throw new ShopifyApiError(errs.map((e) => e.message).join("; ").slice(0, 300), 200);
      }
      await sql`UPDATE shopify_orders SET sync_status = 'marked_paid', marked_paid_at = ${clock.now()}, last_error = NULL,
                sync_attempts = sync_attempts + 1 WHERE id = ${id}`;
      await audit(sql, { merchantId: c.merchant_id, actor: "worker", action: "shopify.order_marked_paid", resourceId: str(o.shopify_order_id), metadata: { intent: str(o.payment_intent_id), was: st.order.displayFinancialStatus } });
      if (c.status === "error") await sql`UPDATE shopify_connections SET status = 'active', last_error = NULL WHERE id = ${c.id}`;
      out.marked++;
    } catch (e) {
      const attempts = int(o.sync_attempts) + 1;
      const msg = ((e as Error).message || "Shopify sync failed").slice(0, 300);
      if (attempts >= MAX_SYNC_ATTEMPTS) {
        await sql`UPDATE shopify_orders SET sync_status = 'failed', sync_attempts = ${attempts}, last_error = ${msg} WHERE id = ${id}`;
        await notify(sql, c.merchant_id, {
          kind: "shopify_error",
          title: "Shopify order not updated",
          body: `Order ${str(o.order_name)} was paid in MUSD but could not be marked paid in Shopify: ${msg}. Mark it paid manually.`,
          link: "/merchant/shopify",
          dedupeKey: `shopify_error:${id}`,
        });
        out.failed++;
      } else {
        await sql`UPDATE shopify_orders SET sync_attempts = ${attempts}, last_error = ${msg},
                  next_sync_at = ${addSeconds(clock.now(), shopifyBackoffSeconds(attempts))} WHERE id = ${id}`;
        out.retried++;
      }
      if (e instanceof ShopifyApiError && (e.status === 401 || e.status === 403)) {
        await sql`UPDATE shopify_connections SET status = 'error', last_error = ${msg}, updated_at = ${clock.now()} WHERE id = ${c.id}`;
      }
    }
  }
  return out;
}
