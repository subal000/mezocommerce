import { getChain } from "@/lib/server/chain";
import { route } from "@/lib/server/http";
import { handleShopifyWebhook } from "@/lib/server/shopify";

/** Shopify orders/create webhook. Raw body HMAC (X-Shopify-Hmac-Sha256) verified with the app's API secret. */
export const POST = route<{ merchantSlug: string }>(
  async (req, { sql, params }) => handleShopifyWebhook(sql, getChain(), params.merchantSlug, req.headers, await req.text()),
  { rateLimit: { bucket: "shopify_webhook", limit: 300 } },
);
