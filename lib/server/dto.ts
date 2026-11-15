// DB row → wire DTO mappers (lib/api-types.ts) and intent loaders.
import type { Address, Hex } from "viem";
import type { PaymentAttemptDTO, PaymentDTO, PaymentIntentDTO, RefundDTO } from "@/lib/api-types";
import { explorerTx } from "@/lib/chain/config";
import { effectiveStatus, type AttemptStatus, type IntentStatus, type RefundStatus } from "@/lib/chain/payment-state";
import { musdToDecimalString } from "@/lib/money";
import type { Sql } from "./db";
import { big, bool, date, dec, int, iso, isoOrNull, json, str, strOrNull } from "./db/rows";
import type { IntentStruct } from "./chain";
import { clock } from "./clock";
import { BYTES32_RE, PI_ID_RE } from "./ids";

export interface IntentRow {
  id: string;
  payment_id: string;
  merchant_id: string;
  onchain_merchant_id: string;
  merchant_order_id: string;
  description: string;
  amount: bigint;
  token_address: string;
  token_symbol: string;
  payout_address: string;
  payer_address: string | null;
  expires_at: Date;
  signature: string;
  signer_address: string;
  status: IntentStatus;
  late: boolean;
  return_url: string | null;
  cancel_url: string | null;
  metadata: Record<string, string>;
  source: string;
  checkout_url: string;
  amount_refunded: bigint;
  paid_at: Date | null;
  cancelled_at: Date | null;
  expired_at: Date | null;
  first_viewed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const dOrNull = (v: unknown) => (v === null || v === undefined ? null : date(v));

export function toIntentRow(r: Record<string, unknown>): IntentRow {
  return {
    id: str(r.id),
    payment_id: str(r.payment_id),
    merchant_id: str(r.merchant_id),
    onchain_merchant_id: dec(r.onchain_merchant_id),
    merchant_order_id: str(r.merchant_order_id),
    description: str(r.description),
    amount: big(r.amount),
    token_address: str(r.token_address),
    token_symbol: str(r.token_symbol),
    payout_address: str(r.payout_address),
    payer_address: strOrNull(r.payer_address),
    expires_at: date(r.expires_at),
    signature: str(r.signature),
    signer_address: str(r.signer_address),
    status: str(r.status) as IntentStatus,
    late: bool(r.late),
    return_url: strOrNull(r.return_url),
    cancel_url: strOrNull(r.cancel_url),
    metadata: json<Record<string, string>>(r.metadata, {}),
    source: str(r.source),
    checkout_url: str(r.checkout_url),
    amount_refunded: big(r.amount_refunded),
    paid_at: dOrNull(r.paid_at),
    cancelled_at: dOrNull(r.cancelled_at),
    expired_at: dOrNull(r.expired_at),
    first_viewed_at: dOrNull(r.first_viewed_at),
    created_at: date(r.created_at),
    updated_at: date(r.updated_at),
  };
}

const ZERO = "0x0000000000000000000000000000000000000000" as Address;

/** The exact struct the customer submits on-chain (and that was signed). */
export function intentStruct(i: IntentRow): IntentStruct {
  return {
    paymentId: i.payment_id as Hex,
    merchantId: BigInt(i.onchain_merchant_id),
    payout: i.payout_address as Address,
    token: i.token_address as Address,
    amount: i.amount,
    payer: (i.payer_address ?? ZERO) as Address,
    expiresAt: BigInt(Math.floor(i.expires_at.getTime() / 1000)),
  };
}

export function toPaymentDTO(p: Record<string, unknown>, intentId: string): PaymentDTO {
  const tx = str(p.transaction_hash);
  return {
    id: str(p.id),
    object: "payment",
    payment_intent_id: intentId,
    payment_id: str(p.payment_id),
    payer_address: str(p.payer_address),
    payout_address: str(p.payout_address),
    token_address: str(p.token_address),
    amount: dec(p.amount),
    amount_display: musdToDecimalString(big(p.amount)),
    transaction_hash: tx,
    block_number: dec(p.block_number),
    confirmations: int(p.confirmations),
    status: str(p.status) as PaymentDTO["status"],
    explorer_url: explorerTx(tx),
    paid_at: iso(p.paid_at),
    confirmed_at: isoOrNull(p.confirmed_at),
  };
}

export function toIntentDTO(i: IntentRow, payment: Record<string, unknown> | null): PaymentIntentDTO {
  return {
    id: i.id,
    object: "payment_intent",
    payment_id: i.payment_id,
    merchant_id: i.merchant_id,
    merchant_order_id: i.merchant_order_id,
    description: i.description,
    amount: i.amount.toString(),
    amount_display: musdToDecimalString(i.amount),
    currency: "MUSD",
    token_address: i.token_address,
    payout_address: i.payout_address,
    payer_address: i.payer_address,
    status: effectiveStatus(i.status, i.expires_at, clock.now()),
    late: i.late,
    checkout_url: i.checkout_url,
    return_url: i.return_url,
    cancel_url: i.cancel_url,
    metadata: i.metadata,
    source: i.source,
    expires_at: i.expires_at.toISOString(),
    amount_refunded: i.amount_refunded.toString(),
    amount_refunded_display: musdToDecimalString(i.amount_refunded),
    payment: payment ? toPaymentDTO(payment, i.id) : null,
    created_at: i.created_at.toISOString(),
    updated_at: i.updated_at.toISOString(),
  };
}

export function toAttemptDTO(a: Record<string, unknown>): PaymentAttemptDTO {
  return {
    transaction_hash: str(a.transaction_hash),
    status: str(a.status) as AttemptStatus,
    failure_reason: strOrNull(a.failure_reason),
    created_at: iso(a.created_at),
  };
}

export function toRefundDTO(r: Record<string, unknown>, tx: RefundDTO["tx"] = null): RefundDTO {
  const hash = strOrNull(r.transaction_hash);
  const status = str(r.status) as RefundStatus;
  return {
    id: str(r.id),
    object: "refund",
    payment_intent_id: str(r.payment_intent_id),
    amount: dec(r.amount),
    amount_display: musdToDecimalString(big(r.amount)),
    reason: str(r.reason),
    status,
    transaction_hash: hash,
    explorer_url: hash ? explorerTx(hash) : null,
    from_address: strOrNull(r.from_address),
    total_refunded: r.total_refunded === null || r.total_refunded === undefined ? null : dec(r.total_refunded),
    created_at: iso(r.created_at),
    confirmed_at: isoOrNull(r.confirmed_at),
    tx,
  };
}

// ---------------------------------------------------------------- loaders

/** Find an intent by pi_ id or payment_id, optionally scoped to a merchant. */
export async function findIntent(sql: Sql, idOrPaymentId: string, merchantId?: string): Promise<IntentRow | null> {
  let rows: Record<string, unknown>[];
  if (PI_ID_RE.test(idOrPaymentId)) {
    rows = merchantId
      ? await sql`SELECT * FROM payment_intents WHERE id = ${idOrPaymentId} AND merchant_id = ${merchantId}`
      : await sql`SELECT * FROM payment_intents WHERE id = ${idOrPaymentId}`;
  } else if (BYTES32_RE.test(idOrPaymentId)) {
    const pid = idOrPaymentId.toLowerCase();
    rows = merchantId
      ? await sql`SELECT * FROM payment_intents WHERE payment_id = ${pid} AND merchant_id = ${merchantId}`
      : await sql`SELECT * FROM payment_intents WHERE payment_id = ${pid}`;
  } else {
    return null;
  }
  return rows[0] ? toIntentRow(rows[0]) : null;
}

export async function paymentRowFor(sql: Sql, intentId: string): Promise<Record<string, unknown> | null> {
  const [p] = await sql`SELECT * FROM payments WHERE payment_intent_id = ${intentId}`;
  return p ?? null;
}

export async function intentDTO(sql: Sql, i: IntentRow): Promise<PaymentIntentDTO> {
  return toIntentDTO(i, await paymentRowFor(sql, i.id));
}

export async function loadIntentDTO(sql: Sql, intentId: string): Promise<PaymentIntentDTO | null> {
  const [r] = await sql`SELECT * FROM payment_intents WHERE id = ${intentId}`;
  return r ? intentDTO(sql, toIntentRow(r)) : null;
}

/** Bulk DTOs for lists (one query for payments). */
export async function intentDTOs(sql: Sql, rows: IntentRow[]): Promise<PaymentIntentDTO[]> {
  if (rows.length === 0) return [];
  const ids = sql.join(rows.map((r) => sql.frag`${r.id}`), ", ");
  const payments = await sql`SELECT * FROM payments WHERE payment_intent_id IN (${ids})`;
  const byIntent = new Map(payments.map((p) => [str(p.payment_intent_id), p]));
  return rows.map((r) => toIntentDTO(r, byIntent.get(r.id) ?? null));
}
