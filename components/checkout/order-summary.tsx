"use client";

import type { CheckoutDTO } from "@/lib/api-types";
import { isPayable } from "@/lib/chain/payment-state";
import { formatMusd } from "@/lib/money";
import { formatRemaining, hostOf, merchantAccent, safeHttpUrl } from "@/lib/client/checkout-format";
import { cn } from "@/lib/client/utils";

export function MerchantMark({ merchant, size = 36 }: { merchant: CheckoutDTO["merchant"]; size?: number }) {
  const logo = safeHttpUrl(merchant.logo_url);
  const accent = merchantAccent(merchant.brand_color);
  if (logo) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={logo} alt="" width={size} height={size} className="shrink-0 rounded-lg border bg-card object-cover" style={{ width: size, height: size }} />
    );
  }
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-lg bg-primary font-semibold text-primary-foreground"
      style={{ width: size, height: size, fontSize: size * 0.42, ...(accent ? { background: accent.bg, color: accent.fg } : {}) }}
    >
      {merchant.name.trim().charAt(0).toUpperCase() || "M"}
    </span>
  );
}

export function Countdown({ expiresAt, now }: { expiresAt: string; now: number }) {
  const left = new Date(expiresAt).getTime() - now;
  if (left <= 0) return <span>Expired</span>;
  const soon = left < 2 * 60_000;
  return (
    <span className={cn("num", soon && "font-medium text-warn")} aria-live="off">
      {formatRemaining(left)}
    </span>
  );
}

/** Left column (or top block on mobile / in embeds): who you're paying, how much, for what. */
export function OrderSummary({ checkout, now, compact = false }: { checkout: CheckoutDTO; now: number; compact?: boolean }) {
  const site = hostOf(checkout.merchant.website);
  const amount = formatMusd(checkout.amount, { decimals: 2 });
  const showTimer = isPayable(checkout.status) && !!checkout.intent;

  return (
    <section aria-labelledby="order-summary-title" className={cn(compact ? "space-y-4" : "space-y-8")}>
      <div className="flex items-center gap-3">
        <MerchantMark merchant={checkout.merchant} size={compact ? 32 : 36} />
        <div className="min-w-0">
          <p className="truncate font-medium" id="order-summary-title">
            {checkout.merchant.name}
          </p>
          {site ? <p className="truncate text-[0.8125rem] text-muted-foreground">{site}</p> : null}
        </div>
      </div>

      <div>
        <p className="text-sm text-muted-foreground">{compact ? "Total" : `Pay ${checkout.merchant.name}`}</p>
        <p className={cn("num mt-1 font-semibold tracking-[-0.02em]", compact ? "text-3xl" : "text-4xl sm:text-[2.75rem] sm:leading-tight")}>
          {amount}
          <span className="ml-2 text-[0.55em] font-medium tracking-normal text-muted-foreground">MUSD</span>
        </p>
        {checkout.description ? (
          <p className={cn("mt-3 max-w-[48ch] text-[0.9375rem] text-foreground/85", compact && "mt-2 line-clamp-2 text-sm")}>{checkout.description}</p>
        ) : null}
      </div>

      <dl className={cn("grid grid-cols-[auto_1fr] gap-x-6 gap-y-2.5 text-sm", !compact && "border-t pt-6")}>
        <dt className="text-muted-foreground">Order</dt>
        <dd className="min-w-0 truncate text-right font-mono text-[0.8125rem] sm:text-left">{checkout.merchant_order_id}</dd>
        <dt className="text-muted-foreground">Network</dt>
        <dd className="text-right sm:text-left">{checkout.network.name || "Mezo Testnet"}</dd>
        {showTimer ? (
          <>
            <dt className="text-muted-foreground">Expires in</dt>
            <dd className="text-right sm:text-left">
              <Countdown expiresAt={checkout.expires_at} now={now} />
            </dd>
          </>
        ) : null}
      </dl>
    </section>
  );
}
