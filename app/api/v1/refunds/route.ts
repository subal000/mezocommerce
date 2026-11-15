import type { RefundDTO } from "@/lib/api-types";
import { apiRoute, parseBody } from "@/lib/server/http";
import { createRefund, zCreateRefund } from "@/lib/server/refunds";

/** Creates a `requested` refund; `tx` holds the approve + refund calls the merchant wallet must send. */
export const POST = apiRoute(
  async (req, { sql, merchant, actor }): Promise<RefundDTO> => createRefund(sql, merchant.id, await parseBody(req, zCreateRefund), actor),
  { permission: "refunds:write", rateLimit: { bucket: "v1_write", limit: 120 }, idempotent: true },
);
