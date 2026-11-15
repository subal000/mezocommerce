import type { MerchantDTO } from "@/lib/api-types";
import { merchantRoute, parseBody } from "@/lib/server/http";
import { toMerchantDTO, updateMerchant, zUpdateMerchant } from "@/lib/server/merchants";

export const GET = merchantRoute(async (_req, { merchant }): Promise<MerchantDTO> => toMerchantDTO(merchant));

export const PATCH = merchantRoute(
  async (req, { sql, merchant, actor }): Promise<MerchantDTO> => {
    const input = await parseBody(req, zUpdateMerchant);
    return toMerchantDTO(await updateMerchant(sql, merchant, input, actor));
  },
  { rateLimit: { bucket: "merchant_update", limit: 30 } },
);
