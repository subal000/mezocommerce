import "./setup-env";
import { beforeEach, describe, expect, it } from "vitest";
import type { Address } from "viem";
import { getDb, resetDbForTests } from "@/lib/server/db";
import { setChainForTests } from "@/lib/server/chain";
import { clearReadinessCache } from "@/lib/server/merchants";
import { platformSignerAddress } from "@/lib/server/signer";
import { acquireLease, releaseLease } from "@/lib/server/leases";
import { FakeChain, OWNER, PAYOUT, STRANGER, call, rawLog, sessionCookieFor, txHash } from "./fakes";
import * as merchantsRoute from "@/app/api/merchants/route";
import * as meRoute from "@/app/api/merchants/me/route";
import * as regRoute from "@/app/api/merchants/me/registration/route";
import * as confirmRoute from "@/app/api/merchants/me/confirm/route";

let chain: FakeChain;
let cookie: string;
beforeEach(async () => {
  await resetDbForTests();
  clearReadinessCache();
  chain = new FakeChain();
  setChainForTests(chain);
  cookie = await sessionCookieFor(OWNER);
});

describe("merchant onboarding", () => {
  it("creates a pending profile, validates URLs, and confirms registration from the chain", async () => {
    const bad = await call(merchantsRoute.POST, { method: "POST", headers: { cookie }, body: { name: "Tea", payout_address: PAYOUT, logo_url: "data:image/png;base64,AAAA" } });
    expect(bad.status).toBe(400);
    const js = await call(merchantsRoute.POST, { method: "POST", headers: { cookie }, body: { name: "Tea", payout_address: PAYOUT, website: "javascript:alert(1)" } });
    expect(js.status).toBe(400);
    const c = await call(merchantsRoute.POST, { method: "POST", headers: { cookie }, body: { name: "Larkspur Tea Co.", payout_address: PAYOUT, website: "https://tea.example" } });
    expect(c.status).toBe(200);
    expect(c.body.slug).toBe("larkspur-tea-co");
    expect(c.body.status).toBe("pending");
    expect(c.body.payout_address).toBeNull(); // [chain] column untouched until confirmed
    expect((await call(merchantsRoute.POST, { method: "POST", headers: { cookie }, body: { name: "x", payout_address: PAYOUT } })).status).toBe(409);

    const reg = await call(regRoute.GET, { headers: { cookie } });
    expect(reg.body).toMatchObject({ next: "register", payout_address: PAYOUT.toLowerCase(), platform_signer: platformSignerAddress() });

    // register tx sent by someone else → rejected
    const h0 = txHash("reg0");
    chain.addTx(h0, [rawLog("MerchantRegistered", { merchantId: 7n, owner: STRANGER, payout: PAYOUT }, { blockNumber: 100n, txHash: h0, logIndex: 0 })], { from: STRANGER });
    expect((await call(confirmRoute.POST, { method: "POST", headers: { cookie }, body: { tx_hash: h0 } })).status).toBe(403);

    const h = txHash("reg");
    chain.addTx(
      h,
      [
        rawLog("MerchantRegistered", { merchantId: 7n, owner: OWNER, payout: PAYOUT }, { blockNumber: 100n, txHash: h, logIndex: 0 }),
        rawLog("SignerUpdated", { merchantId: 7n, signer: platformSignerAddress() as Address, allowed: true }, { blockNumber: 100n, txHash: h, logIndex: 1 }),
      ],
      { from: OWNER },
    );
    chain.merchants.set(7n, { owner: OWNER, payout: PAYOUT, active: true });
    chain.signers.add(`7:${platformSignerAddress()}`);
    const conf = await call(confirmRoute.POST, { method: "POST", headers: { cookie }, body: { tx_hash: h } });
    expect(conf.status).toBe(200);
    expect(conf.body).toMatchObject({ onchain_merchant_id: "7", payout_address: PAYOUT.toLowerCase(), chain_active: true, platform_signer_enabled: true, status: "active" });
    expect((await call(regRoute.GET, { headers: { cookie } })).body.next).toBe("ready");

    const patch = await call(meRoute.PATCH, { method: "PATCH", headers: { cookie }, body: { brand_color: "#112233", notify_refund: false } });
    expect(patch.body.brand_color).toBe("#112233");
    expect((await call(meRoute.PATCH, { method: "PATCH", headers: { cookie }, body: { brand_color: "red" } })).status).toBe(400);
  });
});

describe("worker leases", () => {
  it("only one holder at a time; expired leases can be taken over", async () => {
    const sql = await getDb();
    expect(await acquireLease(sql, "indexer", "w1", 60)).toBe(true);
    expect(await acquireLease(sql, "indexer", "w2", 60)).toBe(false);
    expect(await acquireLease(sql, "indexer", "w1", 60)).toBe(true);
    await releaseLease(sql, "indexer", "w1");
    expect(await acquireLease(sql, "indexer", "w2", -1)).toBe(true); // already-expired lease
    expect(await acquireLease(sql, "indexer", "w1", 60)).toBe(true);
  });
});
