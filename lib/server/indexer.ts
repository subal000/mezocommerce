// Reorg-aware indexer for the MerchantPaymentProcessor.
//   cursor (indexer_state 'main') starts at NEXT_PUBLIC_DEPLOY_BLOCK - 1; getLogs in chunks ≤ 2,000 blocks up to head;
//   each log is stored in blockchain_events (unique tx+log_index) and applied idempotently through ./verify + ./settle;
//   indexed_blocks keeps hashes; the last 12 are re-checked every pass (mismatch → rewind + roll back).
//   Transient RPC errors propagate: the cursor is not advanced, the next pass retries.
import type { Hex } from "viem";
import { contracts, isDeployed, MEZO_TESTNET_ID } from "@/lib/chain/config";
import { isSettled, refundStatus } from "@/lib/chain/payment-state";
import type { Sql } from "./db";
import { big, str } from "./db/rows";
import { argsToJson, decodeLog, isRpcError, lc, type ChainAdapter, type DecodedLog } from "./chain";
import { audit } from "./audit";
import { addSeconds, clock } from "./clock";
import { env } from "./env";
import { toIntentRow } from "./dto";
import { emitEvent } from "./events";
import { transitionIntent } from "./intents";
import { linkRegisteredMerchant, merchantByOnchainId, syncMerchantFromChain, toMerchantRow } from "./merchants";
import { applyCancelledLog, applyPaymentCheck, applyRefundCheck, rollbackPayment, updateConfirmations } from "./settle";
import { verifyPaymentLog, verifyRefundTx } from "./verify";

export const MAX_CHUNK = 2000n;
export const REORG_DEPTH = 12;

export interface IndexerPassResult {
  from: string | null;
  to: string | null;
  head: string | null;
  logs: number;
  applied: number;
  rewoundTo: string | null;
  confirmed: number;
  reorged: number;
  reconciled: number | null;
}

export async function getCursor(sql: Sql): Promise<bigint> {
  const [row] = await sql<{ last_block: string | number }>`SELECT last_block FROM indexer_state WHERE id = 'main'`;
  if (row) return big(row.last_block);
  const start = contracts.deployBlock > 0n ? contracts.deployBlock - 1n : 0n;
  await sql`INSERT INTO indexer_state (id, last_block, updated_at) VALUES ('main', ${start}, ${clock.now()}) ON CONFLICT (id) DO NOTHING`;
  return start;
}

async function setCursor(sql: Sql, block: bigint, hash: string | null) {
  await sql`UPDATE indexer_state SET last_block = ${block}, last_block_hash = ${hash}, updated_at = ${clock.now()} WHERE id = 'main'`;
}

export async function indexerStatus(sql: Sql): Promise<{ lastBlock: bigint | null; updatedAt: Date | null }> {
  const [row] = await sql<{ last_block: string | number; updated_at: Date }>`SELECT last_block, updated_at FROM indexer_state WHERE id = 'main'`;
  return row ? { lastBlock: big(row.last_block), updatedAt: new Date(row.updated_at) } : { lastBlock: null, updatedAt: null };
}

// ---------------------------------------------------------------- event application

/** Store + apply one decoded processor log. Returns true when it was newly applied. */
export async function ingestLog(sql: Sql, chain: ChainAdapter, log: DecodedLog, head: bigint, blockTime: Date): Promise<boolean> {
  const txHash = lc(log.txHash);
  const args = argsToJson(log.args);
  const paymentId = typeof args.paymentId === "string" ? args.paymentId : null;
  const ins = await sql<{ id: string }>`
    INSERT INTO blockchain_events (chain_id, contract_address, event_name, payment_id, block_number, block_hash, transaction_hash,
      log_index, args, block_time)
    VALUES (${MEZO_TESTNET_ID}, ${lc(log.address)}, ${log.eventName}, ${paymentId}, ${log.blockNumber}, ${lc(log.blockHash)}, ${txHash},
      ${log.logIndex}, ${args}::jsonb, ${blockTime})
    ON CONFLICT (transaction_hash, log_index) DO NOTHING RETURNING id`;
  let eventId: string;
  if (ins.length) eventId = str(ins[0].id);
  else {
    const [ev] = await sql<{ id: string; processed_at: Date | null }>`
      SELECT id, processed_at FROM blockchain_events WHERE transaction_hash = ${txHash} AND log_index = ${log.logIndex}`;
    if (!ev || ev.processed_at) return false; // already applied (duplicate ingestion is a no-op)
    eventId = str(ev.id);
  }
  try {
    await applyLog(sql, chain, log, head);
    await sql`UPDATE blockchain_events SET processed_at = ${clock.now()}, error = NULL WHERE id = ${eventId}`;
  } catch (e) {
    if (isRpcError(e)) throw e; // retried next pass; event stays unprocessed
    const message = ((e as Error)?.message ?? String(e)).slice(0, 500);
    console.error("[indexer] event failed", log.eventName, txHash, log.logIndex, message);
    await sql`UPDATE blockchain_events SET processed_at = ${clock.now()}, error = ${message} WHERE id = ${eventId}`;
    await audit(sql, { actor: "indexer", action: "indexer.event_failed", resourceId: `${txHash}:${log.logIndex}`, metadata: { event: log.eventName, error: message } });
  }
  return true;
}

