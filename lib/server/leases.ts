// worker_leases: a named stage runs in at most one worker process at a time.
import type { Sql } from "./db";
import { addSeconds, clock } from "./clock";

export async function acquireLease(sql: Sql, name: string, holder: string, ttlSec = 120): Promise<boolean> {
  const now = clock.now();
  const rows = await sql`
    INSERT INTO worker_leases (name, holder, expires_at) VALUES (${name}, ${holder}, ${addSeconds(now, ttlSec)})
    ON CONFLICT (name) DO UPDATE SET holder = EXCLUDED.holder, expires_at = EXCLUDED.expires_at
      WHERE worker_leases.expires_at < ${now} OR worker_leases.holder = EXCLUDED.holder
    RETURNING name`;
  return rows.length > 0;
}

export async function releaseLease(sql: Sql, name: string, holder: string): Promise<void> {
  await sql`DELETE FROM worker_leases WHERE name = ${name} AND holder = ${holder}`;
}

/** Run fn under a lease; returns { skipped: true } when another worker holds it. */
export async function withLease<T>(sql: Sql, name: string, holder: string, fn: () => Promise<T>, ttlSec = 120): Promise<T | { skipped: true }> {
  if (!(await acquireLease(sql, name, holder, ttlSec))) return { skipped: true };
  try {
    return await fn();
  } finally {
    await releaseLease(sql, name, holder).catch(() => undefined);
  }
}
