import type { WebhookDeliveryDTO } from "@/lib/api-types";
import { merchantRoute } from "@/lib/server/http";
import { sendTestEvent } from "@/lib/server/webhooks";

/** Sends a `ping` event to this endpoint now and returns the delivery result. */
export const POST = merchantRoute<{ id: string }>(
  async (_req, { sql, merchant, params, actor }): Promise<WebhookDeliveryDTO> => sendTestEvent(sql, merchant.id, params.id, actor),
  { rateLimit: { bucket: "webhook_test", limit: 10 } },
);
