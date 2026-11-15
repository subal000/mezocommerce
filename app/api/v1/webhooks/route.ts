import { z } from "zod";
import type { CreatedWebhookEndpointDTO, WebhookEndpointDTO } from "@/lib/api-types";
import { WEBHOOK_EVENT_TYPES } from "@/lib/chain/payment-state";
import { apiRoute, parseBody } from "@/lib/server/http";
import { createEndpoint, listEndpoints } from "@/lib/server/webhooks";

const zCreate = z.object({ url: z.string().trim().max(2048), event_types: z.array(z.enum([...WEBHOOK_EVENT_TYPES, "*"])).max(20).optional() });

export const GET = apiRoute(async (_req, { sql, merchant }): Promise<WebhookEndpointDTO[]> => listEndpoints(sql, merchant.id), {
  permission: "webhooks:write",
  rateLimit: { bucket: "v1_read", limit: 300 },
});

export const POST = apiRoute(
  async (req, { sql, merchant, actor }): Promise<CreatedWebhookEndpointDTO> => createEndpoint(sql, merchant.id, await parseBody(req, zCreate), actor),
  { permission: "webhooks:write", rateLimit: { bucket: "v1_write", limit: 30 }, idempotent: true },
);
