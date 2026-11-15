import { SITE } from "@/lib/client/site";
import { INTENT_LIMITS } from "@/lib/chain/config";
import {
  json,
  sampleHealth,
  sampleIntentCancelled,
  sampleIntentCreated,
  sampleIntentList,
  sampleIntentPaid,
  samplePayment,
  samplePaymentList,
  sampleRefund,
  sampleRefundConfirmed,
  sampleWebhook,
  sampleWebhookCreated,
} from "./samples";

/** Public v1 API (docs/ARCHITECTURE.md). Request fields mirror lib/api-types.ts. */
export interface Field {
  name: string;
  type: string;
  required?: boolean;
  description: string;
}

export interface Endpoint {
  id: string;
  group: "Payment intents" | "Payments" | "Refunds" | "Webhooks" | "Health";
  method: "GET" | "POST" | "DELETE";
  path: string;
  title: string;
  purpose: string;
  auth: boolean;
  params?: Field[];
  body?: Field[];
  curl: string;
  status: number;
  response: string;
}

const BASE = SITE.url;
const KEY = "mc_test_sk_...";
const auth = `-H "Authorization: Bearer ${KEY}"`;

const ttlMin = INTENT_LIMITS.MIN_TTL_SECONDS;
const ttlMax = INTENT_LIMITS.MAX_TTL_SECONDS;
const ttlDefault = INTENT_LIMITS.DEFAULT_TTL_SECONDS;

