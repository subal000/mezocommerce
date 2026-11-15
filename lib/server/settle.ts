// Apply verified chain facts to the DB (payments, intents, refunds) idempotently. Callers must pass checks produced
// by ./verify.ts — this module never looks at client input.
import type { Hex } from "viem";
import { refundStatus, isSettled, TERMINAL_UNPAID, type IntentStatus } from "@/lib/chain/payment-state";
import { formatMusd } from "@/lib/money";
import type { Sql } from "./db";
import { big, int, str } from "./db/rows";
import { lc, type ChainAdapter, type DecodedLog } from "./chain";
import { audit } from "./audit";
import { clock } from "./clock";
import { env } from "./env";
import { emitEvent, notify } from "./events";
import { findIntent, toIntentRow, toRefundDTO, type IntentRow } from "./dto";
import { transitionIntent } from "./intents";
import { confirmationsOf, verifyPaymentTx, verifyRefundTx, type PaymentLogCheck, type RefundLogCheck } from "./verify";

export interface ApplyResult {
  applied: boolean;
  status?: IntentStatus;
  reason?: string;
}

async function rememberBlock(sql: Sql, n: bigint, hash: string) {
  await sql`INSERT INTO indexed_blocks (block_number, block_hash) VALUES (${n}, ${lc(hash)})
            ON CONFLICT (block_number) DO UPDATE SET block_hash = EXCLUDED.block_hash`;
}

/** Record a mismatch: audit only, never paid. */
async function recordMismatch(sql: Sql, check: PaymentLogCheck, actor: string) {
  await audit(sql, {
    merchantId: check.intent?.merchant_id ?? null,
    actor,
    action: "payment.mismatch",
    resourceId: `${lc(check.log.txHash)}:${check.log.logIndex}`,
    metadata: {
      reason: check.reason,
      payment_id: check.paymentId,
      intent: check.intent?.id ?? null,
      chain: { merchant_id: check.merchantId.toString(), payer: check.payer, payout: check.payout, token: check.token, amount: check.amount.toString() },
    },
  });
}

/** Move an intent to confirming/paid after a verified PaymentCompleted (+ events, notifications, Shopify sync). */
async function settleIntent(tx: Sql, intent: IntentRow, final: boolean, paidAt: Date, actor: string, txHash: string): Promise<void> {
  if (isSettled(intent.status)) return;
  const target: IntentStatus = final ? "paid" : "confirming";
  if (intent.status === target) return;
  const late = TERMINAL_UNPAID.includes(intent.status) || intent.late;
  const moved = await transitionIntent(tx, intent, target, actor, { late, reason: "payment_verified" });
  if (!moved) return;
  await tx`UPDATE payment_intents SET paid_at = ${paidAt} WHERE id = ${intent.id}`;
  if (target === "confirming") {
    await emitEvent(tx, { merchantId: intent.merchant_id, type: "payment.pending", dedupeKey: `payment.pending:${intent.payment_id}`, intentId: intent.id });
    return;
  }
  await emitEvent(tx, { merchantId: intent.merchant_id, type: "payment.confirmed", dedupeKey: `payment.confirmed:${intent.payment_id}`, intentId: intent.id });
  const amount = formatMusd(intent.amount);
  await notify(tx, intent.merchant_id, late
    ? {
        kind: "late_payment",
        title: "Late payment received",
        body: `Order ${intent.merchant_order_id} was paid (${amount} MUSD) after it was cancelled or expired. Fulfil or refund it.`,
        link: `/merchant/payments/${intent.id}`,
        dedupeKey: `late_payment:${intent.id}`,
      }
    : {
        kind: "payment_confirmed",
        title: "Payment received",
        body: `${amount} MUSD for order ${intent.merchant_order_id} is confirmed on-chain.`,
        link: `/merchant/payments/${intent.id}`,
        dedupeKey: `payment_confirmed:${intent.id}`,
      });
  // Shopify: the worker marks the order paid (once).
  await tx`UPDATE shopify_orders SET next_sync_at = ${clock.now()} WHERE payment_intent_id = ${intent.id} AND sync_status = 'pending'`;
  await tx`UPDATE payment_attempts SET status = 'succeeded', checked_at = ${clock.now()}, failure_reason = NULL
           WHERE payment_intent_id = ${intent.id} AND transaction_hash = ${txHash}`;
}

