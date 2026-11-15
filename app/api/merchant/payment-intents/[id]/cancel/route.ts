import { merchantRoute } from "@/lib/server/http";
import { cancelIntent } from "@/lib/server/intents";

/** DB cancel + `cancel_tx` calldata for the optional on-chain cancelPayment (merchant owner wallet). */
export const POST = merchantRoute<{ id: string }>(
  async (_req, { sql, merchant, params, actor }) => cancelIntent(sql, merchant.id, params.id, actor),
  { rateLimit: { bucket: "intent_cancel", limit: 60 } },
);
