-- FROZEN. MezoCommerce schema (Postgres 15+ / PGlite). Idempotent: safe to run on every boot.
-- Columns marked [chain] are written ONLY by the indexer / receipt verifier from confirmed logs or live chain reads,
-- never from client input. Amounts are NUMERIC(78,0) token units (wei). Times are TIMESTAMPTZ.
-- Addresses and hashes are stored lowercase.

CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address  TEXT NOT NULL UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_nonces (
  nonce       TEXT PRIMARY KEY,
  address     TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,                        -- random 32 bytes hex; cookie holds HMAC-signed id
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  address     TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS merchants (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id        UUID NOT NULL REFERENCES users(id),
  owner_address        TEXT NOT NULL,                  -- [chain] once registered
  onchain_merchant_id  NUMERIC(78,0) UNIQUE,           -- [chain] NULL until registration confirmed
  payout_address       TEXT,                           -- [chain]
  platform_signer_enabled BOOLEAN NOT NULL DEFAULT FALSE, -- [chain] isSigner(id, platform signer)
  chain_active         BOOLEAN NOT NULL DEFAULT FALSE, -- [chain]
  status               TEXT NOT NULL DEFAULT 'pending',-- pending|active|inactive (derived from chain)
  name                 TEXT NOT NULL,
  slug                 TEXT NOT NULL UNIQUE,
  description          TEXT NOT NULL DEFAULT '',
  logo_url             TEXT,                           -- https only
  website              TEXT,                           -- https only; also default return URL origin
  support_email        TEXT,
  brand_color          TEXT NOT NULL DEFAULT '#0f766e',-- checkout accent, validated #rrggbb
  notify_payment       BOOLEAN NOT NULL DEFAULT TRUE,
  notify_failure       BOOLEAN NOT NULL DEFAULT TRUE,
  notify_refund        BOOLEAN NOT NULL DEFAULT TRUE,
  register_tx_hash     TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS merchants_owner_uq ON merchants (owner_address);

CREATE TABLE IF NOT EXISTS api_keys (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id   UUID NOT NULL REFERENCES merchants(id),
  name          TEXT NOT NULL DEFAULT 'Default',
  key_hash      TEXT NOT NULL UNIQUE,                  -- hex sha256(API_KEY_PEPPER || key)
  key_prefix    TEXT NOT NULL,                         -- first 16 chars, shown in UI
  permissions   JSONB NOT NULL DEFAULT '["payment_intents:write","payment_intents:read","payments:read","refunds:write","webhooks:write"]',
  last_used_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS api_keys_merchant_idx ON api_keys (merchant_id);

CREATE TABLE IF NOT EXISTS payment_intents (
  id                  TEXT PRIMARY KEY,                -- public id "pi_<24 base62>"
  payment_id          TEXT NOT NULL UNIQUE,            -- bytes32 hex (random), the on-chain paymentId
  merchant_id         UUID NOT NULL REFERENCES merchants(id),
  onchain_merchant_id NUMERIC(78,0) NOT NULL,          -- signed into the intent
  merchant_order_id   TEXT NOT NULL,
  description         TEXT NOT NULL DEFAULT '',
  amount              NUMERIC(78,0) NOT NULL,          -- signed, immutable
  token_address       TEXT NOT NULL,                   -- signed, immutable
  token_symbol        TEXT NOT NULL,
  payout_address      TEXT NOT NULL,                   -- signed, immutable
  payer_address       TEXT,                            -- signed (NULL = any payer = address(0))
  expires_at          TIMESTAMPTZ NOT NULL,            -- signed, immutable
  signature           TEXT NOT NULL,                   -- EIP-712 sig by the platform signer
  signer_address      TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'created', -- lib/chain/payment-state.ts IntentStatus
  late                BOOLEAN NOT NULL DEFAULT FALSE,  -- paid after DB cancel/expiry
  return_url          TEXT,
  cancel_url          TEXT,
  metadata            JSONB NOT NULL DEFAULT '{}',
  source              TEXT NOT NULL DEFAULT 'api',     -- api|dashboard|payment_link|shopify|demo_store
  checkout_url        TEXT NOT NULL,
  amount_refunded     NUMERIC(78,0) NOT NULL DEFAULT 0,-- [chain]
  paid_at             TIMESTAMPTZ,                     -- [chain] block time
  cancelled_at        TIMESTAMPTZ,
  expired_at          TIMESTAMPTZ,
  first_viewed_at     TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pi_merchant_idx ON payment_intents (merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS pi_status_exp_idx ON payment_intents (status, expires_at);
CREATE INDEX IF NOT EXISTS pi_order_idx ON payment_intents (merchant_id, merchant_order_id);
-- At most one open-or-settled intent per merchant order (retry allowed after expired/cancelled).
CREATE UNIQUE INDEX IF NOT EXISTS pi_order_open_uq ON payment_intents (merchant_id, merchant_order_id)
  WHERE status NOT IN ('expired', 'cancelled');

-- Client-reported transaction hashes. Hints only — never proof of payment.
CREATE TABLE IF NOT EXISTS payment_attempts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_intent_id  TEXT NOT NULL REFERENCES payment_intents(id),
  transaction_hash   TEXT NOT NULL UNIQUE,
  reported_payer     TEXT,
  status             TEXT NOT NULL DEFAULT 'submitted', -- submitted|succeeded|failed
  failure_reason     TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  checked_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS attempts_intent_idx ON payment_attempts (payment_intent_id);

-- Verified on-chain payments: exactly one per intent (from PaymentCompleted).
CREATE TABLE IF NOT EXISTS payments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_intent_id  TEXT NOT NULL UNIQUE REFERENCES payment_intents(id),
  merchant_id        UUID NOT NULL REFERENCES merchants(id),
  payment_id         TEXT NOT NULL UNIQUE,             -- [chain] bytes32
  payer_address      TEXT NOT NULL,                    -- [chain]
  payout_address     TEXT NOT NULL,                    -- [chain]
  token_address      TEXT NOT NULL,                    -- [chain]
  amount             NUMERIC(78,0) NOT NULL,           -- [chain]
  transaction_hash   TEXT NOT NULL,                    -- [chain]
  log_index          INTEGER NOT NULL,
  block_number       BIGINT NOT NULL,
  block_hash         TEXT NOT NULL,
  confirmations      INTEGER NOT NULL DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'confirming', -- confirming|confirmed|reorged
  paid_at            TIMESTAMPTZ NOT NULL,             -- block time
  confirmed_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (transaction_hash, log_index)
);
CREATE INDEX IF NOT EXISTS payments_merchant_idx ON payments (merchant_id, paid_at DESC);

CREATE TABLE IF NOT EXISTS refunds (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_intent_id  TEXT NOT NULL REFERENCES payment_intents(id),
  merchant_id        UUID NOT NULL REFERENCES merchants(id),
  amount             NUMERIC(78,0) NOT NULL,
  reason             TEXT NOT NULL DEFAULT '',
  status             TEXT NOT NULL DEFAULT 'requested', -- requested|submitted|confirmed|failed
  transaction_hash   TEXT UNIQUE,                       -- reported, then [chain] verified
  log_index          INTEGER,
  from_address       TEXT,                              -- [chain]
  total_refunded     NUMERIC(78,0),                     -- [chain] cumulative after this refund
  requested_by       TEXT NOT NULL,                     -- wallet or 'api:<key prefix>'
  confirmed_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS refunds_intent_idx ON refunds (payment_intent_id);
CREATE UNIQUE INDEX IF NOT EXISTS refunds_tx_log_uq ON refunds (transaction_hash, log_index) WHERE log_index IS NOT NULL;

CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id  UUID NOT NULL REFERENCES merchants(id),
  url          TEXT NOT NULL,                           -- https, public host only (SSRF-checked)
  secret       TEXT NOT NULL,                           -- whsec_…; shown once at creation
  event_types  JSONB NOT NULL DEFAULT '["*"]',
  status       TEXT NOT NULL DEFAULT 'active',          -- active|disabled
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS webhook_endpoints_merchant_idx ON webhook_endpoints (merchant_id);

-- Event log (one row per merchant event) + per-endpoint deliveries (at-least-once, HMAC signed).
CREATE TABLE IF NOT EXISTS webhook_events (
  id           TEXT PRIMARY KEY,                        -- "evt_<24 base62>", sent as idempotency id
  merchant_id  UUID NOT NULL REFERENCES merchants(id),
  event_type   TEXT NOT NULL,
  dedupe_key   TEXT NOT NULL UNIQUE,                    -- e.g. payment.confirmed:<payment_id>
  payment_intent_id TEXT,
  payload      JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS webhook_events_merchant_idx ON webhook_events (merchant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         TEXT NOT NULL REFERENCES webhook_events(id),
  endpoint_id      UUID NOT NULL REFERENCES webhook_endpoints(id),
  status           TEXT NOT NULL DEFAULT 'pending',     -- pending|delivered|failed
  attempt_count    INTEGER NOT NULL DEFAULT 0,
  response_status  INTEGER,
  last_error       TEXT,
  next_retry_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_until     TIMESTAMPTZ,
  delivered_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, endpoint_id)
);
CREATE INDEX IF NOT EXISTS webhook_deliveries_due_idx ON webhook_deliveries (status, next_retry_at);

-- Raw chain events; (tx_hash, log_index) makes ingestion idempotent.
CREATE TABLE IF NOT EXISTS blockchain_events (
  id               BIGSERIAL PRIMARY KEY,
  chain_id         INTEGER NOT NULL,
  contract_address TEXT NOT NULL,
  event_name       TEXT NOT NULL,
  payment_id       TEXT,                                -- bytes32 when the event has one
  block_number     BIGINT NOT NULL,
  block_hash       TEXT NOT NULL,
  transaction_hash TEXT NOT NULL,
  log_index        INTEGER NOT NULL,
  args             JSONB NOT NULL,                      -- bigint as decimal strings
  block_time       TIMESTAMPTZ NOT NULL,
  processed_at     TIMESTAMPTZ,
  error            TEXT,
  UNIQUE (transaction_hash, log_index)
);
CREATE INDEX IF NOT EXISTS bc_events_block_idx ON blockchain_events (block_number);
CREATE INDEX IF NOT EXISTS bc_events_payment_idx ON blockchain_events (payment_id);

CREATE TABLE IF NOT EXISTS indexer_state (
  id               TEXT PRIMARY KEY,                    -- 'main' cursor | 'worker' heartbeat
  last_block       BIGINT NOT NULL,
  last_block_hash  TEXT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS indexed_blocks (
  block_number  BIGINT PRIMARY KEY,
  block_hash    TEXT NOT NULL
);

-- Leases so two worker processes never run the same pass concurrently.
CREATE TABLE IF NOT EXISTS worker_leases (
  name         TEXT PRIMARY KEY,                        -- indexer|webhooks|expiry|shopify
  holder       TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id  UUID NOT NULL REFERENCES merchants(id),
  kind         TEXT NOT NULL,                           -- payment_confirmed|payment_failed|payment_expired|refund_confirmed|late_payment|shopify_error
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  link         TEXT,
  dedupe_key   TEXT NOT NULL UNIQUE,
  read_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_merchant_idx ON notifications (merchant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_logs (
  id           BIGSERIAL PRIMARY KEY,
  merchant_id  UUID,
  actor        TEXT NOT NULL,                           -- wallet, 'api:<prefix>', 'indexer', 'worker', 'system', 'shopify'
  action       TEXT NOT NULL,
  resource_id  TEXT,
  metadata     JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_logs_merchant_idx ON audit_logs (merchant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS rate_limits (
  key          TEXT PRIMARY KEY,
  window_start TIMESTAMPTZ NOT NULL,
  count        INTEGER NOT NULL
);

-- POST idempotency (Idempotency-Key header). key = <merchant_id>:<header value>. Same key + different body → 409.
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key           TEXT PRIMARY KEY,
  request_hash  TEXT NOT NULL,
  status_code   INTEGER NOT NULL,
  response      JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Shopify custom-app connection (one per merchant). Token + webhook secret encrypted with AES-256-GCM (ENCRYPTION_KEY).
CREATE TABLE IF NOT EXISTS shopify_connections (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id              UUID NOT NULL UNIQUE REFERENCES merchants(id),
  shop_domain              TEXT NOT NULL UNIQUE,        -- <name>.myshopify.com
  access_token_enc         TEXT NOT NULL,
  webhook_secret_enc       TEXT NOT NULL,
  payment_method_name      TEXT NOT NULL DEFAULT 'Pay with MUSD',
  status                   TEXT NOT NULL DEFAULT 'active', -- active|error|disconnected
  last_error               TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shopify_orders (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id        UUID NOT NULL REFERENCES shopify_connections(id),
  shopify_order_id     TEXT NOT NULL,                   -- numeric id as text
  order_name           TEXT NOT NULL,                   -- e.g. #1001
  payment_intent_id    TEXT REFERENCES payment_intents(id),
  sync_status          TEXT NOT NULL DEFAULT 'pending', -- pending|marked_paid|failed|skipped
  sync_attempts        INTEGER NOT NULL DEFAULT 0,
  next_sync_at         TIMESTAMPTZ,
  last_error           TEXT,
  marked_paid_at       TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (connection_id, shopify_order_id)
);
CREATE INDEX IF NOT EXISTS shopify_orders_sync_idx ON shopify_orders (sync_status, next_sync_at);

-- Inbound Shopify webhook ids (X-Shopify-Webhook-Id) for replay/duplicate protection.
CREATE TABLE IF NOT EXISTS shopify_webhook_receipts (
  webhook_id   TEXT PRIMARY KEY,
  topic        TEXT NOT NULL,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