/** Idempotently apply one verified PaymentCompleted check. */
export async function applyPaymentCheck(sql: Sql, check: PaymentLogCheck, actor: string): Promise<ApplyResult> {
  if (!check.ok || !check.intent) {
    await recordMismatch(sql, check, actor);
    return { applied: false, reason: check.reason ?? "mismatch" };
  }
  const txHash = lc(check.log.txHash);
  const blockHash = lc(check.log.blockHash);
  return sql.begin(async (tx) => {
    const [ir] = await tx`SELECT * FROM payment_intents WHERE id = ${check.intent!.id}`;
    const intent = toIntentRow(ir);
    const now = clock.now();
    const status = check.final ? "confirmed" : "confirming";
    const [existing] = await tx`SELECT * FROM payments WHERE payment_intent_id = ${intent.id}`;
    if (existing) {
      const sameLog = str(existing.transaction_hash) === txHash && int(existing.log_index) === check.log.logIndex;
      if (!sameLog && str(existing.status) !== "reorged") {
        await audit(tx, { merchantId: intent.merchant_id, actor, action: "payment.duplicate_log", resourceId: intent.id, metadata: { tx: txHash, existing_tx: str(existing.transaction_hash) } });
        return { applied: false, reason: "duplicate" };
      }
      const keepConfirmed = str(existing.status) === "confirmed" && sameLog && lc(str(existing.block_hash)) === blockHash;
      await tx`UPDATE payments SET transaction_hash = ${txHash}, log_index = ${check.log.logIndex}, block_number = ${check.log.blockNumber},
                 block_hash = ${blockHash}, confirmations = ${check.confirmations}, payer_address = ${check.payer},
                 status = ${keepConfirmed ? "confirmed" : status}, paid_at = ${check.blockTime},
                 confirmed_at = CASE WHEN ${keepConfirmed || check.final} THEN COALESCE(confirmed_at, ${now}::timestamptz) ELSE NULL END
               WHERE id = ${str(existing.id)}`;
      if (str(existing.status) === "reorged") {
        await audit(tx, { merchantId: intent.merchant_id, actor, action: "payment.reincluded", resourceId: intent.id, metadata: { tx: txHash, block: check.log.blockNumber.toString() } });
      }
    } else {
      await tx`INSERT INTO payments (payment_intent_id, merchant_id, payment_id, payer_address, payout_address, token_address, amount,
                 transaction_hash, log_index, block_number, block_hash, confirmations, status, paid_at, confirmed_at, created_at)
               VALUES (${intent.id}, ${intent.merchant_id}, ${intent.payment_id}, ${check.payer}, ${check.payout}, ${check.token}, ${check.amount},
                 ${txHash}, ${check.log.logIndex}, ${check.log.blockNumber}, ${blockHash}, ${check.confirmations}, ${status},
                 ${check.blockTime}, ${check.final ? now : null}, ${now})`;
      await audit(tx, {
        merchantId: intent.merchant_id,
        actor,
        action: "payment.recorded",
        resourceId: intent.id,
        metadata: { tx: txHash, log_index: check.log.logIndex, block: check.log.blockNumber.toString(), amount: check.amount.toString(), payer: check.payer, confirmations: check.confirmations },
      });
    }
    await rememberBlock(tx, check.log.blockNumber, blockHash);
    await settleIntent(tx, intent, check.final, check.blockTime, actor, txHash);
    return { applied: true, status: intent.status };
  });
}

/**
 * Re-count confirmations of `confirming` payments; promote to paid at CONFIRMATIONS. A block hash that no longer
 * matches means the payment was reorged out → rolled back.
 */
export async function updateConfirmations(
  sql: Sql,
  chain: ChainAdapter,
  head: bigint,
  only?: { intentId: string },
): Promise<{ confirmed: number; reorged: number }> {
  const rows = only
    ? await sql`SELECT * FROM payments WHERE status = 'confirming' AND payment_intent_id = ${only.intentId} LIMIT 5`
    : await sql`SELECT * FROM payments WHERE status = 'confirming' ORDER BY block_number ASC LIMIT 500`;
  const required = env.confirmations();
  const out = { confirmed: 0, reorged: 0 };
  for (const p of rows) {
    const bn = big(p.block_number);
    const live = await chain.getBlock(bn);
    if (lc(live.hash) !== lc(str(p.block_hash))) {
      await rollbackPayment(sql, p, "indexer", "block_hash_changed");
      out.reorged++;
      continue;
    }
    const confs = confirmationsOf(head, bn);
    if (confs < required) {
      await sql`UPDATE payments SET confirmations = ${confs} WHERE id = ${str(p.id)} AND status = 'confirming'`;
      continue;
    }
    await sql.begin(async (tx) => {
      const upd = await tx`UPDATE payments SET confirmations = ${confs}, status = 'confirmed', confirmed_at = ${clock.now()}
                           WHERE id = ${str(p.id)} AND status = 'confirming' RETURNING id`;
      if (!upd.length) return;
      const [ir] = await tx`SELECT * FROM payment_intents WHERE id = ${str(p.payment_intent_id)}`;
      const intent = toIntentRow(ir);
      await audit(tx, { merchantId: intent.merchant_id, actor: "indexer", action: "payment.confirmed", resourceId: intent.id, metadata: { confirmations: confs, tx: str(p.transaction_hash) } });
      await settleIntent(tx, intent, true, new Date(String(p.paid_at instanceof Date ? p.paid_at.toISOString() : p.paid_at)), "indexer", str(p.transaction_hash));
    });
    out.confirmed++;
  }
  return out;
}

