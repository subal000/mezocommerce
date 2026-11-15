// Merchant profiles, on-chain readiness and onboarding confirmation.
import { getAddress, type Address, type Hex } from "viem";
import { z } from "zod";
import { zBrandColor, zEmail, zHttpsUrl } from "./validation";
import type { MerchantDTO, RegistrationParamsDTO } from "@/lib/api-types";
import { ZERO_ADDRESS, contracts, isDeployed } from "@/lib/chain/config";
import type { Sql } from "./db";
import { bool, iso, str, strOrNull, dec } from "./db/rows";
import { decodeLog, fetchReceipt, lc, type ChainAdapter, type ChainMerchant } from "./chain";
import { audit } from "./audit";
import { clock } from "./clock";
import { HttpError, conflict, unavailable, unprocessable } from "./errors";
import { platformSignerAddress } from "./signer";

export interface MerchantRow {
  id: string;
  owner_user_id: string;
  owner_address: string;
  onchain_merchant_id: string | null;
  payout_address: string | null;
  platform_signer_enabled: boolean;
  chain_active: boolean;
  status: "pending" | "active" | "inactive";
  name: string;
  slug: string;
  description: string;
  logo_url: string | null;
  website: string | null;
  support_email: string | null;
  brand_color: string;
  notify_payment: boolean;
  notify_failure: boolean;
  notify_refund: boolean;
  register_tx_hash: string | null;
  created_at: string;
}

export function toMerchantRow(r: Record<string, unknown>): MerchantRow {
  return {
    id: str(r.id),
    owner_user_id: str(r.owner_user_id),
    owner_address: str(r.owner_address).toLowerCase(),
    onchain_merchant_id: r.onchain_merchant_id === null || r.onchain_merchant_id === undefined ? null : dec(r.onchain_merchant_id),
    payout_address: strOrNull(r.payout_address),
    platform_signer_enabled: bool(r.platform_signer_enabled),
    chain_active: bool(r.chain_active),
    status: str(r.status) as MerchantRow["status"],
    name: str(r.name),
    slug: str(r.slug),
    description: str(r.description),
    logo_url: strOrNull(r.logo_url),
    website: strOrNull(r.website),
    support_email: strOrNull(r.support_email),
    brand_color: str(r.brand_color) || "#0f766e",
    notify_payment: bool(r.notify_payment),
    notify_failure: bool(r.notify_failure),
    notify_refund: bool(r.notify_refund),
    register_tx_hash: strOrNull(r.register_tx_hash),
    created_at: iso(r.created_at),
  };
}

export function toMerchantDTO(m: MerchantRow): MerchantDTO {
  return {
    id: m.id,
    slug: m.slug,
    name: m.name,
    description: m.description,
    logo_url: m.logo_url,
    website: m.website,
    support_email: m.support_email,
    brand_color: m.brand_color,
    owner_address: m.owner_address,
    onchain_merchant_id: m.onchain_merchant_id,
    payout_address: m.payout_address,
    platform_signer_enabled: m.platform_signer_enabled,
    chain_active: m.chain_active,
    status: m.status,
    notify_payment: m.notify_payment,
    notify_failure: m.notify_failure,
    notify_refund: m.notify_refund,
    created_at: m.created_at,
  };
}

export async function merchantById(sql: Sql, id: string): Promise<MerchantRow | null> {
  const [r] = await sql`SELECT * FROM merchants WHERE id = ${id}`;
  return r ? toMerchantRow(r) : null;
}
export async function merchantForUser(sql: Sql, userId: string): Promise<MerchantRow | null> {
  const [r] = await sql`SELECT * FROM merchants WHERE owner_user_id = ${userId}`;
  return r ? toMerchantRow(r) : null;
}
export async function merchantForAddress(sql: Sql, address: string): Promise<MerchantRow | null> {
  const [r] = await sql`SELECT * FROM merchants WHERE owner_address = ${address.toLowerCase()}`;
  return r ? toMerchantRow(r) : null;
}
export async function merchantBySlug(sql: Sql, slug: string): Promise<MerchantRow | null> {
  const [r] = await sql`SELECT * FROM merchants WHERE slug = ${slug.toLowerCase()}`;
  return r ? toMerchantRow(r) : null;
}
export async function merchantByOnchainId(sql: Sql, id: bigint): Promise<MerchantRow | null> {
  const [r] = await sql`SELECT * FROM merchants WHERE onchain_merchant_id = ${id}`;
  return r ? toMerchantRow(r) : null;
}

