import type { RefundDTO } from "@/lib/api-types";
import { merchantRoute, parseBody } from "@/lib/server/http";
import { createRefund, zCreateRefund } from "@/lib/server/refunds";

export const POST = merchantRoute(
  async (req, { sql, merchant, actor }): Promise<RefundDTO> => createRefund(sql, merchant.id, await parseBody(req, zCreateRefund), actor),
  { rateLimit: { bucket: "refund_create", limit: 30 }, idempotent: true },
);
