import type { Sql } from "./db";
import { clock } from "./clock";

/** Append-only audit trail. Every state change of a money-relevant row goes through here. */
export async function audit(
  sql: Sql,
  input: { merchantId?: string | null; actor: string; action: string; resourceId?: string | null; metadata?: Record<string, unknown> },
): Promise<void> {
  await sql`INSERT INTO audit_logs (merchant_id, actor, action, resource_id, metadata, created_at)
            VALUES (${input.merchantId ?? null}, ${input.actor}, ${input.action}, ${input.resourceId ?? null},
                    ${input.metadata ?? {}}::jsonb, ${clock.now()})`;
}
