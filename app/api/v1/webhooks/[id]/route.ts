import type { WebhookEndpointDTO } from "@/lib/api-types";
import { apiRoute } from "@/lib/server/http";
import { disableEndpoint } from "@/lib/server/webhooks";

export const DELETE = apiRoute<{ id: string }>(
  async (_req, { sql, merchant, params, actor }): Promise<WebhookEndpointDTO> => disableEndpoint(sql, merchant.id, params.id, actor),
  { permission: "webhooks:write", rateLimit: { bucket: "v1_write", limit: 30 } },
);
