"use client";

import { useState } from "react";
import Script from "next/script";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Leaf, Minus, Plus, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import type { DemoCheckoutRequest, DemoCheckoutResponse } from "@/lib/api-types";
import { api, ApiClientError } from "@/lib/client/api";
import { formatMusd, parseMusd } from "@/lib/money";
import { cn } from "@/lib/client/utils";
import { Button } from "@/components/ui/button";
import type { StoreProduct } from "./catalog";
import { getMezoCommerce } from "./widget-types";

type Cart = Record<string, number>;
const MAX_QTY = 9;

export function cartTotalWei(products: readonly StoreProduct[], cart: Cart): bigint {
  return products.reduce((sum, p) => sum + parseMusd(p.price) * BigInt(cart[p.sku] ?? 0), 0n);
}

export function TestnetBanner() {
  return (
    <div className="border-b bg-warn/10 px-4 py-2.5 text-center text-[0.8125rem] text-foreground">
      Demo store on Mezo Testnet. Nothing here is for sale, and payments use test MUSD.{" "}
      <Link href="/" className="font-medium underline underline-offset-4">
        Back to MezoCommerce
      </Link>
    </div>
  );
}

export function StoreHeader({ name, count }: { name: string; count?: number }) {
  return (
    <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-5 sm:px-6">
      <Link href="/demo-store" className="flex items-center gap-2 font-semibold tracking-[-0.01em]">
        <Leaf className="size-5 text-brand" aria-hidden />
        {name}
      </Link>
      {count !== undefined ? (
        <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
          <ShoppingBag className="size-4" aria-hidden />
          <span className="num">{count}</span>
          <span className="sr-only">items in cart</span>
        </span>
      ) : null}
    </header>
  );
}

