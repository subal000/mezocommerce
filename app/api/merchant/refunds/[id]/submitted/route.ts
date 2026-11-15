import { z } from "zod";
import type { RefundDTO } from "@/lib/api-types";
import { getChain } from "@/lib/server/chain";
import { merchantRoute, parseBody, zTxHash } from "@/lib/server/http";
import { submitRefundTx } from "@/lib/server/refunds";

export const POST = merchantRoute<{ id: string }>(
  async (req, { sql, merchant, params, actor }): Promise<RefundDTO> => {
    const { tx_hash } = await parseBody(req, z.object({ tx_hash: zTxHash }));
    return submitRefundTx(sql, getChain(), merchant.id, params.id, tx_hash, actor);
  },
  { rateLimit: { bucket: "refund_submitted", limit: 30 } },
);
