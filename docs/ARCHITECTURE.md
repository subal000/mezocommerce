# MezoCommerce — Architecture (FROZEN)

MezoCommerce lets online merchants accept MUSD on Mezo Testnet. A merchant gets an API key and creates a
**payment intent** per order. Each intent has a hosted checkout URL, works in an embeddable widget and has a QR code.
The customer pays through `MerchantPaymentProcessor`, which moves the exact amount **directly from the customer to
the merchant's payout wallet** and emits `PaymentCompleted(paymentId, …)`. The worker indexes that event, checks every
field against the intent, waits for confirmations and only then marks the order paid and sends `payment.confirmed`.
The platform never holds funds.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Custody | None. `safeTransferFrom(customer → merchant.payout)` inside `pay`; refunds `safeTransferFrom(merchant wallet → original payer)` | No platform wallet, no withdrawal function, nothing to drain |
| Intent authorization | **EIP-712 signed intent** (Option A). Merchant registers on-chain `{owner, payout, signers}`; at onboarding they authorize the **platform signer** (`registerMerchant(payout, platformSigner)`). Backend signs each intent with `INTENT_SIGNER_PRIVATE_KEY` | API-created intents need no merchant wallet popup and no gas. A stolen signer key cannot redirect funds: payout is set only by the merchant owner on-chain and must equal `intent.payout`. Merchants can revoke the platform signer with `setSigner(id, signer, false)` and add their own |
| Option B (on-chain registered intents) | Rejected | Costs the merchant a tx and gas per order; breaks server-to-server checkout creation |
| Binding | Signed: paymentId, merchantId, payout, token, amount, payer (0 = any), expiresAt. Domain binds chainId + contract | No substitution of merchant, amount, token; no cross-chain/contract replay |
| Exact amount | Contract transfers exactly `intent.amount` or reverts | "Underpaid / overpaid" cannot happen through the processor (documented) |
| Uniqueness | `intentState[merchantId][paymentId]` None → Paid/Cancelled (scoped per merchant, so another merchant can't squat a public id), set **before** the transfer (CEI) + `nonReentrant` | No double payment, no replay |
| Approval UX | Default `payWithPermit` (MUSD has EIP-2612): one signature for the exact amount + one tx. Fallback: `approve(exact amount)` then `pay` | Never unlimited approval |
| Cancel | DB cancel hides the signature from checkout immediately; dashboard also offers on-chain `cancelPayment` (merchant owner) for intents whose checkout was already opened | A leaked signature can't be paid after an on-chain cancel; a race payment is recorded as `late` |
| Refunds | Merchant owner or payout wallet calls `refund(merchantId, paymentId, amount)`. Contract pays the recorded payer from msg.sender and caps cumulative refunds at the original amount | Non-custodial; over-refund is impossible on-chain, not only in the DB |
| Admin | Ownable2Step: `setTokenSupported`, `pause` (blocks new payments only). No fund movement, no merchant edits | Small trust surface |
| Fees | 0% platform fee in the MVP (disclosed). Business model in README | Payment accounting stays exact |
| Pricing | Intents are denominated in MUSD. Shopify orders in USD are charged 1 USD = 1 MUSD as a stated policy (MUSD is a USD-pegged stablecoin); other currencies are rejected. No price oracle | Prompt: no hardcoded market rate; fixed MUSD amounts preferred |
| MEZO token | Not supported (not verified as a payment token on testnet). `PAYMENT_TOKENS` + `setTokenSupported` are the extension point | Prompt rule 10 |
| Wallets | **Mezo Passport** (RainbowKit): Bitcoin wallets (Unisat, OKX, Xverse) through a Mezo smart account (connector type `orangekit`), or Ethereum wallets. Smart accounts sign in via ERC-1271/6492 (checked on chain; RPC outage → 503) and pay with approve(exact) → `pay`, since MUSD permits need ECDSA | Bitcoin holders pay without an EVM wallet |
| Stack | Next.js 16 App Router, TS strict, wagmi 2 + viem, TanStack Query, zod 4, Tailwind 4, postgres.js (PGlite fallback), Foundry (solc 0.8.28, cancun, OZ 5.4), `qrcode` | Same as prior Mezo builds (MezoSub) |
| Merchant auth | Dashboard: SIWE-style signed nonce → httpOnly HMAC-signed DB session cookie. API: `Authorization: Bearer mc_test_sk_…`; only sha256(pepper‖key) stored, prefix shown, shown once | |
| Worker | `worker/run.ts` long-running (Render background worker): indexer → reconciliation → expiry sweep → webhook deliveries → Shopify sync, every `WORKER_INTERVAL_MS` (default 5s). Each stage holds a `worker_leases` row so duplicate workers don't double-run | Payment confirmation doesn't depend on a browser tab |
| Hosting | Vercel (web), Render (worker), Neon/Supabase Postgres | |

## Payment lifecycle

See `lib/chain/payment-state.ts` (single source). Summary:

```
created ─view─▶ awaiting_payment ─tx reported (hint)─▶ submitted ─PaymentCompleted verified─▶ confirming ─N confs─▶ paid
   └──────────────┴── expires_at passed ──▶ expired         └── merchant cancel ──▶ cancelled
paid ─RefundCompleted─▶ partially_refunded ─…─▶ refunded
```

**A payment is `paid` only when ALL hold** (`lib/server/verify.ts`, one code path used by the indexer, the
checkout `submitted`/`status` endpoints and reconciliation):
1. Log comes from `contracts.processor` on chain 31611, receipt `status == success`.
2. Event is `PaymentCompleted` and `paymentId` matches a known intent.
3. `merchantId`, `payout`, `token`, `amount` equal the intent's signed values; `payer` equals the intent's payer if locked.
4. `head - log.blockNumber + 1 ≥ CONFIRMATIONS` (default 2), and the block hash still matches (reorg check).
Anything else → payment row `status=reorged` / attempt `failed` / audit log `payment.mismatch`; never paid.

Client-reported tx hashes (`POST /api/public/checkout/:id/submitted`) only tell the server *where to look first*;
the server fetches the receipt itself and runs the same check.

## Indexer

`getLogs(processor, from cursor+1 to head - 0)` in chunks ≤ 2,000 blocks; store each log in `blockchain_events`
(unique tx+log_index), apply idempotently, record `indexed_blocks` hashes. Confirmation counting happens on each
pass for `payments.status = confirming`. Reorg: re-check the last 12 stored block hashes each pass; mismatch → delete
events/payments/refund confirmations from that block, rewind cursor, roll intents back per the state machine.
Reconciliation every `RECONCILE_EVERY` passes: for every intent in confirming/paid within the last 7 days, compare
`intentState(merchantId, paymentId)` + `payment(merchantId, paymentId)` on chain; for every merchant, re-read `merchant(id)` and
`isSigner(id, platformSigner)`. Mismatches → audit log + correction from chain. RPC errors → back off, cursor not advanced.

## Widget protocol

`<script src="https://APP/checkout.js" async></script>` exposes `window.MezoCommerce`:
- `MezoCommerce.checkout({ paymentId | checkoutUrl, mode?: "modal" | "redirect" | "inline", container?, onSuccess?, onCancel?, onExpired?, onError? })`
- `MezoCommerce.button(el, { paymentId | createUrl })` — renders a styled button; with `createUrl` it POSTs to the
  merchant's own server endpoint (which holds the API key) to create an intent, then opens checkout.
- Modal/inline = sandboxed iframe of `/checkout/:id?embed=1`. Messages via `postMessage`, origin-checked on both
  sides: `{source:"mezocommerce", type:"ready"|"resize"|"status"|"success"|"close", paymentIntentId, status, txHash}`.
  `success` is sent only when the checkout's own server status poll says `verified: true`.
- If the iframe has no wallet provider (EVM or Bitcoin extension), checkout shows "Open in new tab" and a QR code.
- `/checkout/*` sends `Content-Security-Policy: frame-ancestors *`; every other route `frame-ancestors 'none'`.

## Shopify (custom app + manual payment method — no gateway approval needed)

Shopify's Payments Apps API (a real checkout payment method) requires an approved Payments Partner, so the MVP does
**not** claim to be a Shopify checkout gateway. Instead:
1. Merchant adds a **manual payment method** named e.g. "Pay with MUSD" and creates a **custom app** (Admin API
   scopes `read_orders`, `write_orders`), then pastes the shop domain, Admin API token and API secret into
   MezoCommerce → Settings → Shopify.
2. Merchant adds an `orders/create` webhook → `POST /api/integrations/shopify/webhook/:merchantSlug`
   (HMAC `X-Shopify-Hmac-Sha256` verified with the API secret, `X-Shopify-Webhook-Id` deduped).
3. For orders whose `payment_gateway_names` include the method name and `financial_status = pending`
   and currency USD → create an intent (`merchant_order_id = shopify:<order id>`, source `shopify`).
4. Customers reach checkout through `GET /pay/shopify/:shop/:orderId` (order-status/thank-you page link via a
   Checkout UI extension in `integrations/shopify/extension` or the order-confirmation email template). If the
   webhook hasn't arrived yet, the route fetches the order from the Admin API and creates the intent on demand.
5. When the intent becomes `paid`, the worker calls Admin GraphQL `orderMarkAsPaid` once (`shopify_orders.sync_status`,
   checks `displayFinancialStatus` first, retries with backoff) → no duplicate updates.

## Repository layout & ownership

| Path | Owner |
|---|---|
| `contracts/**`, `scripts/export-abi.mjs`, `lib/chain/abis.ts` (generated) | Contracts agent. `contracts/src/interfaces/` FROZEN |
| `lib/chain/config.ts`, `lib/chain/payment-state.ts`, `lib/api-types.ts`, `lib/server/db/schema.sql`, `docs/ARCHITECTURE.md` | Lead — FROZEN |
| `lib/server/**` (except schema.sql), `lib/money.ts`, `app/api/**`, `app/pay/shopify/**` (route handler), `worker/**`, `integrations/shopify/**`, `tests/server/**`, `render.yaml`, `next.config.ts` headers, `middleware`/`proxy` | Backend agent |
| `app/**` except `app/api`, `app/checkout`, `app/demo-store`, `app/pay`; `components/**` except `components/checkout`, `components/wallet`, `components/storefront`; `hooks/**`; `lib/client/**` except `lib/client/checkout*.ts` & `lib/client/wallet*.ts`; `public/**` except `public/checkout.js`; `app/globals.css`; `tests/ui/**` except `tests/ui/checkout*` & `tests/ui/widget*` | App frontend agent (landing, onboarding, dashboard, docs pages, site basics) |
| `app/checkout/**`, `app/demo-store/**`, `components/checkout/**`, `components/wallet/**`, `components/storefront/**`, `lib/client/checkout*.ts`, `lib/client/wallet*.ts`, `public/checkout.js`, `examples/**`, `tests/ui/checkout*`, `tests/ui/widget*` | Checkout agent (checkout, wallet, QR, widget, reference storefronts) |
| `README.md`, `docs/*.md` other than ARCHITECTURE | Lead, at the end (agents add notes to `docs/notes-<agent>.md`) |

Pre-made shared files (lead): `lib/client/wagmi.ts`, `lib/client/api.ts`, `components/providers.tsx`, `lib/money.ts`
(pure MUSD parse/format, backend may extend), `app/globals.css` tokens (app agent may retune values, never rename).
`app/layout.tsx` belongs to the app agent and must wrap children in `<Providers>`.

## API routes

All JSON; types in `lib/api-types.ts`; every POST zod-validated, rate-limited, `Idempotency-Key` honoured.

**Public v1 (Bearer API key; merchant isolation by key):**

| Method & path | Purpose |
|---|---|
| `POST /api/v1/payment-intents` | Create (409 `order_has_open_intent` returns the existing intent in details) |
| `GET /api/v1/payment-intents?status=&page=` · `GET /api/v1/payment-intents/:id` (pi_ id or payment_id) | List / read |
| `POST /api/v1/payment-intents/:id/cancel` | DB cancel (+ returns on-chain cancel calldata) |
| `GET /api/v1/payments/:id` | Verified payment (by payment row id, pi_ id or payment_id) |
| `GET /api/v1/merchants/:id/payments` | Must equal the key's merchant (else 403) |
| `POST /api/v1/refunds` · `GET /api/v1/refunds/:id` | Create refund request (returns tx calls) / read |
| `GET/POST /api/v1/webhooks` · `DELETE /api/v1/webhooks/:id` | Manage endpoints |
| `GET /api/v1/health` (no auth) | HealthResponse |

**Dashboard (session cookie):** `/api/auth/{nonce,verify,session,logout}`; `POST /api/merchants`;
`GET/PATCH /api/merchants/me`; `GET /api/merchants/me/registration`; `POST /api/merchants/me/confirm {tx_hash}`
(register/setPayout/setSigner/setMerchantActive → verify receipt + sync from chain); `GET /api/merchant/overview`;
`GET/POST /api/merchant/payment-intents`, `GET /api/merchant/payment-intents/:id` (detail),
`POST /api/merchant/payment-intents/:id/cancel`, `GET /api/merchant/payment-intents/export.csv`;
`GET/POST /api/merchant/api-keys`, `POST /api/merchant/api-keys/:id/revoke`;
`GET/POST /api/merchant/webhooks`, `DELETE /api/merchant/webhooks/:id`, `POST /api/merchant/webhooks/:id/test`,
`GET /api/merchant/webhook-deliveries`, `POST /api/merchant/webhook-deliveries/:id/retry`;
`POST /api/merchant/refunds`, `POST /api/merchant/refunds/:id/submitted {tx_hash}`;
`GET /api/merchant/notifications`, `POST /api/merchant/notifications/read`;
`GET/POST/DELETE /api/merchant/shopify`, `GET /api/merchant/shopify/orders`.

**Checkout (public, rate-limited):** `GET /api/public/config`; `GET /api/public/checkout/:id`;
`GET /api/public/checkout/:id/status`; `GET /api/public/checkout/:id/preflight?payer=`;
`POST /api/public/checkout/:id/submitted`.

**Integrations:** `POST /api/integrations/shopify/webhook/:merchantSlug`; `GET /pay/shopify/:shop/:orderId`;
`POST /api/demo-store/checkout` (reference storefront; server-side uses `DEMO_STORE_API_KEY`);
`POST /api/demo-store/webhook` (reference storefront's own webhook receiver — verifies signature, records events
so the storefront page can show "Order confirmed via webhook"); `GET /api/demo-store/orders/:id`.
`POST /api/indexer/sync` (`Bearer $INDEXER_SECRET`, one worker pass; cron fallback).

## Environment

| Var | Used by |
|---|---|
| `NEXT_PUBLIC_MEZO_RPC_URL`, `NEXT_PUBLIC_MUSD_ADDRESS`, `NEXT_PUBLIC_PROCESSOR_ADDRESS`, `NEXT_PUBLIC_DEPLOY_BLOCK`, `NEXT_PUBLIC_APP_URL` | web, worker |
| `DATABASE_URL` (unset → PGlite at `.data/pglite`) | API, worker |
| `SESSION_SECRET` (≥32), `API_KEY_PEPPER` (≥32), `ENCRYPTION_KEY` (32-byte hex, Shopify tokens) | API (+worker for Shopify) |
| `INTENT_SIGNER_PRIVATE_KEY` | **API only.** Holds no funds, needs no gas. Address is the platform signer |
| `INDEXER_SECRET` | `/api/indexer/sync` |
| `CONFIRMATIONS` (2), `WORKER_INTERVAL_MS` (5000), `RECONCILE_EVERY` (20) | worker |
| `DEMO_STORE_API_KEY`, `DEMO_STORE_WEBHOOK_SECRET` | reference storefront server routes |
| `DEPLOYER_PRIVATE_KEY` | `contracts/.env` only |