export const ENDPOINTS: Endpoint[] = [
  {
    id: "create-intent",
    group: "Payment intents",
    method: "POST",
    path: "/api/v1/payment-intents",
    title: "Create a payment intent",
    purpose:
      "Creates one payment for one order and returns its checkout_url. If the order already has an open intent you get 409 order_has_open_intent with the existing intent in error.details.",
    auth: true,
    body: [
      { name: "merchant_order_id", type: "string", required: true, description: "Your order id. 1 to 128 characters: letters, digits and _ - # : . /" },
      { name: "amount", type: "string", required: true, description: 'Decimal MUSD, for example "10" or "10.50". From 0.01 to 1,000,000 MUSD, up to 18 decimals.' },
      { name: "currency", type: '"MUSD"', description: "Optional. Only MUSD is accepted." },
      { name: "description", type: "string", description: "Shown at checkout. Up to 500 characters." },
      { name: "return_url", type: "string | null", description: "Where checkout sends the customer after paying. https only (http allowed for localhost)." },
      { name: "cancel_url", type: "string | null", description: "Where checkout sends the customer if they leave." },
      { name: "expires_in_seconds", type: "number", description: `Payment window. ${ttlMin / 60} minutes to ${ttlMax / 86400} days. Default ${ttlDefault / 60} minutes.` },
      { name: "payer_address", type: "string | null", description: "Lock the payment to one wallet. Leave empty to let any wallet pay." },
      { name: "metadata", type: "Record<string, string>", description: "Up to 20 keys. Keys up to 40 characters, values up to 500." },
    ],
    curl: `curl -X POST ${BASE}/api/v1/payment-intents \\
  ${auth} \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: order_1042-attempt-1" \\
  -d '{
    "merchant_order_id": "order_1042",
    "amount": "24.50",
    "description": "2x Field notebook, 1x Brass pen",
    "return_url": "https://shop.example.com/orders/1042/thanks",
    "cancel_url": "https://shop.example.com/cart",
    "metadata": { "customer_email": "rhea@example.com" }
  }'`,
    status: 201,
    response: json(sampleIntentCreated),
  },
  {
    id: "list-intents",
    group: "Payment intents",
    method: "GET",
    path: "/api/v1/payment-intents",
    title: "List payment intents",
    purpose: "Your payment intents, newest first, 20 per page.",
    auth: true,
    params: [
      { name: "status", type: "IntentStatus", description: "Only intents in this status, for example paid or awaiting_payment." },
      { name: "page", type: "number", description: "Page number, starting at 1." },
    ],
    curl: `curl "${BASE}/api/v1/payment-intents?status=paid&page=1" \\
  ${auth}`,
    status: 200,
    response: json(sampleIntentList),
  },
  {
    id: "get-intent",
    group: "Payment intents",
    method: "GET",
    path: "/api/v1/payment-intents/:id",
    title: "Retrieve a payment intent",
    purpose: "Read one intent by its pi_ id or its on-chain payment_id. payment is filled in once the payment is seen on-chain.",
    auth: true,
    params: [{ name: "id", type: "string", required: true, description: "pi_ id or 0x payment_id." }],
    curl: `curl ${BASE}/api/v1/payment-intents/pi_3Nq8vR2kX7mB5c \\
  ${auth}`,
    status: 200,
    response: json(sampleIntentPaid),
  },
  {
    id: "cancel-intent",
    group: "Payment intents",
    method: "POST",
    path: "/api/v1/payment-intents/:id/cancel",
    title: "Cancel a payment intent",
    purpose:
      "Stops checkout from offering this payment right away. If the customer may already hold the signed checkout, also cancel it on-chain from your owner wallet (cancelPayment). The dashboard does both.",
    auth: true,
    params: [{ name: "id", type: "string", required: true, description: "pi_ id or payment_id. Only created, awaiting_payment or submitted intents can be cancelled." }],
    curl: `curl -X POST ${BASE}/api/v1/payment-intents/pi_3Nq8vR2kX7mB5c/cancel \\
  ${auth} \\
  -H "Idempotency-Key: cancel-order_1042"`,
    status: 200,
    response: json(sampleIntentCancelled),
  },
  {
    id: "get-payment",
    group: "Payments",
    method: "GET",
    path: "/api/v1/payments/:id",
    title: "Retrieve a verified payment",
    purpose: "The on-chain payment behind an intent. Look it up by payment id, pi_ id or payment_id. Only payments checked against the chain are returned.",
    auth: true,
    params: [{ name: "id", type: "string", required: true, description: "pay_ id, pi_ id or payment_id." }],
    curl: `curl ${BASE}/api/v1/payments/pi_3Nq8vR2kX7mB5c \\
  ${auth}`,
    status: 200,
    response: json(samplePayment),
  },
  {
    id: "list-merchant-payments",
    group: "Payments",
    method: "GET",
    path: "/api/v1/merchants/:id/payments",
    title: "List a merchant's payments",
    purpose: "Verified payments for your merchant. The id must be the merchant your API key belongs to, otherwise 403.",
    auth: true,
    params: [
      { name: "id", type: "string", required: true, description: "Your merchant id." },
      { name: "page", type: "number", description: "Page number, starting at 1." },
    ],
    curl: `curl "${BASE}/api/v1/merchants/mer_7Hd2pL9sQ4/payments?page=1" \\
  ${auth}`,
    status: 200,
    response: json(samplePaymentList),
  },
  {
    id: "create-refund",
    group: "Refunds",
    method: "POST",
    path: "/api/v1/refunds",
    title: "Create a refund",
    purpose:
      "Records a refund request and returns the two calls your merchant wallet must send: approve the exact amount, then refund. Nothing moves until your owner or payout wallet signs. The contract caps refunds at the original amount.",
    auth: true,
    body: [
      { name: "payment_intent_id", type: "string", required: true, description: "The paid intent to refund." },
      { name: "amount", type: "string", required: true, description: "Decimal MUSD. At most the amount paid minus what was already refunded." },
      { name: "reason", type: "string", description: "Kept with the refund for your records." },
    ],
    curl: `curl -X POST ${BASE}/api/v1/refunds \\
  ${auth} \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: refund-order_1042-1" \\
  -d '{ "payment_intent_id": "pi_3Nq8vR2kX7mB5c", "amount": "10", "reason": "One item out of stock" }'`,
    status: 201,
    response: json(sampleRefund),
  },
  {
    id: "get-refund",
    group: "Refunds",
    method: "GET",
    path: "/api/v1/refunds/:id",
    title: "Retrieve a refund",
    purpose: "Status of one refund. It becomes confirmed once the RefundCompleted event is verified on-chain.",
    auth: true,
    params: [{ name: "id", type: "string", required: true, description: "re_ id." }],
    curl: `curl ${BASE}/api/v1/refunds/re_8Tg3nV6cJ1 \\
  ${auth}`,
    status: 200,
    response: json(sampleRefundConfirmed),
  },
  {
    id: "list-webhooks",
    group: "Webhooks",
    method: "GET",
    path: "/api/v1/webhooks",
    title: "List webhook endpoints",
    purpose: "Every endpoint that receives your events. Secrets are never returned here.",
    auth: true,
    curl: `curl ${BASE}/api/v1/webhooks \\
  ${auth}`,
    status: 200,
    response: json([sampleWebhook]),
  },
  {
    id: "create-webhook",
    group: "Webhooks",
    method: "POST",
    path: "/api/v1/webhooks",
    title: "Create a webhook endpoint",
    purpose: "Adds an https endpoint. The response holds the signing secret. It is shown only this once, so store it right away.",
    auth: true,
    body: [
      { name: "url", type: "string", required: true, description: "Public https URL. Private and local addresses are refused." },
      { name: "event_types", type: '(WebhookEventType | "*")[]', description: 'Events to send. Default ["*"] (all).' },
    ],
    curl: `curl -X POST ${BASE}/api/v1/webhooks \\
  ${auth} \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: webhook-setup-1" \\
  -d '{ "url": "https://shop.example.com/webhooks/mezocommerce", "event_types": ["payment.confirmed", "payment.refunded"] }'`,
    status: 201,
    response: json(sampleWebhookCreated),
  },
  {
    id: "delete-webhook",
    group: "Webhooks",
    method: "DELETE",
    path: "/api/v1/webhooks/:id",
    title: "Delete a webhook endpoint",
    purpose: "Stops deliveries to this endpoint. Pending retries are dropped.",
    auth: true,
    params: [{ name: "id", type: "string", required: true, description: "we_ id." }],
    curl: `curl -X DELETE ${BASE}/api/v1/webhooks/we_5Rk2mP8dQ3 \\
  ${auth}`,
    status: 200,
    response: json({ id: "we_5Rk2mP8dQ3", deleted: true }),
  },
  {
    id: "health",
    group: "Health",
    method: "GET",
    path: "/api/v1/health",
    title: "Health",
    purpose: "No key needed. Shows the chain, database, indexer lag and worker status.",
    auth: false,
    curl: `curl ${BASE}/api/v1/health`,
    status: 200,
    response: json(sampleHealth),
  },
];

