import { z } from "zod";
import type { NonceResponse } from "@/lib/api-types";
import { issueNonce } from "@/lib/server/auth";
import { parseBody, route, siweOrigin, zAddress } from "@/lib/server/http";

export const POST = route(
  async (req, { sql }): Promise<NonceResponse> => {
    const { address } = await parseBody(req, z.object({ address: zAddress }));
    const { domain, uri } = siweOrigin(req);
    return issueNonce(sql, address, { domain, uri });
  },
  { rateLimit: { bucket: "auth_nonce", limit: 20 } },
);
