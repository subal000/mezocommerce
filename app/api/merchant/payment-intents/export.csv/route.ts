import { exportCsv } from "@/lib/server/dashboard";
import { merchantRoute, parseQuery } from "@/lib/server/http";
import { zListQuery } from "@/lib/server/intents";

export const GET = merchantRoute(
  async (req, { sql, merchant }) =>
    new Response(await exportCsv(sql, merchant.id, parseQuery(req, zListQuery)), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="payments-${merchant.slug}.csv"`,
        "cache-control": "no-store",
      },
    }),
  { rateLimit: { bucket: "export", limit: 10 } },
);
