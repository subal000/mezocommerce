import type { PaymentIntentDTO } from "@/lib/api-types";
import { intentDTO } from "@/lib/server/dto";
import { apiRoute } from "@/lib/server/http";
import { getIntentForMerchant } from "@/lib/server/intents";

/** :id = pi_ id or payment_id (bytes32). */
export const GET = apiRoute<{ id: string }>(
  async (_req, { sql, merchant, params }): Promise<PaymentIntentDTO> => intentDTO(sql, await getIntentForMerchant(sql, merchant.id, params.id)),
  { permission: "payment_intents:read", rateLimit: { bucket: "v1_read", limit: 300 } },
);
