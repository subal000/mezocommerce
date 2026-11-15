import type {
  ApiError,
  CreatedWebhookEndpointDTO,
  HealthResponse,
  Paginated,
  PaymentDTO,
  PaymentIntentDTO,
  RefundDTO,
  WebhookEndpointDTO,
  WebhookPayload,
} from "@/lib/api-types";
import { SITE } from "@/lib/client/site";

/** Example values for the docs only. Every object is type-checked against the frozen wire types. */
const APP = SITE.url;
const PAYMENT_ID = "0x7d1c4a9e2b06f53d8a41c0e9b7f2a6d3c58e019b4f7a2c6d1e8b3a05c9f4d2e7";
const PAYOUT = "0x4b2e9a7c51d08f3e6a9b0c2d7e14f5a8c3b6d901";
const PAYER = "0x9f31c6e2a8b04d75e1c3a6f9028b7d4e5a1c6b38";
const MUSD = "0x118917a40faf1cd7a13db0ef56c86de7973ac503";
const TX = "0x3e8a1f6c09b27d4e5a8c1b3f6d02e9a7c4b8f15e3d6a0c2b9e7f4a1d8c5b3e06";

export const samplePayment = {
  id: "pay_2fK9wQm4Lr8xT1",
  object: "payment",
  payment_intent_id: "pi_3Nq8vR2kX7mB5c",
  payment_id: PAYMENT_ID,
  payer_address: PAYER,
  payout_address: PAYOUT,
  token_address: MUSD,
  amount: "24500000000000000000",
  amount_display: "24.5",
  transaction_hash: TX,
  block_number: "16712408",
  confirmations: 2,
  status: "confirmed",
  explorer_url: `https://explorer.test.mezo.org/tx/${TX}`,
  paid_at: "2026-11-10T14:21:37.000Z",
  confirmed_at: "2026-11-10T14:21:49.000Z",
} satisfies PaymentDTO;

export const sampleIntentCreated = {
  id: "pi_3Nq8vR2kX7mB5c",
  object: "payment_intent",
  payment_id: PAYMENT_ID,
  merchant_id: "mer_7Hd2pL9sQ4",
  merchant_order_id: "order_1042",
  description: "2x Field notebook, 1x Brass pen",
  amount: "24500000000000000000",
  amount_display: "24.5",
  currency: "MUSD",
  token_address: MUSD,
  payout_address: PAYOUT,
  payer_address: null,
  status: "created",
  late: false,
  checkout_url: `${APP}/checkout/pi_3Nq8vR2kX7mB5c`,
  return_url: "https://shop.example.com/orders/1042/thanks",
  cancel_url: "https://shop.example.com/cart",
  metadata: { customer_email: "rhea@example.com" },
  source: "api",
  expires_at: "2026-11-10T14:49:02.000Z",
  amount_refunded: "0",
  amount_refunded_display: "0",
  payment: null,
  created_at: "2026-11-10T14:19:02.000Z",
  updated_at: "2026-11-10T14:19:02.000Z",
} satisfies PaymentIntentDTO;

export const sampleIntentPaid = {
  ...sampleIntentCreated,
  status: "paid",
  payment: samplePayment,
  updated_at: "2026-11-10T14:21:49.000Z",
} satisfies PaymentIntentDTO;

export const sampleIntentCancelled = {
  ...sampleIntentCreated,
  status: "cancelled",
  updated_at: "2026-11-10T14:25:11.000Z",
} satisfies PaymentIntentDTO;

export const sampleIntentList = {
  data: [sampleIntentPaid],
  page: 1,
  page_size: 20,
  total: 1,
} satisfies Paginated<PaymentIntentDTO>;

export const samplePaymentList = {
  data: [samplePayment],
  page: 1,
  page_size: 20,
  total: 1,
} satisfies Paginated<PaymentDTO>;

export const sampleRefund = {
  id: "re_8Tg3nV6cJ1",
  object: "refund",
  payment_intent_id: "pi_3Nq8vR2kX7mB5c",
  amount: "10000000000000000000",
  amount_display: "10",
  reason: "One item out of stock",
  status: "requested",
  transaction_hash: null,
  explorer_url: null,
  from_address: null,
  total_refunded: null,
  created_at: "2026-11-10T15:02:40.000Z",
  confirmed_at: null,
  tx: {
    approve: { to: MUSD, data: "0x095ea7b3000000000000000000000000…0000000000008ac7230489e80000" },
    refund: { to: "<processor_address>", data: "0x<refund(paymentId, amount) calldata>" },
  },
} satisfies RefundDTO;

export const sampleRefundConfirmed = {
  ...sampleRefund,
  status: "confirmed",
  transaction_hash: "0x91b0e4c7a2d65f38e1a9c0b4d7f2e6a3c8b15d9e0f4a7c2b6e3d8a1f5c09b7e4",
  explorer_url: "https://explorer.test.mezo.org/tx/0x91b0e4c7a2d65f38e1a9c0b4d7f2e6a3c8b15d9e0f4a7c2b6e3d8a1f5c09b7e4",
  from_address: PAYOUT,
  total_refunded: "10000000000000000000",
  confirmed_at: "2026-11-10T15:04:12.000Z",
  tx: null,
} satisfies RefundDTO;

export const sampleWebhook = {
  id: "we_5Rk2mP8dQ3",
  url: "https://shop.example.com/webhooks/mezocommerce",
  event_types: ["payment.confirmed", "payment.refunded"],
  status: "active",
  created_at: "2026-11-09T10:12:00.000Z",
} satisfies WebhookEndpointDTO;

export const sampleWebhookCreated = {
  ...sampleWebhook,
  secret: "whsec_4f9a…shown once",
} satisfies CreatedWebhookEndpointDTO;

export const sampleHealth = {
  ok: true,
  chain_id: 31611,
  block_number: "16712455",
  db: "postgres",
  db_ok: true,
  deployed: true,
  indexer: { last_block: "16712453", lag_blocks: 2, updated_at: "2026-11-10T14:22:05.000Z" },
  worker: { last_run_at: "2026-11-10T14:22:04.000Z", healthy: true },
} satisfies HealthResponse;

export const sampleError = {
  error: {
    code: "order_has_open_intent",
    message: "Order order_1042 already has an open payment intent",
    details: { payment_intent: { id: "pi_3Nq8vR2kX7mB5c", status: "awaiting_payment" } },
  },
} satisfies ApiError;

export const sampleWebhookPayload = {
  id: "evt_6Wb1sF4hK9",
  object: "event",
  type: "payment.confirmed",
  created_at: "2026-11-10T14:21:50.000Z",
  livemode: false,
  data: { payment_intent: sampleIntentPaid },
} satisfies WebhookPayload;

export const json = (v: unknown) => JSON.stringify(v, null, 2);
