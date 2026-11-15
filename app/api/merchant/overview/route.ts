import type { MerchantOverviewDTO } from "@/lib/api-types";
import { overview } from "@/lib/server/dashboard";
import { merchantRoute } from "@/lib/server/http";

export const GET = merchantRoute(async (_req, { sql, merchant }): Promise<MerchantOverviewDTO> => overview(sql, merchant));