function Qty({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  return (
    <div className="inline-flex items-center rounded-md border" role="group" aria-label={`Quantity of ${label}`}>
      <button
        type="button"
        className="flex size-8 cursor-pointer items-center justify-center text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        onClick={() => onChange(value - 1)}
        disabled={value <= 0}
        aria-label={`Remove one ${label}`}
      >
        <Minus className="size-3.5" aria-hidden />
      </button>
      <span className="num w-6 text-center text-sm" aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        className="flex size-8 cursor-pointer items-center justify-center text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        onClick={() => onChange(value + 1)}
        disabled={value >= MAX_QTY}
        aria-label={`Add one ${label}`}
      >
        <Plus className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}

export function Storefront({ storeName, products }: { storeName: string; products: readonly StoreProduct[] }) {
  const router = useRouter();
  const [cart, setCart] = useState<Cart>({});
  const [widgetReady, setWidgetReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "warn" | "bad"; text: string } | null>(null);

  const count = Object.values(cart).reduce((a, b) => a + b, 0);
  const total = cartTotalWei(products, cart);
  const lines = products.filter((p) => (cart[p.sku] ?? 0) > 0);

  const setQty = (sku: string, n: number) => setCart((c) => ({ ...c, [sku]: Math.max(0, Math.min(MAX_QTY, n)) }));

  async function checkout() {
    setNotice(null);
    const mc = getMezoCommerce();
    if (!mc) {
      setNotice({ tone: "bad", text: "The checkout script didn't load. Reload the page and try again." });
      return;
    }
    setBusy(true);
    let res: DemoCheckoutResponse;
    try {
      const body: DemoCheckoutRequest = { items: lines.map((p) => ({ sku: p.sku, qty: cart[p.sku] })) };
      res = await api<DemoCheckoutResponse>("/api/demo-store/checkout", { method: "POST", json: body });
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiClientError && err.status === 503) {
        setNotice({
          tone: "warn",
          text: "This demo store isn't connected to a merchant account on this server yet. The operator needs to set DEMO_STORE_API_KEY.",
        });
      } else {
        setNotice({ tone: "bad", text: err instanceof Error ? err.message : "Couldn't start checkout. Try again." });
      }
      return;
    }
    setBusy(false);
    const orderPath = `/demo-store/order/${encodeURIComponent(res.order_id)}`;
    // The real integration path: the same widget a merchant embeds, opened with the intent the server just created.
    mc.checkout({
      paymentId: res.payment_intent_id,
      mode: "modal",
      onSuccess: () => {
        setCart({});
        router.push(orderPath);
      },
      onCancel: () => toast("Checkout closed", { description: "You weren't charged. Your cart is still here." }),
      onExpired: () => toast("Checkout expired", { description: "Start the checkout again to pay." }),
      onError: (e) => setNotice({ tone: "bad", text: e.message }),
    });
  }

  return (
    <>
      <Script src="/checkout.js" strategy="afterInteractive" onReady={() => setWidgetReady(true)} />
      <StoreHeader name={storeName} count={count} />
      <main id="main" className="mx-auto grid w-full max-w-5xl gap-10 px-4 pb-20 sm:px-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-labelledby="shop-title">
          <h1 id="shop-title" className="text-2xl font-semibold tracking-[-0.02em]">
            Small-batch tea
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Prices in MUSD. Pay with a wallet on Mezo Testnet.</p>
          <ul className="mt-8 grid gap-x-6 gap-y-8 sm:grid-cols-2">
            {products.map((p) => {
              const q = cart[p.sku] ?? 0;
              return (
                <li key={p.sku} className="group">
                  <div className="flex aspect-[4/3] items-end rounded-xl p-4" style={{ background: `color-mix(in oklch, ${p.tint} 22%, var(--card))` }} aria-hidden>
                    <span className="size-10 rounded-full" style={{ background: p.tint }} />
                  </div>
                  <div className="mt-3 flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h2 className="font-medium">{p.name}</h2>
                      <p className="text-sm text-muted-foreground">{p.detail}</p>
                    </div>
                    <p className="num shrink-0 font-medium">{formatMusd(parseMusd(p.price))} MUSD</p>
                  </div>
                  <div className="mt-3">
                    {q === 0 ? (
                      <Button variant="outline" size="sm" onClick={() => setQty(p.sku, 1)}>
                        Add to cart
                      </Button>
                    ) : (
                      <Qty value={q} onChange={(n) => setQty(p.sku, n)} label={p.name} />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <aside aria-labelledby="cart-title" className="lg:sticky lg:top-6 lg:self-start">
          <div className="rounded-xl border bg-card p-5 shadow-panel">
            <h2 id="cart-title" className="font-semibold">
              Cart
            </h2>
            {lines.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">Your cart is empty. Add a tea to try a test payment.</p>
            ) : (
              <ul className="mt-4 space-y-2 text-sm">
                {lines.map((p) => (
                  <li key={p.sku} className="flex justify-between gap-4">
                    <span className="min-w-0 truncate">
                      {p.name} <span className="text-muted-foreground">× {cart[p.sku]}</span>
                    </span>
                    <span className="num shrink-0">{formatMusd(parseMusd(p.price) * BigInt(cart[p.sku]))}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 flex items-baseline justify-between border-t pt-4">
              <span className="text-sm text-muted-foreground">Total</span>
              <span className="num text-lg font-semibold">{formatMusd(total)} MUSD</span>
            </div>
            <Button size="lg" className="mt-5 w-full" disabled={lines.length === 0 || busy || !widgetReady} onClick={checkout}>
              {busy ? "Starting checkout…" : "Pay with MUSD"}
            </Button>
            <div aria-live="polite">
              {notice ? (
                <p className={cn("mt-3 text-sm", notice.tone === "bad" ? "text-bad" : "text-foreground")} role={notice.tone === "bad" ? "alert" : undefined}>
                  {notice.text}
                </p>
              ) : null}
            </div>
          </div>
        </aside>
      </main>
    </>
  );
}
