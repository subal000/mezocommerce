/**
 * Display catalog for the reference storefront (/demo-store).
 * The SERVER is authoritative for prices: POST /api/demo-store/checkout receives only SKUs + quantities, and the
 * checkout shows the amount from the signed intent. Backend: lib/server/demo-store.ts should use these SKUs and prices
 * (import this constant, it has no client-only dependencies) so the cart total matches the checkout amount.
 */
export interface StoreProduct {
  sku: string;
  name: string;
  detail: string;
  /** decimal MUSD */
  price: string;
  /** swatch colour for the product tile (no stock photos in a fictional store) */
  tint: string;
}

export const STORE_NAME = "Larkspur Tea Co.";

export const DEMO_STORE_PRODUCTS: readonly StoreProduct[] = [
  { sku: "tea-hojicha", name: "Roasted hojicha", detail: "Loose leaf, 50 g. Toasty, low caffeine.", price: "6", tint: "#8a5a3c" },
  { sku: "tea-sencha", name: "Spring sencha", detail: "Loose leaf, 50 g. Bright and grassy.", price: "8.5", tint: "#6f8f3a" },
  { sku: "tea-oolong", name: "High mountain oolong", detail: "Rolled leaf, 40 g. Floral, resteeps well.", price: "12", tint: "#b08a2e" },
  { sku: "kit-brew", name: "Glass brewing kit", detail: "500 ml pot with a steel strainer.", price: "24", tint: "#4f6b78" },
];
