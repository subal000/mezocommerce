# MezoCommerce

**Accept payments in MUSD. Sell beyond traditional payment rails.**

MezoCommerce is merchant checkout infrastructure for Mezo. Merchants create a payment intent per order through an API or
the dashboard. Customers pay in MUSD on a hosted checkout page, in an embeddable widget or by scanning a QR code.
`MerchantPaymentProcessor` moves the exact amount **straight from the customer to the merchant's payout wallet**.
The order counts as paid only after the backend has checked the on-chain `PaymentCompleted` event against the order
and waited for confirmations.

> Testnet MVP on Mezo Testnet (chain 31611). Contracts are tested and AI-reviewed (`docs/audits/`) but **not
> audited by a firm**. 0% platform fee.

## The problem and the solution

Taking crypto at checkout today usually means telling customers to send tokens to an address. The merchant then
matches transfers to orders by hand, wrong amounts slip through, and orders get marked paid on a screenshot.
MezoCommerce fixes this:

- **Every payment is tied to one order.** Each order has a signed intent with a unique 32-byte `paymentId`, and the
  contract emits that id with the payment.
- **The amount can't be wrong.** The signature locks merchant, payout wallet, token, exact amount, optional payer and
  expiry. Any change fails on-chain, so underpaying or overpaying is impossible.
- **Payments can't be duplicated.** Each `paymentId` can be paid once per merchant, and no other merchant can block it.
- **No custody.** The contract never holds funds. Refunds go from the merchant wallet to the original payer, and the
  contract caps them at the original amount.
- **Orders are confirmed automatically.** The worker indexes events, handles reorgs and confirmations, sends signed
  webhooks and marks Shopify orders paid.

## How MUSD and Mezo are used

- MUSD is the only payment currency in this release: `0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503`, 18 decimals,
  EIP-2612 permit. All of this was verified on the live chain on 2026-11-10.
- Customers sign one exact-amount permit and send one transaction (`payWithPermit`). Wallets that can't sign a permit
  get approve-exact → `pay` instead. Unlimited approvals are never requested.
- Wallets connect through **Mezo Passport**. Customers and merchants can use a Bitcoin wallet (Unisat, OKX, Xverse), which
  acts through a Mezo smart account, or an Ethereum wallet. Bitcoin-wallet payers use approve-exact → `pay`, because
  MUSD's permit needs an ECDSA signature. `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` (optional) adds WalletConnect.
- Gas is paid in BTC, Mezo's native coin. Checkout tells customers when they need testnet BTC from the faucet.
- MEZO token payments are deliberately **not** supported because the token isn't verified as a payment token on
  testnet. Adding a token later means calling `setTokenSupported` and adding an entry to `PAYMENT_TOKENS`.

## What's in the box

| Area | Where |
|---|---|
| Payment contract + 104 Foundry tests (unit, adversarial, fuzz, invariants) | `contracts/` · notes `docs/notes-contracts.md` |
| Payment API v1 (API keys, idempotency, rate limits) | `app/api/v1/**` · reference at `/docs` |
| Merchant onboarding + dashboard (payments, refunds, API keys, webhooks, Shopify, settings) | `/merchant` |
| Hosted checkout (wallet, network switch, preflight, permit/approve, QR, verified success) | `/checkout/[id]` |
| Embeddable widget (modal / inline / redirect, Shadow DOM, origin-checked postMessage) | `public/checkout.js` |
| Reference storefront using the real widget + its own webhook receiver | `/demo-store` |
| Cross-origin storefront + webhook receiver examples | `examples/` |
| Indexer, reconciliation, expiry, webhooks, Shopify sync | `worker/run.ts`, `lib/server/` |
| Shopify custom-app integration (+ thank-you page extension source) | `integrations/shopify/` |
| Architecture, lifecycle, API routes, env | `docs/ARCHITECTURE.md` |

Payment lifecycle (single source: `lib/chain/payment-state.ts`):
`created → awaiting_payment → submitted → confirming → paid → partially_refunded → refunded`, with
`expired` / `cancelled` as unpaid endings.

## Run locally

```bash
npm install
cp .env.example .env.local     # without DATABASE_URL an embedded PGlite DB is used
npm run dev                    # web on :3000
npm run worker                 # indexer + webhooks + expiry + Shopify sync
npm test                       # 227 TS tests (server + UI)
npm run contracts:test         # 104 Foundry tests
```

## Deploy (testnet)

