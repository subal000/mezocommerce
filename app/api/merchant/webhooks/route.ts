import { z } from "zod";
import type { CreatedWebhookEndpointDTO, WebhookEndpointDTO } from "@/lib/api-types";
import { WEBHOOK_EVENT_TYPES } from "@/lib/chain/payment-state";
import { merchantRoute, parseBody } from "@/lib/server/http";
import { createEndpoint, listEndpoints } from "@/lib/server/webhooks";

const zCreate = z.object({ url: z.string().trim().max(2048), event_types: z.array(z.enum([...WEBHOOK_EVENT_TYPES, "*"])).max(20).optional() });

export const GET = merchantRoute(async (_req, { sql, merchant }): Promise<WebhookEndpointDTO[]> => listEndpoints(sql, merchant.id));

export const POST = merchantRoute(
  async (req, { sql, merchant, actor }): Promise<CreatedWebhookEndpointDTO> => createEndpoint(sql, merchant.id, await parseBody(req, zCreate), actor),
  { rateLimit: { bucket: "webhook_create", limit: 20 } },
);
