// FROZEN. Wire types shared by API routes, the dashboard, the checkout, the widget docs and webhook payloads.
// Conventions: snake_case fields (Stripe-like public API). Token amounts are strings:
//   `amount` = integer token units (wei, 18 dp for MUSD), `amount_display` = decimal string ("10.5").
// Addresses / hashes are lowercase 0x strings. Times are ISO-8601 strings.
// Errors: HTTP 4xx/5xx with body ApiError.

import type { IntentStatus, AttemptStatus, RefundStatus, WebhookEventType } from "@/lib/chain/payment-state";
import type { PayCheck } from "@/lib/chain/config";

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}

export interface Paginated<T> {
  data: T[];
  page: number;
  page_size: number;
  total: number;
}

// ───────────── auth ─────────────
export interface NonceResponse { nonce: string; message: string }
export interface SessionDTO { address: string; merchant_id: string | null; expires_at: string }

// ───────────── platform ─────────────
export interface PublicConfigDTO {
  chain_id: number;
  processor_address: string; // zero address when not deployed
  musd_address: string;
  platform_signer: string; // address merchants authorize via registerMerchant/setSigner
  deployed: boolean;
  confirmations: number;
  app_url: string;
}

export interface HealthResponse {
  ok: boolean;
  chain_id: number | null;
  block_number: string | null;
  db: "postgres" | "pglite";
  db_ok: boolean;
  deployed: boolean;
  indexer: { last_block: string | null; lag_blocks: number | null; updated_at: string | null };
  worker: { last_run_at: string | null; healthy: boolean };
}

// ───────────── merchants ─────────────
export interface MerchantDTO {
  id: string;
  slug: string;
  name: string;
  description: string;
  logo_url: string | null;
  website: string | null;
  support_email: string | null;
  brand_color: string;
  owner_address: string;
  onchain_merchant_id: string | null;
  payout_address: string | null;
  platform_signer_enabled: boolean;
  chain_active: boolean;
  status: "pending" | "active" | "inactive";
  notify_payment: boolean;
  notify_failure: boolean;
  notify_refund: boolean;
  created_at: string;
}

/** POST /api/merchants (session) */
export interface CreateMerchantRequest {
  name: string;
  description?: string;
  website?: string | null;
  logo_url?: string | null;
  support_email?: string | null;
  payout_address: string; // proposed; becomes [chain] only after registration confirms
}

/** PATCH /api/merchants/me — off-chain fields only. Payout/signer/active change on-chain then POST .../confirm. */
export interface UpdateMerchantRequest {
  name?: string;
  description?: string;
  website?: string | null;
  logo_url?: string | null;
  support_email?: string | null;
  brand_color?: string;
  notify_payment?: boolean;
  notify_failure?: boolean;
  notify_refund?: boolean;
}

/** GET /api/merchants/me/registration — what the wallet must send to register (or fix setup). */
export interface RegistrationParamsDTO {
  processor_address: string;
  platform_signer: string;
  payout_address: string;
  /** Next step the dashboard should offer. */
  next: "register" | "enable_signer" | "activate" | "ready";
}

export interface MerchantOverviewDTO {
  merchant: MerchantDTO;
  totals: {
    received: string; // wei, confirmed payments (gross)
    received_display: string;
    refunded: string;
    refunded_display: string;
    net_display: string;
    successful_count: number;
    pending_count: number; // created|awaiting_payment|submitted|confirming
    failed_attempts: number;
    expired_count: number;
    cancelled_count: number;
    refunded_count: number; // partially + fully
    /** paid / (paid + expired + cancelled) over intents with a final outcome; null if none. */
    conversion_rate: number | null;
  };
  daily: { date: string; received_display: string; count: number }[]; // last 30 days, UTC
  recent: PaymentIntentDTO[]; // 10 most recent
  integration: {
    api_keys: number;
    webhook_endpoints: number;
    last_webhook_status: "delivered" | "failed" | "pending" | null;
    shopify_connected: boolean;
    onchain_ready: boolean; // registered + active + platform signer enabled
  };
}

// ───────────── API keys ─────────────
export interface ApiKeyDTO {
  id: string;
  name: string;
  key_prefix: string;
  permissions: string[];
  last_used_at: string | null;
  created_at: string;
  revoked_at: string | null;
}
/** Only response that ever contains the full secret. */
export interface CreatedApiKeyDTO extends ApiKeyDTO { secret: string }

