import type { Paginated, PaymentIntentDTO } from "@/lib/api-types";
import { getChain } from "@/lib/server/chain";
import { apiRoute, parseBody, parseQuery } from "@/lib/server/http";
import { createPaymentIntent, listIntents, zCreateIntent, zListQuery } from "@/lib/server/intents";

export const GET = apiRoute(
  async (req, { sql, merchant }): Promise<Paginated<PaymentIntentDTO>> => listIntents(sql, merchant.id, parseQuery(req, zListQuery)),
  { permission: "payment_intents:read", rateLimit: { bucket: "v1_read", limit: 300 } },
);

export const POST = apiRoute(
  async (req, { sql, merchant, actor }): Promise<PaymentIntentDTO> => {
    const input = await parseBody(req, zCreateIntent);
    return createPaymentIntent(sql, getChain(), { merchant, input, source: "api", actor });
  },
  { permission: "payment_intents:write", rateLimit: { bucket: "v1_intent_create", limit: 120 }, idempotent: true },
);
