import type { MerchantDTO } from "@/lib/api-types";
import { createMerchant, toMerchantDTO, zCreateMerchant } from "@/lib/server/merchants";
import { parseBody, sessionRoute } from "@/lib/server/http";

export const POST = sessionRoute(
  async (req, { sql, session }): Promise<MerchantDTO> => {
    const input = await parseBody(req, zCreateMerchant);
    return toMerchantDTO(await createMerchant(sql, session, input));
  },
  { rateLimit: { bucket: "merchant_create", limit: 10 }, idempotent: true },
);