// ───────────── payment intents ─────────────
/** POST /api/v1/payment-intents (Bearer API key) and POST /api/merchant/payment-intents (session). */
export interface CreatePaymentIntentRequest {
  merchant_order_id: string; // 1..128 chars, [A-Za-z0-9_\-#:./]
  amount: string; // decimal MUSD, e.g. "10" or "10.50" (max 18 dp)
  currency?: "MUSD"; // default MUSD
  description?: string; // ≤ 500
  return_url?: string | null; // https (http allowed for localhost in dev)
  cancel_url?: string | null;
  expires_in_seconds?: number; // INTENT_LIMITS, default 1800
  payer_address?: string | null; // lock to one payer
  metadata?: Record<string, string>; // ≤ 20 keys, key ≤ 40, value ≤ 500
}

/** The exact struct the customer submits on-chain + signature. */
export interface SignedIntentDTO {
  payment_id: string; // bytes32
  merchant_id: string; // uint256 decimal
  payout: string;
  token: string;
  amount: string; // wei
  payer: string; // zero address = any
  expires_at: string; // uint64 unix seconds, decimal
  signature: string;
}

export interface PaymentIntentDTO {
  id: string; // pi_…
  object: "payment_intent";
  payment_id: string;
  merchant_id: string;
  merchant_order_id: string;
  description: string;
  amount: string;
  amount_display: string;
  currency: "MUSD";
  token_address: string;
  payout_address: string;
  payer_address: string | null;
  status: IntentStatus;
  late: boolean;
  checkout_url: string;
  return_url: string | null;
  cancel_url: string | null;
  metadata: Record<string, string>;
  source: string;
  expires_at: string;
  amount_refunded: string;
  amount_refunded_display: string;
  payment: PaymentDTO | null;
  created_at: string;
  updated_at: string;
}

export interface PaymentIntentDetailDTO extends PaymentIntentDTO {
  attempts: PaymentAttemptDTO[];
  refunds: RefundDTO[];
  events: { type: WebhookEventType; created_at: string }[];
  explorer_url: string | null;
}

export interface PaymentAttemptDTO {
  transaction_hash: string;
  status: AttemptStatus;
  failure_reason: string | null;
  created_at: string;
}

/** Verified on-chain payment. */
export interface PaymentDTO {
  id: string;
  object: "payment";
  payment_intent_id: string;
  payment_id: string;
  payer_address: string;
  payout_address: string;
  token_address: string;
  amount: string;
  amount_display: string;
  transaction_hash: string;
  block_number: string;
  confirmations: number;
  status: "confirming" | "confirmed" | "reorged";
  explorer_url: string;
  paid_at: string;
  confirmed_at: string | null;
}

// ───────────── checkout (public, no auth; keyed by payment_id or pi_ id) ─────────────
/** GET /api/public/checkout/:id */
export interface CheckoutDTO {
  id: string;
  payment_id: string;
  status: IntentStatus; // effectiveStatus() applied
  late: boolean;
  merchant: { name: string; slug: string; logo_url: string | null; website: string | null; brand_color: string; payout_address: string };
  merchant_order_id: string;
  description: string;
  amount: string;
  amount_display: string;
  currency: "MUSD";
  token: { address: string; symbol: "MUSD"; decimals: 18 };
  network: { chain_id: number; name: string };
  processor_address: string;
  expires_at: string;
  return_url: string | null;
  cancel_url: string | null;
  /** Omitted once the intent is no longer payable. */
  intent: SignedIntentDTO | null;
  payment: PaymentDTO | null; // when confirming/paid
  required_confirmations: number;
}

/** POST /api/public/checkout/:id/submitted — UNVERIFIED hint; server checks the chain itself. */
export interface SubmittedRequest { tx_hash: string; payer_address?: string }
/** Response of submitted + GET /api/public/checkout/:id/status (polling). */
export interface CheckoutStatusDTO {
  status: IntentStatus;
  payment: PaymentDTO | null;
  attempt: PaymentAttemptDTO | null;
  /** True only when status ∈ paid|partially_refunded|refunded (verified on-chain + confirmations met). */
  verified: boolean;
}

