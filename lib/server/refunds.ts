// Refund requests. Nothing moves until the merchant wallet (owner or current payout) sends approve + refund; the
// processor pays the original payer and caps cumulative refunds on-chain. The DB caps requests too.
import { encodeFunctionData, type Hex } from "viem";
import { z } from "zod";
import type { RefundDTO } from "@/lib/api-types";
import { erc20Abi, processorAbi } from "@/lib/chain/abis";
import { contracts } from "@/lib/chain/config";
import { isSettled } from "@/lib/chain/payment-state";
import { formatMusd, parseMusd } from "@/lib/money";
import type { Sql } from "./db";
import { big, str } from "./db/rows";
import type { ChainAdapter } from "./chain";
import { audit } from "./audit";
import { addSeconds, clock } from "./clock";
import { HttpError, conflict, notFound } from "./errors";
import { findIntent, toRefundDTO, type IntentRow } from "./dto";
import { checkReportedRefund } from "./settle";
import { UUID_RE } from "./ids";

export const zCreateRefund = z.object({
  payment_intent_id: z.string().min(1).max(80),
  amount: z.string().min(1).max(40),
  reason: z.string().max(500).optional(),
});

/** Requested refunds older than this no longer reserve refundable balance. */
const REQUEST_RESERVATION_SEC = 24 * 3600;

export function refundCalls(i: IntentRow, amount: bigint): NonNullable<RefundDTO["tx"]> {
  return {
    approve: {
      to: i.token_address,
      data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [contracts.processor, amount] }),
    },
    refund: {
      to: contracts.processor.toLowerCase(),
      data: encodeFunctionData({ abi: processorAbi, functionName: "refund", args: [BigInt(i.onchain_merchant_id), i.payment_id as Hex, amount] }),
    },
  };
}

export async function refundable(sql: Sql, i: IntentRow): Promise<{ refundable: bigint; inFlight: bigint }> {
  const cutoff = addSeconds(clock.now(), -REQUEST_RESERVATION_SEC);
  const [r] = await sql<{ s: string | null }>`
    SELECT COALESCE(SUM(amount), 0)::text AS s FROM refunds WHERE payment_intent_id = ${i.id}
    AND (status = 'submitted' OR (status = 'requested' AND created_at > ${cutoff}))`;
  const inFlight = big(r?.s);
  const left = i.amount - i.amount_refunded - inFlight;
  return { refundable: left > 0n ? left : 0n, inFlight };
}

export async function createRefund(sql: Sql, merchantId: string, input: z.infer<typeof zCreateRefund>, actor: string): Promise<RefundDTO> {
  const i = await findIntent(sql, input.payment_intent_id, merchantId);
  if (!i) throw notFound("Payment intent not found");
  if (!isSettled(i.status) || i.status === "refunded") throw conflict("not_refundable", `A ${i.status} payment cannot be refunded`);
  let amount: bigint;
  try {
    amount = parseMusd(input.amount);
  } catch (e) {
    throw new HttpError(400, "invalid_amount", (e as Error).message);
  }
  if (amount <= 0n) throw new HttpError(400, "invalid_amount", "Refund amount must be greater than zero");
  return sql.begin(async (tx) => {
    // Serialise refund creation per intent (Postgres row lock; PGlite is single-connection).
    if (tx.kind === "postgres") await tx`SELECT id FROM payment_intents WHERE id = ${i.id} FOR UPDATE`;
    const { refundable: left } = await refundable(tx, i);
    if (amount > left) {
      throw new HttpError(422, "refund_exceeds_payment", `At most ${formatMusd(left, { decimals: 18 }).replace(/\.?0+$/, "")} MUSD can still be refunded`, {
        refundable: left.toString(),
      });
    }
    const [row] = await tx`INSERT INTO refunds (payment_intent_id, merchant_id, amount, reason, status, requested_by, created_at)
                           VALUES (${i.id}, ${merchantId}, ${amount}, ${input.reason ?? ""}, 'requested', ${actor}, ${clock.now()}) RETURNING *`;
    await audit(tx, { merchantId, actor, action: "refund.requested", resourceId: str(row.id), metadata: { intent: i.id, amount: amount.toString() } });
    return toRefundDTO(row, refundCalls(i, amount));
  });
}

export async function getRefund(sql: Sql, merchantId: string, id: string): Promise<RefundDTO> {
  if (!UUID_RE.test(id)) throw notFound("Refund not found");
  const [row] = await sql`SELECT * FROM refunds WHERE id = ${id} AND merchant_id = ${merchantId}`;
  if (!row) throw notFound("Refund not found");
  let tx: RefundDTO["tx"] = null;
  if (str(row.status) === "requested" || str(row.status) === "failed") {
    const i = await findIntent(sql, str(row.payment_intent_id), merchantId);
    if (i) tx = refundCalls(i, big(row.amount));
  }
  return toRefundDTO(row, tx);
}

export async function listRefundsForIntent(sql: Sql, intentId: string): Promise<RefundDTO[]> {
  const rows = await sql`SELECT * FROM refunds WHERE payment_intent_id = ${intentId} ORDER BY created_at DESC`;
  return rows.map((r) => toRefundDTO(r));
}

/** POST /api/merchant/refunds/:id/submitted { tx_hash } — record the hash, then verify RefundCompleted from the chain. */
export async function submitRefundTx(sql: Sql, chain: ChainAdapter, merchantId: string, id: string, txHash: Hex, actor: string): Promise<RefundDTO> {
  if (!UUID_RE.test(id)) throw notFound("Refund not found");
  const hash = txHash.toLowerCase();
  const [row] = await sql`SELECT * FROM refunds WHERE id = ${id} AND merchant_id = ${merchantId}`;
  if (!row) throw notFound("Refund not found");
  if (str(row.status) === "confirmed") return getRefund(sql, merchantId, id);
  const [other] = await sql`SELECT id FROM refunds WHERE transaction_hash = ${hash} AND id <> ${id}`;
  if (other) throw conflict("tx_already_used", "This transaction is already recorded for another refund");
  await sql`UPDATE refunds SET transaction_hash = ${hash}, status = 'submitted' WHERE id = ${id} AND status IN ('requested', 'submitted', 'failed')`;
  await audit(sql, { merchantId, actor, action: "refund.submitted", resourceId: id, metadata: { tx: hash } });
  await checkReportedRefund(sql, chain, id, txHash, actor);
  return getRefund(sql, merchantId, id);
}
