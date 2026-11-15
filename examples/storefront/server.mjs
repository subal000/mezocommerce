// Standalone example store that embeds MezoCommerce checkout from another origin. No dependencies (Node 18+).
//
//   MEZOCOMMERCE_URL=http://localhost:3000 MEZOCOMMERCE_API_KEY=mc_test_sk_... node examples/storefront/server.mjs
//   open http://localhost:4242
//
// The API key stays on this server. The browser only ever calls POST /create-intent here; this server calls
// POST {MEZOCOMMERCE_URL}/api/v1/payment-intents and returns { payment_intent_id, checkout_url } to the widget.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4242);
const BASE = (process.env.MEZOCOMMERCE_URL || "http://localhost:3000").replace(/\/$/, "");
const API_KEY = process.env.MEZOCOMMERCE_API_KEY || "";
const SELF = `http://localhost:${PORT}`;

if (!/^https?:\/\/[^\s"'<>]+$/.test(BASE)) {
  console.error("MEZOCOMMERCE_URL must be an http(s) URL");
  process.exit(1);
}
if (!API_KEY.startsWith("mc_test_sk_")) console.warn("MEZOCOMMERCE_API_KEY is not set: /create-intent will fail until it is.");

/** Prices live on the server. The browser sends a SKU; it never sends an amount. */
const PRODUCTS = [
  { sku: "print-tide", name: "Tide chart print", detail: "A3, risograph, two colours", price: "18" },
  { sku: "print-orbit", name: "Orbit poster", detail: "A2, matte stock", price: "32.5" },
  { sku: "cards-mixed", name: "Postcard set", detail: "Eight cards, mixed designs", price: "9" },
];

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify(body));
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 10_000) throw new Error("too large");
    chunks.push(c);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

async function createIntent(req, res) {
  // Same-origin only: the widget's button() posts with credentials "same-origin" from this page.
  const origin = req.headers.origin;
  let sameOrigin = true;
  try {
    sameOrigin = !origin || new URL(origin).host === req.headers.host;
  } catch {
    sameOrigin = false;
  }
  if (!sameOrigin) return json(res, 403, { error: "cross-origin request refused" });
  let body;
  try {
    body = await readJson(req);
  } catch {
    return json(res, 400, { error: "invalid JSON" });
  }
  const product = PRODUCTS.find((p) => p.sku === body.sku);
  if (!product) return json(res, 400, { error: "unknown product" });

  const orderId = `pebble-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
  const r = await fetch(`${BASE}/api/v1/payment-intents`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": orderId,
    },
    body: JSON.stringify({
      merchant_order_id: orderId,
      amount: product.price,
      description: `${product.name} (${product.detail})`,
      return_url: `${SELF}/?paid=${encodeURIComponent(orderId)}`,
      cancel_url: `${SELF}/`,
      metadata: { sku: product.sku },
    }),
  }).catch((e) => ({ ok: false, status: 502, json: async () => ({ error: { message: String(e) } }) }));
  const data = await r.json().catch(() => null);
  if (!r.ok) return json(res, r.status === 401 ? 500 : 502, { error: data?.error?.message || `MezoCommerce answered ${r.status}` });
  return json(res, 200, { payment_intent_id: data.id, checkout_url: data.checkout_url });
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, SELF);
    if (req.method === "GET" && url.pathname === "/") {
      const html = (await readFile(join(here, "index.html"), "utf8")).replaceAll("__MEZOCOMMERCE_URL__", BASE);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(html);
    } else if (req.method === "GET" && url.pathname === "/products") {
      json(res, 200, PRODUCTS);
    } else if (req.method === "POST" && url.pathname === "/create-intent") {
      await createIntent(req, res);
    } else {
      res.writeHead(404).end("Not found");
    }
  } catch (err) {
    console.error(err);
    if (!res.headersSent) json(res, 500, { error: "server error" });
  }
}).listen(PORT, () => console.log(`Example store on ${SELF} (checkout from ${BASE})`));
