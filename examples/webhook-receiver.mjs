// MezoCommerce webhook receiver example. No dependencies (Node 18+).
//
//   MEZOCOMMERCE_WEBHOOK_SECRET=whsec_... node examples/webhook-receiver.mjs
//
// Listens on PORT (default 4243) at POST /webhook. Verifies MezoCommerce-Signature
// (t=<unix>,v1=<hex HMAC-SHA256 of `${t}.${rawBody}`>), rejects timestamps older than 5 minutes,
// and ignores repeats of the same MezoCommerce-Event-Id (retries reuse the id).
import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";

export const TOLERANCE_SECONDS = 300;

/** Parse "t=123,v1=abc,v1=def" → { t: 123, v1: ["abc","def"] } or null. */
export function parseSignatureHeader(header) {
  if (typeof header !== "string" || !header) return null;
  let t = null;
  const v1 = [];
  for (const part of header.split(",")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === "t" && /^\d+$/.test(v)) t = Number(v);
    else if (k === "v1" && /^[0-9a-f]{64}$/i.test(v)) v1.push(v.toLowerCase());
  }
  return t !== null && v1.length ? { t, v1 } : null;
}

/**
 * Verify a webhook. `rawBody` must be the exact bytes received (Buffer or string), not re-serialised JSON.
 * Returns { ok: true } or { ok: false, reason }.
 */
export function verifySignature({ rawBody, header, secret, nowSeconds = Math.floor(Date.now() / 1000), tolerance = TOLERANCE_SECONDS }) {
  if (!secret) return { ok: false, reason: "no_secret" };
  const sig = parseSignatureHeader(header);
  if (!sig) return { ok: false, reason: "bad_header" };
  if (Math.abs(nowSeconds - sig.t) > tolerance) return { ok: false, reason: "too_old" };
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), "utf8");
  const expected = createHmac("sha256", secret).update(`${sig.t}.`).update(body).digest();
  const match = sig.v1.some((h) => {
    const got = Buffer.from(h, "hex");
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
  return match ? { ok: true } : { ok: false, reason: "mismatch" };
}

/** In-memory event-id dedupe. Use your database (unique index on event id) in production. */
export function createDeduper(max = 10_000) {
  const seen = new Set();
  return {
    /** true the first time an id is seen */
    first(id) {
      if (!id || seen.has(id)) return false;
      seen.add(id);
      if (seen.size > max) seen.delete(seen.values().next().value);
      return true;
    },
  };
}

export function createHandler({ secret, onEvent = (e) => console.log(`[webhook] ${e.type} ${e.data?.payment_intent?.id ?? ""}`) }) {
  const dedupe = createDeduper();
  return (req, res) => {
    if (req.method !== "POST" || req.url !== "/webhook") {
      res.writeHead(404).end();
      return;
    }
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 1_000_000) req.destroy();
      else chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks);
      const v = verifySignature({ rawBody: raw, header: req.headers["mezocommerce-signature"], secret });
      if (!v.ok) {
        res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: v.reason }));
        return;
      }
      const eventId = req.headers["mezocommerce-event-id"];
      if (!dedupe.first(typeof eventId === "string" ? eventId : "")) {
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ received: true, duplicate: true }));
        return;
      }
      let event;
      try {
        event = JSON.parse(raw.toString("utf8"));
      } catch {
        res.writeHead(400).end();
        return;
      }
      // Answer fast; do slow work (fulfilment, email) after responding or in a queue.
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ received: true }));
      try {
        onEvent(event);
      } catch (err) {
        console.error(err);
      }
    });
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const secret = process.env.MEZOCOMMERCE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("Set MEZOCOMMERCE_WEBHOOK_SECRET (shown once when you add the endpoint in the dashboard).");
    process.exit(1);
  }
  const port = Number(process.env.PORT || 4243);
  createServer(
    createHandler({
      secret,
      onEvent: (e) => {
        const pi = e.data?.payment_intent;
        if (e.type === "payment.confirmed") console.log(`Order ${pi?.merchant_order_id} paid: ${pi?.amount_display} MUSD (tx ${pi?.payment?.transaction_hash})`);
        else console.log(`[webhook] ${e.type} ${pi?.merchant_order_id ?? ""}`);
      },
    }),
  ).listen(port, () => console.log(`Webhook receiver on http://localhost:${port}/webhook`));
}
