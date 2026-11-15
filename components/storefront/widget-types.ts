/** Types for window.MezoCommerce (public/checkout.js). */
export interface MezoCommerceEvent {
  paymentIntentId: string | null;
  status: string | null;
  txHash?: string | null;
}
export interface MezoCommerceCheckoutOptions {
  paymentId?: string;
  checkoutUrl?: string;
  mode?: "modal" | "redirect" | "inline";
  container?: Element | string;
  onSuccess?: (e: MezoCommerceEvent) => void;
  onCancel?: (e: MezoCommerceEvent) => void;
  onExpired?: (e: MezoCommerceEvent) => void;
  onError?: (err: Error) => void;
  onStatus?: (e: MezoCommerceEvent) => void;
}
export interface MezoCommerceGlobal {
  version: string;
  baseUrl: string;
  checkout(opts: MezoCommerceCheckoutOptions): { close(): void } | null;
  button(
    el: Element | string,
    opts: Omit<MezoCommerceCheckoutOptions, "mode" | "container"> & { createUrl?: string; label?: string; body?: unknown },
  ): { element: Element; destroy(): void };
  isValidId(id: string): boolean;
}

export function getMezoCommerce(): MezoCommerceGlobal | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { MezoCommerce?: MezoCommerceGlobal }).MezoCommerce ?? null;
}
