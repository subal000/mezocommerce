import type { Paginated, PaymentIntentDTO } from "@/lib/api-types";
import { getChain } from "@/lib/server/chain";
import { merchantRoute, parseBody, parseQuery } from "@/lib/server/http";
import { createPaymentIntent, listIntents, zCreateIntent, zListQuery } from "@/lib/server/intents";

export const GET = merchantRoute(
  async (req, { sql, merchant }): Promise<Paginated<PaymentIntentDTO>> => listIntents(sql, merchant.id, parseQuery(req, zListQuery)),
);

export const POST = merchantRoute(
  async (req, { sql, merchant, actor }): Promise<PaymentIntentDTO> => {
    const input = await parseBody(req, zCreateIntent);
    return createPaymentIntent(sql, getChain(), { merchant, input, source: "dashboard", actor });
  },
  { rateLimit: { bucket: "intent_create", limit: 60 }, idempotent: true },
);
