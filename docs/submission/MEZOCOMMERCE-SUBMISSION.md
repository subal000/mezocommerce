# MezoCommerce — AKINDO / Mezo Buildathon submission answers

Same questions, same order as the MezoGuard questionnaire: team form, product form, wave form.
Every fact comes from the live site (mezocommerce.vercel.app), the deployed contract, or the build records.

Before you submit:
1. Make `github.com/prajalsharma/mezocommerce` **public**. It is private now, so judges would see a 404.
2. Upload `~/mezocommerce/demo/out/mezocommerce-demo.mp4` to YouTube as **Public** and paste the link in Video.
3. Fill in the grant recipient and social links yourself.

---

## PART 1 — Create team

**Icon**
Upload `~/mezocommerce/docs/brand/mezocommerce-mark-1024.png` (1024×1024, mark only).

**Team name**
```
MezoCommerce
```

**About this team** (Markdown)
```markdown
**MezoCommerce** is checkout for online stores on Mezo: customers pay in MUSD, and the money goes straight from their wallet to the merchant's wallet.

Taking crypto at checkout usually means "send tokens to this address", then matching transfers to orders by hand. MezoCommerce ties every payment to one order instead:

- **Signed payment intents:** each checkout is an EIP-712 intent for one order. Amount, token, payout wallet, payer and expiry are signed, so a wrong amount fails on-chain.
- **Non-custodial:** one contract moves the exact amount from customer to merchant. It never holds funds.
- **Verified before "paid":** the server reads the payment event on Mezo itself and waits for confirmations. A transaction hash from the browser is never trusted on its own.
- **Ways to sell:** hosted checkout page, QR code, embeddable widget, payment API with signed webhooks, and a Shopify custom-app path.
- **Mezo Passport:** Bitcoin wallets (Unisat, OKX, Xverse) and Ethereum wallets.

Live on Mezo testnet:
- App: https://mezocommerce.vercel.app
- Payment contract (verified): https://explorer.test.mezo.org/address/0x94D35689d95b4C7ec9c8bD296ff606027e154df8
- A real payment made in the browser: https://explorer.test.mezo.org/tx/0x33c0b8ca4b0d8e4ef28b7d76bbcbc542c6325baff25834ac0b3b96efb606f895
```

**Buildathon Grant Recipient:** fill in yourself (the person receiving the grant).

**GitHub or Website**
```
https://github.com/prajalsharma/mezocommerce
```
(Make it public first, or use `https://mezocommerce.vercel.app`.)

**X / Telegram / Discord:** your own links, or leave empty.

**Recruiting Members:** leave it unchecked.

---

## PART 2 — Register product

**Product icon**
Upload `~/mezocommerce/docs/brand/mezocommerce-mark-1024.png`.

**Product name**
```
MezoCommerce
```

**Tagline** (50 characters or fewer)
```
Accept MUSD at checkout, verified on Mezo
```
(41 characters.) Alternatives:
- `MUSD checkout for stores. Paid straight to you.` (47)
- `Non-custodial MUSD payments for online stores` (45)

**Describe your product in 100 words or less**
```
MezoCommerce lets online stores accept MUSD on Mezo. Merchants register once with a wallet, then create payments from the dashboard or API. Each payment is a signed intent for one order: the amount, token and payout wallet can't be changed, and each payment ID can be paid once. Customers pay on a hosted checkout, by QR code or in an embeddable widget, with one signature and one transaction. The money goes straight to the merchant's wallet; the contract never holds it. Orders turn paid only after the server verifies the payment on-chain. Webhooks, refunds and a Shopify path included.
```
(99 words.)

**Product type**
**Functional.** It is live on Vercel, with a source-verified payment contract on Mezo testnet and real payments made through the browser.

**Image gallery** (5 images, 2560×1440, upload in this order)
1. `~/mezocommerce/docs/screenshots/1-landing.png`: the landing page and a sample checkout
2. `~/mezocommerce/docs/screenshots/2-checkout.png`: a live checkout, ready to pay 18 MUSD
3. `~/mezocommerce/docs/screenshots/3-paid-receipt.png`: the receipt after a payment confirmed on Mezo
4. `~/mezocommerce/docs/screenshots/4-merchant-dashboard.png`: the merchant dashboard with paid orders
5. `~/mezocommerce/docs/screenshots/5-payment-link.png`: a new payment link with its QR code

