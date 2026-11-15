import type { Paginated, WebhookDeliveryDTO } from "@/lib/api-types";
import { z } from "zod";
import { merchantRoute, parseQuery, zPage, zPageSize } from "@/lib/server/http";
import { listDeliveries } from "@/lib/server/webhooks";

export const GET = merchantRoute(async (req, { sql, merchant }): Promise<Paginated<WebhookDeliveryDTO>> => {
  const q = parseQuery(req, z.object({ page: zPage, page_size: zPageSize }));
  return listDeliveries(sql, merchant.id, q.page, q.page_size);
});
