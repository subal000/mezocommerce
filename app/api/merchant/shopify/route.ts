import type { ShopifyConnectionDTO } from "@/lib/api-types";
import { merchantRoute, parseBody } from "@/lib/server/http";
import { connectShopify, disconnectShopify, getConnection, toConnectionDTO, zConnectShopify } from "@/lib/server/shopify";

/** null when not connected. */
export const GET = merchantRoute(async (_req, { sql, merchant }): Promise<ShopifyConnectionDTO | null> => {
  const c = await getConnection(sql, merchant.id);
  return c && c.status !== "disconnected" ? toConnectionDTO(c, merchant) : null;
});

export const POST = merchantRoute(
  async (req, { sql, merchant, actor }): Promise<ShopifyConnectionDTO> => connectShopify(sql, merchant, await parseBody(req, zConnectShopify), actor),
  { rateLimit: { bucket: "shopify_connect", limit: 10 } },
);

export const DELETE = merchantRoute(async (_req, { sql, merchant, actor }) => disconnectShopify(sql, merchant, actor));
