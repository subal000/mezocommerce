import { z } from "zod";
import type { Paginated, ShopifyOrderDTO } from "@/lib/api-types";
import { merchantRoute, parseQuery, zPage, zPageSize } from "@/lib/server/http";
import { listShopifyOrders } from "@/lib/server/shopify";

export const GET = merchantRoute(async (req, { sql, merchant }): Promise<Paginated<ShopifyOrderDTO>> => {
  const q = parseQuery(req, z.object({ page: zPage, page_size: zPageSize }));
  return listShopifyOrders(sql, merchant.id, q.page, q.page_size);
});
