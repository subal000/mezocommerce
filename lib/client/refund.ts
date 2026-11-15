import { tryParseMusd, formatMusd } from "@/lib/money";

/** How much of a payment can still be refunded (wei). Never negative. */
export function refundableWei(amount: string | bigint, refunded: string | bigint): bigint {
  const a = typeof amount === "bigint" ? amount : BigInt(amount || "0");
  const r = typeof refunded === "bigint" ? refunded : BigInt(refunded || "0");
  return a > r ? a - r : 0n;
}

export type RefundCheck = { ok: true; wei: bigint } | { ok: false; error: string };

/** Validates the refund amount input against what's left (also enforced on-chain). Unit tested. */
export function validateRefundAmount(input: string, refundable: bigint): RefundCheck {
  const raw = input.trim();
  if (raw === "") return { ok: false, error: "Enter an amount." };
  if (raw.startsWith("-")) return { ok: false, error: "The amount can't be negative." };
  const wei = tryParseMusd(raw);
  if (wei === null) return { ok: false, error: "Enter a number like 10 or 10.50." };
  if (wei <= 0n) return { ok: false, error: "The amount must be more than zero." };
  if (refundable <= 0n) return { ok: false, error: "This payment is already fully refunded." };
  if (wei > refundable) return { ok: false, error: `You can refund at most ${formatMusd(refundable, { decimals: 2 })} MUSD.` };
  return { ok: true, wei };
}
