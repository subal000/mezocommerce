import { z } from "zod";
import type { SessionDTO } from "@/lib/api-types";
import { sessionCookieHeader, verifySignIn } from "@/lib/server/auth";
import { getChain } from "@/lib/server/chain";
import { json, parseBody, route, siweOrigin, zAddress } from "@/lib/server/http";
import { merchantForUser } from "@/lib/server/merchants";

const body = z.object({
  address: zAddress,
  message: z.string().min(10).max(4000),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/).max(20_000) as unknown as z.ZodType<`0x${string}`>,
});

export const POST = route(
  async (req, { sql }) => {
    const input = await parseBody(req, body);
    const { allowedDomains } = siweOrigin(req);
    const session = await verifySignIn(sql, getChain(), input, { allowedDomains });
    const m = await merchantForUser(sql, session.userId);
    const res: SessionDTO = { address: session.address, merchant_id: m?.id ?? null, expires_at: session.expiresAt.toISOString() };
    return json(res, { headers: { "set-cookie": sessionCookieHeader(session.id, session.expiresAt) } });
  },
  { rateLimit: { bucket: "auth_verify", limit: 20 } },
);
