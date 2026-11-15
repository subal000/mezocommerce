import type { PublicConfigDTO } from "@/lib/api-types";
import { route } from "@/lib/server/http";
import { publicConfig } from "@/lib/server/platform";

export const GET = route(async (): Promise<PublicConfigDTO> => publicConfig());
