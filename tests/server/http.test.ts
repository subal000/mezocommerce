import "./setup-env";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb, resetDbForTests } from "@/lib/server/db";
import { setChainForTests } from "@/lib/server/chain";
import { clock } from "@/lib/server/clock";
import { clearReadinessCache } from "@/lib/server/merchants";
import { route } from "@/lib/server/http";
import { createPaymentIntent } from "@/lib/server/intents";
import { checkReportedPayment } from "@/lib/server/settle";
import { findIntent } from "@/lib/server/dto";
import { signWebhook } from "@/lib/server/webhooks";
import { FakeChain, apiKeyFor, call, setupMerchant, CUSTOMER } from "./fakes";
import * as v1Intents from "@/app/api/v1/payment-intents/route";
import * as demoCheckout from "@/app/api/demo-store/checkout/route";
import * as demoWebhook from "@/app/api/demo-store/webhook/route";
import * as demoOrder from "@/app/api/demo-store/orders/[id]/route";
import * as configRoute from "@/app/api/public/config/route";

let chain: FakeChain;
beforeEach(async () => {
  await resetDbForTests();
  clearReadinessCache();
  clock.set(null);
  chain = new FakeChain();
  setChainForTests(chain);
  delete process.env.DEMO_STORE_API_KEY;
  delete process.env.DEMO_STORE_WEBHOOK_SECRET;
});

describe("http errors", () => {
  it("a database outage surfaces as 503 without leaking internals", async () => {
    const h = route(async () => {
      const e = new Error("connect ECONNREFUSED 10.0.0.9:5432 at Socket.secret/path.js:12") as Error & { code: string };
      e.code = "ECONNREFUSED";
      throw e;
    });
    const r = await call(h);
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe("service_unavailable");
    expect(JSON.stringify(r.body)).not.toMatch(/ECONNREFUSED|5432|secret|\.js/);
  });

  it("unknown errors are 500 with a generic message", async () => {
    const r = await call(route(async () => {
      throw new Error("boom at /srv/app/x.ts:1");
    }));
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain("/srv");
  });

  it("public config exposes the platform signer and no secrets", async () => {
    const r = await call(configRoute.GET);
    expect(r.body.chain_id).toBe(31611);
    expect(r.body.platform_signer).toMatch(/^0x[0-9a-f]{40}$/);
    expect(r.body.deployed).toBe(true);
    expect(JSON.stringify(r.body)).not.toMatch(/PRIVATE|secret/i);
  });

  it("list search matches order id, payment_id, payer and tx hash", async () => {
    const m = await setupMerchant(chain);
    const key = await apiKeyFor(m);
    const sql = await getDb();
    const a = await createPaymentIntent(sql, chain, { merchant: m, input: { merchant_order_id: "ORDER-abc", amount: "1" }, source: "api", actor: "t" });
    await createPaymentIntent(sql, chain, { merchant: m, input: { merchant_order_id: "other", amount: "1" }, source: "api", actor: "t" });
    const { hash } = chain.pay(a);
    await checkReportedPayment(sql, chain, (await findIntent(sql, a.id))!, hash);
    const q = async (term: string) => (await call(v1Intents.GET, { path: `/x?q=${encodeURIComponent(term)}`, headers: { authorization: `Bearer ${key}` } })).body;
    for (const term of ["order-ABC", a.id, a.payment_id.toUpperCase().replace("0X", "0x"), CUSTOMER.toUpperCase().replace("0X", "0x"), hash]) {
      const r = await q(term);
      expect(r.total, term).toBe(1);
      expect(r.data[0].id).toBe(a.id);
    }
  });
});

describe("demo store", () => {
  it("503 when DEMO_STORE_API_KEY is unset", async () => {
    const r = await call(demoCheckout.POST, { method: "POST", body: { items: [{ sku: "tea-hojicha", qty: 1 }] } });
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe("demo_store_not_configured");
  });

  it("prices server-side, creates an intent, records verified webhooks (deduped)", async () => {
    const m = await setupMerchant(chain);
    process.env.DEMO_STORE_API_KEY = await apiKeyFor(m);
    process.env.DEMO_STORE_WEBHOOK_SECRET = "whsec_demo";
    const bad = await call(demoCheckout.POST, { method: "POST", body: { items: [{ sku: "nope", qty: 1 }] } });
    expect(bad.status).toBe(400);
    const r = await call(demoCheckout.POST, { method: "POST", body: { items: [{ sku: "tea-hojicha", qty: 2 }, { sku: "tea-sencha", qty: 1 }] } });
    expect(r.status).toBe(200);
    expect(r.body.amount_display).toBe("20.5");
    const o1 = await call(demoOrder.GET, { params: { id: r.body.order_id } });
    expect(o1.body.items).toHaveLength(2);
    expect(o1.body.webhook_received).toBe(false);
    expect(o1.body.verified).toBe(false);

    const payload = JSON.stringify({ id: "evt_abc123", type: "payment.confirmed", data: { payment_intent: { id: r.body.payment_intent_id, status: "paid", metadata: { demo_order_id: r.body.order_id } } } });
    const forged = await call(demoWebhook.POST, { method: "POST", body: payload, headers: { "mezocommerce-signature": signWebhook("whsec_wrong", payload) } });
    expect(forged.status).toBe(401);
    const ok = await call(demoWebhook.POST, { method: "POST", body: payload, headers: { "mezocommerce-signature": signWebhook("whsec_demo", payload) } });
    expect(ok.body.duplicate).toBe(false);
    const dup = await call(demoWebhook.POST, { method: "POST", body: payload, headers: { "mezocommerce-signature": signWebhook("whsec_demo", payload) } });
    expect(dup.body.duplicate).toBe(true);
    const o2 = await call(demoOrder.GET, { params: { id: r.body.order_id } });
    expect(o2.body.webhook_received).toBe(true);
    expect(o2.body.webhook_event_type).toBe("payment.confirmed");
  });
});
