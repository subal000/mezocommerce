import "./setup-env";
import { beforeEach, describe, expect, it } from "vitest";
import { recoverTypedDataAddress, verifyTypedData, type Address, type Hex } from "viem";
import { INTENT_DOMAIN, INTENT_TYPES, MEZO_TESTNET_ID, contracts } from "@/lib/chain/config";
import { getDb, resetDbForTests } from "@/lib/server/db";
import { setChainForTests } from "@/lib/server/chain";
import { clearReadinessCache } from "@/lib/server/merchants";
import { platformSignerAddress } from "@/lib/server/signer";
import { clock } from "@/lib/server/clock";
import { FakeChain, apiKeyFor, call, setupMerchant, CUSTOMER } from "./fakes";
import * as v1Intents from "@/app/api/v1/payment-intents/route";
import * as v1Cancel from "@/app/api/v1/payment-intents/[id]/cancel/route";
import * as checkoutRoute from "@/app/api/public/checkout/[id]/route";
import * as preflightRoute from "@/app/api/public/checkout/[id]/preflight/route";

describe("payment intent creation", () => {
  let chain: FakeChain;
  let key: string;
  const auth = () => ({ authorization: `Bearer ${key}` });
  const create = (body: unknown, headers: Record<string, string> = {}) =>
    call(v1Intents.POST, { method: "POST", path: "/api/v1/payment-intents", body, headers: { ...auth(), ...headers } });

  beforeEach(async () => {
    await resetDbForTests();
    clearReadinessCache();
    clock.set(null);
    chain = new FakeChain();
    setChainForTests(chain);
    key = await apiKeyFor(await setupMerchant(chain));
  });

  it("validates input", async () => {
    const bad = [
      { merchant_order_id: "", amount: "1" },
      { merchant_order_id: "has space", amount: "1" },
      { merchant_order_id: "o", amount: "abc" },
      { merchant_order_id: "o", amount: "-1" },
      { merchant_order_id: "o", amount: "0.001" },
      { merchant_order_id: "o", amount: "2000000" },
      { merchant_order_id: "o", amount: "1.0000000000000000001" },
      { merchant_order_id: "o", amount: "1", return_url: "javascript:alert(1)" },
      { merchant_order_id: "o", amount: "1", return_url: "http://shop.example/ok" },
      { merchant_order_id: "o", amount: "1", expires_in_seconds: 10 },
      { merchant_order_id: "o", amount: "1", payer_address: "0x123" },
      { merchant_order_id: "o", amount: "1", metadata: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, "v"])) },
      { merchant_order_id: "o", amount: "1", metadata: { k: "x".repeat(501) } },
      { merchant_order_id: "o", amount: "1", currency: "USD" },
    ];
    for (const b of bad) {
      const r = await create(b);
      expect(r.status, JSON.stringify(b)).toBe(400);
    }
    const ok = await create({ merchant_order_id: "o-1", amount: "10.50", return_url: "http://localhost:3000/thanks", metadata: { a: "b" } });
    expect(ok.status).toBe(200);
    expect(ok.body.amount).toBe("10500000000000000000");
    expect(ok.body.amount_display).toBe("10.5");
    expect(ok.body.status).toBe("created");
    expect(ok.body.checkout_url).toBe(`http://localhost:3000/checkout/${ok.body.id}`);
    expect(ok.body.id).toMatch(/^pi_[0-9A-Za-z]{24}$/);
    expect(ok.body.payment_id).toMatch(/^0x[0-9a-f]{64}$/);
    expect(ok.body).not.toHaveProperty("signature");
  });

  it("honours Idempotency-Key (replay, and 409 on a different body)", async () => {
    const a = await create({ merchant_order_id: "idem-1", amount: "3" }, { "idempotency-key": "k1" });
    const b = await create({ merchant_order_id: "idem-1", amount: "3" }, { "idempotency-key": "k1" });
    expect(b.status).toBe(200);
    expect(b.body.id).toBe(a.body.id);
    expect(b.headers.get("idempotent-replayed")).toBe("true");
    const c = await create({ merchant_order_id: "idem-1", amount: "4" }, { "idempotency-key": "k1" });
    expect(c.status).toBe(409);
    expect(c.body.error.code).toBe("idempotency_key_reused");
    const sql = await getDb();
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM payment_intents`;
    expect(Number(n)).toBe(1);
  });

  it("rejects a second open intent for the same order with the existing intent, allows retry after cancel", async () => {
    const a = await create({ merchant_order_id: "order-9", amount: "3" });
    const dup = await create({ merchant_order_id: "order-9", amount: "3" });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("order_has_open_intent");
    expect(dup.body.error.details.payment_intent.id).toBe(a.body.id);
    const c = await call(v1Cancel.POST, { method: "POST", params: { id: a.body.id }, headers: auth() });
    expect(c.body.status).toBe("cancelled");
    expect(c.body.cancel_tx.to).toBe(contracts.processor.toLowerCase());
    const again = await create({ merchant_order_id: "order-9", amount: "3" });
    expect(again.status).toBe(200);
  });

  it("refuses when the merchant is not ready on-chain (live read), falls back to DB on RPC failure", async () => {
    chain.signers.clear();
    const r = await create({ merchant_order_id: "x", amount: "1" });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("merchant_not_ready");
    expect(r.body.error.details.source).toBe("chain");
    clearReadinessCache();
    chain.failing.add("getMerchant");
    const sql = await getDb();
    await sql`UPDATE merchants SET platform_signer_enabled = true`;
    const r2 = await create({ merchant_order_id: "y", amount: "1" });
    expect(r2.status).toBe(200); // DB [chain] columns said ready
  });

  it("signature recovers to the platform signer over the frozen EIP-712 domain/types", async () => {
    const r = await create({ merchant_order_id: "sig-1", amount: "7", payer_address: CUSTOMER });
    const co = await call(checkoutRoute.GET, { params: { id: r.body.id } });
    const it = co.body.intent;
    const message = {
      paymentId: it.payment_id as Hex,
      merchantId: BigInt(it.merchant_id),
      payout: it.payout as Address,
      token: it.token as Address,
      amount: BigInt(it.amount),
      payer: it.payer as Address,
      expiresAt: BigInt(it.expires_at),
    };
    const domain = { ...INTENT_DOMAIN, chainId: MEZO_TESTNET_ID, verifyingContract: contracts.processor };
    const signer = platformSignerAddress() as Address;
    expect(await verifyTypedData({ address: signer, domain, types: INTENT_TYPES, primaryType: "PaymentIntent", message, signature: it.signature })).toBe(true);
    expect((await recoverTypedDataAddress({ domain, types: INTENT_TYPES, primaryType: "PaymentIntent", message, signature: it.signature })).toLowerCase()).toBe(signer);
    // Any field change breaks it (no substitution).
    expect(await verifyTypedData({ address: signer, domain, types: INTENT_TYPES, primaryType: "PaymentIntent", message: { ...message, amount: message.amount + 1n }, signature: it.signature })).toBe(false);
    expect(await verifyTypedData({ address: signer, domain: { ...domain, chainId: 1 }, types: INTENT_TYPES, primaryType: "PaymentIntent", message, signature: it.signature })).toBe(false);
    expect(message.payer.toLowerCase()).toBe(CUSTOMER.toLowerCase());
    expect(message.amount).toBe(7n * 10n ** 18n);
  });

  it("checkout DTO: first view → awaiting_payment; intent hidden once not payable", async () => {
    const r = await create({ merchant_order_id: "co-1", amount: "2" });
    const v1 = await call(checkoutRoute.GET, { params: { id: r.body.id } });
    expect(v1.body.status).toBe("awaiting_payment");
    expect(v1.body.intent.signature).toMatch(/^0x/);
    expect(JSON.stringify(v1.body)).not.toMatch(/api_key|secret|key_hash/);
    // by payment_id too
    expect((await call(checkoutRoute.GET, { params: { id: r.body.payment_id } })).body.id).toBe(r.body.id);
    await call(v1Cancel.POST, { method: "POST", params: { id: r.body.id }, headers: auth() });
    const v2 = await call(checkoutRoute.GET, { params: { id: r.body.id } });
    expect(v2.body.status).toBe("cancelled");
    expect(v2.body.intent).toBeNull();
    // expired (effective) also hides it
    const e = await create({ merchant_order_id: "co-2", amount: "2", expires_in_seconds: 300 });
    clock.set(() => new Date(Date.now() + 301_000));
    const v3 = await call(checkoutRoute.GET, { params: { id: e.body.id } });
    expect(v3.body.status).toBe("expired");
    expect(v3.body.intent).toBeNull();
    clock.set(null);
    expect((await call(checkoutRoute.GET, { params: { id: "pi_doesnotexist000000000000" } })).status).toBe(404);
  });

  it("preflight treats insufficient_allowance as payable with needs_approval", async () => {
    const r = await create({ merchant_order_id: "pf-1", amount: "2" });
    chain.payCheck = "insufficient_allowance";
    const p = await call(preflightRoute.GET, { path: `/x?payer=${CUSTOMER}`, params: { id: r.body.id } });
    expect(p.status).toBe(200);
    expect(p.body.check).toBe("ok");
    expect(p.body.needs_approval).toBe(true);
    expect(p.body.gas_ok).toBe(true);
    chain.payCheck = "insufficient_balance";
    expect((await call(preflightRoute.GET, { path: `/x?payer=${CUSTOMER}`, params: { id: r.body.id } })).body.check).toBe("insufficient_balance");
  });
});
