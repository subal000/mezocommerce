import { z } from "zod";
import { listNotifications } from "@/lib/server/dashboard";
import { merchantRoute, parseQuery } from "@/lib/server/http";

/** { data: NotificationDTO[], unread: number } */
export const GET = merchantRoute(async (req, { sql, merchant }) => {
  const q = parseQuery(req, z.object({ unread: z.enum(["1", "true", "0", "false"]).optional(), limit: z.coerce.number().int().min(1).max(100).optional() }));
  return listNotifications(sql, merchant.id, { unread: q.unread === "1" || q.unread === "true", limit: q.limit });
});
