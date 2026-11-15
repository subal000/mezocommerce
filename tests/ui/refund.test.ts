import { describe, expect, it } from "vitest";
import { refundableWei, validateRefundAmount } from "@/lib/client/refund";

const E = 10n ** 18n;

describe("refundableWei", () => {
  it("is amount minus refunded, never negative", () => {
    expect(refundableWei((10n * E).toString(), (4n * E).toString())).toBe(6n * E);
    expect(refundableWei("100", "100")).toBe(0n);
    expect(refundableWei("100", "150")).toBe(0n);
    expect(refundableWei(5n, 0n)).toBe(5n);
  });
});

describe("validateRefundAmount", () => {
  const left = 6n * E;
  it("accepts amounts up to what's left", () => {
    expect(validateRefundAmount("6", left)).toEqual({ ok: true, wei: 6n * E });
    expect(validateRefundAmount("0.01", left)).toEqual({ ok: true, wei: E / 100n });
    expect(validateRefundAmount(" 2.5 ", left)).toEqual({ ok: true, wei: (25n * E) / 10n });
  });

  it("rejects more than what's left", () => {
    const r = validateRefundAmount("6.000000000000000001", left);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("at most 6.00 MUSD");
  });

  it("rejects empty, zero, negative and junk", () => {
    expect(validateRefundAmount("", left).ok).toBe(false);
    expect(validateRefundAmount("0", left).ok).toBe(false);
    expect(validateRefundAmount("-1", left).ok).toBe(false);
    expect(validateRefundAmount("abc", left).ok).toBe(false);
    expect(validateRefundAmount("1.1234567890123456789", left).ok).toBe(false);
  });

  it("says when there's nothing left to refund", () => {
    const r = validateRefundAmount("1", 0n);
    expect(r).toEqual({ ok: false, error: "This payment is already fully refunded." });
  });
});
