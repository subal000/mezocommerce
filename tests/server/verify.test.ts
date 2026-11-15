import "./setup-env";
import { beforeEach, describe, expect, it } from "vitest";
import type { Address } from "viem";
import type { PaymentIntentDTO } from "@/lib/api-types";
import { getDb, resetDbForTests } from "@/lib/server/db";
import { setChainForTests } from "@/lib/server/chain";
import { clock } from "@/lib/server/clock";
import { clearReadinessCache, type MerchantRow } from "@/lib/server/merchants";
import { createPaymentIntent, sweepExpired, cancelIntent } from "@/lib/server/intents";
import { verifyPaymentTx } from "@/lib/server/verify";
import { checkReportedPayment } from "@/lib/server/settle";
import { findIntent } from "@/lib/server/dto";
import { getCursor, resetIndexerPassCountForTests, runIndexerPass } from "@/lib/server/indexer";
import { runWorkerPass } from "@/lib/server/worker";
import { FakeChain, LOOKALIKE, MUSD, STRANGER, call, setupMerchant, CUSTOMER, E18 } from "./fakes";
import * as submittedRoute from "@/app/api/public/checkout/[id]/submitted/route";
import * as statusRoute from "@/app/api/public/checkout/[id]/status/route";

let chain: FakeChain;
let merchant: MerchantRow;

async function newIntent(order: string, extra: Record<string, unknown> = {}): Promise<PaymentIntentDTO> {
  const sql = await getDb();
  return createPaymentIntent(sql, chain, { merchant, input: { merchant_order_id: order, amount: "10", ...extra }, source: "api", actor: "test" });
}
async function intentRow(id: string) {
  return (await findIntent(await getDb(), id))!;
}
async function events(type?: string) {
  const sql = await getDb();
  const rows = await sql`SELECT event_type FROM webhook_events ORDER BY created_at`;
  return rows.map((r) => String(r.event_type)).filter((t) => !type || t === type);
}
async function audits(action: string) {
  const sql = await getDb();
  return sql`SELECT * FROM audit_logs WHERE action = ${action}`;
}

beforeEach(async () => {
  await resetDbForTests();
  clearReadinessCache();
  resetIndexerPassCountForTests();
  clock.set(null);
  chain = new FakeChain();
  setChainForTests(chain);
  merchant = await setupMerchant(chain);
});

