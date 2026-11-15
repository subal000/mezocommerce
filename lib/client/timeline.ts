import type { PaymentIntentDetailDTO } from "@/lib/api-types";
import type { Tone } from "./status";
import { musdDisplay } from "./format";

export interface TimelineItem {
  at: string;
  title: string;
  detail?: string;
  tone: Tone;
  txHash?: string | null;
}

/** Payment history built from the detail DTO, oldest first. Pure, unit tested. */
export function buildTimeline(p: PaymentIntentDetailDTO): TimelineItem[] {
  const out: TimelineItem[] = [{ at: p.created_at, title: "Payment created", detail: p.source === "shopify" ? "From a Shopify order" : p.source === "api" ? "From the API" : undefined, tone: "idle" }];
  for (const a of p.attempts) {
    out.push({ at: a.created_at, title: "Customer sent a transaction", detail: "Reported by checkout. We check it on-chain ourselves.", tone: "info", txHash: a.transaction_hash });
    if (a.status === "failed") out.push({ at: a.created_at, title: "Transaction didn't count", detail: a.failure_reason ?? "Reverted, or didn't match this payment.", tone: "bad", txHash: a.transaction_hash });
  }
  if (p.payment) {
    out.push({
      at: p.payment.paid_at,
      title: p.payment.status === "reorged" ? "On-chain payment dropped" : "Payment found on-chain",
      detail: p.payment.status === "reorged" ? "The block was replaced, so this payment isn't counted." : `Block ${p.payment.block_number}. Amount, wallet and store all match.`,
      tone: p.payment.status === "reorged" ? "bad" : "warn",
      txHash: p.payment.transaction_hash,
    });
    if (p.payment.confirmed_at) {
      out.push({ at: p.payment.confirmed_at, title: p.late ? "Confirmed (paid late)" : "Confirmed. Safe to fulfil", detail: `${p.payment.confirmations} confirmations.`, tone: "ok" });
    }
  }
  for (const r of p.refunds) {
    out.push({ at: r.created_at, title: `Refund of ${musdDisplay(r.amount_display)} MUSD started`, detail: r.reason || undefined, tone: "idle" });
    if (r.status === "confirmed" && r.confirmed_at) out.push({ at: r.confirmed_at, title: `Refunded ${musdDisplay(r.amount_display)} MUSD`, tone: "ok", txHash: r.transaction_hash });
    if (r.status === "failed") out.push({ at: r.confirmed_at ?? r.created_at, title: "Refund failed", tone: "bad", txHash: r.transaction_hash });
  }
  const ev = (t: string) => p.events.find((e) => e.type === t)?.created_at;
  if (p.status === "expired" || (p.late && ev("payment.expired"))) out.push({ at: ev("payment.expired") ?? p.expires_at, title: "Expired", detail: "The payment window closed.", tone: "idle" });
  if (p.status === "cancelled" || (p.late && ev("payment.cancelled"))) out.push({ at: ev("payment.cancelled") ?? p.updated_at, title: "Cancelled", tone: "idle" });
  return out.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

export const EVENT_LABEL: Record<string, string> = {
  "payment.created": "Payment created",
  "payment.pending": "Seen on-chain, confirming",
  "payment.confirmed": "Paid and confirmed",
  "payment.failed": "Transaction failed",
  "payment.expired": "Expired",
  "payment.cancelled": "Cancelled",
  "payment.refunded": "Refunded",
  ping: "Test ping",
};