export const ENDPOINT_GROUPS = ["Payment intents", "Payments", "Refunds", "Webhooks", "Health"] as const;

export const ERROR_CODES: { status: number; code: string; meaning: string }[] = [
  { status: 400, code: "validation_error", meaning: "A field is missing or has the wrong shape. message says which one." },
  { status: 400, code: "bad_request", meaning: "The body isn't valid JSON, or the request can't be read." },
  { status: 401, code: "unauthorized", meaning: "No API key, or the key is wrong or revoked." },
  { status: 403, code: "forbidden", meaning: "The key belongs to a different merchant than the one in the path." },
  { status: 403, code: "insufficient_permissions", meaning: "The key doesn't have permission for this endpoint." },
  { status: 404, code: "not_found", meaning: "No such object for your merchant." },
  { status: 409, code: "order_has_open_intent", meaning: "This order already has an open intent. details holds it, so you can reuse its checkout_url." },
  { status: 409, code: "conflict", meaning: "The object can't change from its current status, for example cancelling a paid intent." },
  { status: 409, code: "idempotency_in_progress", meaning: "A request with this Idempotency-Key is still running. Retry shortly." },
  { status: 409, code: "idempotency_key_reused", meaning: "This Idempotency-Key was used with a different body. Use a new key." },
  { status: 429, code: "rate_limited", meaning: "Too many requests. Wait and retry." },
  { status: 500, code: "internal", meaning: "Something failed on our side. Safe to retry with the same Idempotency-Key." },
];
