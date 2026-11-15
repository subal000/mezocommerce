// Merchant events: one webhook_events row per (deduped) event + one webhook_deliveries row per subscribed endpoint,
// and dashboard notifications honouring the merchant's notify_* preferences.
import type { PaymentIntentDTO, RefundDTO, WebhookPayload } from "@/lib/api-types";
import { contracts } from "@/lib/chain/config";
import type { WebhookEventType } from "@/lib/chain/payment-state";
import type { Sql } from "./db";
import { bool, json, str } from "./db/rows";
import { clock } from "./clock";
import { newEventId } from "./ids";
import { loadIntentDTO } from "./dto";

export interface EmitInput {
  merchantId: string;
  type: WebhookEventType;
  /** Unique forever: the same key never produces a second event (e.g. `payment.confirmed:<payment_id>`). */
  dedupeKey: string;
  intentId: string | null;
  refund?: RefundDTO;
  fullyRefunded?: boolean;
  /** Deliver to this endpoint only (test pings). */
  onlyEndpointId?: string;
}

/** Returns the new event id, or null when the dedupe key was already used. Call inside the state-change transaction. */
export async function emitEvent(sql: Sql, input: EmitInput): Promise<string | null> {
  const id = newEventId();
  const now = clock.now();
  let intent = input.intentId ? await loadIntentDTO(sql, input.intentId) : null;
  if (!intent && input.type !== "ping") return null;
  if (!intent) intent = samplePingIntent(input.merchantId, now);
  const payload: WebhookPayload = {
    id,
    object: "event",
    type: input.type,
    created_at: now.toISOString(),
    livemode: false,
    data: {
      payment_intent: intent,
      ...(input.refund ? { refund: input.refund } : {}),
      ...(input.fullyRefunded !== undefined ? { fully_refunded: input.fullyRefunded } : {}),
    },
  };
  const ins = await sql`
    INSERT INTO webhook_events (id, merchant_id, event_type, dedupe_key, payment_intent_id, payload, created_at)
    VALUES (${id}, ${input.merchantId}, ${input.type}, ${input.dedupeKey}, ${input.intentId}, ${payload}::jsonb, ${now})
    ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`;
  if (ins.length === 0) return null;
  const endpoints = input.onlyEndpointId
    ? await sql`SELECT id, event_types FROM webhook_endpoints WHERE id = ${input.onlyEndpointId} AND merchant_id = ${input.merchantId}`
    : await sql`SELECT id, event_types FROM webhook_endpoints WHERE merchant_id = ${input.merchantId} AND status = 'active'`;
  for (const ep of endpoints) {
    const types = json<string[]>(ep.event_types, ["*"]);
    if (!input.onlyEndpointId && !types.includes("*") && !types.includes(input.type)) continue;
    await sql`INSERT INTO webhook_deliveries (event_id, endpoint_id, status, next_retry_at, created_at)
              VALUES (${id}, ${str(ep.id)}, 'pending', ${now}, ${now}) ON CONFLICT (event_id, endpoint_id) DO NOTHING`;
  }
  return id;
}

export type NotificationKind =
  | "payment_confirmed"
  | "payment_failed"
  | "payment_expired"
  | "refund_confirmed"
  | "late_payment"
  | "shopify_error";

const PREF: Record<NotificationKind, "notify_payment" | "notify_failure" | "notify_refund" | null> = {
  payment_confirmed: "notify_payment",
  late_payment: "notify_payment",
  payment_failed: "notify_failure",
  payment_expired: "notify_failure",
  refund_confirmed: "notify_refund",
  shopify_error: null, // always (integration broken)
};

export async function notify(
  sql: Sql,
  merchantId: string,
  n: { kind: NotificationKind; title: string; body: string; link?: string | null; dedupeKey: string },
): Promise<void> {
  const pref = PREF[n.kind];
  if (pref) {
    const [m] = await sql`SELECT notify_payment, notify_failure, notify_refund FROM merchants WHERE id = ${merchantId}`;
    if (!m || !bool(m[pref])) return;
  }
  await sql`INSERT INTO notifications (merchant_id, kind, title, body, link, dedupe_key, created_at)
            VALUES (${merchantId}, ${n.kind}, ${n.title.slice(0, 200)}, ${n.body.slice(0, 1000)}, ${n.link ?? null}, ${n.dedupeKey}, ${clock.now()})
            ON CONFLICT (dedupe_key) DO NOTHING`;
}

/** Synthetic intent carried by `ping` test events (clearly fake ids, zero amount). */
function samplePingIntent(merchantId: string, now: Date): PaymentIntentDTO {
  const t = now.toISOString();
  return {
    id: "pi_test000000000000000000000",
    object: "payment_intent",
    payment_id: "0x" + "0".repeat(64),
    merchant_id: merchantId,
    merchant_order_id: "test",
    description: "Webhook test event",
    amount: "0",
    amount_display: "0",
    currency: "MUSD",
    token_address: contracts.musd.toLowerCase(),
    payout_address: "0x0000000000000000000000000000000000000000",
    payer_address: null,
    status: "created",
    late: false,
    checkout_url: "",
    return_url: null,
    cancel_url: null,
    metadata: { test: "true" },
    source: "api",
    expires_at: t,
    amount_refunded: "0",
    amount_refunded_display: "0",
    payment: null,
    created_at: t,
    updated_at: t,
  };
}
