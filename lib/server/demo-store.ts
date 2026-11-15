// Reference storefront catalog. PURE module (no DB / node imports) so UI code may import it too.
// Prices are fixed MUSD amounts defined server-side; the client only sends SKUs + quantities.
import { DEMO_STORE_PRODUCTS } from "@/components/storefront/catalog";
import { musdToDecimalString, parseMusd } from "@/lib/money";

export interface DemoProduct {
  sku: string;
  name: string;
  /** Decimal MUSD */
  price: string;
}

/** Single source: the storefront's display catalog (components/storefront/catalog.ts, no client-only deps). */
export const DEMO_CATALOG: readonly DemoProduct[] = DEMO_STORE_PRODUCTS;

export const DEMO_MAX_QTY = 10;

export function demoProduct(sku: string): DemoProduct | undefined {
  return DEMO_CATALOG.find((p) => p.sku === sku);
}

export interface DemoLine {
  sku: string;
  name: string;
  qty: number;
  unit_price: string;
  /** decimal MUSD line total */
  amount_display: string;
}

/** Price a cart server-side. Throws on unknown SKU / bad quantity / empty cart. */
export function priceCart(items: { sku: string; qty: number }[]): { lines: DemoLine[]; totalWei: bigint } {
  if (!items.length) throw new Error("Cart is empty");
  const merged = new Map<string, number>();
  for (const it of items) merged.set(it.sku, (merged.get(it.sku) ?? 0) + it.qty);
  let total = 0n;
  const lines: DemoLine[] = [];
  for (const [sku, qty] of merged) {
    const p = demoProduct(sku);
    if (!p) throw new Error(`Unknown product: ${sku}`);
    if (!Number.isInteger(qty) || qty < 1 || qty > DEMO_MAX_QTY) throw new Error(`Quantity for ${sku} must be 1–${DEMO_MAX_QTY}`);
    const unit = parseMusd(p.price);
    const line = unit * BigInt(qty);
    total += line;
    lines.push({ sku, name: p.name, qty, unit_price: p.price, amount_display: musdToDecimalString(line) });
  }
  return { lines, totalWei: total };
}

/** GET /api/demo-store/orders/:id (shape agreed with the storefront page, docs/notes-checkout.md). */
export interface DemoOrderDTO {
  order_id: string;
  payment_intent_id: string;
  amount_display: string;
  items: { sku: string; name: string; qty: number; amount_display: string }[];
  /** payment intent status (effective) */
  status: string;
  /** true only when the intent is settled (verified on-chain + confirmations) */
  verified: boolean;
  transaction_hash: string | null;
  explorer_url: string | null;
  /** a signature-verified payment.confirmed webhook reached the storefront's receiver */
  webhook_received: boolean;
  webhook_event_type: string | null;
  webhook_received_at: string | null;
}
