# MezoCommerce examples

Two small programs with no dependencies (Node 18+). They show the integration a real store does.

## Example store: `storefront/`

A static shop page plus a tiny Node server. The page loads `checkout.js` from your MezoCommerce deployment
(a different origin), so it proves cross-origin embedding.

```bash
MEZOCOMMERCE_URL=http://localhost:3000 \
MEZOCOMMERCE_API_KEY=mc_test_sk_... \
node examples/storefront/server.mjs
# open http://localhost:4242
```

- The API key stays on the server. The browser only calls `POST /create-intent` on the store's own server.
- `/create-intent` looks the price up by SKU (the browser never sends an amount), then calls
  `POST {MEZOCOMMERCE_URL}/api/v1/payment-intents` with `Authorization: Bearer <key>` and an `Idempotency-Key`,
  and returns `{ payment_intent_id, checkout_url }`.
- Each product uses `MezoCommerce.button(el, { createUrl: "/create-intent", body: { sku } })`. The widget POSTs,
  then opens the checkout modal. `onSuccess` fires only after the payment is verified on-chain.
- Treat `onSuccess` as a UI hint. Fulfil orders from the `payment.confirmed` webhook (below) or by reading
  `GET /api/v1/payment-intents/:id` on your server.

Env: `MEZOCOMMERCE_URL` (default `http://localhost:3000`), `MEZOCOMMERCE_API_KEY`, `PORT` (default 4242).

## Webhook receiver: `webhook-receiver.mjs`

```bash
MEZOCOMMERCE_WEBHOOK_SECRET=whsec_... node examples/webhook-receiver.mjs
# POST http://localhost:4243/webhook
```

- Verifies `MezoCommerce-Signature: t=<unix>,v1=<hex>` where `v1 = HMAC-SHA256(secret, "${t}.${rawBody}")`, using the
  exact raw body bytes and a constant-time compare. Any matching `v1` passes (for secret rotation).
- Rejects timestamps more than 5 minutes away from now (replay protection).
- Dedupes on `MezoCommerce-Event-Id`: retries reuse the same id. The example keeps ids in memory; use a unique
  index in your database in production.
- Answers `200` quickly, then does the work.

`verifySignature`, `parseSignatureHeader` and `createDeduper` are exported so you can copy them into your own server.
