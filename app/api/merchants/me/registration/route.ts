import type { RegistrationParamsDTO } from "@/lib/api-types";
import { getChain } from "@/lib/server/chain";
import { merchantRoute } from "@/lib/server/http";
import { registrationParams } from "@/lib/server/merchants";

export const GET = merchantRoute(
  async (_req, { sql, merchant }): Promise<RegistrationParamsDTO> => registrationParams(sql, getChain(), merchant),
  { rateLimit: { bucket: "merchant_registration", limit: 60 } },
);
