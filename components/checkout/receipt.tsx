"use client";

import { useEffect, useRef } from "react";
import { ArrowUpRight, Check } from "lucide-react";
import type { CheckoutDTO, CheckoutStatusDTO } from "@/lib/api-types";
import { explorerTx } from "@/lib/chain/config";
import { formatMusd } from "@/lib/money";
import { formatDateTime, safeHttpUrl, shortHash } from "@/lib/client/checkout-format";
import { shortAddress } from "@/lib/client/wallet-network";
import { Button } from "@/components/ui/button";

/** Shown ONLY for verified views (CheckoutStatusDTO.verified === true). */
export function Receipt({
  kind,
  checkout,
  status,
  txHash,
  embed,
  onDone,
}: {
  kind: "paid" | "already_paid" | "late_paid";
  checkout: CheckoutDTO;
  status: CheckoutStatusDTO | null;
  txHash: string | null;
  embed: boolean;
  onDone?: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const payment = status?.payment ?? checkout.payment;
  const hash = payment?.transaction_hash ?? txHash;
  const returnUrl = safeHttpUrl(checkout.return_url);
  const refunded = status?.status === "refunded" || status?.status === "partially_refunded";
  const heading = kind === "already_paid" ? "This order is paid" : "Payment received";
  const lead =
    kind === "late_paid"
      ? `Your payment arrived after this checkout closed. ${checkout.merchant.name} has been told and will complete or refund your order.`
      : `${checkout.merchant.name} has your payment. It's confirmed on Mezo Testnet.`;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <span className="flex size-10 items-center justify-center rounded-full bg-brand-soft text-brand-ink" aria-hidden>
          <Check className="size-5" strokeWidth={2.25} />
        </span>
        <h2 ref={headingRef} tabIndex={-1} className="text-xl font-semibold tracking-[-0.01em] outline-none">
          {heading}
        </h2>
        <p className="text-sm text-muted-foreground">{lead}</p>
        {refunded ? (
          <p className="text-sm">
            {status?.status === "refunded" ? "This payment has been refunded." : "Part of this payment has been refunded."}
          </p>
        ) : null}
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2.5 rounded-lg bg-surface p-4 text-sm">
        <dt className="text-muted-foreground">Amount</dt>
        <dd className="num text-right font-medium">{formatMusd(payment?.amount ?? checkout.amount, { decimals: 2 })} MUSD</dd>
        <dt className="text-muted-foreground">Store</dt>
        <dd className="min-w-0 truncate text-right">{checkout.merchant.name}</dd>
        <dt className="text-muted-foreground">Order</dt>
        <dd className="min-w-0 truncate text-right font-mono text-[0.8125rem]">{checkout.merchant_order_id}</dd>
        {payment?.payer_address ? (
          <>
            <dt className="text-muted-foreground">Paid from</dt>
            <dd className="text-right font-mono text-[0.8125rem]">{shortAddress(payment.payer_address)}</dd>
          </>
        ) : null}
        {payment?.paid_at ? (
          <>
            <dt className="text-muted-foreground">Date</dt>
            <dd className="num text-right">{formatDateTime(payment.confirmed_at ?? payment.paid_at)}</dd>
          </>
        ) : null}
        {hash ? (
          <>
            <dt className="text-muted-foreground">Transaction</dt>
            <dd className="text-right">
              <a
                href={payment?.explorer_url || explorerTx(hash)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-mono text-[0.8125rem] underline-offset-4 hover:underline"
              >
                {shortHash(hash)}
                <ArrowUpRight className="size-3.5" aria-hidden />
                <span className="sr-only">(opens the block explorer)</span>
              </a>
            </dd>
          </>
        ) : null}
      </dl>

      {embed ? (
        <Button size="lg" className="w-full" onClick={onDone}>
          Done
        </Button>
      ) : returnUrl ? (
        <Button size="lg" className="w-full" asChild>
          <a href={returnUrl}>Return to {checkout.merchant.name}</a>
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">You can close this page.</p>
      )}
    </div>
  );
}