**About** (Markdown)
```markdown
## What it does
MezoCommerce is checkout infrastructure for merchants on Mezo. Customers pay in MUSD, the Bitcoin-backed dollar, and the money goes straight from their wallet to the merchant's payout wallet.

**Merchants** sign in with their wallet, name the store and register it on Mezo in one transaction. After that, they create payments from the dashboard or the API and never need their wallet again for a checkout: MezoCommerce signs each payment intent with a platform key that can't change where money goes.

**Customers** open a hosted checkout, scan a QR code, or pay inside an embeddable widget on the store's own site. They sign one exact-amount spending permission (EIP-2612 permit) and confirm one transaction. Bitcoin wallets that act through a Mezo smart account use an exact approval instead.

**Every order is verified on-chain.** The server reads the PaymentCompleted event from Mezo itself, checks every field against the order, and waits for confirmations before the order turns paid. Then it sends a signed webhook. Merchants can refund to the original payer; the contract caps refunds at what was paid. Stores on Shopify can use a custom-app path that marks the order paid.

## The problem it solves
Taking crypto at checkout usually means "send tokens to this address". The merchant then matches transfers to orders by hand, wrong amounts slip through, and orders get marked paid on a screenshot. Payment processors that fix this usually hold the money.

MezoCommerce ties each payment to one order with a signed intent, makes underpaying or overpaying impossible, never holds funds, and only marks an order paid after it reads the payment on Mezo.

## Challenges I ran into
- **A public payment ID can be squatted.** An AI security audit (Pashov solidity-auditor, two passes) found that any registered merchant could pay another merchant's public payment ID for 1 wei and block the real payment. Fixed by keying all intent state by merchant and payment ID.
- **Mezo's public RPC nodes are not always in sync.** A lagging node estimates a contract call as a plain transfer, and the transaction then fails. The app now estimates gas itself, retries low estimates and passes an explicit gas limit.
- **Bitcoin wallets can't sign a permit.** Mezo Passport Bitcoin wallets act through a smart account, so checkout detects them and switches to an exact approval.
- **Waiting for confirmations without a paid worker.** The background worker runs from Supabase cron once a minute, so the checkout now counts confirmations itself and a payment turns paid in seconds.
- **Never trusting the browser.** A transaction hash from the client is only a hint; the server fetches the receipt and checks the event.

## Technologies I used
Mezo testnet (MUSD, EIP-2612 permit, native BTC gas), Mezo Passport, Solidity and Foundry, OpenZeppelin, Next.js, TypeScript, wagmi and viem, Postgres (Supabase) with pg_cron, Vercel.

## How we built it
I started on-chain: checked the MUSD token, its permit domain and decimals on Mezo testnet before writing code. The contract interface, payment state machine, API types and database schema were frozen first. Then the contract, the backend, the merchant app and the checkout were built in parallel against them.

One contract, MerchantPaymentProcessor, checks the signed intent and moves the exact amount with SafeERC20. The backend has the payment API (API keys, idempotency, rate limits), an indexer that handles reorgs and confirmations, signed webhooks with retries, refunds and Shopify sync.

Tests: 104 contract tests (unit, adversarial, fuzz, invariants) and 232 app tests. The contract is deployed and source-verified on Mezo testnet, and the demo video shows a real merchant registration and a real customer payment on the live site.

## What we learned
- A transaction hash from a browser is not proof of payment. Read the event from the chain and match it to the order.
- Public IDs need per-merchant scope. Anything a stranger can see, a stranger can try to use first.
- Testnet infrastructure has its own failure modes, such as lagging RPC nodes, and the app has to handle them.

## What's next for MezoCommerce
- A Shopify payments app, beyond today's custom-app path.
- More payment tokens alongside MUSD.
- Plugins for popular store platforms.
- A professional audit, then a mainnet release.
```