describe("verify path", () => {
  it("good log: confirming below N confirmations, paid at N", async () => {
    const sql = await getDb();
    const i = await newIntent("good");
    const { hash } = chain.pay(i); // block 100 = head → 1 confirmation
    expect(await checkReportedPayment(sql, chain, await intentRow(i.id), hash)).toBe("verified");
    expect((await intentRow(i.id)).status).toBe("confirming");
    expect(await events("payment.pending")).toHaveLength(1);
    chain.head = 101n;
    await runIndexerPass(sql, chain);
    const r = await intentRow(i.id);
    expect(r.status).toBe("paid");
    expect(r.late).toBe(false);
    const [p] = await sql`SELECT * FROM payments WHERE payment_intent_id = ${i.id}`;
    expect(p.status).toBe("confirmed");
    expect(String(p.payer_address)).toBe(CUSTOMER.toLowerCase());
    expect(await events("payment.confirmed")).toHaveLength(1);
    const [n] = await sql`SELECT kind FROM notifications`;
    expect(n.kind).toBe("payment_confirmed");
  });

  it("checkout status poll promotes confirming → paid without waiting for the worker", async () => {
    const sql = await getDb();
    const i = await newIntent("poll");
    const { hash } = chain.pay(i); // 1 confirmation
    await call(submittedRoute.POST, { method: "POST", params: { id: i.id }, body: { tx_hash: hash } });
    expect((await intentRow(i.id)).status).toBe("confirming");
    chain.head = 101n; // 2nd confirmation; no indexer / worker pass runs
    const r = await call(statusRoute.GET, { params: { id: i.id } });
    expect(r.body.status).toBe("paid");
    expect(r.body.verified).toBe(true);
    expect((await intentRow(i.id)).status).toBe("paid");
    // The worker running afterwards changes nothing (promotion is guarded).
    await runIndexerPass(sql, chain);
    expect(await events("payment.confirmed")).toHaveLength(1);
  });

  const mismatches: [string, (i: PaymentIntentDTO) => Record<string, unknown>, string][] = [
    ["wrong amount", (i) => ({ amount: BigInt(i.amount) - 1n }), "amount_mismatch"],
    ["wrong payout", () => ({ payout: STRANGER }), "payout_mismatch"],
    ["wrong token", () => ({ token: STRANGER }), "token_mismatch"],
    ["wrong merchant", () => ({ merchantId: 2n }), "merchant_mismatch"],
  ];
  for (const [name, over, reason] of mismatches) {
    it(`${name} → never paid, audited`, async () => {
      const sql = await getDb();
      const i = await newIntent(name.replace(/ /g, "-"));
      const { hash } = chain.pay(i, over(i) as never);
      chain.head = 110n;
      const v = await verifyPaymentTx(sql, chain, hash);
      expect(v.kind).toBe("payments");
      if (v.kind === "payments") expect(v.checks[0].reason).toBe(reason);
      expect(await checkReportedPayment(sql, chain, await intentRow(i.id), hash)).toBe("mismatch");
      await runIndexerPass(sql, chain);
      expect((await intentRow(i.id)).status).not.toBe("paid");
      expect((await intentRow(i.id)).status).not.toBe("confirming");
      const a = await audits("payment.mismatch");
      expect(a.some((x) => JSON.stringify(x.metadata).includes(reason))).toBe(true);
      const [{ n }] = await sql`SELECT count(*)::int AS n FROM payments`;
      expect(Number(n)).toBe(0);
    });
  }

  it("locked payer mismatch is rejected", async () => {
    const sql = await getDb();
    const i = await newIntent("locked", { payer_address: CUSTOMER });
    const { hash } = chain.pay(i, { payer: STRANGER });
    expect(await checkReportedPayment(sql, chain, await intentRow(i.id), hash)).toBe("mismatch");
    expect((await intentRow(i.id)).status).toBe("created"); // never moved to confirming/paid
  });

  it("wrong contract (lookalike emitter) is ignored", async () => {
    const sql = await getDb();
    const i = await newIntent("lookalike");
    const { hash } = chain.pay(i, { address: LOOKALIKE });
    const v = await verifyPaymentTx(sql, chain, hash);
    expect(v.kind).toBe("no_payment");
    if (v.kind === "no_payment") expect(v.reason).toBe("wrong_contract");
    chain.head = 110n;
    await runIndexerPass(sql, chain);
    expect((await intentRow(i.id)).status).toBe("created");
  });

  it("reverted receipt → attempt failed, payment.failed, intent stays payable", async () => {
    const i = await newIntent("reverted");
    const { hash } = chain.pay(i, { status: "reverted" });
    const r = await call(submittedRoute.POST, { method: "POST", params: { id: i.id }, body: { tx_hash: hash, payer_address: CUSTOMER } });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("awaiting_payment");
    expect(r.body.attempt.status).toBe("failed");
    expect(r.body.verified).toBe(false);
    expect(await events("payment.failed")).toHaveLength(1);
  });

  it("client-reported hash that isn't mined yet stays submitted; status poll verifies it later", async () => {
    const i = await newIntent("later");
    const fake = "0x" + "ab".repeat(32);
    const r = await call(submittedRoute.POST, { method: "POST", params: { id: i.id }, body: { tx_hash: fake } });
    expect(r.body.status).toBe("submitted");
    expect(r.body.verified).toBe(false);
    // the real tx (different hash) gets indexed
    chain.pay(i);
    chain.head = 105n;
    await runIndexerPass(await getDb(), chain);
    const s = await call(statusRoute.GET, { params: { id: i.id } });
    expect(s.body.status).toBe("paid");
    expect(s.body.verified).toBe(true);
  });

  it("insufficient confirmations is never paid", async () => {
    const sql = await getDb();
    const i = await newIntent("confs");
    chain.pay(i);
    await runIndexerPass(sql, chain);
    expect((await intentRow(i.id)).status).toBe("confirming");
    const s = await call(statusRoute.GET, { params: { id: i.id } });
    expect(s.body.verified).toBe(false);
  });

  it("unknown paymentId → audited mismatch, nothing recorded", async () => {
    const sql = await getDb();
    const i = await newIntent("unknown");
    chain.pay({ ...i, payment_id: "0x" + "77".repeat(32) });
    chain.head = 110n;
    await runIndexerPass(sql, chain);
    expect((await audits("payment.mismatch")).some((a) => JSON.stringify(a.metadata).includes("unknown_payment_id"))).toBe(true);
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM payments`;
    expect(Number(n)).toBe(0);
  });

  it("duplicate event ingestion is idempotent", async () => {
    const sql = await getDb();
    const i = await newIntent("dup");
    const { hash } = chain.pay(i);
    chain.head = 110n;
    await runIndexerPass(sql, chain);
    await sql`UPDATE indexer_state SET last_block = 1 WHERE id = 'main'`; // force re-scan
    await runIndexerPass(sql, chain);
    await checkReportedPayment(sql, chain, await intentRow(i.id), hash);
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM payments`;
    expect(Number(n)).toBe(1);
    expect(await events("payment.confirmed")).toHaveLength(1);
    const [{ e }] = await sql`SELECT count(*)::int AS e FROM blockchain_events`;
    expect(Number(e)).toBe(1);
  });
});

