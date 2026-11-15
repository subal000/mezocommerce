"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight } from "lucide-react";
import { explorerTx } from "@/lib/chain/config";
import { isSettled, type IntentStatus, INTENT_STATUSES } from "@/lib/chain/payment-state";
import { api, ApiClientError, errorMessage, isNotFound } from "@/lib/client/api";
import { formatDateTime, shortHash } from "@/lib/client/checkout-format";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusDot, type StatusTone } from "@/components/checkout/status-dot";

/**
 * Shape this page reads from GET /api/demo-store/orders/:id (backend-owned route; not in lib/api-types.ts).
 * Every field is read defensively so a missing field degrades to "waiting" instead of a false "verified".
 */
export interface DemoOrderDTO {
  order_id: string;
  payment_intent_id?: string;
  checkout_url?: string;
  amount_display?: string;
  items?: { sku: string; name?: string; qty: number; amount_display?: string }[];
  status?: IntentStatus;
  /** true only when the intent is paid per the verified on-chain record */
  verified?: boolean;
  transaction_hash?: string | null;
  explorer_url?: string | null;
  webhook_received?: boolean;
  webhook_event_type?: string | null;
  webhook_received_at?: string | null;
  created_at?: string;
}

export function isOrderVerified(o: Pick<DemoOrderDTO, "verified" | "status"> | null | undefined): boolean {
  if (!o) return false;
  if (typeof o.verified === "boolean") return o.verified;
  return !!o.status && (INTENT_STATUSES as readonly string[]).includes(o.status) && isSettled(o.status);
}

function payTone(o: DemoOrderDTO): { tone: StatusTone; label: string; text: string } {
  if (isOrderVerified(o)) return { tone: "ok", label: "Payment verified on-chain", text: "The payment is on Mezo Testnet with enough confirmations." };
  switch (o.status) {
    case "confirming":
    case "submitted":
      return { tone: "info", label: "Confirming payment", text: "The payment is on its way. This usually takes under a minute." };
    case "expired":
      return { tone: "idle", label: "Checkout expired", text: "No payment was taken." };
    case "cancelled":
      return { tone: "idle", label: "Checkout cancelled", text: "No payment was taken." };
    default:
      return { tone: "idle", label: "Waiting for payment", text: "We haven't seen a payment for this order yet." };
  }
}

export function OrderStatus({ orderId }: { orderId: string }) {
  const q = useQuery({
    queryKey: ["demo-store-order", orderId],
    queryFn: () => api<DemoOrderDTO>(`/api/demo-store/orders/${encodeURIComponent(orderId)}`),
    refetchInterval: (query) => {
      const d = query.state.data;
      if (query.state.error && isNotFound(query.state.error)) return false;
      if (d && isOrderVerified(d) && d.webhook_received) return false;
      return 3_000;
    },
  });

  if (q.isPending) {
    return (
      <div className="space-y-3" aria-busy="true">
        <span className="sr-only">Loading order…</span>
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (q.isError) {
    const unconfigured = q.error instanceof ApiClientError && q.error.status === 503;
    return (
      <div className="space-y-3" role="alert">
        <h1 className="text-xl font-semibold">{isNotFound(q.error) ? "Order not found" : unconfigured ? "Demo store not set up" : "Couldn't load this order"}</h1>
        <p className="text-sm text-muted-foreground">
          {isNotFound(q.error)
            ? "Check the link, or start a new order."
            : unconfigured
              ? "This demo store isn't connected to a merchant account on this server yet."
              : errorMessage(q.error)}
        </p>
        <Button variant="outline" asChild>
          <Link href="/demo-store">Back to the store</Link>
        </Button>
      </div>
    );
  }

  const o = q.data;
  const pay = payTone(o);
  const hook = o.webhook_received;
  const tx = o.transaction_hash;

  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm text-muted-foreground">
          Order <span className="font-mono">{o.order_id}</span>
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-[-0.02em]">{isOrderVerified(o) ? "Thanks for your order" : "Your order"}</h1>
      </div>

      <ol className="space-y-5" aria-live="polite">
        <li className="space-y-1">
          <StatusDot tone={pay.tone}>{pay.label}</StatusDot>
          <p className="pl-4 text-sm text-muted-foreground">{pay.text}</p>
          {tx ? (
            <p className="pl-4 text-sm">
              <a
                href={o.explorer_url || explorerTx(tx)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-mono text-[0.8125rem] underline-offset-4 hover:underline"
              >
                {shortHash(tx)} <ArrowUpRight className="size-3.5" aria-hidden />
                <span className="sr-only">(opens the block explorer)</span>
              </a>
            </p>
          ) : null}
        </li>
        <li className="space-y-1">
          <StatusDot tone={hook ? "ok" : "idle"}>{hook ? "Webhook received" : "Waiting for webhook"}</StatusDot>
          <p className="pl-4 text-sm text-muted-foreground">
            {hook
              ? `The store's server got a signed ${o.webhook_event_type ?? "payment.confirmed"} event${o.webhook_received_at ? ` at ${formatDateTime(o.webhook_received_at)}` : ""} and confirmed the order.`
              : "The store's server confirms the order when MezoCommerce sends it a signed webhook."}
          </p>
        </li>
      </ol>

      {o.items?.length ? (
        <div className="rounded-xl border bg-card p-5">
          <ul className="space-y-2 text-sm">
            {o.items.map((it) => (
              <li key={it.sku} className="flex justify-between gap-4">
                <span>
                  {it.name ?? it.sku} <span className="text-muted-foreground">× {it.qty}</span>
                </span>
                {it.amount_display ? <span className="num">{it.amount_display}</span> : null}
              </li>
            ))}
          </ul>
          {o.amount_display ? (
            <div className="mt-4 flex items-baseline justify-between border-t pt-4">
              <span className="text-sm text-muted-foreground">Total</span>
              <span className="num font-semibold">{o.amount_display} MUSD</span>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        {!isOrderVerified(o) && o.payment_intent_id && (o.status === "created" || o.status === "awaiting_payment") ? (
          <Button asChild>
            <Link href={`/checkout/${encodeURIComponent(o.payment_intent_id)}`}>Go to checkout</Link>
          </Button>
        ) : null}
        <Button variant="outline" asChild>
          <Link href="/demo-store">Back to the store</Link>
        </Button>
      </div>
    </div>
  );
}