// ---------------------------------------------------------------- slug

export function slugify(name: string): string {
  const s = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return s.length >= 2 ? s : `store-${s || "x"}`;
}

export async function uniqueSlug(sql: Sql, name: string): Promise<string> {
  const base = slugify(name);
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const [hit] = await sql`SELECT 1 FROM merchants WHERE slug = ${candidate}`;
    if (!hit) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

// ---------------------------------------------------------------- status derivation

export function deriveStatus(registered: boolean, active: boolean, signer: boolean): MerchantRow["status"] {
  if (!registered) return "pending";
  if (!active) return "inactive";
  return signer ? "active" : "pending";
}

/** Proposed payout (kept off the [chain] column until registration is confirmed). */
export async function proposedPayout(sql: Sql, merchantId: string): Promise<string | null> {
  const [r] = await sql<{ metadata: unknown }>`
    SELECT metadata FROM audit_logs WHERE merchant_id = ${merchantId} AND action = 'merchant.payout_proposed'
    ORDER BY id DESC LIMIT 1`;
  if (!r) return null;
  const m = (typeof r.metadata === "string" ? JSON.parse(r.metadata) : r.metadata) as { payout_address?: string };
  return m?.payout_address ?? null;
}

// ---------------------------------------------------------------- on-chain readiness (live, cached)

export interface Readiness {
  ready: boolean;
  registered: boolean;
  active: boolean;
  signer_enabled: boolean;
  payout: string | null;
  owner: string | null;
  /** "chain" = live read; "db" = RPC failed, fell back to the last synced [chain] columns. */
  source: "chain" | "db";
}

const READINESS_TTL_MS = 30_000;
const readinessCache = new Map<string, { at: number; value: Readiness }>();
export function clearReadinessCache() {
  readinessCache.clear();
}

/**
 * Live check that the merchant can receive payments right now: registered, active and the platform signer
 * allowed. Cached for 30 s. On RPC failure falls back to the DB [chain] columns (`source: "db"`).
 * Successful live reads are written back to the [chain] columns.
 */
export async function merchantReadiness(sql: Sql, chain: ChainAdapter, m: MerchantRow, opts: { fresh?: boolean } = {}): Promise<Readiness> {
  if (!m.onchain_merchant_id) {
    return { ready: false, registered: false, active: false, signer_enabled: false, payout: null, owner: null, source: "db" };
  }
  const key = m.onchain_merchant_id;
  const hit = readinessCache.get(key);
  if (!opts.fresh && hit && Date.now() - hit.at < READINESS_TTL_MS) return hit.value;
  const signer = platformSignerAddress();
  try {
    const id = BigInt(key);
    const [cm, sig] = await Promise.all([chain.getMerchant(id), signer ? chain.isSigner(id, signer as Address) : Promise.resolve(false)]);
    const registered = lc(cm.owner) !== lc(ZERO_ADDRESS);
    const value: Readiness = {
      ready: registered && cm.active && sig && lc(cm.payout) !== lc(ZERO_ADDRESS),
      registered,
      active: cm.active,
      signer_enabled: sig,
      payout: registered ? lc(cm.payout) : null,
      owner: registered ? lc(cm.owner) : null,
      source: "chain",
    };
    readinessCache.set(key, { at: Date.now(), value });
    if (registered) await writeChainColumns(sql, m, cm, sig, "chain_read");
    return value;
  } catch (e) {
    console.warn("[merchant] readiness RPC failed, using DB columns:", (e as Error).message);
    return {
      ready: m.chain_active && m.platform_signer_enabled && Boolean(m.payout_address),
      registered: true,
      active: m.chain_active,
      signer_enabled: m.platform_signer_enabled,
      payout: m.payout_address,
      owner: m.owner_address,
      source: "db",
    };
  }
}

async function writeChainColumns(sql: Sql, m: MerchantRow, cm: ChainMerchant, signer: boolean, actor: string) {
  const payout = lc(cm.payout);
  const status = deriveStatus(true, cm.active, signer);
  if (m.payout_address === payout && m.chain_active === cm.active && m.platform_signer_enabled === signer && m.status === status) return;
  await sql`UPDATE merchants SET payout_address = ${payout}, chain_active = ${cm.active}, platform_signer_enabled = ${signer},
            status = ${status}, updated_at = ${clock.now()} WHERE id = ${m.id}`;
  await audit(sql, {
    merchantId: m.id,
    actor,
    action: "merchant.chain_synced",
    resourceId: m.id,
    metadata: {
      payout: { from: m.payout_address, to: payout },
      active: { from: m.chain_active, to: cm.active },
      signer: { from: m.platform_signer_enabled, to: signer },
    },
  });
  m.payout_address = payout;
  m.chain_active = cm.active;
  m.platform_signer_enabled = signer;
  m.status = status;
}

/** Re-read merchant(id) + isSigner and sync [chain] columns (indexer, reconciliation, confirm). */
export async function syncMerchantFromChain(sql: Sql, chain: ChainAdapter, m: MerchantRow, actor: string): Promise<MerchantRow> {
  if (!m.onchain_merchant_id) return m;
  const id = BigInt(m.onchain_merchant_id);
  const signer = platformSignerAddress();
  const [cm, sigLive] = await Promise.all([chain.getMerchant(id), signer ? chain.isSigner(id, signer as Address) : Promise.resolve(null)]);
  if (lc(cm.owner) === lc(ZERO_ADDRESS)) return m;
  // Without a known platform signer address (misconfigured worker) keep the last synced value instead of clearing it.
  const sig = sigLive ?? m.platform_signer_enabled;
  if (lc(cm.owner) !== m.owner_address) {
    await audit(sql, { merchantId: m.id, actor, action: "merchant.owner_mismatch", resourceId: m.id, metadata: { chain_owner: lc(cm.owner) } });
  }
  await writeChainColumns(sql, m, cm, sig, actor);
  readinessCache.delete(m.onchain_merchant_id);
  return m;
}

// ---------------------------------------------------------------- registration params

export async function registrationParams(sql: Sql, chain: ChainAdapter, m: MerchantRow): Promise<RegistrationParamsDTO> {
  const signer = platformSignerAddress() ?? ZERO_ADDRESS;
  const base = { processor_address: lc(contracts.processor), platform_signer: signer };
  if (!m.onchain_merchant_id) {
    return { ...base, payout_address: (await proposedPayout(sql, m.id)) ?? m.owner_address, next: "register" };
  }
  const r = await merchantReadiness(sql, chain, m, { fresh: true });
  const next: RegistrationParamsDTO["next"] = !r.registered ? "register" : !r.signer_enabled ? "enable_signer" : !r.active ? "activate" : "ready";
  return { ...base, payout_address: r.payout ?? m.payout_address ?? m.owner_address, next };
}

// ---------------------------------------------------------------- onboarding tx confirmation

const MERCHANT_EVENTS = ["MerchantRegistered", "PayoutUpdated", "SignerUpdated", "MerchantStatusUpdated"];

/**
 * POST /api/merchants/me/confirm. The tx must: exist and succeed, be sent TO the processor BY the signed-in wallet,
 * and contain at least one merchant-management event for this merchant (MerchantRegistered with owner == wallet
 * links the on-chain id). The DB is then synced from live reads, never from the event payload alone.
 */
export async function confirmMerchantTx(sql: Sql, chain: ChainAdapter, m: MerchantRow, sessionAddress: string, txHash: Hex): Promise<MerchantRow> {
  if (!isDeployed) throw unavailable("processor_not_deployed", "The payment processor contract is not configured");
  const receipt = await fetchReceipt(chain, txHash, { attempts: 6, delayMs: 1500 });
  if (!receipt) throw new HttpError(404, "tx_not_found", "Transaction receipt not found yet. Try again in a few seconds.");
  if (receipt.status !== "success") throw unprocessable("tx_reverted", "Transaction reverted on-chain");
  if (lc(receipt.to) !== lc(contracts.processor)) throw unprocessable("wrong_contract", "Transaction was not sent to the MezoCommerce processor");
  if (lc(receipt.from) !== lc(sessionAddress)) throw new HttpError(403, "wrong_sender", "Transaction was sent by a different wallet than the signed-in one");
  const logs = receipt.logs.map(decodeLog).filter((l) => l !== null && MERCHANT_EVENTS.includes(l.eventName));
  if (logs.length === 0) throw unprocessable("event_missing", "No merchant registration or settings event found in this transaction");

  let onchainId = m.onchain_merchant_id;
  for (const l of logs) {
    const id = String(l!.args.merchantId as bigint);
    if (l!.eventName === "MerchantRegistered") {
      if (lc(l!.args.owner as string) !== lc(sessionAddress)) throw new HttpError(403, "wrong_owner", "Registered owner is not your wallet");
      if (onchainId && onchainId !== id) throw conflict("already_registered", "This merchant is already linked to a different on-chain id");
      onchainId = id;
    } else if (onchainId !== id) {
      throw unprocessable("wrong_merchant", "The transaction changed a different merchant");
    }
  }
  if (!onchainId) throw unprocessable("not_registered", "Register the merchant on-chain first");

  // Live read is the source of truth; the event only told us which merchant to look at.
  const cm = await chain.getMerchant(BigInt(onchainId));
  if (lc(cm.owner) !== lc(sessionAddress)) throw new HttpError(403, "wrong_owner", "On-chain owner is not your wallet");

  if (!m.onchain_merchant_id) {
    const [taken] = await sql`SELECT id FROM merchants WHERE onchain_merchant_id = ${onchainId} AND id <> ${m.id}`;
    if (taken) throw conflict("already_linked", "That on-chain merchant is linked to another profile");
    await sql`UPDATE merchants SET onchain_merchant_id = ${onchainId}, owner_address = ${lc(cm.owner)},
              register_tx_hash = ${lc(txHash)}, updated_at = ${clock.now()} WHERE id = ${m.id}`;
    await audit(sql, { merchantId: m.id, actor: lc(sessionAddress), action: "merchant.registered", resourceId: m.id, metadata: { onchain_merchant_id: onchainId, tx: lc(txHash) } });
    m.onchain_merchant_id = onchainId;
  } else {
    await audit(sql, { merchantId: m.id, actor: lc(sessionAddress), action: "merchant.settings_tx_confirmed", resourceId: m.id, metadata: { tx: lc(txHash), events: logs.map((l) => l!.eventName) } });
  }
  await syncMerchantFromChain(sql, chain, m, lc(sessionAddress));
  return (await merchantById(sql, m.id))!;
}

/** Indexer: link a MerchantRegistered event to the owner's pending profile (owner match is the security condition). */
export async function linkRegisteredMerchant(sql: Sql, chain: ChainAdapter, onchainId: bigint, owner: string, txHash: string): Promise<void> {
  const existing = await merchantByOnchainId(sql, onchainId);
  if (existing) {
    await syncMerchantFromChain(sql, chain, existing, "indexer");
    return;
  }
  const m = await merchantForAddress(sql, owner);
  if (!m || m.onchain_merchant_id) return;
  await sql`UPDATE merchants SET onchain_merchant_id = ${onchainId}, register_tx_hash = COALESCE(register_tx_hash, ${lc(txHash)}),
            updated_at = ${clock.now()} WHERE id = ${m.id} AND onchain_merchant_id IS NULL`;
  await audit(sql, { merchantId: m.id, actor: "indexer", action: "merchant.registered", resourceId: m.id, metadata: { onchain_merchant_id: onchainId.toString(), tx: lc(txHash) } });
  m.onchain_merchant_id = onchainId.toString();
  await syncMerchantFromChain(sql, chain, m, "indexer");
}

export const checksum = (a: string) => getAddress(a);

// ---------------------------------------------------------------- profile create / update


export const zCreateMerchant = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional(),
  website: zHttpsUrl.nullish(),
  logo_url: zHttpsUrl.nullish(),
  support_email: zEmail.nullish(),
  payout_address: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x address"),
});

