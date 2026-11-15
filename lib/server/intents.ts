// Payment intent service: creation (shared by v1 API, dashboard, Shopify and the demo store), reads, cancel, expiry.
import { encodeFunctionData, getAddress, type Address, type Hex } from "viem";
import { z } from "zod";
import type { PaymentIntentDTO } from "@/lib/api-types";
import { processorAbi } from "@/lib/chain/abis";
import { INTENT_LIMITS, MUSD_SYMBOL, contracts, isDeployed } from "@/lib/chain/config";
import { canTransition, INTENT_STATUSES, isPayable, type IntentStatus } from "@/lib/chain/payment-state";
import { formatMusd, parseMusd } from "@/lib/money";
import type { Sql } from "./db";
import { int } from "./db/rows";
import type { ChainAdapter } from "./chain";
import { audit } from "./audit";
import { addSeconds, clock } from "./clock";
import { env } from "./env";
import { HttpError, badRequest, conflict, isUniqueViolation, notFound, unavailable } from "./errors";
import { emitEvent, notify } from "./events";
import { findIntent, intentDTO, intentDTOs, toIntentRow, type IntentRow } from "./dto";
import { newIntentId, newPaymentId } from "./ids";
import { merchantReadiness, type MerchantRow } from "./merchants";
import { intentSigner, signIntent } from "./signer";
import { zRedirectUrl } from "./validation";

export const INTENT_SOURCES = ["api", "dashboard", "payment_link", "shopify", "demo_store"] as const;
export type IntentSource = (typeof INTENT_SOURCES)[number];

const zMetadata = z
  .record(z.string().min(1).max(40), z.string().max(500))
  .refine((m) => Object.keys(m).length <= INTENT_LIMITS.MAX_METADATA_KEYS, `at most ${INTENT_LIMITS.MAX_METADATA_KEYS} metadata keys`);

export const zCreateIntent = z.object({
  merchant_order_id: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9_\-#:./]+$/, "may only contain letters, digits and _ - # : . /"),
  amount: z.string().min(1).max(40),
  currency: z.literal("MUSD").optional(),
  description: z.string().max(500).optional(),
  return_url: zRedirectUrl.nullish(),
  cancel_url: zRedirectUrl.nullish(),
  expires_in_seconds: z.number().int().min(INTENT_LIMITS.MIN_TTL_SECONDS).max(INTENT_LIMITS.MAX_TTL_SECONDS).optional(),
  payer_address: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x address")
    .nullish(),
  metadata: zMetadata.optional(),
});
export type CreateIntentInput = z.infer<typeof zCreateIntent>;

/** Parse + range-check a decimal MUSD amount → wei. */
export function parseIntentAmount(raw: string): bigint {
  let wei: bigint;
  try {
    wei = parseMusd(raw);
  } catch (e) {
    throw new HttpError(400, "invalid_amount", (e as Error).message);
  }
  if (wei < INTENT_LIMITS.MIN_AMOUNT_WEI) throw new HttpError(400, "amount_too_small", `Minimum amount is ${formatMusd(INTENT_LIMITS.MIN_AMOUNT_WEI)} MUSD`);
  if (wei > INTENT_LIMITS.MAX_AMOUNT_WEI) throw new HttpError(400, "amount_too_large", `Maximum amount is ${formatMusd(INTENT_LIMITS.MAX_AMOUNT_WEI, { decimals: 0 })} MUSD`);
  return wei;
}

async function openOrderIntent(sql: Sql, merchantId: string, orderId: string): Promise<IntentRow | null> {
  const [r] = await sql`SELECT * FROM payment_intents WHERE merchant_id = ${merchantId} AND merchant_order_id = ${orderId}
                        AND status NOT IN ('expired', 'cancelled')`;
  return r ? toIntentRow(r) : null;
}

/**
 * Create a signed, immutable payment intent. Requires the merchant to be ready on-chain (registered, active,
 * platform signer allowed — live read with a short cache, DB fallback on RPC failure).
 */
