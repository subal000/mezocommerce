import type { PaymentDTO } from "@/lib/api-types";
import { findIntent, toPaymentDTO } from "@/lib/server/dto";
import { notFound } from "@/lib/server/errors";
import { UUID_RE } from "@/lib/server/ids";
import { apiRoute } from "@/lib/server/http";
import { str } from "@/lib/server/db/rows";

/** Verified payment by payment row id (uuid), pi_ id or payment_id. */
export const GET = apiRoute<{ id: string }>(
  async (_req, { sql, merchant, params }): Promise<PaymentDTO> => {
    let row: Record<string, unknown> | undefined;
    if (UUID_RE.test(params.id)) [row] = await sql`SELECT * FROM payments WHERE id = ${params.id} AND merchant_id = ${merchant.id}`;
    else {
      const i = await findIntent(sql, params.id, merchant.id);
      if (i) [row] = await sql`SELECT * FROM payments WHERE payment_intent_id = ${i.id} AND merchant_id = ${merchant.id}`;
    }
    if (!row) throw notFound("Payment not found");
    return toPaymentDTO(row, str(row.payment_intent_id));
  },
  { permission: "payments:read", rateLimit: { bucket: "v1_read", limit: 300 } },
);
