import { getChain } from "@/lib/server/chain";
import { getDb } from "@/lib/server/db";
import { resolvePayLink } from "@/lib/server/shopify";

export const dynamic = "force-dynamic";

function page(status: number, message: string): Response {
  const esc = message.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Payment link</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 16px;color:#1c1917;background:#fafaf9}
h1{font-size:1.25rem}@media (prefers-color-scheme:dark){body{color:#e7e5e4;background:#0c0a09}}</style></head>
<body><h1>We couldn't open this payment</h1><p>${esc}</p><p>If you already paid, you don't need to do anything else.</p></body></html>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

/** Shopify order-status / thank-you link → hosted checkout (creates the intent on demand). */
export async function GET(_req: Request, ctx: { params: Promise<{ shop: string; orderId: string }> }): Promise<Response> {
  try {
    const { shop, orderId } = await ctx.params;
    const sql = await getDb();
    const r = await resolvePayLink(sql, getChain(), decodeURIComponent(shop), decodeURIComponent(orderId));
    if ("url" in r) return Response.redirect(r.url, 303);
    return page(r.status, r.error);
  } catch (e) {
    console.error("[pay/shopify]", e);
    return page(503, "The payment service is temporarily unavailable. Please try again in a minute.");
  }
}
