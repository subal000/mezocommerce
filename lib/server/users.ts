import type { Sql } from "./db";

export async function ensureUser(tx: Sql, address: string): Promise<string> {
  const a = address.toLowerCase();
  const [row] = await tx<{ id: string }>`
    INSERT INTO users (wallet_address) VALUES (${a})
    ON CONFLICT (wallet_address) DO UPDATE SET wallet_address = EXCLUDED.wallet_address
    RETURNING id`;
  return row.id;
}
