import type { WebhookEndpointDTO } from "@/lib/api-types";
import { merchantRoute } from "@/lib/server/http";
import { disableEndpoint } from "@/lib/server/webhooks";

export const DELETE = merchantRoute<{ id: string }>(
  async (_req, { sql, merchant, params, actor }): Promise<WebhookEndpointDTO> => disableEndpoint(sql, merchant.id, params.id, actor),
);
