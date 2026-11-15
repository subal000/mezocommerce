import { z } from "zod";
import { markNotificationsRead } from "@/lib/server/dashboard";
import { merchantRoute, parseBody } from "@/lib/server/http";

/** Body { ids?: uuid[] } — omit ids to mark all read. */
export const POST = merchantRoute(async (req, { sql, merchant }) => {
  const { ids } = await parseBody(req, z.object({ ids: z.array(z.string().uuid()).max(200).optional() }));
  return markNotificationsRead(sql, merchant.id, ids);
});
