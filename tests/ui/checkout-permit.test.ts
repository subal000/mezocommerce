import { describe, expect, it } from "vitest";
import { recoverTypedDataAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { MUSD_PERMIT_DOMAIN, MUSD_TESTNET } from "@/lib/chain/config";
import type { SignedIntentDTO } from "@/lib/api-types";
import {
  buildPermitTypedData,
  PERMIT_MAX_LIFETIME_SECONDS,
  permitDeadline,
  permitForIntent,
  splitPermitSignature,
  toIntentTuple,
} from "@/lib/client/checkout-permit";

const account = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const PROCESSOR = "0x4444444444444444444444444444444444444444" as Address;
const NOW = Date.parse("2026-11-10T12:00:00Z");
const nowS = BigInt(NOW / 1000);

function intent(expiresInS: number, amount = "10000000000000000000"): SignedIntentDTO {
  return {
    payment_id: "0x" + "11".repeat(32),
    merchant_id: "7",
    payout: "0x" + "22".repeat(20),
    token: MUSD_TESTNET.toLowerCase(),
    amount,
    payer: "0x0000000000000000000000000000000000000000",
    expires_at: String(nowS + BigInt(expiresInS)),
    signature: "0x" + "55".repeat(65),
  };
}

describe("permitDeadline", () => {
  it("is now + 20 min when the intent lives longer", () => {
    expect(permitDeadline(nowS + 3600n, NOW)).toBe(nowS + BigInt(PERMIT_MAX_LIFETIME_SECONDS));
  });
  it("never exceeds the intent expiry", () => {
    expect(permitDeadline(nowS + 300n, NOW)).toBe(nowS + 300n);
    for (const s of [1, 60, 1199, 1200, 1201, 86400]) {
      const d = permitDeadline(nowS + BigInt(s), NOW);
      expect(d <= nowS + BigInt(s)).toBe(true);
      expect(d <= nowS + 1200n).toBe(true);
    }
  });
});

describe("permit typed data", () => {
  it("permits EXACTLY the intent amount to the processor, on MUSD's domain", () => {
    const i = intent(3600, "12345000000000000000");
    const { typedData, deadline } = permitForIntent({ intent: i, owner: account.address, processor: PROCESSOR, nonce: 3n, nowMs: NOW });
    expect(typedData.domain).toEqual({ name: MUSD_PERMIT_DOMAIN.name, version: MUSD_PERMIT_DOMAIN.version, chainId: 31611, verifyingContract: i.token });
    expect(typedData.primaryType).toBe("Permit");
    expect(typedData.message).toEqual({ owner: account.address, spender: PROCESSOR, value: 12345000000000000000n, nonce: 3n, deadline });
    expect(deadline).toBe(nowS + 1200n);
  });
  it("deadline ≤ intent expiry for a short-lived intent", () => {
    const i = intent(90);
    const { typedData } = permitForIntent({ intent: i, owner: account.address, processor: PROCESSOR, nonce: 0n, nowMs: NOW });
    expect(typedData.message.deadline).toBe(BigInt(i.expires_at));
  });
  it("signs and recovers; v/r/s split is canonical", async () => {
    const td = buildPermitTypedData({ token: MUSD_TESTNET, owner: account.address, spender: PROCESSOR, value: 10n ** 19n, nonce: 0n, deadline: nowS + 600n });
    const sig = await account.signTypedData(td);
    const rec = await recoverTypedDataAddress({ ...td, signature: sig });
    expect(rec).toBe(account.address);
    const { v, r, s } = splitPermitSignature(sig);
    expect([27, 28]).toContain(v);
    expect(r).toMatch(/^0x[0-9a-f]{64}$/);
    expect(s).toMatch(/^0x[0-9a-f]{64}$/);
    expect((r + s.slice(2)) as Hex).toBe(sig.slice(0, 130));
  });
});

describe("toIntentTuple", () => {
  it("converts the API strings to the on-chain tuple", () => {
    const t = toIntentTuple(intent(600));
    expect(t.merchantId).toBe(7n);
    expect(t.amount).toBe(10n ** 19n);
    expect(t.expiresAt).toBe(nowS + 600n);
    expect(t.paymentId).toBe("0x" + "11".repeat(32));
  });
});
