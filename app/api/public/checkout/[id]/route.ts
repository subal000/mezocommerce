import type { CheckoutDTO } from "@/lib/api-types";
import { getCheckout } from "@/lib/server/checkout";
import { route } from "@/lib/server/http";

export const GET = route<{ id: string }>(async (_req, { sql, params }): Promise<CheckoutDTO> => getCheckout(sql, params.id), {
  rateLimit: { bucket: "checkout_read", limit: 120 },
});