export async function createPaymentIntent(
  sql: Sql,
  chain: ChainAdapter,
  args: { merchant: MerchantRow; input: CreateIntentInput; source: IntentSource; actor: string },
): Promise<PaymentIntentDTO> {
  const { merchant, input, source, actor } = args;
  if (!isDeployed) throw unavailable("processor_not_deployed", "Payments are not available yet: the processor contract is not configured");
  const amount = parseIntentAmount(input.amount);

  const readiness = await merchantReadiness(sql, chain, merchant);
  if (!readiness.ready || !readiness.payout || !merchant.onchain_merchant_id) {
    throw conflict("merchant_not_ready", "Finish on-chain setup first: register the merchant, enable the platform signer and keep it active", {
      registered: readiness.registered,
      active: readiness.active,
      signer_enabled: readiness.signer_enabled,
      source: readiness.source,
    });
  }

  // One open-or-settled intent per order. A payable intent that is past expiry is expired now, freeing the order.
  const existing = await openOrderIntent(sql, merchant.id, input.merchant_order_id);
  if (existing) {
    if (isPayable(existing.status) && existing.expires_at.getTime() < clock.now().getTime()) {
      await expireIntent(sql, existing, "system");
    } else {
      throw conflict("order_has_open_intent", "This order already has an open or paid payment intent", {
        payment_intent: await intentDTO(sql, existing),
      });
    }
  }

  const now = clock.now();
  const ttl = input.expires_in_seconds ?? INTENT_LIMITS.DEFAULT_TTL_SECONDS;
  const expiresAtSec = BigInt(Math.floor(now.getTime() / 1000) + ttl);
  const id = newIntentId();
  const paymentId = newPaymentId();
  const payer = input.payer_address ? input.payer_address.toLowerCase() : null;
  const struct = {
    paymentId,
    merchantId: BigInt(merchant.onchain_merchant_id),
    payout: getAddress(readiness.payout) as Address,
    token: contracts.musd,
    amount,
    payer: (payer ? getAddress(payer) : "0x0000000000000000000000000000000000000000") as Address,
    expiresAt: expiresAtSec,
  };
  const signature = await signIntent(struct);
  const signer = intentSigner().address.toLowerCase();
  const checkoutUrl = `${env.appUrl()}/checkout/${id}`;

  try {
    await sql.begin(async (tx) => {
      await tx`
        INSERT INTO payment_intents (id, payment_id, merchant_id, onchain_merchant_id, merchant_order_id, description, amount,
          token_address, token_symbol, payout_address, payer_address, expires_at, signature, signer_address, status,
          return_url, cancel_url, metadata, source, checkout_url, created_at, updated_at)
        VALUES (${id}, ${paymentId.toLowerCase()}, ${merchant.id}, ${merchant.onchain_merchant_id}, ${input.merchant_order_id},
          ${input.description ?? ""}, ${amount}, ${contracts.musd.toLowerCase()}, ${MUSD_SYMBOL}, ${readiness.payout!.toLowerCase()},
          ${payer}, ${new Date(Number(expiresAtSec) * 1000)}, ${signature}, ${signer}, 'created',
          ${input.return_url ?? null}, ${input.cancel_url ?? null}, ${input.metadata ?? {}}::jsonb, ${source}, ${checkoutUrl}, ${now}, ${now})`;
      await audit(tx, {
        merchantId: merchant.id,
        actor,
        action: "payment_intent.created",
        resourceId: id,
        metadata: { amount: amount.toString(), order: input.merchant_order_id, source, payout: readiness.payout, readiness_source: readiness.source },
      });
      await emitEvent(tx, { merchantId: merchant.id, type: "payment.created", dedupeKey: `payment.created:${paymentId.toLowerCase()}`, intentId: id });
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      const other = await openOrderIntent(sql, merchant.id, input.merchant_order_id);
      throw conflict("order_has_open_intent", "This order already has an open or paid payment intent", {
        payment_intent: other ? await intentDTO(sql, other) : null,
      });
    }
    throw e;
  }
  const row = await findIntent(sql, id, merchant.id);
  return intentDTO(sql, row!);
}

// ---------------------------------------------------------------- reads

export async function getIntentForMerchant(sql: Sql, merchantId: string, id: string): Promise<IntentRow> {
  const i = await findIntent(sql, id, merchantId);
  if (!i) throw notFound("Payment intent not found");
  return i;
}

export const zListQuery = z.object({
  status: z.enum(INTENT_STATUSES).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().max(128).optional(),
  search: z.string().max(128).optional(),
});

/** WHERE fragment for list/export: status filter + search over order id, pi_ id, payment_id, payer and tx hashes. */
export function intentFilter(sql: Sql, merchantId: string, f: { status?: IntentStatus; q?: string; search?: string }) {
  const where = [sql.frag`merchant_id = ${merchantId}`];
  if (f.status) where.push(sql.frag`status = ${f.status}`);
  const term = (f.q ?? f.search ?? "").trim();
  if (term) {
    const hex = term.toLowerCase(); // hex values are stored lowercase
    where.push(sql.frag`(merchant_order_id ILIKE ${"%" + term.replace(/[%_\\]/g, "\\$&") + "%"} OR id = ${term} OR payment_id = ${hex}
      OR payer_address = ${hex}
      OR EXISTS (SELECT 1 FROM payments p WHERE p.payment_intent_id = payment_intents.id AND (p.payer_address = ${hex} OR p.transaction_hash = ${hex}))
      OR EXISTS (SELECT 1 FROM payment_attempts a WHERE a.payment_intent_id = payment_intents.id AND (a.transaction_hash = ${hex} OR a.reported_payer = ${hex})))`);
  }
  return sql.join(where, " AND ");
}

export async function listIntents(sql: Sql, merchantId: string, q: z.infer<typeof zListQuery>) {
  const w = intentFilter(sql, merchantId, q);
  const [{ n }] = await sql<{ n: number }>`SELECT count(*)::int AS n FROM payment_intents WHERE ${w}`;
  const rows = await sql`SELECT * FROM payment_intents WHERE ${w} ORDER BY created_at DESC, id DESC
                         LIMIT ${q.page_size} OFFSET ${(q.page - 1) * q.page_size}`;
  return { data: await intentDTOs(sql, rows.map(toIntentRow)), page: q.page, page_size: q.page_size, total: int(n) };
}

// ---------------------------------------------------------------- transitions

/** Set status (state-machine checked) + timestamps + audit. Returns false when the transition is not allowed. */
export async function transitionIntent(
  sql: Sql,
  i: IntentRow,
  to: IntentStatus,
  actor: string,
  extra: { late?: boolean; reason?: string; force?: boolean } = {},
): Promise<boolean> {
  if (i.status === to && to !== "partially_refunded") return false;
  if (!extra.force && !canTransition(i.status, to)) return false;
  const now = clock.now();
  const rows = await sql`
    UPDATE payment_intents SET status = ${to}, updated_at = ${now},
      late = ${extra.late ?? i.late},
      cancelled_at = CASE WHEN ${to} = 'cancelled' THEN ${now}::timestamptz ELSE cancelled_at END,
      expired_at = CASE WHEN ${to} = 'expired' THEN ${now}::timestamptz ELSE expired_at END
    WHERE id = ${i.id} AND status = ${i.status} RETURNING id`;
  if (rows.length === 0) return false; // lost a race; caller re-reads
  await audit(sql, {
    merchantId: i.merchant_id,
    actor,
    action: "payment_intent.status_changed",
    resourceId: i.id,
    metadata: { from: i.status, to, ...(extra.reason ? { reason: extra.reason } : {}), ...(extra.late ? { late: true } : {}) },
  });
  i.status = to;
  if (extra.late !== undefined) i.late = extra.late;
  return true;
}

export async function expireIntent(sql: Sql, i: IntentRow, actor: string): Promise<boolean> {
  return sql.begin(async (tx) => {
    if (!(await transitionIntent(tx, i, "expired", actor))) return false;
    await emitEvent(tx, { merchantId: i.merchant_id, type: "payment.expired", dedupeKey: `payment.expired:${i.payment_id}`, intentId: i.id });
    await notify(tx, i.merchant_id, {
      kind: "payment_expired",
      title: "Payment expired",
      body: `Order ${i.merchant_order_id} was not paid before the checkout expired.`,
      link: `/merchant/payments/${i.id}`,
      dedupeKey: `payment_expired:${i.id}`,
    });
    return true;
  });
}

/** Expiry sweep: payable intents past expires_at (+ small grace for an indexer that is catching up). */
export async function sweepExpired(sql: Sql, opts: { graceSec?: number; limit?: number } = {}): Promise<number> {
  const cutoff = addSeconds(clock.now(), -(opts.graceSec ?? 60));
  const rows = await sql`SELECT * FROM payment_intents WHERE status IN ('created', 'awaiting_payment', 'submitted')
                         AND expires_at < ${cutoff} ORDER BY expires_at ASC LIMIT ${opts.limit ?? 200}`;
  let n = 0;
  for (const r of rows) if (await expireIntent(sql, toIntentRow(r), "worker")) n++;
  return n;
}

/** On-chain cancel calldata (merchant owner or an allowed signer sends it). */
export function cancelCalldata(i: IntentRow): { to: string; data: Hex } {
  return {
    to: contracts.processor.toLowerCase(),
    data: encodeFunctionData({ abi: processorAbi, functionName: "cancelPayment", args: [BigInt(i.onchain_merchant_id), i.payment_id as Hex] }),
  };
}

/** DB cancel: hides the signature from checkout immediately. Returns the on-chain cancel calldata as well. */
export async function cancelIntent(sql: Sql, merchantId: string, id: string, actor: string): Promise<PaymentIntentDTO & { cancel_tx: { to: string; data: string } }> {
  const i = await getIntentForMerchant(sql, merchantId, id);
  if (!isPayable(i.status)) {
    if (i.status === "cancelled") return { ...(await intentDTO(sql, i)), cancel_tx: cancelCalldata(i) };
    throw conflict("intent_not_cancellable", `A ${i.status} payment intent cannot be cancelled`);
  }
  const ok = await sql.begin(async (tx) => {
    if (!(await transitionIntent(tx, i, "cancelled", actor))) return false;
    await emitEvent(tx, { merchantId, type: "payment.cancelled", dedupeKey: `payment.cancelled:${i.payment_id}`, intentId: i.id });
    return true;
  });
  if (!ok) throw conflict("intent_changed", "The payment intent changed while cancelling; reload and try again");
  return { ...(await intentDTO(sql, i)), cancel_tx: cancelCalldata(i) };
}

export function assertMetadataSize(meta: Record<string, string> | undefined) {
  if (meta && JSON.stringify(meta).length > 16_000) throw badRequest("metadata too large");
}