/** Payment reorged out (or contradicted by the chain): mark reorged, roll the intent back per the state machine. */
export async function rollbackPayment(sql: Sql, p: Record<string, unknown>, actor: string, reason: string): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`UPDATE payments SET status = 'reorged', confirmations = 0, confirmed_at = NULL WHERE id = ${str(p.id)}`;
    const [ir] = await tx`SELECT * FROM payment_intents WHERE id = ${str(p.payment_intent_id)}`;
    if (!ir) return;
    const intent = toIntentRow(ir);
    const expired = intent.expires_at.getTime() < clock.now().getTime();
    const to: IntentStatus = expired ? "expired" : "awaiting_payment";
    const wasSettled = isSettled(intent.status);
    if (intent.status === "confirming" || wasSettled) {
      // confirming → awaiting_payment|expired is a normal transition; a settled intent losing its payment is not
      // in the state machine (reorg deeper than CONFIRMATIONS) and is forced + flagged for the operator.
      await transitionIntent(tx, intent, to, actor, { reason, force: wasSettled });
    }
    await tx`UPDATE payment_attempts SET status = 'submitted', checked_at = ${clock.now()} WHERE transaction_hash = ${str(p.transaction_hash)} AND status = 'succeeded'`;
    await audit(tx, {
      merchantId: intent.merchant_id,
      actor,
      action: wasSettled ? "payment.reorged_after_settlement" : "payment.reorged",
      resourceId: intent.id,
      metadata: { tx: str(p.transaction_hash), block: String(p.block_number), reason },
    });
  });
}

// ---------------------------------------------------------------- refunds

