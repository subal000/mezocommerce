import type { IntentStatus, AttemptStatus, RefundStatus } from "@/lib/chain/payment-state";
import type { ShopifyOrderDTO, WebhookDeliveryDTO, PaymentDTO, MerchantDTO } from "@/lib/api-types";

/** Semantic tone → token colour. Always shown together with a word, never colour alone. */
export type Tone = "ok" | "info" | "warn" | "bad" | "idle";

export interface StatusMeta {
  label: string;
  tone: Tone;
  /** One short sentence for tooltips and detail pages. */
  hint: string;
}

/** Every payment intent status. The one map the whole dashboard reads. */
export const INTENT_STATUS: Record<IntentStatus, StatusMeta> = {
  created: { label: "Created", tone: "idle", hint: "Checkout link made. The customer hasn't opened it yet." },
  awaiting_payment: { label: "Awaiting payment", tone: "info", hint: "The customer opened checkout and hasn't paid yet." },
  submitted: { label: "Submitted", tone: "info", hint: "The customer sent a transaction. We're checking it on-chain." },
  confirming: { label: "Confirming", tone: "warn", hint: "Payment found on-chain. Waiting for confirmations." },
  paid: { label: "Paid", tone: "ok", hint: "Verified on-chain and confirmed. Safe to fulfil." },
  expired: { label: "Expired", tone: "idle", hint: "The payment window closed before the customer paid." },
  cancelled: { label: "Cancelled", tone: "idle", hint: "You cancelled this payment. It can't be paid." },
  partially_refunded: { label: "Partly refunded", tone: "warn", hint: "Part of this payment was sent back to the customer." },
  refunded: { label: "Refunded", tone: "bad", hint: "The full amount was sent back to the customer." },
};

export function intentStatusMeta(status: IntentStatus, late = false): StatusMeta {
  const base = INTENT_STATUS[status] ?? { label: String(status), tone: "idle" as Tone, hint: "" };
  if (late && (status === "paid" || status === "confirming")) {
    return { ...base, label: `${base.label}, late`, hint: "Paid after it expired or was cancelled. The money arrived; fulfil or refund." };
  }
  return base;
}

/** Statuses offered in the payments filter, in lifecycle order. */
export const INTENT_FILTERS: { value: IntentStatus | "pending" | ""; label: string }[] = [
  { value: "", label: "All" },
  { value: "paid", label: "Paid" },
  { value: "confirming", label: "Confirming" },
  { value: "awaiting_payment", label: "Awaiting payment" },
  { value: "submitted", label: "Submitted" },
  { value: "created", label: "Created" },
  { value: "partially_refunded", label: "Partly refunded" },
  { value: "refunded", label: "Refunded" },
  { value: "expired", label: "Expired" },
  { value: "cancelled", label: "Cancelled" },
];

export const ATTEMPT_STATUS: Record<AttemptStatus, StatusMeta> = {
  submitted: { label: "Checking", tone: "info", hint: "Reported by checkout. Not verified yet." },
  succeeded: { label: "Verified", tone: "ok", hint: "Matched the payment on-chain." },
  failed: { label: "Failed", tone: "bad", hint: "Reverted, or didn't match this payment." },
};

export const REFUND_STATUS: Record<RefundStatus, StatusMeta> = {
  requested: { label: "Waiting for wallet", tone: "idle", hint: "Created. Nothing moves until your wallet sends it." },
  submitted: { label: "Submitted", tone: "info", hint: "Sent. Waiting to verify it on-chain." },
  confirmed: { label: "Refunded", tone: "ok", hint: "Verified on-chain. The customer has the MUSD." },
  failed: { label: "Failed", tone: "bad", hint: "The refund transaction didn't go through." },
};

export const ONCHAIN_PAYMENT_STATUS: Record<PaymentDTO["status"], StatusMeta> = {
  confirming: { label: "Confirming", tone: "warn", hint: "Waiting for confirmations." },
  confirmed: { label: "Confirmed", tone: "ok", hint: "Enough confirmations." },
  reorged: { label: "Dropped", tone: "bad", hint: "The block holding this payment was replaced. Not counted." },
};

export const DELIVERY_STATUS: Record<WebhookDeliveryDTO["status"], StatusMeta> = {
  pending: { label: "Pending", tone: "info", hint: "Queued or waiting to retry." },
  delivered: { label: "Delivered", tone: "ok", hint: "Your endpoint answered 2xx." },
  failed: { label: "Failed", tone: "bad", hint: "All retries failed." },
};

export const SHOPIFY_SYNC_STATUS: Record<ShopifyOrderDTO["sync_status"], StatusMeta> = {
  pending: { label: "Waiting", tone: "info", hint: "Will be marked paid in Shopify once the payment confirms." },
  marked_paid: { label: "Marked paid", tone: "ok", hint: "Shopify shows this order as paid." },
  failed: { label: "Failed", tone: "bad", hint: "Couldn't update Shopify. We'll retry." },
  skipped: { label: "Skipped", tone: "idle", hint: "Not a MUSD order, or not in USD." },
};

export const MERCHANT_STATUS: Record<MerchantDTO["status"], StatusMeta> = {
  pending: { label: "Setup not finished", tone: "idle", hint: "Finish registering your wallet on-chain." },
  active: { label: "Accepting payments", tone: "ok", hint: "Registered and active on-chain." },
  inactive: { label: "Paused", tone: "warn", hint: "Payments are paused on-chain." },
};

/** Tailwind classes per tone, shared by badges, notices and dots. */
export const TONE_CLASS: Record<Tone, { text: string; bg: string; border: string; dot: string }> = {
  ok: { text: "text-ok", bg: "bg-ok/10", border: "border-ok/30", dot: "bg-ok" },
  info: { text: "text-info", bg: "bg-info/10", border: "border-info/30", dot: "bg-info" },
  warn: { text: "text-warn", bg: "bg-warn/10", border: "border-warn/35", dot: "bg-warn" },
  bad: { text: "text-bad", bg: "bg-bad/10", border: "border-bad/30", dot: "bg-bad" },
  idle: { text: "text-muted-foreground", bg: "bg-muted", border: "border-border", dot: "bg-idle" },
};
