import { z } from "zod";
import type { Paginated, PaymentDTO } from "@/lib/api-types";
import { int, str } from "@/lib/server/db/rows";
import { toPaymentDTO } from "@/lib/server/dto";
import { forbidden } from "@/lib/server/errors";
import { apiRoute, parseQuery, zPage, zPageSize } from "@/lib/server/http";

/** :id must be the key's merchant (uuid, slug or on-chain id) — anything else is 403. */
export const GET = apiRoute<{ id: string }>(
  async (req, { sql, merchant, params }): Promise<Paginated<PaymentDTO>> => {
    const id = params.id.toLowerCase();
    if (id !== merchant.id && id !== merchant.slug && id !== (merchant.onchain_merchant_id ?? "")) throw forbidden("This API key belongs to a different merchant");
    const q = parseQuery(req, z.object({ page: zPage, page_size: zPageSize }));
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM payments WHERE merchant_id = ${merchant.id}`;
    const rows = await sql`SELECT * FROM payments WHERE merchant_id = ${merchant.id} ORDER BY paid_at DESC
                           LIMIT ${q.page_size} OFFSET ${(q.page - 1) * q.page_size}`;
    return { data: rows.map((r) => toPaymentDTO(r, str(r.payment_intent_id))), page: q.page, page_size: q.page_size, total: int(n) };
  },
  { permission: "payments:read", rateLimit: { bucket: "v1_read", limit: 300 } },
);
