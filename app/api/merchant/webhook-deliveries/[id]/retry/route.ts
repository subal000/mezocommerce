import type { WebhookDeliveryDTO } from "@/lib/api-types";
import { merchantRoute } from "@/lib/server/http";
import { retryDelivery } from "@/lib/server/webhooks";

export const POST = merchantRoute<{ id: string }>(
  async (_req, { sql, merchant, params, actor }): Promise<WebhookDeliveryDTO> => retryDelivery(sql, merchant.id, params.id, actor),
  { rateLimit: { bucket: "webhook_retry", limit: 20 } },
);
