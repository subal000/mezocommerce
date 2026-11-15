import type { DemoCheckoutResponse } from "@/lib/api-types";
import { getChain } from "@/lib/server/chain";
import { demoCheckout, zDemoCheckout } from "@/lib/server/demo-store-service";
import { parseBody, route } from "@/lib/server/http";

export const POST = route(
  async (req, { sql }): Promise<DemoCheckoutResponse> => demoCheckout(sql, getChain(), await parseBody(req, zDemoCheckout)),
  { rateLimit: { bucket: "demo_checkout", limit: 20 } },
);
