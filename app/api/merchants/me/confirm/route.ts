import { z } from "zod";
import type { MerchantDTO } from "@/lib/api-types";
import { getChain } from "@/lib/server/chain";
import { merchantRoute, parseBody, zTxHash } from "@/lib/server/http";
import { confirmMerchantTx, toMerchantDTO } from "@/lib/server/merchants";

/** Verify a register / setPayout / setSigner / setMerchantActive tx (receipt + events + live reads), then sync. */
export const POST = merchantRoute(
  async (req, { sql, merchant, session }): Promise<MerchantDTO> => {
    const { tx_hash } = await parseBody(req, z.object({ tx_hash: zTxHash }));
    return toMerchantDTO(await confirmMerchantTx(sql, getChain(), merchant, session.address, tx_hash));
  },
  { rateLimit: { bucket: "merchant_confirm", limit: 30 } },
);
