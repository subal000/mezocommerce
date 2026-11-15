// API keys: mc_test_sk_<40 base62>. Only sha256(API_KEY_PEPPER ‖ key) is stored; the prefix is kept for display.
import { createHash, timingSafeEqual } from "node:crypto";
import type { ApiKeyDTO, CreatedApiKeyDTO } from "@/lib/api-types";
import { API_KEY_PREFIX } from "@/lib/chain/config";
import type { Sql } from "./db";
import { iso, isoOrNull, json, str } from "./db/rows";
import { addSeconds, clock } from "./clock";
import { env } from "./env";
import { HttpError, badRequest, notFound, unauthorized } from "./errors";
import { randomBase62 } from "./ids";
import { audit } from "./audit";
import { toMerchantRow, type MerchantRow } from "./merchants";

export const API_PERMISSIONS = [
  "payment_intents:write",
  "payment_intents:read",
  "payments:read",
  "refunds:write",
  "webhooks:write",
] as const;
export type ApiPermission = (typeof API_PERMISSIONS)[number];

export const API_KEY_RE = new RegExp(`^${API_KEY_PREFIX}[0-9A-Za-z]{40}$`);
const MAX_ACTIVE_KEYS = 20;

export interface ApiKeyAuth {
  id: string;
  merchantId: string;
  prefix: string;
  permissions: string[];
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(env.apiKeyPepper()).update(key).digest("hex");
}

export function generateApiKey(): string {
  return `${API_KEY_PREFIX}${randomBase62(40)}`;
}

function toDTO(r: Record<string, unknown>): ApiKeyDTO {
  return {
    id: str(r.id),
    name: str(r.name),
    key_prefix: str(r.key_prefix),
    permissions: json<string[]>(r.permissions, []),
    last_used_at: isoOrNull(r.last_used_at),
    created_at: iso(r.created_at),
    revoked_at: isoOrNull(r.revoked_at),
  };
}

export async function createApiKey(
  sql: Sql,
  merchantId: string,
  input: { name?: string; permissions?: string[] },
  actor: string,
): Promise<CreatedApiKeyDTO> {
  const perms = input.permissions?.length ? Array.from(new Set(input.permissions)) : [...API_PERMISSIONS];
  for (const p of perms) if (!(API_PERMISSIONS as readonly string[]).includes(p)) throw badRequest(`Unknown permission: ${p}`);
  const [{ n }] = await sql<{ n: number }>`SELECT count(*)::int AS n FROM api_keys WHERE merchant_id = ${merchantId} AND revoked_at IS NULL`;
  if (Number(n) >= MAX_ACTIVE_KEYS) throw new HttpError(409, "too_many_keys", `At most ${MAX_ACTIVE_KEYS} active API keys; revoke one first`);
  const secret = generateApiKey();
  const [row] = await sql`
    INSERT INTO api_keys (merchant_id, name, key_hash, key_prefix, permissions, created_at)
    VALUES (${merchantId}, ${(input.name || "Default").slice(0, 60)}, ${hashApiKey(secret)}, ${secret.slice(0, 16)}, ${perms}::jsonb, ${clock.now()})
    RETURNING *`;
  await audit(sql, { merchantId, actor, action: "api_key.created", resourceId: str(row.id), metadata: { prefix: secret.slice(0, 16), permissions: perms } });
  return { ...toDTO(row), secret };
}

export async function listApiKeys(sql: Sql, merchantId: string): Promise<ApiKeyDTO[]> {
  const rows = await sql`SELECT * FROM api_keys WHERE merchant_id = ${merchantId} ORDER BY created_at DESC`;
  return rows.map(toDTO);
}

export async function revokeApiKey(sql: Sql, merchantId: string, id: string, actor: string): Promise<ApiKeyDTO> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("API key not found");
  const [row] = await sql`
    UPDATE api_keys SET revoked_at = COALESCE(revoked_at, ${clock.now()})
    WHERE id = ${id} AND merchant_id = ${merchantId} RETURNING *`;
  if (!row) throw notFound("API key not found");
  await audit(sql, { merchantId, actor, action: "api_key.revoked", resourceId: id, metadata: { prefix: str(row.key_prefix) } });
  return toDTO(row);
}

/** Resolve a bearer key → (key, merchant). 401 on any failure (unknown, malformed, revoked). */
export async function authenticateApiKey(sql: Sql, presented: string): Promise<{ key: ApiKeyAuth; merchant: MerchantRow }> {
  if (!API_KEY_RE.test(presented)) throw unauthorized("Invalid API key");
  const hash = hashApiKey(presented);
  const [row] = await sql`
    SELECT k.id AS key_id, k.key_hash, k.key_prefix, k.permissions, k.revoked_at, k.last_used_at, m.*
    FROM api_keys k JOIN merchants m ON m.id = k.merchant_id WHERE k.key_hash = ${hash}`;
  // The row lookup is by hash (an index probe); re-compare in constant time anyway.
  const stored = Buffer.from(str(row?.key_hash ?? "0".repeat(64)), "hex");
  const want = Buffer.from(hash, "hex");
  if (!row || stored.length !== want.length || !timingSafeEqual(stored, want)) throw unauthorized("Invalid API key");
  if (row.revoked_at) throw unauthorized("This API key has been revoked");
  const now = clock.now();
  const last = row.last_used_at ? new Date(String(row.last_used_at instanceof Date ? row.last_used_at.toISOString() : row.last_used_at)) : null;
  if (!last || last.getTime() < addSeconds(now, -60).getTime()) {
    await sql`UPDATE api_keys SET last_used_at = ${now} WHERE id = ${str(row.key_id)}`;
  }
  const merchant = toMerchantRow(row);
  return {
    key: { id: str(row.key_id), merchantId: merchant.id, prefix: str(row.key_prefix), permissions: json<string[]>(row.permissions, []) },
    merchant,
  };
}

export function requirePermission(key: ApiKeyAuth, perm: ApiPermission): void {
  if (!key.permissions.includes(perm)) {
    throw new HttpError(403, "insufficient_permissions", `This API key lacks the ${perm} permission`);
  }
}