**Deliverable URL**
```
https://github.com/prajalsharma/mezocommerce
```
(The repo must be public. The form says so.)

**Video**
Upload `~/mezocommerce/demo/out/mezocommerce-demo.mp4` (1:49, Andrew voiceover, subtitles) to YouTube as Public and paste the link.

**Live demo**
```
https://mezocommerce.vercel.app
```

**Build with** (press Enter after each)
`Mezo` · `MUSD` · `Mezo Passport` · `Bitcoin`

**Product Category** (max 3)
`Payments` · `DeFi` · `Infrastructure`

**Tags** (max 10)
`Solidity` · `Foundry` · `OpenZeppelin` · `Next.js` · `TypeScript` · `viem` · `wagmi` · `Mezo Passport` · `Supabase` · `Vercel`

**Product detail visibility**
**Show**

---

## PART 3 — Wave form

**Updates in this Wave** (3,000 characters or fewer)
```
MezoCommerce is live on Mezo testnet: https://mezocommerce.vercel.app
Code: https://github.com/prajalsharma/mezocommerce

What shipped this wave:
- Payment contract: MerchantPaymentProcessor checks an EIP-712 signed intent (order ID, merchant, payout, token, exact amount, optional payer, expiry) and moves the exact MUSD from customer to merchant. It never holds funds. Deployed and source-verified: https://explorer.test.mezo.org/address/0x94D35689d95b4C7ec9c8bD296ff606027e154df8
- Merchant onboarding: sign in with a wallet, name the store, register on Mezo in one transaction.
- Dashboard: payments, payment links with QR codes, refunds, API keys, webhooks, Shopify settings.
- Hosted checkout: one permit signature and one transaction; Bitcoin wallets through Mezo Passport use an exact approval.
- Payment API with API keys, idempotency and rate limits; embeddable widget; reference storefront.
- On-chain verification: the server reads the payment event itself, checks every field and waits for confirmations before an order turns paid; signed webhooks with retries.
- Refunds from the merchant wallet to the original payer, capped on-chain at what was paid.
- Shopify custom-app path that marks orders paid.
- Mezo Passport: Bitcoin wallets (Unisat, OKX, Xverse) and Ethereum wallets.
- Real payment on the live site: merchant registered https://explorer.test.mezo.org/tx/0x1dd2056c609d31ef2217ba718b3e7159f68f64198aaa0eba1667ac1922779dc8 · customer paid https://explorer.test.mezo.org/tx/0x33c0b8ca4b0d8e4ef28b7d76bbcbc542c6325baff25834ac0b3b96efb606f895
- Security: an AI audit (Pashov solidity-auditor, 2 passes) found that a public payment ID could be squatted by another merchant; fixed by scoping all payment state per merchant. Leads also fixed: token address rejected as payout, permit no longer overwrites a larger approval, ownership can't be renounced.
- Reliability: explicit gas limits for Mezo's lagging RPC nodes; checkout confirms payments without waiting for the worker.
- Tests: 104 contract tests and 232 app tests.
```

**Milestone — 3rd Wave** (1,000 characters or fewer). Goals for the next wave, not what is already built; that goes in "Updates in this Wave".
```
- Shopify end to end: build and test the checkout extension on a Shopify development store, so an order placed on Shopify is paid in MUSD and marked paid automatically.
- Store plugins: a WooCommerce plugin on top of the existing widget and payment API.
- External security audit of the payment contract, and fix every finding.
- Faster confirmations: move the background worker from a once-a-minute cron to a dedicated service, so webhooks arrive within seconds.
- Merchant tools: several stores under one account, and team members with their own roles.
- Testnet pilot with real merchants: onboard a few stores, collect feedback and fix what slows them down.
```

**Milestone — 4th Wave** (plan)
```
- Launch on Mezo mainnet with real MUSD, starting with a per-payment limit that rises over time.
- Apply for Shopify Payments partner approval, to offer MUSD as a native Shopify payment method.
- Accept more payment tokens alongside MUSD once they are confirmed on Mezo.
- Business model: a small disclosed per-transaction fee, plus paid plans with deeper analytics and a white-label checkout.
```
