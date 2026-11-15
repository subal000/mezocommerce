import { z } from "zod";
import type { ApiKeyDTO, CreatedApiKeyDTO } from "@/lib/api-types";
import { API_PERMISSIONS, createApiKey, listApiKeys } from "@/lib/server/api-keys";
import { merchantRoute, parseBody } from "@/lib/server/http";

export const GET = merchantRoute(async (_req, { sql, merchant }): Promise<ApiKeyDTO[]> => listApiKeys(sql, merchant.id));

export const POST = merchantRoute(
  async (req, { sql, merchant, actor }): Promise<CreatedApiKeyDTO> => {
    const input = await parseBody(req, z.object({ name: z.string().trim().max(60).optional(), permissions: z.array(z.enum(API_PERMISSIONS)).max(10).optional() }));
    return createApiKey(sql, merchant.id, input, actor);
  },
  { rateLimit: { bucket: "api_key_create", limit: 10 } },
);