async function applyLog(sql: Sql, chain: ChainAdapter, log: DecodedLog, head: bigint): Promise<void> {
  switch (log.eventName) {
    case "PaymentCompleted": {
      const check = await verifyPaymentLog(sql, chain, log, head);
      if (!check) {
        await audit(sql, { actor: "indexer", action: "payment.mismatch", resourceId: `${lc(log.txHash)}:${log.logIndex}`, metadata: { reason: "receipt_unverifiable" } });
        return;
      }
      await applyPaymentCheck(sql, check, "indexer");
      return;
    }
    case "RefundCompleted": {
      const v = await verifyRefundTx(sql, chain, log.txHash);
      if (v.kind !== "refunds") {
        await audit(sql, { actor: "indexer", action: "refund.mismatch", resourceId: `${lc(log.txHash)}:${log.logIndex}`, metadata: { reason: v.kind } });
        return;
      }
      const c = v.checks.find((x) => x.log.logIndex === log.logIndex);
      if (c) await applyRefundCheck(sql, c, "indexer");
      return;
    }
    case "PaymentCancelled":
      await applyCancelledLog(sql, log, "indexer");
      return;
    case "MerchantRegistered":
      await linkRegisteredMerchant(sql, chain, log.args.merchantId as bigint, lc(log.args.owner as string), log.txHash);
      return;
    case "PayoutUpdated":
    case "SignerUpdated":
    case "MerchantStatusUpdated": {
      const m = await merchantByOnchainId(sql, log.args.merchantId as bigint);
      if (m) await syncMerchantFromChain(sql, chain, m, "indexer");
      return;
    }
    default:
      return; // admin / token events: stored only
  }
}

// ---------------------------------------------------------------- reorgs

/**
 * Compare the last REORG_DEPTH stored block hashes with the chain. On mismatch, roll back everything derived from
 * the first mismatching block onward and rewind the cursor so those blocks are re-indexed.
 */
export async function checkReorg(sql: Sql, chain: ChainAdapter): Promise<bigint | null> {
  const stored = await sql<{ block_number: string | number; block_hash: string }>`
    SELECT block_number, block_hash FROM indexed_blocks ORDER BY block_number DESC LIMIT ${REORG_DEPTH}`;
  let forkAt: bigint | null = null;
  for (const b of stored) {
    const n = big(b.block_number);
    const live = await chain.getBlock(n);
    if (lc(live.hash) === lc(b.block_hash)) break; // older blocks are canonical too
    forkAt = n;
  }
  if (forkAt === null) return null;
  await rewindFrom(sql, forkAt);
  return forkAt;
}

