// THE payment / refund verification path. Used by the indexer, the checkout `submitted` and `status` endpoints, the
// refund `submitted` endpoint and reconciliation. Nothing else may decide that money moved.
//
// A PaymentCompleted counts only when ALL hold:
//   1. it is in a receipt with status == success, fetched by the server itself, on chain 31611;
//   2. the log was emitted by contracts.processor (lookalike contracts are ignored → `wrong_contract`);
//   3. paymentId belongs to a known intent;
//   4. merchantId, payout, token, amount equal the intent's signed values; payer equals the intent's payer if locked;
//   5. the block hash still matches the canonical chain; confirmations = head - block + 1 (paid needs ≥ CONFIRMATIONS).
// A RefundCompleted counts only when: success receipt, emitted by the processor, paymentId known with a recorded
// payment, merchantId matches, payer == the recorded payer, from ∈ {merchant owner, payout}, block hash matches.

import type { Address, Hex } from "viem";
import { MEZO_TESTNET_ID, ZERO_ADDRESS } from "@/lib/chain/config";
import type { Sql } from "./db";
import { str } from "./db/rows";
import { decodeAnyProcessorLog, decodeLog, lc, type ChainAdapter, type DecodedLog, type RawReceipt } from "./chain";
import { env } from "./env";
import { findIntent, type IntentRow } from "./dto";

export type PaymentMismatch =
  | "unknown_payment_id"
  | "merchant_mismatch"
  | "payout_mismatch"
  | "token_mismatch"
  | "amount_mismatch"
  | "payer_mismatch"
  | "block_hash_mismatch";

export interface PaymentLogFields {
  paymentId: string;
  merchantId: bigint;
  payer: string;
  payout: string;
  token: string;
  amount: bigint;
}

export interface PaymentLogCheck extends PaymentLogFields {
  log: DecodedLog;
  intent: IntentRow | null;
  ok: boolean;
  reason: PaymentMismatch | null;
  confirmations: number;
  /** confirmations ≥ CONFIRMATIONS */
  final: boolean;
  blockTime: Date;
}

export type PaymentTxVerification =
  | { kind: "not_found" }
  | { kind: "reverted"; receipt: RawReceipt }
  | { kind: "no_payment"; receipt: RawReceipt; reason: "no_payment_event" | "wrong_contract" }
  | { kind: "payments"; receipt: RawReceipt; checks: PaymentLogCheck[] };

/** Pure field comparison of a decoded PaymentCompleted against the intent's signed values. */
export function comparePaymentFields(intent: IntentRow | null, f: PaymentLogFields): PaymentMismatch | null {
  if (!intent) return "unknown_payment_id";
  if (lc(intent.payment_id) !== lc(f.paymentId)) return "unknown_payment_id";
  if (BigInt(intent.onchain_merchant_id) !== f.merchantId) return "merchant_mismatch";
  if (lc(intent.payout_address) !== lc(f.payout)) return "payout_mismatch";
  if (lc(intent.token_address) !== lc(f.token)) return "token_mismatch";
  if (intent.amount !== f.amount) return "amount_mismatch";
  if (intent.payer_address && lc(intent.payer_address) !== lc(ZERO_ADDRESS) && lc(intent.payer_address) !== lc(f.payer)) return "payer_mismatch";
  return null;
}

export function paymentFields(log: DecodedLog): PaymentLogFields {
  const a = log.args;
  return {
    paymentId: lc(a.paymentId as string),
    merchantId: a.merchantId as bigint,
    payer: lc(a.payer as string),
    payout: lc(a.payout as string),
    token: lc(a.token as string),
    amount: a.amount as bigint,
  };
}

let chainIdChecked = false;
async function assertChain(chain: ChainAdapter) {
  if (chainIdChecked) return;
  const id = await chain.chainId();
  if (id !== MEZO_TESTNET_ID) throw new Error(`RPC chain id ${id} is not Mezo Testnet (${MEZO_TESTNET_ID})`);
  chainIdChecked = true;
}
export function resetChainIdCheckForTests() {
  chainIdChecked = false;
}

export function confirmationsOf(head: bigint, blockNumber: bigint): number {
  return head >= blockNumber ? Number(head - blockNumber + 1n) : 0;
}

interface BlockInfo {
  hash: string;
  time: Date;
}

async function blockInfo(chain: ChainAdapter, n: bigint, cache: Map<bigint, BlockInfo>): Promise<BlockInfo> {
  let b = cache.get(n);
  if (!b) {
    const blk = await chain.getBlock(n);
    b = { hash: lc(blk.hash), time: new Date(Number(blk.timestamp) * 1000) };
    cache.set(n, b);
  }
  return b;
}

/**
 * Verify every PaymentCompleted in a transaction. The receipt is always fetched here (client hashes are hints).
 * RPC errors propagate (callers retry later); "not mined yet" is `not_found`.
 */
