// Reference storefront server logic. Demo orders + received webhooks are recorded in audit_logs
// (actions demo_store.order_created / demo_store.webhook) — the frozen schema has no storefront tables.
import { z } from "zod";
import type { DemoCheckoutResponse } from "@/lib/api-types";
import { musdToDecimalString } from "@/lib/money";
import type { Sql } from "./db";
import { iso, json, str } from "./db/rows";
import type { ChainAdapter } from "./chain";
import { audit } from "./audit";
import { authenticateApiKey, requirePermission } from "./api-keys";
import { env } from "./env";
import { HttpError, badRequest, notFound, unavailable } from "./errors";
import { findIntent, paymentRowFor } from "./dto";
import { newDemoOrderId } from "./ids";
import { createPaymentIntent } from "./intents";
import { effectiveStatus, isSettled } from "@/lib/chain/payment-state";
import { explorerTx } from "@/lib/chain/config";
import { clock } from "./clock";
import { verifyWebhookSignature } from "./webhooks";
import { DEMO_MAX_QTY, priceCart, type DemoLine, type DemoOrderDTO } from "./demo-store";

export const zDemoCheckout = z.object({
  items: z.array(z.object({ sku: z.string().min(1).max(64), qty: z.number().int().min(1).max(DEMO_MAX_QTY) })).min(1).max(10),
});

async function demoMerchant(sql: Sql) {
  const key = env.demoStoreApiKey();
  if (!key) throw unavailable("demo_store_not_configured", "The demo store is not configured (DEMO_STORE_API_KEY is unset)");
  try {
    const r = await authenticateApiKey(sql, key);
    requirePermission(r.key, "payment_intents:write");
    return r;
  } catch (e) {
    if (e instanceof HttpError && (e.status === 401 || e.status === 403)) {
      throw unavailable("demo_store_misconfigured", "The demo store's API key is invalid or revoked");
    }
    throw e;
  }
}

export async function demoCheckout(sql: Sql, chain: ChainAdapter, input: z.infer<typeof zDemoCheckout>): Promise<DemoCheckoutResponse> {
  const { key, merchant } = await demoMerchant(sql);
  let priced: ReturnType<typeof priceCart>;
  try {
    priced = priceCart(input.items);
  } catch (e) {
    throw badRequest((e as Error).message);
  }
  const orderId = newDemoOrderId();
  const amount = musdToDecimalString(priced.totalWei);
  const intent = await createPaymentIntent(sql, chain, {
    merchant,
    source: "demo_store",
    actor: `api:${key.prefix}`,
    input: {
      merchant_order_id: `demo:${orderId}`,
      amount,
      description: priced.lines.map((l) => `${l.qty} × ${l.name}`).join(", ").slice(0, 500),
      return_url: `${env.appUrl()}/demo-store/order/${orderId}`,
      cancel_url: `${env.appUrl()}/demo-store`,
      metadata: { demo_order_id: orderId },
    },
  });
  await audit(sql, {
    merchantId: merchant.id,
    actor: "demo_store",
    action: "demo_store.order_created",
    resourceId: orderId,
    metadata: { lines: priced.lines, amount, payment_intent_id: intent.id, checkout_url: intent.checkout_url },
  });
  return { payment_intent_id: intent.id, checkout_url: intent.checkout_url, amount_display: intent.amount_display, order_id: orderId };
}

/** The storefront's own receiver: verify MezoCommerce-Signature, dedupe on event id, record. */
export async function demoWebhook(sql: Sql, headers: Headers, rawBody: string): Promise<{ received: true; duplicate: boolean }> {
  const secret = env.demoStoreWebhookSecret();
  if (!secret) throw unavailable("demo_store_not_configured", "DEMO_STORE_WEBHOOK_SECRET is unset");
  const sig = headers.get("mezocommerce-signature") || "";
  if (!verifyWebhookSignature(secret, rawBody, sig, 300, Math.floor(clock.now().getTime() / 1000))) {
    throw new HttpError(401, "invalid_signature", "Invalid or expired MezoCommerce-Signature");
  }
  let payload: { id?: string; type?: string; data?: { payment_intent?: { id?: string; status?: string; metadata?: Record<string, string> } } };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    throw badRequest("Body must be JSON");
  }
  const eventId = String(payload.id ?? headers.get("mezocommerce-event-id") ?? "");
  if (!/^evt_[0-9A-Za-z]{1,40}$/.test(eventId)) throw badRequest("Missing event id");
  const dup = await sql`SELECT 1 FROM audit_logs WHERE action = 'demo_store.webhook' AND resource_id = ${eventId} LIMIT 1`;
  if (dup.length) return { received: true, duplicate: true };
  const pi = payload.data?.payment_intent;
  await audit(sql, {
    actor: "demo_store",
    action: "demo_store.webhook",
    resourceId: eventId,
    metadata: { type: payload.type ?? null, payment_intent_id: pi?.id ?? null, status: pi?.status ?? null, order_id: pi?.metadata?.demo_order_id ?? null },
  });
  return { received: true, duplicate: false };
}

export async function demoOrder(sql: Sql, orderId: string): Promise<DemoOrderDTO> {
  if (!/^demo_[0-9A-Za-z]{16}$/.test(orderId)) throw notFound("Order not found");
  const [o] = await sql`SELECT metadata FROM audit_logs WHERE action = 'demo_store.order_created' AND resource_id = ${orderId} LIMIT 1`;
  if (!o) throw notFound("Order not found");
  const meta = json<{ lines: DemoLine[]; amount: string; payment_intent_id: string }>(o.metadata, { lines: [], amount: "0", payment_intent_id: "" });
  const intent = await findIntent(sql, meta.payment_intent_id);
  const status = intent ? effectiveStatus(intent.status, intent.expires_at, clock.now()) : "unknown";
  const payment = intent ? await paymentRowFor(sql, intent.id) : null;
  const tx = payment && str(payment.status) !== "reorged" ? str(payment.transaction_hash) : null;
  const [hook] = await sql`SELECT metadata, created_at FROM audit_logs WHERE action = 'demo_store.webhook'
                           AND metadata->>'order_id' = ${orderId} AND metadata->>'type' = 'payment.confirmed' ORDER BY id ASC LIMIT 1`;
  return {
    order_id: orderId,
    payment_intent_id: meta.payment_intent_id,
    amount_display: meta.amount,
    items: meta.lines.map((l) => ({ sku: l.sku, name: l.name, qty: l.qty, amount_display: l.amount_display })),
    status,
    verified: intent ? isSettled(intent.status) : false,
    transaction_hash: tx,
    explorer_url: tx ? explorerTx(tx) : null,
    webhook_received: Boolean(hook),
    webhook_event_type: hook ? "payment.confirmed" : null,
    webhook_received_at: hook ? iso(hook.created_at) : null,
  };
}