1. **Contract** (needs a funded deployer; the `deployer` keystore has BTC):
   ```bash
   cd contracts
   forge script script/Deploy.s.sol --rpc-url mezo_testnet --broadcast --legacy --slow \
     --account deployer --sender 0x017FF5FB886E90f9e5ADb405D8eFddffC1162dD2
   node script/record-deployment.mjs 31611
   ```
   Put `processor` and `deployBlock` from `contracts/deployments/31611.json` into `NEXT_PUBLIC_PROCESSOR_ADDRESS` and
   `NEXT_PUBLIC_DEPLOY_BLOCK`.
2. **Postgres** (Neon or Supabase): set `DATABASE_URL`, then run `npm run db:migrate`.
3. **Web** (Vercel): set every variable in `.env.example`. `INTENT_SIGNER_PRIVATE_KEY` is a fresh key that holds no
   funds and needs no gas. `SESSION_SECRET` and `API_KEY_PEPPER` must be 32+ characters, `ENCRYPTION_KEY` is 64 hex
   characters, and `NEXT_PUBLIC_APP_URL` is the production URL.
4. **Worker.** It indexes payments, confirms them, expires old checkouts, sends webhooks and syncs Shopify.
   - **Today (free): Supabase cron.** Render background workers are paid, so the live testnet app runs the worker
     from the database instead. A `pg_cron` job calls `POST /api/indexer/sync` (one worker pass, Bearer
     `INDEXER_SECRET`) every minute through `pg_net`. The secret is kept in Supabase Vault:
     ```sql
     select vault.create_secret('<INDEXER_SECRET>', 'mezocommerce_indexer_secret');
     select cron.schedule('mezocommerce-worker', '* * * * *', $$
       select net.http_post(
         url := 'https://<app>/api/indexer/sync',
         headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization',
           'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'mezocommerce_indexer_secret')),
         body := '{}'::jsonb, timeout_milliseconds := 60000)
     $$);
     ```
     Trade-off: payments confirm within about a minute instead of about 5 seconds.
   - **Later: Render.** `render.yaml` and `worker/run.ts` stay in the repo. When a paid worker is worth it, create
     the Render service from `render.yaml` with the same chain and DB variables, plus `PLATFORM_SIGNER_ADDRESS` (the
     signer's address, never its key), then stop the cron job with `select cron.unschedule('mezocommerce-worker');`.
     Running both at once is safe (each stage holds a lease) but wasteful.
5. **Demo store:** onboard a merchant in the dashboard, create an API key and a webhook endpoint pointing to
   `<app>/api/demo-store/webhook`, then set `DEMO_STORE_API_KEY` and `DEMO_STORE_WEBHOOK_SECRET`.
6. **Two-wallet end-to-end run:** set `E2E_MERCHANT_KEY` and `E2E_CUSTOMER_KEY`, where the customer wallet holds
   MUSD and BTC. Then run `npm run e2e:testnet`. It registers a merchant, creates a 10 MUSD intent, approves the exact
   amount, pays, waits for verified `paid` and the webhook, refunds, and prints explorer links.

## Target users and business model

- **Target users:** independent stores, digital product and SaaS sellers, creators, and crypto-native merchants whose
  customers already hold MUSD.
- **Today:** free, with a 0% fee.
- **Later, possible paid tiers:**
  - a disclosed per-transaction fee, taken by a separate fee transfer in the contract;
  - premium plans with analytics, multi-store support and team seats;
  - a white-label checkout;
  - maintained e-commerce plugins.

## Security assumptions and known limits

- **Platform signer:** the platform signer key can create valid intents but **cannot redirect funds**. Payout is set
  on-chain by the merchant owner and must match. Merchants can revoke it with `setSigner`.
- **Unmatched transfers:** MUSD sent directly to a merchant without going through the processor is not matched to any
  order.
- **Deep reorgs:** a reorg deeper than `CONFIRMATIONS` can't retract a webhook that was already sent or reverse a
  Shopify order already marked paid. Both cases are audit-logged.
- **Shopify:** this is **not** a Shopify Payments gateway, which requires Shopify Partner approval. It uses a custom
  app with a manual payment method and `orderMarkAsPaid`. USD orders are charged 1 USD = 1 MUSD, a stated policy
  for a USD stablecoin rather than a market rate. Other currencies are rejected. The checkout UI extension is source
  only and has not been built or tested.
- **Gas check:** preflight `gas_ok` only checks that the customer has some BTC.
- **Contract owner:** the owner can pause new payments and manage the token allowlist. The owner can't move funds or
  change merchants. Renouncing ownership while paused would freeze payments; refunds and cancels still work.
