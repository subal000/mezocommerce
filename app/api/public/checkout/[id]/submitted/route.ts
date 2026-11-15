import { z } from "zod";
import type { CheckoutStatusDTO } from "@/lib/api-types";
import { getChain } from "@/lib/server/chain";
import { reportSubmitted } from "@/lib/server/checkout";
import { parseBody, route, zAddress, zTxHash } from "@/lib/server/http";

/** UNVERIFIED hint: the server fetches the receipt itself and runs the single verification path. */
export const POST = route<{ id: string }>(
  async (req, { sql, params }): Promise<CheckoutStatusDTO> => {
    const body = await parseBody(req, z.object({ tx_hash: zTxHash, payer_address: zAddress.optional() }));
    return reportSubmitted(sql, getChain(), params.id, body.tx_hash, body.payer_address);
  },
  { rateLimit: { bucket: "checkout_submitted", limit: 30 } },
);