/** GET /api/public/checkout/:id/preflight?payer=0x… — live chain checkPayment + balances. */
export interface PreflightDTO {
  check: PayCheck;
  musd_balance: string;
  musd_balance_display: string;
  allowance: string;
  btc_balance: string; // wei, native gas
  needs_approval: boolean;
  gas_ok: boolean;
}

// ───────────── refunds ─────────────
/** POST /api/v1/refunds (API key) or /api/merchant/refunds (session). Creates a `requested` refund and returns
 *  the tx the merchant wallet (owner or payout) must send; nothing moves until that wallet signs. */
export interface CreateRefundRequest {
  payment_intent_id: string;
  amount: string; // decimal MUSD; ≤ amount - refunded (also enforced on-chain)
  reason?: string;
}
export interface RefundDTO {
  id: string;
  object: "refund";
  payment_intent_id: string;
  amount: string;
  amount_display: string;
  reason: string;
  status: RefundStatus;
  transaction_hash: string | null;
  explorer_url: string | null;
  from_address: string | null;
  total_refunded: string | null;
  created_at: string;
  confirmed_at: string | null;
  /** Calls to send from the merchant wallet (approve exact amount, then refund). */
  tx: { approve: { to: string; data: string }; refund: { to: string; data: string } } | null;
}
/** POST /api/merchant/refunds/:id/submitted { tx_hash } → server verifies RefundCompleted. */

// ───────────── webhooks ─────────────
export interface WebhookEndpointDTO {
  id: string;
  url: string;
  event_types: (WebhookEventType | "*")[];
  status: "active" | "disabled";
  created_at: string;
}
export interface CreatedWebhookEndpointDTO extends WebhookEndpointDTO { secret: string }
export interface CreateWebhookEndpointRequest { url: string; event_types?: (WebhookEventType | "*")[] }

export interface WebhookDeliveryDTO {
  id: string;
  event_id: string;
  event_type: WebhookEventType;
  endpoint_url: string;
  status: "pending" | "delivered" | "failed";
  attempt_count: number;
  response_status: number | null;
  last_error: string | null;
  next_retry_at: string | null;
  delivered_at: string | null;
  created_at: string;
}

/** Body POSTed to merchant endpoints. Headers:
 *   MezoCommerce-Signature: t=<unix>,v1=<hex hmac_sha256(secret, `${t}.${rawBody}`)>
 *   MezoCommerce-Event-Id: <evt id>  (idempotency — same id on every retry)
 *   MezoCommerce-Event-Type: <type>
 *  Receivers must reject t older than 5 minutes (replay) and dedupe on event id. */
export interface WebhookPayload {
  id: string; // evt_…
  object: "event";
  type: WebhookEventType;
  created_at: string;
  livemode: false; // testnet
  data: { payment_intent: PaymentIntentDTO; refund?: RefundDTO; fully_refunded?: boolean };
}

// ───────────── notifications ─────────────
export interface NotificationDTO {
  id: string;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

// ───────────── Shopify ─────────────
export interface ShopifyConnectionDTO {
  shop_domain: string;
  payment_method_name: string;
  status: "active" | "error" | "disconnected";
  last_error: string | null;
  webhook_url: string; // where the merchant points the orders/create webhook
  pay_link_template: string; // e.g. https://app/pay/shopify/<shop>/{{ order.id }}
  created_at: string;
}
export interface ConnectShopifyRequest {
  shop_domain: string; // *.myshopify.com
  admin_access_token: string; // shpat_… from a custom app with read_orders, write_orders
  webhook_secret: string; // the app's API secret key (used for X-Shopify-Hmac-Sha256)
  payment_method_name?: string; // name of the manual payment method customers pick
}
export interface ShopifyOrderDTO {
  shopify_order_id: string;
  order_name: string;
  payment_intent_id: string | null;
  intent_status: IntentStatus | null;
  sync_status: "pending" | "marked_paid" | "failed" | "skipped";
  last_error: string | null;
  marked_paid_at: string | null;
  created_at: string;
}

// ───────────── reference storefront (demo) ─────────────
/** POST /api/demo-store/checkout — server-side creates an intent with the demo merchant's API key. */
export interface DemoCheckoutRequest { items: { sku: string; qty: number }[] }
export interface DemoCheckoutResponse { payment_intent_id: string; checkout_url: string; amount_display: string; order_id: string }