export async function rewindFrom(sql: Sql, block: bigint): Promise<void> {
  const payments = await sql`SELECT * FROM payments WHERE block_number >= ${block} AND status <> 'reorged'`;
  for (const p of payments) await rollbackPayment(sql, p, "indexer", "reorg");
  await sql.begin(async (tx) => {
    // Refunds confirmed in orphaned blocks: chain-discovered rows vanish, requested ones go back to submitted.
    const refunds = await tx`SELECT r.* FROM refunds r JOIN blockchain_events e ON e.transaction_hash = r.transaction_hash
                             WHERE e.block_number >= ${block} AND r.status = 'confirmed'`;
    const touched = new Set<string>();
    for (const r of refunds) {
      touched.add(str(r.payment_intent_id));
      if (str(r.requested_by) === "chain") await tx`DELETE FROM refunds WHERE id = ${str(r.id)}`;
      else await tx`UPDATE refunds SET status = 'submitted', log_index = NULL, from_address = NULL, total_refunded = NULL, confirmed_at = NULL WHERE id = ${str(r.id)}`;
    }
    for (const id of touched) {
      const [ir] = await tx`SELECT * FROM payment_intents WHERE id = ${id}`;
      const intent = toIntentRow(ir);
      const [sum] = await tx<{ s: string | null }>`SELECT COALESCE(SUM(amount), 0)::text AS s FROM refunds WHERE payment_intent_id = ${id} AND status = 'confirmed'`;
      const refunded = big(sum?.s);
      await tx`UPDATE payment_intents SET amount_refunded = ${refunded}, updated_at = ${clock.now()} WHERE id = ${id}`;
      if (isSettled(intent.status)) {
        const next = refundStatus(intent.amount, refunded);
        if (next !== intent.status) await transitionIntent(tx, intent, next, "indexer", { reason: "reorg", force: true });
      }
    }
    const [evs] = await tx<{ n: number }>`SELECT count(*)::int AS n FROM blockchain_events WHERE block_number >= ${block}`;
    await tx`DELETE FROM blockchain_events WHERE block_number >= ${block}`;
    await tx`DELETE FROM indexed_blocks WHERE block_number >= ${block}`;
    await tx`UPDATE indexer_state SET last_block = LEAST(last_block, ${block - 1n}), updated_at = ${clock.now()} WHERE id = 'main'`;
    await audit(tx, { actor: "indexer", action: "indexer.reorg_rewind", resourceId: block.toString(), metadata: { events: Number(evs?.n ?? 0), payments: payments.length, refunds: refunds.length } });
  });
}

// ---------------------------------------------------------------- reconciliation

/**
 * Compare recent confirming/paid intents with intentState/payment on chain and re-read every registered merchant.
 * Mismatches → audit + correction from chain.
 */
export async function reconcile(sql: Sql, chain: ChainAdapter): Promise<number> {
  let n = 0;
  const since = addSeconds(clock.now(), -7 * 86400);
  // `confirming` intents are re-checked every pass by updateConfirmations (block hash + depth).
  const intents = await sql`SELECT * FROM payment_intents WHERE status IN ('paid', 'partially_refunded', 'refunded', 'cancelled')
                            AND updated_at > ${since} ORDER BY updated_at DESC LIMIT 500`;
  for (const r of intents) {
    const i = toIntentRow(r);
    try {
      const pid = i.payment_id as Hex;
      const mid = BigInt(i.onchain_merchant_id);
      if (i.status === "cancelled") {
        // A DB cancel may have raced a payment.
        const state = await chain.intentState(mid, pid);
        if (state === "paid") await audit(sql, { merchantId: i.merchant_id, actor: "reconcile", action: "reconcile.paid_but_cancelled", resourceId: i.id });
        n++;
        continue;
      }
      const state = await chain.intentState(mid, pid);
      if (state !== "paid") {
        await audit(sql, { merchantId: i.merchant_id, actor: "reconcile", action: "reconcile.mismatch", resourceId: i.id, metadata: { db: i.status, chain: state } });
        const [p] = await sql`SELECT * FROM payments WHERE payment_intent_id = ${i.id} AND status <> 'reorged'`;
        if (p) await rollbackPayment(sql, p, "reconcile", `chain_state_${state}`);
        n++;
        continue;
      }
      const rec = await chain.getPayment(mid, pid);
      if (rec.refunded > i.amount_refunded && isSettled(i.status)) {
        await audit(sql, { merchantId: i.merchant_id, actor: "reconcile", action: "reconcile.refund_total_corrected", resourceId: i.id, metadata: { db: i.amount_refunded.toString(), chain: rec.refunded.toString() } });
        const capped = rec.refunded > i.amount ? i.amount : rec.refunded;
        await sql.begin(async (tx) => {
          await tx`UPDATE payment_intents SET amount_refunded = ${capped}, updated_at = ${clock.now()} WHERE id = ${i.id}`;
          const next = refundStatus(i.amount, capped);
          if (next !== i.status) await transitionIntent(tx, i, next, "reconcile", { reason: "reconcile" });
        });
      }
      n++;
    } catch (e) {
      if (isRpcError(e)) throw e;
      console.warn("[reconcile] intent", i.id, (e as Error).message);
    }
  }
  // Payable intents the merchant cancelled on-chain but whose PaymentCancelled log we missed.
  const open = await sql`SELECT * FROM payment_intents WHERE status IN ('awaiting_payment', 'submitted')
                         AND expires_at > ${clock.now()} ORDER BY updated_at DESC LIMIT 200`;
  for (const r of open) {
    const i = toIntentRow(r);
    try {
      if ((await chain.intentState(BigInt(i.onchain_merchant_id), i.payment_id as Hex)) === "cancelled") {
        await sql.begin(async (tx) => {
          if (await transitionIntent(tx, i, "cancelled", "reconcile", { reason: "onchain_cancel" })) {
            await emitEvent(tx, { merchantId: i.merchant_id, type: "payment.cancelled", dedupeKey: `payment.cancelled:${i.payment_id}`, intentId: i.id });
          }
        });
        n++;
      }
    } catch (e) {
      if (isRpcError(e)) throw e;
    }
  }
  const merchants = await sql`SELECT * FROM merchants WHERE onchain_merchant_id IS NOT NULL`;
  for (const m of merchants) {
    try {
      await syncMerchantFromChain(sql, chain, toMerchantRow(m), "reconcile");
    } catch (e) {
      if (isRpcError(e)) throw e;
    }
  }
  return n;
}

