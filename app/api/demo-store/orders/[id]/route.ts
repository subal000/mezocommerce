import { demoOrder } from "@/lib/server/demo-store-service";
import type { DemoOrderDTO } from "@/lib/server/demo-store";
import { route } from "@/lib/server/http";

export const GET = route<{ id: string }>(async (_req, { sql, params }): Promise<DemoOrderDTO> => demoOrder(sql, params.id), {
  rateLimit: { bucket: "demo_order", limit: 240 },
});
