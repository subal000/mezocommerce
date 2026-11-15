// FROZEN. Payment intent state machine (pure; shared by API, worker and UI).
//
//   created ──checkout opened──▶ awaiting_payment
//   created|awaiting_payment ──client reports tx (UNVERIFIED hint)──▶ submitted
//   submitted ──reported tx reverted / not ours──▶ awaiting_payment   (a payment_attempt row is marked failed)
//   created|awaiting_payment|submitted ──PaymentCompleted log seen, receipt ok, all fields match, confs < N──▶ confirming
//   created|awaiting_payment|submitted|confirming ──same, confs ≥ N──▶ paid
//   created|awaiting_payment|submitted ──now > expires_at and no PaymentCompleted──▶ expired
//   created|awaiting_payment|submitted ──merchant cancels (API) / PaymentCancelled log──▶ cancelled
//   confirming ──reorg removed the log──▶ awaiting_payment (or expired)
//   paid ──RefundCompleted, total < amount──▶ partially_refunded ──…total == amount──▶ refunded
//
// Only the indexer / receipt verifier moves an intent into confirming|paid|partially_refunded|refunded.
// A PaymentCompleted for an intent that is expired/cancelled in the DB is still recorded (the money moved on-chain);
// the intent becomes `paid` with `late=true` so the merchant can fulfil or refund. (Expiry is enforced on-chain, so
// this only happens when a DB-only cancel races a payment.)
//
// "underpaid" / "overpaid" cannot occur: the contract transfers exactly the signed amount or reverts. Direct
// ERC-20 transfers to a merchant that bypass the contract are not matched to orders (documented limitation).

export const INTENT_STATUSES = [
  "created",
  "awaiting_payment",
  "submitted",
  "confirming",
  "paid",
  "expired",
  "cancelled",
  "partially_refunded",
  "refunded",
] as const;
export type IntentStatus = (typeof INTENT_STATUSES)[number];

const T: Record<IntentStatus, readonly IntentStatus[]> = {
  created: ["awaiting_payment", "submitted", "confirming", "paid", "expired", "cancelled"],
  awaiting_payment: ["submitted", "confirming", "paid", "expired", "cancelled"],
  submitted: ["awaiting_payment", "confirming", "paid", "expired", "cancelled"],
  confirming: ["paid", "awaiting_payment", "expired"],
  paid: ["partially_refunded", "refunded"],
  partially_refunded: ["refunded", "partially_refunded"],
  refunded: [],
  // Late payment (money already moved on-chain) is the only exit from a terminal unpaid state.
  expired: ["confirming", "paid"],
  cancelled: ["confirming", "paid"],
};

export function canTransition(from: IntentStatus, to: IntentStatus): boolean {
  return T[from].includes(to);
}

/** Statuses in which the customer may still attempt payment (subject to on-chain expiry). */
export const PAYABLE: readonly IntentStatus[] = ["created", "awaiting_payment", "submitted"];
/** Statuses that mean the merchant has been paid on-chain (confirmed). */
export const SETTLED: readonly IntentStatus[] = ["paid", "partially_refunded", "refunded"];
export const TERMINAL_UNPAID: readonly IntentStatus[] = ["expired", "cancelled"];

export const isPayable = (s: IntentStatus) => PAYABLE.includes(s);
export const isSettled = (s: IntentStatus) => SETTLED.includes(s);

/** Effective status for display: a payable intent past its expiry reads as expired even before the worker runs. */
export function effectiveStatus(status: IntentStatus, expiresAt: Date | string, now: Date = new Date()): IntentStatus {
  if (isPayable(status) && new Date(expiresAt).getTime() < now.getTime()) return "expired";
  return status;
}

/** Refund status of a settled payment from cumulative amounts (wei). */
export function refundStatus(amount: bigint, refunded: bigint): "paid" | "partially_refunded" | "refunded" {
  if (refunded <= 0n) return "paid";
  return refunded >= amount ? "refunded" : "partially_refunded";
}

/** Payment attempt (client-reported tx) statuses. */
export const ATTEMPT_STATUSES = ["submitted", "succeeded", "failed"] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

/** Refund lifecycle. requested = merchant asked (no tx yet); submitted = tx hash reported; confirmed = RefundCompleted verified. */
export const REFUND_STATUSES = ["requested", "submitted", "confirmed", "failed"] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

export const WEBHOOK_EVENT_TYPES = [
  "payment.created",
  "payment.pending", // PaymentCompleted seen, waiting for confirmations
  "payment.confirmed",
  "payment.failed", // a submitted payment tx reverted (the intent stays payable)
  "payment.expired",
  "payment.cancelled",
  "payment.refunded", // each confirmed refund; data.fully_refunded tells partial vs full
  "ping",
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];
