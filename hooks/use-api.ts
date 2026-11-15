"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ApiKeyDTO,
  CreatedApiKeyDTO,
  CreatedWebhookEndpointDTO,
  CreateMerchantRequest,
  CreatePaymentIntentRequest,
  CreateRefundRequest,
  CreateWebhookEndpointRequest,
  ConnectShopifyRequest,
  MerchantDTO,
  MerchantOverviewDTO,
  NotificationDTO,
  Paginated,
  PaymentIntentDetailDTO,
  PaymentIntentDTO,
  PublicConfigDTO,
  RefundDTO,
  RegistrationParamsDTO,
  SessionDTO,
  ShopifyConnectionDTO,
  ShopifyOrderDTO,
  UpdateMerchantRequest,
  WebhookDeliveryDTO,
  WebhookEndpointDTO,
} from "@/lib/api-types";
import { api, ApiClientError } from "@/lib/client/api";

/** Accepts T[], Paginated<T> or any { key: T[] } wrapper so list endpoints stay tolerant. */
export function asList<T>(x: unknown): T[] {
  if (Array.isArray(x)) return x as T[];
  if (x && typeof x === "object") {
    const o = x as Record<string, unknown>;
    if (Array.isArray(o.data)) return o.data as T[];
    for (const v of Object.values(o)) if (Array.isArray(v)) return v as T[];
  }
  return [];
}

const nullOn = (...codes: number[]) =>
  async function <T>(p: Promise<T>): Promise<T | null> {
    try {
      return await p;
    } catch (e) {
      if (e instanceof ApiClientError && codes.includes(e.status)) return null;
      throw e;
    }
  };
const nullOnMissing = nullOn(401, 403, 404);

export interface IntentQuery {
  status?: string;
  q?: string;
  page?: number;
}

export const qk = {
  all: ["api"] as const,
  config: ["api", "public-config"] as const,
  session: ["api", "session"] as const,
  merchant: ["api", "merchant", "me"] as const,
  registration: ["api", "merchant", "registration"] as const,
  overview: ["api", "merchant", "overview"] as const,
  intents: (q: IntentQuery) => ["api", "merchant", "intents", q.status ?? "", q.q ?? "", q.page ?? 1] as const,
  intent: (id: string) => ["api", "merchant", "intent", id] as const,
  apiKeys: ["api", "merchant", "api-keys"] as const,
  webhooks: ["api", "merchant", "webhooks"] as const,
  deliveries: (page: number) => ["api", "merchant", "webhook-deliveries", page] as const,
  notifications: ["api", "merchant", "notifications"] as const,
  shopify: ["api", "merchant", "shopify"] as const,
  shopifyOrders: ["api", "merchant", "shopify", "orders"] as const,
};

export function intentQueryString(q: IntentQuery): string {
  const s = new URLSearchParams();
  if (q.status) s.set("status", q.status);
  if (q.q?.trim()) s.set("q", q.q.trim());
  if (q.page && q.page > 1) s.set("page", String(q.page));
  const out = s.toString();
  return out ? `?${out}` : "";
}

// ───────────── queries ─────────────

export function usePublicConfig() {
  return useQuery({ queryKey: qk.config, queryFn: () => api<PublicConfigDTO>("/api/public/config"), staleTime: 5 * 60_000, retry: 1 });
}

export function useSession() {
  return useQuery({ queryKey: qk.session, queryFn: () => nullOnMissing(api<SessionDTO>("/api/auth/session")), staleTime: 60_000 });
}

export function useMerchant(enabled = true) {
  return useQuery({ queryKey: qk.merchant, enabled, queryFn: () => nullOnMissing(api<MerchantDTO>("/api/merchants/me")) });
}

export function useRegistration(enabled = true) {
  return useQuery({
    queryKey: qk.registration,
    enabled,
    queryFn: () => nullOnMissing(api<RegistrationParamsDTO>("/api/merchants/me/registration")),
  });
}

export function useOverview(enabled = true) {
  return useQuery({ queryKey: qk.overview, enabled, queryFn: () => api<MerchantOverviewDTO>("/api/merchant/overview"), refetchInterval: 20_000 });
}

export function useIntents(q: IntentQuery, enabled = true) {
  return useQuery({
    queryKey: qk.intents(q),
    enabled,
    placeholderData: keepPreviousData,
    queryFn: () => api<Paginated<PaymentIntentDTO>>(`/api/merchant/payment-intents${intentQueryString(q)}`),
    refetchInterval: 15_000,
  });
}

export function useIntent(id: string | undefined) {
  return useQuery({
    queryKey: qk.intent(id ?? ""),
    enabled: Boolean(id),
    queryFn: () => api<PaymentIntentDetailDTO>(`/api/merchant/payment-intents/${encodeURIComponent(id!)}`),
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s && ["created", "awaiting_payment", "submitted", "confirming"].includes(s) ? 5_000 : 30_000;
    },
  });
}

export function useApiKeys(enabled = true) {
  return useQuery({ queryKey: qk.apiKeys, enabled, queryFn: async () => asList<ApiKeyDTO>(await api<unknown>("/api/merchant/api-keys")) });
}

export function useWebhooks(enabled = true) {
  return useQuery({ queryKey: qk.webhooks, enabled, queryFn: async () => asList<WebhookEndpointDTO>(await api<unknown>("/api/merchant/webhooks")) });
}

