import type { RefundDTO } from "@/lib/api-types";
import { apiRoute } from "@/lib/server/http";
import { getRefund } from "@/lib/server/refunds";

export const GET = apiRoute<{ id: string }>(
  async (_req, { sql, merchant, params }): Promise<RefundDTO> => getRefund(sql, merchant.id, params.id),
  { permission: "payments:read", rateLimit: { bucket: "v1_read", limit: 300 } },
);