export async function applyRefundCheck(sql: Sql, check: RefundLogCheck, actor: string, opts: { refundId?: string } = {}): Promise<ApplyResult> {
  const txHash = lc(check.log.txHash);
  if (!check.ok || !check.intent) {
    await audit(sql, {
      merchantId: check.intent?.merchant_id ?? null,
      actor,
      action: "refund.mismatch",
      resourceId: `${txHash}:${check.log.logIndex}`,
      metadata: { reason: check.reason, payment_id: check.paymentId, from: check.from, amount: check.amount.toString() },
    });
    if (opts.refundId) {
      await sql`UPDATE refunds SET status = 'failed' WHERE id = ${opts.refundId} AND status IN ('requested', 'submitted')`;
    }
    return { applied: false, reason: check.reason ?? "mismatch" };
  }
  return sql.begin(async (tx) => {
    const [ir] = await tx`SELECT * FROM payment_intents WHERE id = ${check.intent!.id}`;
    const intent = toIntentRow(ir);
    const now = clock.now();
    const [done] = await tx`SELECT id FROM refunds WHERE transaction_hash = ${txHash} AND log_index = ${check.log.logIndex}`;
    if (done) return { applied: false, reason: "already_applied" };

    // Match: explicit row → row carrying this tx hash → oldest open request of the same amount → new chain row.
    let row: Record<string, unknown> | undefined;
    if (opts.refundId) [row] = await tx`SELECT * FROM refunds WHERE id = ${opts.refundId} AND payment_intent_id = ${intent.id}`;
    if (!row) [row] = await tx`SELECT * FROM refunds WHERE transaction_hash = ${txHash} AND payment_intent_id = ${intent.id}`;
    if (!row)
      [row] = await tx`SELECT * FROM refunds WHERE payment_intent_id = ${intent.id} AND transaction_hash IS NULL
                         AND status = 'requested' AND amount = ${check.amount} ORDER BY created_at ASC LIMIT 1`;
    let refundId: string;
    if (row) {
      refundId = str(row.id);
      if (big(row.amount) !== check.amount) {
        await audit(tx, { merchantId: intent.merchant_id, actor, action: "refund.amount_differs", resourceId: refundId, metadata: { requested: String(row.amount), chain: check.amount.toString() } });
      }
      await tx`UPDATE refunds SET status = 'confirmed', amount = ${check.amount}, transaction_hash = ${txHash}, log_index = ${check.log.logIndex},
                 from_address = ${check.from}, total_refunded = ${check.totalRefunded}, confirmed_at = ${now} WHERE id = ${refundId}`;
    } else {
      const [ins] = await tx`INSERT INTO refunds (payment_intent_id, merchant_id, amount, reason, status, transaction_hash, log_index,
                               from_address, total_refunded, requested_by, confirmed_at, created_at)
                             VALUES (${intent.id}, ${intent.merchant_id}, ${check.amount}, 'Refund sent outside the dashboard', 'confirmed', ${txHash},
                               ${check.log.logIndex}, ${check.from}, ${check.totalRefunded}, 'chain', ${now}, ${now}) RETURNING id`;
      refundId = str(ins.id);
    }
    await audit(tx, { merchantId: intent.merchant_id, actor, action: "refund.confirmed", resourceId: refundId, metadata: { tx: txHash, amount: check.amount.toString(), total: check.totalRefunded.toString(), from: check.from } });

    const [sum] = await tx<{ s: string | null }>`SELECT COALESCE(SUM(amount), 0)::text AS s FROM refunds WHERE payment_intent_id = ${intent.id} AND status = 'confirmed'`;
    const refunded = [big(sum?.s), check.totalRefunded, intent.amount_refunded].reduce((a, b) => (b > a ? b : a), 0n);
    const capped = refunded > intent.amount ? intent.amount : refunded;
    await tx`UPDATE payment_intents SET amount_refunded = ${capped}, updated_at = ${now} WHERE id = ${intent.id}`;
    intent.amount_refunded = capped;
    if (isSettled(intent.status)) {
      const next = refundStatus(intent.amount, capped);
      if (next !== "paid") await transitionIntent(tx, intent, next, actor, { reason: "refund_confirmed" });
    }
    await rememberBlock(tx, check.log.blockNumber, check.log.blockHash);
    const [rr] = await tx`SELECT * FROM refunds WHERE id = ${refundId}`;
    const fully = capped >= intent.amount;
    await emitEvent(tx, {
      merchantId: intent.merchant_id,
      type: "payment.refunded",
      dedupeKey: `payment.refunded:${txHash}:${check.log.logIndex}`,
      intentId: intent.id,
      refund: toRefundDTO(rr),
      fullyRefunded: fully,
    });
    await notify(tx, intent.merchant_id, {
      kind: "refund_confirmed",
      title: fully ? "Refund complete" : "Partial refund sent",
      body: `${formatMusd(check.amount)} MUSD refunded for order ${intent.merchant_order_id}.`,
      link: `/merchant/payments/${intent.id}`,
      dedupeKey: `refund_confirmed:${txHash}:${check.log.logIndex}`,
    });
    return { applied: true, status: intent.status };
  });
}

/** PaymentCancelled from the processor (merchant cancelled on-chain). */
export async function applyCancelledLog(sql: Sql, log: DecodedLog, actor: string): Promise<boolean> {
  const intent = await findIntent(sql, lc(log.args.paymentId as string));
  if (!intent) return false;
  if (BigInt(intent.onchain_merchant_id) !== (log.args.merchantId as bigint)) {
    await audit(sql, { merchantId: intent.merchant_id, actor, action: "payment.foreign_cancel_ignored", resourceId: intent.id, metadata: { tx: lc(log.txHash) } });
    return false;
  }
  return sql.begin(async (tx) => {
    await audit(tx, { merchantId: intent.merchant_id, actor, action: "payment_intent.cancelled_onchain", resourceId: intent.id, metadata: { tx: lc(log.txHash), by: lc(log.args.by as string) } });
    if (!(await transitionIntent(tx, intent, "cancelled", actor, { reason: "onchain_cancel" }))) return false;
    await emitEvent(tx, { merchantId: intent.merchant_id, type: "payment.cancelled", dedupeKey: `payment.cancelled:${intent.payment_id}`, intentId: intent.id });
    return true;
  });
}

// ---------------------------------------------------------------- client-reported tx (checkout `submitted` / `status`)

/**
 * Check a client-reported payment tx for one intent. Receipt fetched here; never trusts the client.
 * reverted → attempt failed + payment.failed + intent back to awaiting_payment. success → verify path.
 */
