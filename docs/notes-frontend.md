# Frontend notes (app agent)

Landing, merchant onboarding, dashboard, docs and site basics. Everything reads real API routes and frozen
`lib/api-types.ts` DTOs. There's no mock analytics. The only sample data is on the landing page, and it's labelled "Sample data, not live".

## Design system

- Tokens are in `app/globals.css`. Values and names are unchanged: cool neutrals, one ledger-green accent (`--brand`), and semantic
  `--ok/info/warn/bad/idle`. Fonts are Geist and Geist Mono via `next/font`. Controls have an 8px radius and panels `rounded-xl`.
- The theme defaults to light and dark is toggle-only. `components/providers.tsx` now uses `defaultTheme="light" enableSystem={false}`
  (this is the one edit to a lead file).
- There is one status display. `StatusBadge` / `StatusDot` (`components/shared/status-badge.tsx`) show a small dot and a word, never a pill.
  Every `IntentStatus` is mapped in `lib/client/status.ts` (`INTENT_STATUS`). Attempts, refunds, deliveries, Shopify sync and merchant
  status use the same maps.
- Money: `formatMusd` (`lib/money.ts`) is used through `musd()` / `musdDisplay()` in `lib/client/format.ts`, with the
  `<Musd>` / `<MusdDisplay>` components. Integer math only. The chart converts to floats for the y axis and for nothing else.
- Addresses and hashes use `AddressText`, `TxLink` and `IdText` (truncated, with copy and an explorer link). Explorer URLs come from `lib/chain/config.ts`.
- Visible copy has no em or en dashes (grep-checked), uses sentence case, and has no eyebrows or pills.
- Motion uses `motion/react`, takes 150 to 250ms in the dashboard, and turns off under `useReducedMotion` (plus the global CSS guard).
- The root layout has no global header or footer. The skip link carries `data-site-chrome` so checkout and embed layouts can hide it.

## On-chain writes

`lib/client/writes.ts` handles both kinds of write:
- `build.*` produces processor calls (`registerMerchant`, `setPayout`, `setSigner`, `setMerchantActive`, `cancelPayment`).
- `build.raw` wraps the API-prepared refund calls (`RefundDTO.tx.approve` / `.refund`).

`executeWrite` checks the deployment and the chain, then either simulates (contract calls) or runs `estimateGas` (raw calls), then sends and waits for the receipt.
`hooks/use-tx.tsx` drives the phases: wallet, then submitted, then recording (`POST /api/merchants/me/confirm` or
`/api/merchant/refunds/:id/submitted`), then success. A `recordError` can be retried without resending the transaction.
`TxPanel` explains each wallet prompt in one sentence before it opens. `ActionDialog`, `RefundDialog` and `CancelDialog` gate the button on the right
wallet (owner for settings and cancel, owner or payout for refunds, via `lib/client/merchant-wallet.ts`), the right network, and `deployed`.

"Deployed" comes from `GET /api/public/config` (`PublicConfigDTO.deployed`). The dashboard shows `NotDeployedNotice` and disables chain
buttons. The footer uses the build-time `contracts.processor` address.

## Routes

- `/merchant`: the shell (`components/merchant/shell.tsx`) decides what to show. Signed out, no profile, or registration `next !== "ready"`
  shows the onboarding wizard. Once shown, the wizard stays up for the visit so the API key and done steps can appear. `/merchant/onboarding` always shows it.
- Onboarding step logic is pure (`lib/client/onboarding.ts`): connect, network, sign_in, profile, onchain, api_key, done.
- Dashboard pages:
  - `/merchant` (overview)
  - `/merchant/payments` (filters live in the URL, debounced search, CSV export link, pagination)
  - `/merchant/payments/new` (form, then link, QR (`qrcode`) and copy; a 409 `order_has_open_intent` reuses `details.payment_intent`)
  - `/merchant/payments/[id]` (timeline, on-chain details, attempts, refunds, webhook events, cancel, refund)
  - `/merchant/developers` (API keys) and `/merchant/developers/webhooks` (endpoints, deliveries, retry)
  - `/merchant/shopify`, `/merchant/settings` and `/merchant/notifications`. The bell sits in the sidebar on desktop and the header on mobile.
- Docs and the landing page were built by the docs and landing forks: `/docs/*` (`components/docs`) and `/` (`components/landing`).

## Assumptions the backend should keep matching (checked against current app/api)

- `GET /api/merchant/payment-intents?status=&q=&page=` returns `Paginated`. Right now `q` only matches `merchant_order_id` (ILIKE) or the exact `pi_` id.
  The spec also asks for payment_id, payer and tx hash search, and the placeholder promises them, so the backend should extend `listIntents`.
- The CSV export link is `/api/merchant/payment-intents/export.csv?status=&q=`.
- `POST /api/merchant/notifications/read` sends `{}` to mark all read.
- `GET /api/merchant/shopify` returns `null` (or 404) when not connected. `GET /api/auth/session` returns 401 when signed out, which the client treats as null.
- `GET /api/merchants/me` returns 404 `merchant_not_found` before a profile exists, which the client treats as null.
- `POST /api/merchant/payment-intents/:id/cancel` is DB-only. The on-chain `cancelPayment` is sent separately from the owner wallet.
- Refund dialog: if `RefundDTO.tx` is null the UI stops with a message. Requested refunds that come back with `tx` show a "Send from wallet" resume button.
- List endpoints are read tolerantly (`asList`: plain array, `Paginated` or `{ key: [] }`).

## Tests (`tests/ui`, vitest + jsdom)

`@testing-library/dom` (peer of `@testing-library/react`) isn't installed, so `tests/ui/dom-helpers.tsx` renders with `react-dom/client`
and `act`.

- `status-badge.test.tsx`: every `IntentStatus` has a label, tone and hint, renders as a dot plus a word, isn't a pill, and late payments are marked.
- `money-table.test.tsx`: `musd` / `musdDisplay` / `musdExact`, and the amounts shown in `PaymentsTable` (desktop table and mobile list), including expiry.
- `onboarding.test.ts`: step order, network step, API key skip, the on-chain action map and `needsOnboarding`.
- `refund.test.ts`: refundable amount, and the amount validation limits and errors.
- `api-key-once.test.tsx`:
  - The `SecretReveal` button is gated on the "saved" checkbox.
  - `CreateKeyDialog` shows the secret once and has no close X while it's showing.
  - After "Done" the secret is gone, and reopening the dialog shows the form.
- `dashboard-logic.test.ts`: pagination, query strings, webhook URL and Shopify form checks, create-payment limits, branding contrast,
  wallet roles, network state, error decoding, the integration checklist and the timeline.

## Open items

- `SITE.faucetUrl` (`https://testnet.mezo.org`) is copied from mezosub and not re-verified.
- There's no `favicon.ico`, because it would need a new dependency. `icon.svg` and the apple icon are served instead.
- No browser, screenshot or live-chain QA has been done (not requested).
