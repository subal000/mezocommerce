import { apiRoute } from "@/lib/server/http";
import { cancelIntent } from "@/lib/server/intents";

/** DB cancel; response also carries `cancel_tx` ({to, data}) for an on-chain cancelPayment from the merchant wallet. */
export const POST = apiRoute<{ id: string }>(
  async (_req, { sql, merchant, params, actor }) => cancelIntent(sql, merchant.id, params.id, actor),
  { permission: "payment_intents:write", rateLimit: { bucket: "v1_write", limit: 120 }, idempotent: true },
);