describe("indexer", () => {
  it("reorg rollback: orphaned payment is reorged, intent back to awaiting_payment, re-inclusion pays", async () => {
    const sql = await getDb();
    const i = await newIntent("reorg");
    chain.pay(i, { block: 100n });
    await runIndexerPass(sql, chain);
    expect((await intentRow(i.id)).status).toBe("confirming");
    chain.reorgFrom(100n);
    chain.head = 101n;
    const r = await runIndexerPass(sql, chain);
    expect(r.rewoundTo).toBe("100");
    expect((await intentRow(i.id)).status).toBe("awaiting_payment");
    const [p] = await sql`SELECT status FROM payments`;
    expect(p.status).toBe("reorged");
    expect((await audits("indexer.reorg_rewind")).length).toBe(1);
    // the tx gets re-mined in a later block
    chain.head = 102n;
    chain.pay(i, { block: 102n });
    chain.head = 103n;
    await runIndexerPass(sql, chain);
    expect((await intentRow(i.id)).status).toBe("paid");
    const [p2] = await sql`SELECT status, block_number FROM payments`;
    expect(p2.status).toBe("confirmed");
    expect(Number(p2.block_number)).toBe(102);
  });

  it("chunks getLogs ≤ 2000 blocks and resumes from the cursor after a restart", async () => {
    const sql = await getDb();
    chain.head = 4500n;
    await runIndexerPass(sql, chain);
    expect(chain.getLogsCalls.every((c) => c.toBlock - c.fromBlock + 1n <= 2000n)).toBe(true);
    expect(chain.getLogsCalls[0].fromBlock).toBe(1n);
    expect(await getCursor(sql)).toBe(4500n);
    // "restart": new process state, same DB
    resetIndexerPassCountForTests();
    chain.getLogsCalls = [];
    chain.head = 4510n;
    await runWorkerPass(sql, { chain, workerId: "w2" });
    expect(chain.getLogsCalls[0].fromBlock).toBe(4501n);
  });

  it("RPC failure does not advance the cursor", async () => {
    const sql = await getDb();
    chain.head = 50n;
    await runIndexerPass(sql, chain);
    chain.head = 60n;
    chain.failing.add("getLogs");
    const r = await runWorkerPass(sql, { chain });
    expect(r.ok).toBe(false);
    expect(await getCursor(sql)).toBe(50n);
  });

  it("expiry sweep: payable + past expiry → expired + payment.expired", async () => {
    const sql = await getDb();
    const i = await newIntent("exp", { expires_in_seconds: 300 });
    clock.set(() => new Date(Date.now() + 400_000));
    expect(await sweepExpired(sql)).toBe(1);
    expect((await intentRow(i.id)).status).toBe("expired");
    expect(await events("payment.expired")).toHaveLength(1);
    expect(await sweepExpired(sql)).toBe(0);
  });

  it("late payment after DB cancel → paid with late=true + late_payment notification", async () => {
    const sql = await getDb();
    const i = await newIntent("late");
    await cancelIntent(sql, merchant.id, i.id, "test");
    chain.pay(i);
    chain.head = 105n;
    await runIndexerPass(sql, chain);
    const r = await intentRow(i.id);
    expect(r.status).toBe("paid");
    expect(r.late).toBe(true);
    const kinds = (await sql`SELECT kind FROM notifications`).map((n) => n.kind);
    expect(kinds).toContain("late_payment");
  });

  it("PaymentCancelled from a foreign merchant is ignored; own merchant cancels", async () => {
    const sql = await getDb();
    const { rawLog, txHash } = await import("./fakes");
    const i = await newIntent("cancel");
    const h1 = txHash("c1");
    chain.addTx(h1, [rawLog("PaymentCancelled", { paymentId: i.payment_id, merchantId: 9n, by: STRANGER as Address }, { blockNumber: 100n, txHash: h1, logIndex: 0 })]);
    await runIndexerPass(sql, chain);
    expect((await intentRow(i.id)).status).toBe("created");
    expect((await audits("payment.foreign_cancel_ignored")).length).toBe(1);
    const h2 = txHash("c2");
    chain.head = 101n;
    chain.addTx(h2, [rawLog("PaymentCancelled", { paymentId: i.payment_id, merchantId: 1n, by: STRANGER as Address }, { blockNumber: 101n, txHash: h2, logIndex: 0 })]);
    await runIndexerPass(sql, chain);
    expect((await intentRow(i.id)).status).toBe("cancelled");
  });

  it("reconciliation corrects refunded totals from chain", async () => {
    const sql = await getDb();
    const i = await newIntent("recon");
    chain.pay(i);
    chain.head = 105n;
    await runIndexerPass(sql, chain);
    chain.payments.get(i.payment_id)!.refunded = 4n * E18;
    await runIndexerPass(sql, chain, { reconcile: true });
    const r = await intentRow(i.id);
    expect(r.amount_refunded).toBe(4n * E18);
    expect(r.status).toBe("partially_refunded");
    void MUSD;
  });
});
