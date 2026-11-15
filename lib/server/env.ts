// Server-side runtime configuration (read lazily so tests and the worker can set process.env first).
import { createHash } from "node:crypto";

function truthy(v: string | undefined): boolean {
  return v === "1" || v === "true" || v === "yes";
}
function intEnv(name: string, def: number, min: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return def;
  const n = Number(raw);
  return Number.isFinite(n) && n >= min ? Math.floor(n) : def;
}

const warned = new Set<string>();
function warnOnce(key: string, msg: string) {
  if (warned.has(key) || process.env.VITEST) return;
  warned.add(key);
  console.warn(`\n[mezocommerce] WARNING: ${msg}\n`);
}

export const env = {
  isProd: () => process.env.NODE_ENV === "production",
  /** Blocks (inclusive of the payment block) before a payment counts as paid. Minimum 1. */
  confirmations: () => intEnv("CONFIRMATIONS", 2, 1),
  workerIntervalMs: () => intEnv("WORKER_INTERVAL_MS", 5000, 1000),
  /** Run reconciliation every N indexer passes. */
  reconcileEvery: () => intEnv("RECONCILE_EVERY", 20, 1),
  appUrl: () => (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, ""),
  sessionSecret(): string {
    const s = process.env.SESSION_SECRET;
    if (s && s.length >= 32) return s;
    if (env.isProd()) throw new Error("SESSION_SECRET must be set (>= 32 chars) in production");
    warnOnce("session", "SESSION_SECRET is not set; using an insecure development secret.");
    return "dev-only-insecure-session-secret-change-me-0000";
  },
  apiKeyPepper(): string {
    const s = process.env.API_KEY_PEPPER;
    if (s && s.length >= 32) return s;
    if (env.isProd()) throw new Error("API_KEY_PEPPER must be set (>= 32 chars) in production");
    warnOnce("pepper", "API_KEY_PEPPER is not set; using an insecure development pepper.");
    return "dev-only-insecure-api-key-pepper-change-me-0000";
  },
  /** 32-byte AES-256-GCM key for Shopify credentials (ENCRYPTION_KEY = 64 hex chars). */
  encryptionKey(): Buffer {
    const s = process.env.ENCRYPTION_KEY;
    if (s && /^[0-9a-fA-F]{64}$/.test(s)) return Buffer.from(s, "hex");
    if (env.isProd()) throw new Error("ENCRYPTION_KEY must be 32 bytes of hex (64 chars) in production");
    warnOnce("enc", "ENCRYPTION_KEY is not set; deriving an insecure development key.");
    return createHash("sha256").update("mezocommerce-dev-encryption-key").digest();
  },
  indexerSecret: () => process.env.INDEXER_SECRET || "",
  demoStoreApiKey: () => process.env.DEMO_STORE_API_KEY || "",
  demoStoreWebhookSecret: () => process.env.DEMO_STORE_WEBHOOK_SECRET || "",
  /** Development only: allow http://localhost webhook endpoints (never honoured in production). */
  allowLocalWebhooks: () => !env.isProd() && truthy(process.env.WEBHOOK_ALLOW_LOCALHOST),
  warnOnce,
};
