// Public checkout endpoints (no auth; keyed by pi_ id or payment_id). Never exposes secrets; the signed intent is
// only returned while the intent is payable.
import { getAddress, type Address, type Hex } from "viem";
import type { CheckoutDTO, CheckoutStatusDTO, PreflightDTO } from "@/lib/api-types";
import { MEZO_TESTNET_ID, MUSD_DECIMALS, contracts, mezoTestnet } from "@/lib/chain/config";
import { effectiveStatus, isPayable, isSettled } from "@/lib/chain/payment-state";
import { musdToDecimalString } from "@/lib/money";
import type { Sql } from "./db";
import { str } from "./db/rows";
import { lc, type ChainAdapter } from "./chain";
import { audit } from "./audit";
import { clock } from "./clock";
import { env } from "./env";
import { HttpError, conflict, notFound } from "./errors";
import { findIntent, intentStruct, paymentRowFor, toAttemptDTO, toPaymentDTO, type IntentRow } from "./dto";
import { transitionIntent } from "./intents";
import { merchantById } from "./merchants";
import { checkReportedPayment, updateConfirmations } from "./settle";

async function load(sql: Sql, id: string): Promise<IntentRow> {
  const i = await findIntent(sql, id);
  if (!i) throw notFound("Checkout not found");
  return i;
}

function visiblePayment(p: Record<string, unknown> | null, intentId: string) {
  return p && str(p.status) !== "reorged" ? toPaymentDTO(p, intentId) : null;
}

export async function getCheckout(sql: Sql, id: string): Promise<CheckoutDTO> {
  const i = await load(sql, id);
  if (i.status === "created" && i.expires_at.getTime() > clock.now().getTime()) {
    await sql`UPDATE payment_intents SET first_viewed_at = COALESCE(first_viewed_at, ${clock.now()}) WHERE id = ${i.id}`;
    await transitionIntent(sql, i, "awaiting_payment", "checkout", { reason: "checkout_opened" });
  }
  const m = await merchantById(sql, i.merchant_id);
  const status = effectiveStatus(i.status, i.expires_at, clock.now());
  const payable = isPayable(status);
  const p = await paymentRowFor(sql, i.id);
  const s = intentStruct(i);
  return {
    id: i.id,
    payment_id: i.payment_id,
    status,
    late: i.late,
    merchant: {
      name: m?.name ?? "Merchant",
      slug: m?.slug ?? "",
      logo_url: m?.logo_url ?? null,
      website: m?.website ?? null,
      brand_color: m?.brand_color ?? "#0f766e",
      payout_address: i.payout_address,
    },
    merchant_order_id: i.merchant_order_id,
    description: i.description,
    amount: i.amount.toString(),
    amount_display: musdToDecimalString(i.amount),
    currency: "MUSD",
    token: { address: i.token_address, symbol: "MUSD", decimals: MUSD_DECIMALS },
    network: { chain_id: MEZO_TESTNET_ID, name: mezoTestnet.name },
    processor_address: lc(contracts.processor),
    expires_at: i.expires_at.toISOString(),
    return_url: i.return_url,
    cancel_url: i.cancel_url,
    intent: payable
      ? {
          payment_id: i.payment_id,
          merchant_id: s.merchantId.toString(),
          payout: lc(s.payout),
          token: lc(s.token),
          amount: s.amount.toString(),
          payer: lc(s.payer),
          expires_at: s.expiresAt.toString(),
          signature: i.signature,
        }
      : null,
    payment: visiblePayment(p, i.id),
    required_confirmations: env.confirmations(),
  };
}

async function statusDTO(sql: Sql, i: IntentRow): Promise<CheckoutStatusDTO> {
  const cur = (await findIntent(sql, i.id))!;
  const status = effectiveStatus(cur.status, cur.expires_at, clock.now());
  const p = await paymentRowFor(sql, i.id);
  const [a] = await sql`SELECT * FROM payment_attempts WHERE payment_intent_id = ${i.id} ORDER BY created_at DESC LIMIT 1`;
  return { status, payment: visiblePayment(p, i.id), attempt: a ? toAttemptDTO(a) : null, verified: isSettled(status) };
}

