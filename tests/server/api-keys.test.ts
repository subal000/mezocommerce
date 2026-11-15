import "./setup-env";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb, resetDbForTests } from "@/lib/server/db";
import { setChainForTests } from "@/lib/server/chain";
import { clearReadinessCache } from "@/lib/server/merchants";
import { hashApiKey } from "@/lib/server/api-keys";
import { FakeChain, apiKeyFor, call, sessionCookieFor, setupMerchant, OWNER } from "./fakes";
import * as v1Intents from "@/app/api/v1/payment-intents/route";
import * as v1Intent from "@/app/api/v1/payment-intents/[id]/route";
import * as v1MerchantPayments from "@/app/api/v1/merchants/[id]/payments/route";
import * as keysRoute from "@/app/api/merchant/api-keys/route";
import * as revokeRoute from "@/app/api/merchant/api-keys/[id]/revoke/route";

describe("API keys", () => {
  let chain: FakeChain;
  beforeEach(async () => {
    await resetDbForTests();
    clearReadinessCache();
    chain = new FakeChain();
    setChainForTests(chain);
  });

  it("creates a key shown once, stores only the peppered hash", async () => {
    await setupMerchant(chain);
    const cookie = await sessionCookieFor(OWNER);
    const created = await call(keysRoute.POST, { method: "POST", body: { name: "server" }, headers: { cookie } });
    expect(created.status).toBe(200);
    expect(created.body.secret).toMatch(/^mc_test_sk_[0-9A-Za-z]{40}$/);
    expect(created.body.key_prefix).toBe(created.body.secret.slice(0, 16));
    const sql = await getDb();
    const [row] = await sql`SELECT key_hash FROM api_keys WHERE id = ${created.body.id}`;
    expect(row.key_hash).toBe(hashApiKey(created.body.secret));
    expect(JSON.stringify(await sql`SELECT * FROM api_keys`)).not.toContain(created.body.secret);
    const list = await call(keysRoute.GET, { headers: { cookie } });
    expect(list.body[0]).not.toHaveProperty("secret");
  });

  it("authenticates, rejects bad / revoked keys, updates last_used_at", async () => {
    const m = await setupMerchant(chain);
    const key = await apiKeyFor(m);
    const ok = await call(v1Intents.GET, { headers: { authorization: `Bearer ${key}` } });
    expect(ok.status).toBe(200);
    const sql = await getDb();
    const [k] = await sql`SELECT id, last_used_at FROM api_keys`;
    expect(k.last_used_at).not.toBeNull();
    expect((await call(v1Intents.GET)).status).toBe(401);
    expect((await call(v1Intents.GET, { headers: { authorization: "Bearer mc_test_sk_" + "x".repeat(40) } })).status).toBe(401);
    const cookie = await sessionCookieFor(OWNER);
    const rv = await call(revokeRoute.POST, { method: "POST", params: { id: String(k.id) }, headers: { cookie } });
    expect(rv.body.revoked_at).not.toBeNull();
    const after = await call(v1Intents.GET, { headers: { authorization: `Bearer ${key}` } });
    expect(after.status).toBe(401);
  });

  it("enforces permissions", async () => {
    const m = await setupMerchant(chain);
    const readOnly = await apiKeyFor(m, ["payment_intents:read"]);
    const r = await call(v1Intents.POST, { method: "POST", body: { merchant_order_id: "o1", amount: "1" }, headers: { authorization: `Bearer ${readOnly}` } });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("insufficient_permissions");
  });

  it("isolates merchants: A cannot read B's intents or payments", async () => {
    const a = await setupMerchant(chain, { name: "A", onchainId: 1n });
    const b = await setupMerchant(chain, { name: "B", onchainId: 2n, owner: "0xcccc00000000000000000000000000000000cccc" });
    const keyA = await apiKeyFor(a);
    const keyB = await apiKeyFor(b);
    const created = await call(v1Intents.POST, { method: "POST", body: { merchant_order_id: "b-1", amount: "5" }, headers: { authorization: `Bearer ${keyB}` } });
    expect(created.status).toBe(200);
    const asA = await call(v1Intent.GET, { params: { id: created.body.id }, headers: { authorization: `Bearer ${keyA}` } });
    expect(asA.status).toBe(404);
    const listA = await call(v1Intents.GET, { headers: { authorization: `Bearer ${keyA}` } });
    expect(listA.body.total).toBe(0);
    const forbidden = await call(v1MerchantPayments.GET, { params: { id: b.id }, headers: { authorization: `Bearer ${keyA}` } });
    expect(forbidden.status).toBe(403);
    const own = await call(v1MerchantPayments.GET, { params: { id: a.id }, headers: { authorization: `Bearer ${keyA}` } });
    expect(own.status).toBe(200);
  });

  it("rate limits per key", async () => {
    const m = await setupMerchant(chain);
    const key = await apiKeyFor(m);
    let last = 0;
    for (let i = 0; i < 302; i++) last = (await call(v1Intents.GET, { headers: { authorization: `Bearer ${key}`, "x-real-ip": `10.1.${i >> 8}.${i & 255}` } })).status;
    expect(last).toBe(429);
  });
});