// ---------------------------------------------------------------- the pass

let passCount = 0;
export function resetIndexerPassCountForTests() {
  passCount = 0;
}

export async function runIndexerPass(
  sql: Sql,
  chain: ChainAdapter,
  opts: { maxBlocks?: bigint; reconcile?: boolean } = {},
): Promise<IndexerPassResult> {
  const result: IndexerPassResult = { from: null, to: null, head: null, logs: 0, applied: 0, rewoundTo: null, confirmed: 0, reorged: 0, reconciled: null };
  if (!isDeployed) return result;
  const head = await chain.getBlockNumber();
  result.head = head.toString();
  const forkAt = await checkReorg(sql, chain);
  if (forkAt !== null) result.rewoundTo = forkAt.toString();
  let cursor = await getCursor(sql);
  const maxBlocks = opts.maxBlocks ?? 20_000n; // per pass, so a long catch-up doesn't starve other stages
  const end = head < cursor + maxBlocks ? head : cursor + maxBlocks;
  if (end > cursor) result.from = (cursor + 1n).toString();
  while (cursor < end) {
    const from = cursor + 1n;
    const to = from + MAX_CHUNK - 1n < end ? from + MAX_CHUNK - 1n : end;
    const raw = await chain.getLogs({ fromBlock: from, toBlock: to });
    const decoded = raw
      .map(decodeLog)
      .filter((l): l is DecodedLog => l !== null)
      .sort((x, y) => (x.blockNumber === y.blockNumber ? x.logIndex - y.logIndex : x.blockNumber < y.blockNumber ? -1 : 1));
    result.logs += decoded.length;
    const times = new Map<bigint, Date>();
    for (const l of decoded) {
      let t = times.get(l.blockNumber);
      if (!t) {
        t = new Date(Number((await chain.getBlock(l.blockNumber)).timestamp) * 1000);
        times.set(l.blockNumber, t);
      }
      if (await ingestLog(sql, chain, l, head, t)) result.applied++;
    }
    const tip = await chain.getBlock(to);
    const seen = new Map<bigint, string>();
    for (const l of decoded) seen.set(l.blockNumber, lc(l.blockHash));
    seen.set(to, lc(tip.hash));
    for (const [n, h] of seen) {
      await sql`INSERT INTO indexed_blocks (block_number, block_hash) VALUES (${n}, ${h})
                ON CONFLICT (block_number) DO UPDATE SET block_hash = EXCLUDED.block_hash`;
    }
    await setCursor(sql, to, lc(tip.hash));
    cursor = to;
  }
  result.to = cursor.toString();
  await sql`DELETE FROM indexed_blocks WHERE block_number < ${cursor - 500n}`;
  const c = await updateConfirmations(sql, chain, head);
  result.confirmed = c.confirmed;
  result.reorged = c.reorged;
  passCount++;
  if (opts.reconcile || (passCount - 1) % env.reconcileEvery() === 0) result.reconciled = await reconcile(sql, chain);
  return result;
}
