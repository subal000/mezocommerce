import type { CheckoutStatusDTO } from "@/lib/api-types";
import { getChain } from "@/lib/server/chain";
import { getCheckoutStatus } from "@/lib/server/checkout";
import { route } from "@/lib/server/http";

export const GET = route<{ id: string }>(async (_req, { sql, params }): Promise<CheckoutStatusDTO> => getCheckoutStatus(sql, getChain(), params.id), {
  rateLimit: { bucket: "checkout_status", limit: 240 },
});
