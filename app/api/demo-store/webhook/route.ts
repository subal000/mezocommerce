import { demoWebhook } from "@/lib/server/demo-store-service";
import { route } from "@/lib/server/http";

/** The reference storefront's own MezoCommerce webhook receiver (signature verified, deduped on event id). */
export const POST = route(async (req, { sql }) => demoWebhook(sql, req.headers, await req.text()), {
  rateLimit: { bucket: "demo_webhook", limit: 300 },
});