export const zUpdateMerchant = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(500).optional(),
  website: zHttpsUrl.nullish(),
  logo_url: zHttpsUrl.nullish(),
  support_email: zEmail.nullish(),
  brand_color: zBrandColor.optional(),
  notify_payment: z.boolean().optional(),
  notify_failure: z.boolean().optional(),
  notify_refund: z.boolean().optional(),
});

export async function createMerchant(sql: Sql, session: { userId: string; address: string }, input: z.infer<typeof zCreateMerchant>): Promise<MerchantRow> {
  const payout = input.payout_address.toLowerCase();
  if (payout === lc(ZERO_ADDRESS)) throw new HttpError(400, "invalid_payout", "Payout address cannot be the zero address");
  if (isDeployed && payout === lc(contracts.processor)) throw new HttpError(400, "invalid_payout", "Payout address cannot be the processor contract");
  if (await merchantForUser(sql, session.userId)) throw conflict("merchant_exists", "This wallet already has a merchant profile");
  const slug = await uniqueSlug(sql, input.name);
  const now = clock.now();
  const [row] = await sql.begin(async (tx) => {
    const r = await tx`INSERT INTO merchants (owner_user_id, owner_address, name, slug, description, website, logo_url, support_email, status, created_at, updated_at)
                       VALUES (${session.userId}, ${session.address.toLowerCase()}, ${input.name}, ${slug}, ${input.description ?? ""},
                               ${input.website ?? null}, ${input.logo_url ?? null}, ${input.support_email ?? null}, 'pending', ${now}, ${now})
                       RETURNING *`;
    await audit(tx, { merchantId: str(r[0].id), actor: session.address.toLowerCase(), action: "merchant.created", resourceId: str(r[0].id), metadata: { slug } });
    await audit(tx, { merchantId: str(r[0].id), actor: session.address.toLowerCase(), action: "merchant.payout_proposed", resourceId: str(r[0].id), metadata: { payout_address: payout } });
    return r;
  });
  return toMerchantRow(row);
}

export async function updateMerchant(sql: Sql, m: MerchantRow, input: z.infer<typeof zUpdateMerchant>, actor: string): Promise<MerchantRow> {
  const sets: ReturnType<Sql["frag"]>[] = [];
  const fields = ["name", "description", "website", "logo_url", "support_email", "brand_color", "notify_payment", "notify_failure", "notify_refund"] as const;
  const changed: string[] = [];
  for (const f of fields) {
    const v = input[f];
    if (v === undefined) continue;
    sets.push(sql.frag`${sql.raw(f)} = ${v}`);
    changed.push(f);
  }
  if (!sets.length) return m;
  sets.push(sql.frag`updated_at = ${clock.now()}`);
  const [row] = await sql`UPDATE merchants SET ${sql.join(sets, ", ")} WHERE id = ${m.id} RETURNING *`;
  await audit(sql, { merchantId: m.id, actor, action: "merchant.updated", resourceId: m.id, metadata: { fields: changed } });
  return toMerchantRow(row);
}
