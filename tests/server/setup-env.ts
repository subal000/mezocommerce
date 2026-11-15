// Imported FIRST by every server test: lib/chain/config reads addresses at module load.
process.env.NEXT_PUBLIC_PROCESSOR_ADDRESS = "0x1111111111111111111111111111111111111111";
process.env.NEXT_PUBLIC_DEPLOY_BLOCK = "1";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
process.env.SESSION_SECRET = "test-session-secret-0123456789abcdef0123456789";
process.env.API_KEY_PEPPER = "test-api-key-pepper-0123456789abcdef0123456789";
process.env.ENCRYPTION_KEY = "11".repeat(32);
// Fixed platform signer (anvil key #0 — test only, holds nothing).
process.env.INTENT_SIGNER_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcab7fb3c41ba1e2f2";
process.env.CONFIRMATIONS = "2";
process.env.RECONCILE_EVERY = "1000";
delete process.env.DATABASE_URL;
delete process.env.DEMO_STORE_API_KEY;
delete process.env.DEMO_STORE_WEBHOOK_SECRET;
const { getDb } = await import("@/lib/server/db");
await getDb();
export {};