export function useDeliveries(page = 1, enabled = true) {
  return useQuery({
    queryKey: qk.deliveries(page),
    enabled,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const res = await api<unknown>(`/api/merchant/webhook-deliveries${page > 1 ? `?page=${page}` : ""}`);
      const list = asList<WebhookDeliveryDTO>(res);
      const p = res as Partial<Paginated<WebhookDeliveryDTO>>;
      return { data: list, page: p.page ?? page, page_size: p.page_size ?? list.length, total: p.total ?? list.length } satisfies Paginated<WebhookDeliveryDTO>;
    },
    refetchInterval: 15_000,
  });
}

export function useNotifications(enabled = true) {
  return useQuery({
    queryKey: qk.notifications,
    enabled,
    queryFn: async () => asList<NotificationDTO>(await api<unknown>("/api/merchant/notifications")),
    refetchInterval: 30_000,
  });
}

export function useShopify(enabled = true) {
  return useQuery({ queryKey: qk.shopify, enabled, queryFn: () => nullOn(404)(api<ShopifyConnectionDTO | null>("/api/merchant/shopify")) });
}

export function useShopifyOrders(enabled = true) {
  return useQuery({
    queryKey: qk.shopifyOrders,
    enabled,
    queryFn: async () => asList<ShopifyOrderDTO>(await api<unknown>("/api/merchant/shopify/orders")),
    refetchInterval: 30_000,
  });
}

// ───────────── mutations ─────────────

function useInvalidate() {
  const qc = useQueryClient();
  return (...keys: readonly (readonly unknown[])[]) => Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: k })));
}

export function useCreateMerchant() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (body: CreateMerchantRequest) => api<MerchantDTO>("/api/merchants", { method: "POST", json: body }),
    onSuccess: () => inv(qk.merchant, qk.registration, qk.session),
  });
}

export function useUpdateMerchant() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (body: UpdateMerchantRequest) => api<MerchantDTO>("/api/merchants/me", { method: "PATCH", json: body }),
    onSuccess: () => inv(qk.merchant, qk.overview),
  });
}

/** Tell the API about a merchant-management tx (register / setPayout / setSigner / setMerchantActive). */
export function confirmMerchantTx(txHash: string) {
  return api<MerchantDTO>("/api/merchants/me/confirm", { method: "POST", json: { tx_hash: txHash } });
}

export function useCreateIntent() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (body: CreatePaymentIntentRequest) => api<PaymentIntentDTO>("/api/merchant/payment-intents", { method: "POST", json: body }),
    onSuccess: () => inv(["api", "merchant", "intents"], qk.overview),
  });
}

export function useCancelIntent(id: string) {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: () => api<unknown>(`/api/merchant/payment-intents/${encodeURIComponent(id)}/cancel`, { method: "POST", json: {} }),
    onSuccess: () => inv(qk.intent(id), ["api", "merchant", "intents"], qk.overview),
  });
}

export function createRefund(body: CreateRefundRequest) {
  return api<RefundDTO>("/api/merchant/refunds", { method: "POST", json: body });
}
export function refundSubmitted(refundId: string, txHash: string) {
  return api<RefundDTO>(`/api/merchant/refunds/${encodeURIComponent(refundId)}/submitted`, { method: "POST", json: { tx_hash: txHash } });
}

export function useCreateApiKey() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (body: { name: string }) => api<CreatedApiKeyDTO>("/api/merchant/api-keys", { method: "POST", json: body }),
    onSuccess: () => inv(qk.apiKeys, qk.overview),
  });
}

export function useRevokeApiKey() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api<ApiKeyDTO>(`/api/merchant/api-keys/${encodeURIComponent(id)}/revoke`, { method: "POST", json: {} }),
    onSuccess: () => inv(qk.apiKeys, qk.overview),
  });
}

export function useCreateWebhook() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (body: CreateWebhookEndpointRequest) => api<CreatedWebhookEndpointDTO>("/api/merchant/webhooks", { method: "POST", json: body }),
    onSuccess: () => inv(qk.webhooks, qk.overview),
  });
}

export function useDeleteWebhook() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api<unknown>(`/api/merchant/webhooks/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: () => inv(qk.webhooks, qk.overview),
  });
}

export function useTestWebhook() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api<unknown>(`/api/merchant/webhooks/${encodeURIComponent(id)}/test`, { method: "POST", json: {} }),
    onSuccess: () => inv(["api", "merchant", "webhook-deliveries"]),
  });
}

export function useRetryDelivery() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api<unknown>(`/api/merchant/webhook-deliveries/${encodeURIComponent(id)}/retry`, { method: "POST", json: {} }),
    onSuccess: () => inv(["api", "merchant", "webhook-deliveries"]),
  });
}

export function useMarkNotificationsRead() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (ids?: string[]) => api<unknown>("/api/merchant/notifications/read", { method: "POST", json: ids ? { ids } : {} }),
    onSuccess: () => inv(qk.notifications),
  });
}

export function useConnectShopify() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (body: ConnectShopifyRequest) => api<ShopifyConnectionDTO>("/api/merchant/shopify", { method: "POST", json: body }),
    onSuccess: () => inv(qk.shopify, qk.shopifyOrders, qk.overview),
  });
}

export function useDisconnectShopify() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: () => api<unknown>("/api/merchant/shopify", { method: "DELETE" }),
    onSuccess: () => inv(qk.shopify, qk.shopifyOrders, qk.overview),
  });
}