export async function checkReportedPayment(sql: Sql, chain: ChainAdapter, intent: IntentRow, txHash: Hex, actor = "checkout"): Promise<"pending" | "failed" | "verified" | "mismatch"> {
  const hash = lc(txHash);
  const v = await verifyPaymentTx(sql, chain, txHash);
  if (v.kind === "not_found") return "pending";
  const failAttempt = async (reason: string, emitFailed: boolean) => {
    await sql.begin(async (tx) => {
      const upd = await tx`UPDATE payment_attempts SET status = 'failed', failure_reason = ${reason}, checked_at = ${clock.now()}
                           WHERE transaction_hash = ${hash} AND status <> 'failed' RETURNING id`;
      const [ir] = await tx`SELECT * FROM payment_intents WHERE id = ${intent.id}`;
      const fresh = toIntentRow(ir);
      if (fresh.status === "submitted") {
        const [open] = await tx`SELECT 1 FROM payment_attempts WHERE payment_intent_id = ${intent.id} AND status = 'submitted' LIMIT 1`;
        if (!open) await transitionIntent(tx, fresh, "awaiting_payment", actor, { reason });
      }
      if (upd.length && emitFailed) {
        await emitEvent(tx, { merchantId: intent.merchant_id, type: "payment.failed", dedupeKey: `payment.failed:${hash}`, intentId: intent.id });
        await notify(tx, intent.merchant_id, {
          kind: "payment_failed",
          title: "Payment attempt failed",
          body: `A payment transaction for order ${intent.merchant_order_id} reverted. The checkout is still open.`,
          link: `/merchant/payments/${intent.id}`,
          dedupeKey: `payment_failed:${hash}`,
        });
      }
      if (upd.length) await audit(tx, { merchantId: intent.merchant_id, actor, action: "payment_attempt.failed", resourceId: intent.id, metadata: { tx: hash, reason } });
    });
  };
  if (v.kind === "reverted") {
    await failAttempt("reverted", true);
    return "failed";
  }
  if (v.kind === "no_payment") {
    await failAttempt(v.reason === "wrong_contract" ? "wrong_contract" : "not_a_payment", false);
    await audit(sql, { merchantId: intent.merchant_id, actor, action: "payment.mismatch", resourceId: hash, metadata: { reason: v.reason, intent: intent.id } });
    return "mismatch";
  }
  let mine: PaymentLogCheck | undefined;
  for (const c of v.checks) {
    if (c.intent?.id === intent.id) mine = c;
    else await applyPaymentCheck(sql, c, actor); // other intents (multicall) or mismatches: same path
  }
  if (!mine) {
    await failAttempt("payment_for_other_intent", false);
    return "mismatch";
  }
  const r = await applyPaymentCheck(sql, mine, actor);
  if (!r.applied && r.reason !== "duplicate") {
    await failAttempt(`mismatch:${mine.reason}`, false);
    return "mismatch";
  }
  return "verified";
}

/** Refund tx reported by the dashboard / API. */
export async function checkReportedRefund(sql: Sql, chain: ChainAdapter, refundId: string, txHash: Hex, actor: string): Promise<"pending" | "failed" | "confirmed" | "mismatch"> {
  const v = await verifyRefundTx(sql, chain, txHash);
  if (v.kind === "not_found") return "pending";
  if (v.kind === "reverted" || v.kind === "no_refund") {
    await sql`UPDATE refunds SET status = 'failed' WHERE id = ${refundId} AND status IN ('requested', 'submitted')`;
    await audit(sql, { merchantId: null, actor, action: "refund.failed", resourceId: refundId, metadata: { tx: lc(txHash), reason: v.kind === "reverted" ? "reverted" : v.reason } });
    return v.kind === "reverted" ? "failed" : "mismatch";
  }
  const [r] = await sql`SELECT payment_intent_id FROM refunds WHERE id = ${refundId}`;
  let outcome: "confirmed" | "mismatch" = "mismatch";
  for (const c of v.checks) {
    const mine = r && c.intent?.id === str(r.payment_intent_id);
    const res = await applyRefundCheck(sql, c, actor, mine ? { refundId } : {});
    if (mine && (res.applied || res.reason === "already_applied")) outcome = "confirmed";
  }
  if (outcome === "mismatch") {
    await sql`UPDATE refunds SET status = 'failed' WHERE id = ${refundId} AND status IN ('requested', 'submitted')`;
  }
  return outcome;
}

export const _intentRow = (r: Record<string, unknown>) => toIntentRow(r);
export type { DecodedLog };
