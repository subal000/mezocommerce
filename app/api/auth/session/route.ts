import type { SessionDTO } from "@/lib/api-types";
import { merchantForUser } from "@/lib/server/merchants";
import { sessionRoute } from "@/lib/server/http";

/** 401 `unauthorized` when not signed in. */
export const GET = sessionRoute(async (_req, { sql, session }): Promise<SessionDTO> => {
  const m = await merchantForUser(sql, session.userId);
  return { address: session.address, merchant_id: m?.id ?? null, expires_at: session.expiresAt.toISOString() };
});