export async function verifyPaymentTx(sql: Sql, chain: ChainAdapter, txHash: Hex, opts: { head?: bigint } = {}): Promise<PaymentTxVerification> {
  await assertChain(chain);
  const receipt = await chain.getReceipt(txHash);
  if (!receipt) return { kind: "not_found" };
  if (receipt.status !== "success") return { kind: "reverted", receipt };
  const ours = receipt.logs.map(decodeLog).filter((l): l is DecodedLog => l !== null && l.eventName === "PaymentCompleted");
  if (ours.length === 0) {
    const lookalike = receipt.logs.some((l) => decodeAnyProcessorLog(l)?.eventName === "PaymentCompleted");
    return { kind: "no_payment", receipt, reason: lookalike ? "wrong_contract" : "no_payment_event" };
  }
  const head = opts.head ?? (await chain.getBlockNumber());
  const blocks = new Map<bigint, BlockInfo>();
  const required = env.confirmations();
  const checks: PaymentLogCheck[] = [];
  for (const log of ours) {
    const f = paymentFields(log);
    const intent = await findIntent(sql, f.paymentId);
    const b = await blockInfo(chain, log.blockNumber, blocks);
    let reason = comparePaymentFields(intent, f);
    if (!reason && (b.hash !== lc(log.blockHash) || b.hash !== lc(receipt.blockHash))) reason = "block_hash_mismatch";
    const confirmations = confirmationsOf(head, log.blockNumber);
    checks.push({ ...f, log, intent, ok: reason === null, reason, confirmations, final: confirmations >= required, blockTime: b.time });
  }
  return { kind: "payments", receipt, checks };
}

/** Verify a single indexed PaymentCompleted log by re-fetching its receipt (same path as client-reported txs). */
export async function verifyPaymentLog(sql: Sql, chain: ChainAdapter, log: DecodedLog, head: bigint): Promise<PaymentLogCheck | null> {
  const v = await verifyPaymentTx(sql, chain, log.txHash, { head });
  if (v.kind !== "payments") return null;
  return v.checks.find((c) => c.log.logIndex === log.logIndex) ?? v.checks.find((c) => lc(c.paymentId) === lc(log.args.paymentId as string)) ?? null;
}

// ---------------------------------------------------------------- refunds

export type RefundMismatch = "unknown_payment_id" | "no_payment" | "merchant_mismatch" | "payer_mismatch" | "unauthorized_sender" | "block_hash_mismatch";

export interface RefundLogCheck {
  log: DecodedLog;
  intent: IntentRow | null;
  paymentId: string;
  merchantId: bigint;
  payer: string;
  from: string;
  amount: bigint;
  totalRefunded: bigint;
  ok: boolean;
  reason: RefundMismatch | null;
  blockTime: Date;
}

export type RefundTxVerification =
  | { kind: "not_found" }
  | { kind: "reverted"; receipt: RawReceipt }
  | { kind: "no_refund"; receipt: RawReceipt; reason: "no_refund_event" | "wrong_contract" }
  | { kind: "refunds"; receipt: RawReceipt; checks: RefundLogCheck[] };

/** Allowed refund senders: live merchant(id) owner + payout; DB values if the RPC read fails. */
async function refundSenders(sql: Sql, chain: ChainAdapter, intent: IntentRow): Promise<string[]> {
  try {
    const m = await chain.getMerchant(BigInt(intent.onchain_merchant_id));
    if (lc(m.owner) !== lc(ZERO_ADDRESS)) return [lc(m.owner), lc(m.payout)];
  } catch {
    /* fall back to DB */
  }
  const [row] = await sql`SELECT owner_address, payout_address FROM merchants WHERE id = ${intent.merchant_id}`;
  return row ? [lc(str(row.owner_address)), lc(str(row.payout_address))].filter(Boolean) : [];
}

export async function verifyRefundTx(sql: Sql, chain: ChainAdapter, txHash: Hex): Promise<RefundTxVerification> {
  await assertChain(chain);
  const receipt = await chain.getReceipt(txHash);
  if (!receipt) return { kind: "not_found" };
  if (receipt.status !== "success") return { kind: "reverted", receipt };
  const ours = receipt.logs.map(decodeLog).filter((l): l is DecodedLog => l !== null && l.eventName === "RefundCompleted");
  if (ours.length === 0) {
    const lookalike = receipt.logs.some((l) => decodeAnyProcessorLog(l)?.eventName === "RefundCompleted");
    return { kind: "no_refund", receipt, reason: lookalike ? "wrong_contract" : "no_refund_event" };
  }
  const blocks = new Map<bigint, BlockInfo>();
  const checks: RefundLogCheck[] = [];
  for (const log of ours) {
    const a = log.args;
    const paymentId = lc(a.paymentId as string);
    const intent = await findIntent(sql, paymentId);
    const b = await blockInfo(chain, log.blockNumber, blocks);
    const base = {
      log,
      intent,
      paymentId,
      merchantId: a.merchantId as bigint,
      payer: lc(a.payer as string),
      from: lc(a.from as string),
      amount: a.amount as bigint,
      totalRefunded: a.totalRefunded as bigint,
      blockTime: b.time,
    };
    let reason: RefundMismatch | null = null;
    if (!intent) reason = "unknown_payment_id";
    else {
      const [p] = await sql`SELECT payer_address, status FROM payments WHERE payment_intent_id = ${intent.id}`;
      if (!p || str(p.status) === "reorged") reason = "no_payment";
      else if (BigInt(intent.onchain_merchant_id) !== base.merchantId) reason = "merchant_mismatch";
      else if (lc(str(p.payer_address)) !== base.payer) reason = "payer_mismatch";
      else if (!(await refundSenders(sql, chain, intent)).includes(base.from)) reason = "unauthorized_sender";
      else if (b.hash !== lc(log.blockHash)) reason = "block_hash_mismatch";
    }
    checks.push({ ...base, ok: reason === null, reason });
  }
  return { kind: "refunds", receipt, checks };
}

export type { Address };
