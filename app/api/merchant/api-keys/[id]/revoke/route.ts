import type { ApiKeyDTO } from "@/lib/api-types";
import { revokeApiKey } from "@/lib/server/api-keys";
import { merchantRoute } from "@/lib/server/http";

export const POST = merchantRoute<{ id: string }>(
  async (_req, { sql, merchant, params, actor }): Promise<ApiKeyDTO> => revokeApiKey(sql, merchant.id, params.id, actor),
);
