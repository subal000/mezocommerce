import { z } from "zod";
import type { PreflightDTO } from "@/lib/api-types";
import { getChain } from "@/lib/server/chain";
import { preflight } from "@/lib/server/checkout";
import { parseQuery, route, zAddress } from "@/lib/server/http";

export const GET = route<{ id: string }>(
  async (req, { sql, params }): Promise<PreflightDTO> => {
    const { payer } = parseQuery(req, z.object({ payer: zAddress }));
    return preflight(sql, getChain(), params.id, payer);
  },
  { rateLimit: { bucket: "checkout_preflight", limit: 60 } },
);