/** Polling. Opportunistically re-checks the latest reported tx (server-side receipt fetch; never trusts the client). */
export async function getCheckoutStatus(sql: Sql, chain: ChainAdapter, id: string): Promise<CheckoutStatusDTO> {
  const i = await load(sql, id);
  if (isPayable(i.status)) {
    const [a] = await sql`SELECT transaction_hash FROM payment_attempts WHERE payment_intent_id = ${i.id} AND status = 'submitted'
                          ORDER BY created_at DESC LIMIT 1`;
    if (a) {
      try {
        await checkReportedPayment(sql, chain, i, str(a.transaction_hash) as Hex, "checkout_status");
      } catch (e) {
        console.warn("[checkout] status re-check failed:", (e as Error).message); // indexer will catch up
      }
    }
  } else if (i.status === "confirming") {
    // Count confirmations for this payment now instead of waiting for the next worker pass (up to a minute when the
    // worker runs from cron). Same code path as the worker; the promotion to paid is guarded, so racing it is safe.
    try {
      await updateConfirmations(sql, chain, await chain.getBlockNumber(), { intentId: i.id });
    } catch (e) {
      console.warn("[checkout] confirmation re-check failed:", (e as Error).message); // worker will catch up
    }
  }
  return statusDTO(sql, i);
}

/** POST submitted — UNVERIFIED hint: records an attempt, then the server fetches the receipt itself. */
export async function reportSubmitted(sql: Sql, chain: ChainAdapter, id: string, txHash: Hex, payer: string | undefined): Promise<CheckoutStatusDTO> {
  const i = await load(sql, id);
  const hash = lc(txHash);
  const [existing] = await sql`SELECT payment_intent_id FROM payment_attempts WHERE transaction_hash = ${hash}`;
  if (existing && str(existing.payment_intent_id) !== i.id) throw conflict("tx_already_reported", "This transaction was reported for a different checkout");
  const status = effectiveStatus(i.status, i.expires_at, clock.now());
  if (!existing) {
    if (!isPayable(status) && !isSettled(status) && status !== "confirming") {
      throw new HttpError(409, "not_payable", `This checkout is ${status}`);
    }
    await sql`INSERT INTO payment_attempts (payment_intent_id, transaction_hash, reported_payer, status, created_at)
              VALUES (${i.id}, ${hash}, ${payer ? lc(payer) : null}, 'submitted', ${clock.now()}) ON CONFLICT (transaction_hash) DO NOTHING`;
    await audit(sql, { merchantId: i.merchant_id, actor: "checkout", action: "payment_attempt.reported", resourceId: i.id, metadata: { tx: hash } });
    if (i.status === "created" || i.status === "awaiting_payment") await transitionIntent(sql, i, "submitted", "checkout", { reason: "tx_reported" });
  }
  try {
    await checkReportedPayment(sql, chain, i, txHash, "checkout");
  } catch (e) {
    console.warn("[checkout] submitted check failed (will retry on poll / indexer):", (e as Error).message);
  }
  return statusDTO(sql, i);
}

/**
 * Live preflight for a payer: processor.checkPayment + MUSD balance/allowance + native BTC (gas).
 * checkPayment cannot see an EIP-2612 permit, so `insufficient_allowance` is reported as payable (`ok`) with
 * needs_approval=true: the checkout either signs a permit (payWithPermit) or sends approve(exact) first.
 */
export async function preflight(sql: Sql, chain: ChainAdapter, id: string, payerRaw: string): Promise<PreflightDTO> {
  const i = await load(sql, id);
  const status = effectiveStatus(i.status, i.expires_at, clock.now());
  if (!isPayable(status)) throw new HttpError(409, "not_payable", `This checkout is ${status}`);
  const payer = getAddress(payerRaw) as Address;
  const token = i.token_address as Address;
  const [raw, bal, allowance, btc] = await Promise.all([
    chain.checkPayment(intentStruct(i), i.signature as Hex, payer),
    chain.balanceOf(token, payer),
    chain.allowance(token, payer, contracts.processor),
    chain.nativeBalance(payer),
  ]);
  const needsApproval = allowance < i.amount;
  const check = raw === "insufficient_allowance" ? "ok" : raw;
  return {
    check,
    musd_balance: bal.toString(),
    musd_balance_display: musdToDecimalString(bal),
    allowance: allowance.toString(),
    btc_balance: btc.toString(),
    needs_approval: needsApproval,
    gas_ok: btc > 0n,
  };
}
