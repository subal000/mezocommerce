import type { PaymentIntentDetailDTO } from "@/lib/api-types";
import { intentDetail } from "@/lib/server/dashboard";
import { merchantRoute } from "@/lib/server/http";

export const GET = merchantRoute<{ id: string }>(
  async (_req, { sql, merchant, params }): Promise<PaymentIntentDetailDTO> => intentDetail(sql, merchant.id, params.id),
);
