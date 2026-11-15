import "./setup-env";
import { beforeEach, describe, expect, it } from "vitest";
import { decodeFunctionData } from "viem";
import { processorAbi, erc20Abi } from "@/lib/chain/abis";
import { contracts } from "@/lib/chain/config";
import { getDb, resetDbForTests } from "@/lib/server/db";
import { setChainForTests } from "@/lib/server/chain";
import { clock } from "@/lib/server/clock";
import { clearReadinessCache, type MerchantRow } from "@/lib/server/merchants";
import { createPaymentIntent } from "@/lib/server/intents";
import { findIntent } from "@/lib/server/dto";
import { resetIndexerPassCountForTests, runIndexerPass } from "@/lib/server/indexer";
import { FakeChain, OWNER, STRANGER, E18, call, sessionCookieFor, setupMerchant, CUSTOMER, PAYOUT } from "./fakes";
import * as refundsRoute from "@/app/api/merchant/refunds/route";
import * as refundSubmitted from "@/app/api/merchant/refunds/[id]/submitted/route";
import type { PaymentIntentDTO } from "@/lib/api-types";

let chain: FakeChain;
let merchant: MerchantRow;
let cookie: string;

async function paidIntent(order = "r1"): Promise<PaymentIntentDTO> {
  const sql = await getDb();
  const i = await createPaymentIntent(sql, chain, { merchant, input: { merchant_order_id: order, amount: "10" }, source: "api", actor: "t" });
  chain.pay(i);
  chain.head += 5n;
  await runIndexerPass(sql, chain);
  expect((await findIntent(sql, i.id))!.status).toBe("paid");
  return i;
}
const refund = (body: unknown) => call(refundsRoute.POST, { method: "POST", body, headers: { cookie } });

beforeEach(async () => {
  await resetDbForTests();
  clearReadinessCache();
  resetIndexerPassCountForTests();
  clock.set(null);
  chain = new FakeChain();
  setChainForTests(chain);
  merchant = await setupMerchant(chain);
  cookie = await sessionCookieFor(OWNER);
});

describe("refunds", () => {
  it("returns exact approve + refund calldata, rejects over-refund including in-flight requests", async () => {
    const i = await paidIntent();
    const r = await refund({ payment_intent_id: i.id, amount: "6" });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("requested");
    expect(r.body.tx.approve.to).toBe(contracts.musd.toLowerCase());
    const ap = decodeFunctionData({ abi: erc20Abi, data: r.body.tx.approve.data });
    expect(ap.functionName).toBe("approve");
    expect(ap.args).toEqual([contracts.processor, 6n * E18]);
    const rf = decodeFunctionData({ abi: processorAbi, data: r.body.tx.refund.data });
    expect(rf.functionName).toBe("refund");
    expect(rf.args).toEqual([BigInt(merchant.onchain_merchant_id!), i.payment_id, 6n * E18]);
    const over = await refund({ payment_intent_id: i.id, amount: "4.01" });
    expect(over.status).toBe(422);
    expect(over.body.error.code).toBe("refund_exceeds_payment");
    expect((await refund({ payment_intent_id: i.id, amount: "4" })).status).toBe(200);
    expect((await refund({ payment_intent_id: i.id, amount: "0" })).status).toBe(400);
  });

  it("submitted refund is verified from the chain; partial then full", async () => {
    const sql = await getDb();
    const i = await paidIntent();
    const r = await refund({ payment_intent_id: i.id, amount: "4" });
    const { hash } = chain.refund(i, 4n * E18, 4n * E18);
    const s = await call(refundSubmitted.POST, { method: "POST", params: { id: r.body.id }, body: { tx_hash: hash }, headers: { cookie } });
    expect(s.body.status).toBe("confirmed");
    expect(s.body.from_address).toBe(OWNER.toLowerCase());
    let row = (await findIntent(sql, i.id))!;
    expect(row.status).toBe("partially_refunded");
    expect(row.amount_refunded).toBe(4n * E18);
    const r2 = await refund({ payment_intent_id: i.id, amount: "6" });
    const t2 = chain.refund(i, 6n * E18, 10n * E18, { from: PAYOUT });
    await call(refundSubmitted.POST, { method: "POST", params: { id: r2.body.id }, body: { tx_hash: t2.hash }, headers: { cookie } });
    row = (await findIntent(sql, i.id))!;
    expect(row.status).toBe("refunded");
    const ev = await sql`SELECT payload FROM webhook_events WHERE event_type = 'payment.refunded' ORDER BY created_at`;
    expect(ev).toHaveLength(2);
    const last = (typeof ev[1].payload === "string" ? JSON.parse(ev[1].payload) : ev[1].payload) as { data: { fully_refunded: boolean; refund: { amount: string } } };
    expect(last.data.fully_refunded).toBe(true);
    expect((await refund({ payment_intent_id: i.id, amount: "1" })).status).toBe(409);
  });

  it("indexer reconciles a RefundCompleted sent outside the dashboard", async () => {
    const sql = await getDb();
    const i = await paidIntent();
    chain.head += 1n;
    chain.refund(i, 3n * E18, 3n * E18);
    await runIndexerPass(sql, chain);
    const rows = await sql`SELECT * FROM refunds`;
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("confirmed");
    expect(rows[0].requested_by).toBe("chain");
    expect((await findIntent(sql, i.id))!.status).toBe("partially_refunded");
  });

  it("refund from an unauthorized sender or to the wrong payer is not recorded", async () => {
    const sql = await getDb();
    const i = await paidIntent();
    chain.head += 1n;
    chain.refund(i, 3n * E18, 3n * E18, { from: STRANGER });
    chain.head += 1n;
    chain.refund(i, 1n * E18, 4n * E18, { payer: STRANGER });
    await runIndexerPass(sql, chain);
    expect(await sql`SELECT * FROM refunds`).toHaveLength(0);
    const a = await sql`SELECT metadata FROM audit_logs WHERE action = 'refund.mismatch'`;
    expect(a.map((x) => JSON.stringify(x.metadata)).join()).toMatch(/unauthorized_sender/);
    expect(a.map((x) => JSON.stringify(x.metadata)).join()).toMatch(/payer_mismatch/);
    void CUSTOMER;
  });
});
