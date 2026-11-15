# Checkout agent notes

Owner: checkout + e-commerce integration. Scope: `app/checkout/**`, `app/demo-store/**`, `components/{checkout,wallet,storefront}/**`,
`lib/client/checkout*.ts`, `lib/client/wallet*.ts`, `public/checkout.js`, `examples/**`, `tests/ui/{checkout*,widget*}`.

## Stable wallet API (used by the app agent)

`components/wallet/connect-dialog.tsx`

- `ConnectWalletButton({ size?: "sm" | "default" | "lg", className?, label? })`: connect button, then an address
  menu (copy, explorer, switch network when wrong, disconnect).
- `ConnectDialog({ open, onOpenChange })`: opens the Mezo Passport modal (RainbowKit): Bitcoin wallets (Unisat, OKX,
  Xverse) via a Mezo smart account, or Ethereum wallets. Smart accounts always pay with approve(exact) → pay (no permit).
- `useMezoNetwork()` → `{ isConnected, address, chainId, connector, isWrongNetwork, isReady, isSwitching, network, switchToMezo() }`.
  `switchToMezo()` calls `wallet_addEthereumChain` (params from `lib/chain/config.ts`) when the wallet doesn't know chain 31611.
- `useIsClient()` (hydration-safe mount flag) is exported too.

## Hosted checkout `/checkout/[id]`

- Server component fetches nothing. Client polls `GET /api/public/checkout/:id` (20s), `/status` (5s; 2.5s while
  submitted/confirming; stops once `verified`), and `/preflight?payer=` (when connected on Mezo, 20s).
- Every screen is one `CheckoutView` from the pure `deriveCheckoutView` (`lib/client/checkout-state.ts`). The paid
  views (`paid`, `already_paid`, `late_paid`) are produced **only** when `CheckoutStatusDTO.verified === true`
  (exhaustively tested across every status × flow × preflight × late combination).
- Pay flow (`lib/client/checkout-pay.ts`): permit for exactly `intent.amount` (domain `MUSD_PERMIT_DOMAIN` + 31611 +
  MUSD address, nonce from `nonces(owner)`, deadline `min(intent.expiresAt, now + 20m)`) → simulate `payWithPermit` →
  write. Toggle "Use two-step approval instead", and automatic fallback when `eth_signTypedData_v4` is unsupported:
  `approve(exact amount)` (skipped when allowance ≥ amount) → wait for receipt → simulate `pay` → write.
  After the hash: `POST /submitted {tx_hash, payer_address}` (hint only), then poll `/status`. The receipt is watched
  only to surface a revert quickly; success is never inferred from it.
- Errors: custom errors decoded with the processor ABI + OZ errors → plain sentences (`lib/client/checkout-errors.ts`).
  The test asserts every interface error and every error in the generated ABI has a message.
- QR: always `${origin}/checkout/${id}` (no `embed`), rendered as an SVG data URL in an `<img>`.

## Embed `?embed=1` and the widget

- Protocol per ARCHITECTURE: `{ source: "mezocommerce", type: ready|resize|status|success|close, paymentIntentId, status, txHash }`
  (+ `height` on `resize`). Posted to `window.parent` with `"*"` (ids/statuses only). `success` only after a verified
  status poll. Inbound: nothing is acted on; the widget's close ack (`{source:"mezocommerce-widget",type:"close"}`) is
  recognised and ignored.
- "Cancel payment" / "Done" in the embed post `close`; the widget fires `onCancel` unless `success` was seen.
- No injected wallet inside the iframe → "Open in new tab" + the checkout QR.
- `public/checkout.js`: ES2017 IIFE, `window.MezoCommerce = { version, baseUrl, checkout, button, isValidId }`.
  Base = origin of its own `<script src>`. 11 KB unminified (hand-written, commented), 7.7 KB minified, 3.9 KB gzip.
  Modal is a Shadow DOM dialog (aria-modal, focus trap with sentinels, Esc, backdrop click, scroll lock, focus
  restore). Messages accepted only when `event.origin === baseUrl && event.source === iframe.contentWindow`.
  `checkoutUrl` must be on the widget's origin. Callbacks: `onSuccess`, `onCancel`, `onExpired`, `onError`, `onStatus`.
  `button(el, { paymentId | createUrl, label?, body? })`: `body` is JSON-posted to `createUrl` (same-origin credentials).

## Site chrome

The root layout currently has no header/footer, so checkout renders bare. `app/checkout/layout.tsx` and
`app/demo-store/layout.tsx` hide anything marked `data-site-chrome` (via `body:has([data-mc-surface])`), so **if the
app agent adds a global header/footer, mark it `data-site-chrome`**. Both use `<main id="main">` for the skip link.

## Demo store `/demo-store`

- Fictional "Larkspur Tea Co.", 4 products. `lib/server/demo-store.ts` did not exist while I built this, so the
  display catalog lives in `components/storefront/catalog.ts` (`DEMO_STORE_PRODUCTS`, no client-only imports).
  **Backend: use these SKUs/prices (import the constant) so the cart total matches the intent amount.** The checkout
  always shows the signed amount, so a mismatch would be cosmetic, not a payment bug.
- "Pay with MUSD" → `POST /api/demo-store/checkout` (`DemoCheckoutRequest`) → loads `/checkout.js` via `next/script`
  → `MezoCommerce.checkout({ paymentId, mode: "modal" })`. 503 → "isn't connected to a merchant account" message.
- `/demo-store/order/[id]` polls `GET /api/demo-store/orders/:id` every 3s until verified + webhook. That response
  type is not in `lib/api-types.ts`; the page reads (all optional, defensively):
  `{ order_id, payment_intent_id, amount_display, items: [{ sku, name, qty, amount_display }], status, verified,
  transaction_hash, explorer_url, webhook_received, webhook_event_type, webhook_received_at }`.
  "Payment verified on-chain" uses `verified` when present (else a settled `status`); "Webhook received" uses
  `webhook_received`. 503 and 404 have their own messages.

## Tests (`npx vitest run tests/ui/checkout- tests/ui/widget`)

119 tests, 8 files: state reducer/derivation, PayCheck messages, permit builder (sign + recover with viem),
error decoding, formatting/embed/network helpers, panel render for all 22 views (jsdom, react-dom), widget (jsdom),
webhook example. `npx tsc --noEmit` clean; eslint clean on owned files; `next build` passed at time of writing.

## Open items

- `@testing-library/dom` (peer of the installed `@testing-library/react`) is missing, so render tests use
  `react-dom/client` + `act` directly. Install it if other agents want `screen` queries.
- `/docs/widget` says "Both sides check the origin". The checkout side can't know the embedding origin; it posts
  only ids/statuses with `"*"` and accepts no commands. Suggest wording: "The widget checks the iframe's origin and
  window; the checkout sends only ids and statuses and accepts no commands."
- CSP `frame-ancestors *` for `/checkout/*` is the backend's (next.config headers); the embed depends on it.
