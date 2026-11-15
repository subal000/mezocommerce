# Backend notes (for the lead)

Owner: `lib/server/**` (except schema.sql), `lib/money.ts`, `app/api/**`, `app/pay/shopify/**`, `worker/**`,
`integrations/shopify/**`, `tests/server/**`, `render.yaml`, `next.config.ts`, `.env.example`, `scripts/e2e-testnet.ts`.

## Run

```bash
cp .env.example .env.local        # fill NEXT_PUBLIC_PROCESSOR_ADDRESS / DEPLOY_BLOCK after the contracts deploy
npm run dev                        # web (PGlite at .data/pglite when DATABASE_URL is unset)
npm run worker                     # indexer → confirmations/reorgs/reconcile → expiry → webhooks → Shopify, every 5 s
npm run worker:once                # one pass, exit code 1 if a stage failed
npx vitest run tests/server        # 57 tests, no network
npm run e2e:testnet                # real testnet run (needs E2E_* env; NOT run by me)
```

`POST /api/indexer/sync` with `Authorization: Bearer $INDEXER_SECRET` runs one worker pass (cron fallback).
Two workers are safe: each stage holds a `worker_leases` row; webhook deliveries and Shopify orders are leased per row.

## Environment

See `.env.example` (every variable, commented). Production requirements: `SESSION_SECRET`, `API_KEY_PEPPER`
(≥ 32 chars), `ENCRYPTION_KEY` (64 hex), `INTENT_SIGNER_PRIVATE_KEY` (web only). Without the signer key in dev a key is
generated to `.data/dev-signer.key` with a loud warning. The **worker gets `PLATFORM_SIGNER_ADDRESS`** (the address,
not the key) so reconciliation can re-read `isSigner`. `WEBHOOK_ALLOW_LOCALHOST=1` (dev only) allows
`http://localhost` webhook endpoints, e.g. the demo store receiver on a local server.

## Module map (lib/server)

- `verify.ts` — the single verification path (receipt fetched server-side, emitter == processor, field equality,
  locked payer, block-hash check, confirmations). `settle.ts` applies verified checks idempotently (payments,
  confirmations, rollback, refunds, cancels, client-reported txs). Nothing else marks money as moved.
- `indexer.ts` — cursor from `NEXT_PUBLIC_DEPLOY_BLOCK - 1`, 2,000-block chunks, `blockchain_events` dedupe, last-12
  block-hash reorg check + rewind, confirmation counting, reconciliation every `RECONCILE_EVERY` passes.
- `intents.ts` (creation service shared by v1 / dashboard / Shopify / demo store; cancel; expiry sweep; list search),
  `checkout.ts`, `refunds.ts`, `merchants.ts` (profile, slug, live readiness with 30 s cache + DB fallback,
  registration params, confirm), `api-keys.ts`, `webhooks.ts` (endpoints, deliveries, HMAC, SSRF-pinned fetch),
  `events.ts` (webhook events + notifications), `shopify.ts`, `demo-store.ts` (pure catalog, re-exports
  `components/storefront/catalog.ts`) + `demo-store-service.ts`, `dashboard.ts`, `platform.ts`, `leases.ts`, `worker.ts`.
- `http.ts` wrappers: `route` (public), `sessionRoute`, `merchantRoute`, `apiRoute({permission})`. All: origin check,
  per-IP + per-principal rate limit, merchant-scoped `Idempotency-Key` (same key + different body → 409
  `idempotency_key_reused`, concurrent → 409 `idempotency_in_progress`), zod → 400, DB unreachable → 503
  `service_unavailable`, unique violation → 409, anything else → generic 500 (no stack).

## Contract changes honoured (lead message)

- `PaymentCancelled` is applied only when its merchantId equals the intent's; foreign cancels are audit-logged
  (`payment.foreign_cancel_ignored`). Reconciliation reads `intentState(merchantId, paymentId)`,
  which is scoped per merchant on-chain.
- Preflight maps `insufficient_allowance` → `check: "ok"` with `needs_approval: true` (permit flow).
- Refund verify path accepts `from` ∈ {owner, CURRENT payout} from a live `merchant(id)` read (DB fallback).
- Payout cannot be the zero address or the processor at profile creation (mirrors `InvalidPayout`).

## Response details the UI depends on (beyond api-types)

- `GET /api/auth/session` → 401 when signed out. `GET /api/merchants/me` → 404 `merchant_not_found` before a profile.
- `POST …/payment-intents/:id/cancel` (dashboard + v1) → `PaymentIntentDTO & { cancel_tx: { to, data } }`.
- `GET /api/merchant/notifications` → `{ data: NotificationDTO[], unread: number }`; `POST …/read` `{ ids? }`.
- `GET /api/merchant/shopify` → `ShopifyConnectionDTO | null`; `DELETE` wipes the stored credentials.
- List search `q` (alias `search`) matches order id (ILIKE), `pi_` id, payment_id, payer (locked or paid) and tx
  hashes (payments + attempts); export.csv accepts the same `status`/`q`.
- `GET /api/demo-store/orders/:id` → `DemoOrderDTO` in `lib/server/demo-store.ts` (shape from notes-checkout.md).
- Webhook `ping` events (dashboard "Send test") carry a synthetic intent with id `pi_test000000000000000000000`.
- Proposed payout (before registration) is kept in `audit_logs` (`merchant.payout_proposed`) so the [chain]
  `payout_address` column stays chain-only; `MerchantDTO.payout_address` is null until registration is confirmed.

## Known limitations

- Demo store orders / received demo webhooks live in `audit_logs` (`demo_store.*`) because the schema is frozen;
  dedupe on event id is check-then-insert (tiny race, harmless for a demo).
- A reorg deeper than `CONFIRMATIONS` that removes an already-`paid` payment forces the intent back to
  `awaiting_payment`/`expired` (outside the frozen state machine) and audit-logs `payment.reorged_after_settlement`;
  the `payment.confirmed` webhook already sent is not retracted, and a Shopify order already marked paid is not undone.
- Reconciliation cannot recover a payment whose `PaymentCompleted` log the indexer never saw (it audits
  `reconcile.*`); the indexer itself is the recovery path (cursor rewind).
- `refunds.transaction_hash` is unique, so a single tx containing two `RefundCompleted` logs (multicall) records
  only the first; the second is audit-logged. `amount_refunded` still follows the chain's cumulative total.
- Requested refunds reserve refundable balance for 24 h, then stop counting (no explicit "cancel refund request").
- The Shopify Checkout UI extension is source only — not built, deployed or tested (no Shopify CLI/dev store here).
  Shopify logic is unit-tested with a mocked Admin GraphQL fetch only.
- Nothing was run against the live chain; `scripts/e2e-testnet.ts` is written but not executed.
- `gas_ok` in preflight is `btc_balance > 0` (no gas estimate).
