"use client";

import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { effectiveStatus, isPayable, isSettled } from "@/lib/chain/payment-state";
import { isNotFound } from "@/lib/client/api";
import { formatDateTime, musd, musdDisplay } from "@/lib/client/format";
import { ATTEMPT_STATUS, intentStatusMeta, ONCHAIN_PAYMENT_STATUS, REFUND_STATUS, TONE_CLASS } from "@/lib/client/status";
import { buildTimeline, EVENT_LABEL } from "@/lib/client/timeline";
import { refundableWei } from "@/lib/client/refund";
import { cn } from "@/lib/client/utils";
import { useIntent, usePublicConfig } from "@/hooks/use-api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DetailList, Panel } from "@/components/shared/page-header";
import { QueryError } from "@/components/shared/query-error";
import { EmptyState } from "@/components/shared/empty-state";
import { AddressText, IdText, TxLink } from "@/components/shared/address";
import { CopyButton } from "@/components/shared/copy-button";
import { MusdDisplay } from "@/components/shared/money";
import { StatusBadge, StatusDot } from "@/components/shared/status-badge";
import { useMerchantCtx } from "./merchant-context";
import { CancelDialog } from "./cancel-dialog";
import { RefundDialog } from "./refund-dialog";

function DetailSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading payment">
      <Skeleton className="h-5 w-24" />
      <Skeleton className="h-9 w-72" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Skeleton className="h-80 rounded-xl" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
    </div>
  );
}

const Back = () => (
  <Link href="/merchant/payments" className="inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
    <ArrowLeft className="size-4" aria-hidden /> Payments
  </Link>
);

export function PaymentDetail({ id }: { id: string }) {
  const { merchant, deployed } = useMerchantCtx();
  const cfg = usePublicConfig();
  const q = useIntent(id);

  if (q.isLoading) return <DetailSkeleton />;
  if (q.isError || !q.data) {
    return (
      <div className="space-y-4">
        <Back />
        {isNotFound(q.error) ? (
          <EmptyState title="Payment not found" body="It may belong to another store, or the link is wrong." action={<Button asChild size="sm"><Link href="/merchant/payments">All payments</Link></Button>} />
        ) : (
          <QueryError error={q.error} onRetry={() => void q.refetch()} title="Couldn't load this payment" />
        )}
      </div>
    );
  }

  const p = q.data;
  const status = effectiveStatus(p.status, p.expires_at);
  const meta = intentStatusMeta(status, p.late);
  const left = refundableWei(p.amount, p.amount_refunded);
  const timeline = buildTimeline(p);
  const required = cfg.data?.confirmations;
  const openRefunds = p.refunds.filter((r) => r.status === "requested" && r.tx);

  return (
    <div className="space-y-6">
      <Back />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-[-0.02em]" title={p.merchant_order_id}>
            Order {p.merchant_order_id}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
            <MusdDisplay value={p.amount_display} className="text-lg font-semibold" />
            <StatusBadge status={status} late={p.late} />
            {p.amount_refunded !== "0" ? <span className="text-[0.8125rem] text-muted-foreground">{musdDisplay(p.amount_refunded_display)} MUSD refunded</span> : null}
          </div>
          <p className="mt-1 max-w-[60ch] text-sm text-muted-foreground">{meta.hint}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isPayable(status) ? (
            <>
              <CopyButton value={p.checkout_url} text="Copy checkout link" />
              <CancelDialog intent={p} merchant={merchant} deployed={deployed} trigger={<Button variant="destructive" size="sm">Cancel payment</Button>} />
            </>
          ) : null}
          {isSettled(p.status) && left > 0n ? (
            <RefundDialog intent={p} merchant={merchant} deployed={deployed} trigger={<Button variant="outline" size="sm">Refund</Button>} />
          ) : null}
        </div>
      </div>

      {p.late ? (
        <div role="status" className="rounded-lg border border-warn/40 bg-warn/5 px-4 py-3 text-sm">
          <p className="font-medium">Paid after it was cancelled or expired</p>
          <p className="mt-0.5 text-muted-foreground">The MUSD reached your wallet. Fulfil the order, or refund it.</p>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <Panel title="Timeline">
            <ol className="relative space-y-5 before:absolute before:top-2 before:bottom-2 before:left-[3px] before:w-px before:bg-border">
              {timeline.map((t, i) => (
                <li key={`${t.at}-${i}`} className="relative pl-6">
                  <span aria-hidden className={cn("absolute top-1.5 left-0 size-[7px] rounded-full ring-4 ring-card", TONE_CLASS[t.tone].dot)} />
                  <p className="text-sm font-medium">{t.title}</p>
                  <p className="text-[0.8125rem] text-muted-foreground">
                    <time dateTime={t.at}>{formatDateTime(t.at)}</time>
                    {t.detail ? <> &middot; {t.detail}</> : null}
                  </p>
                  {t.txHash ? <TxLink hash={t.txHash} className="mt-0.5" /> : null}
                </li>
              ))}
            </ol>
          </Panel>

          <Panel title="Payment attempts" description="Transactions the checkout reported. Each one is checked on-chain before it counts." bodyClassName="px-4 py-2 sm:px-5">
            {p.attempts.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Transaction</TableHead>
                    <TableHead>Result</TableHead>
                    <TableHead className="text-right">When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {p.attempts.map((a) => (
                    <TableRow key={a.transaction_hash + a.created_at}>
                      <TableCell>
                        <TxLink hash={a.transaction_hash} copy />
                      </TableCell>
                      <TableCell>
                        <StatusDot meta={ATTEMPT_STATUS[a.status]} />
                        {a.failure_reason ? <span className="block text-xs text-muted-foreground">{a.failure_reason}</span> : null}
                      </TableCell>
                      <TableCell className="text-right text-[0.8125rem] whitespace-nowrap text-muted-foreground">{formatDateTime(a.created_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="py-3 text-sm text-muted-foreground">No attempts yet.</p>
            )}
          </Panel>

          <Panel title="Refunds" bodyClassName="px-4 py-2 sm:px-5">
            {p.refunds.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Transaction</TableHead>
                    <TableHead className="text-right">Started</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {p.refunds.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-right">
                        <MusdDisplay value={r.amount_display} />
                      </TableCell>
                      <TableCell>
                        <StatusDot meta={REFUND_STATUS[r.status]} />
                        {r.reason ? <span className="block max-w-48 truncate text-xs text-muted-foreground" title={r.reason}>{r.reason}</span> : null}
                      </TableCell>
                      <TableCell>
                        {r.transaction_hash ? (
                          <TxLink hash={r.transaction_hash} />
                        ) : openRefunds.includes(r) ? (
                          <RefundDialog intent={p} merchant={merchant} deployed={deployed} resume={r} trigger={<Button size="xs" variant="outline">Send from wallet</Button>} />
                        ) : (
                          <span className="text-muted-foreground">--</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-[0.8125rem] whitespace-nowrap text-muted-foreground">{formatDateTime(r.created_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="py-3 text-sm text-muted-foreground">
                {isSettled(p.status) ? `No refunds. You can refund up to ${musd(left)} MUSD.` : "Refunds open once the payment is confirmed."}
              </p>
            )}
          </Panel>
        </div>

        <div className="min-w-0 space-y-6">
          <Panel title="On-chain">
            <DetailList
              className="sm:grid-cols-1 sm:gap-y-3"
              items={[
                ...(p.payment
                  ? [
                      { label: "Transaction", value: <TxLink hash={p.payment.transaction_hash} copy /> },
                      { label: "Customer wallet", value: <AddressText address={p.payment.payer_address} /> },
                      {
                        label: "Confirmations",
                        value: (
                          <span className="inline-flex items-center gap-3">
                            <span className="num">
                              {p.payment.confirmations}
                              {required ? ` of ${required}` : ""}
                            </span>
                            <StatusDot meta={ONCHAIN_PAYMENT_STATUS[p.payment.status]} />
                          </span>
                        ),
                      },
                      { label: "Block", value: <span className="num">{p.payment.block_number}</span> },
                    ]
                  : []),
                { label: "Paid to", value: <AddressText address={p.payout_address} />, hint: "Your payout wallet when this payment was created." },
                { label: "Payment ID", value: <IdText value={p.payment_id} />, hint: "The ID the contract uses." },
                { label: "Intent", value: <IdText value={p.id} /> },
                { label: "Token", value: <AddressText address={p.token_address} /> },
                ...(p.payer_address ? [{ label: "Locked to wallet", value: <AddressText address={p.payer_address} /> }] : []),
              ]}
            />
            {p.explorer_url ? (
              <a href={p.explorer_url} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1 text-[0.8125rem] font-medium underline-offset-4 hover:underline">
                Open in explorer <ExternalLink className="size-3.5" aria-hidden />
              </a>
            ) : null}
          </Panel>

          <Panel title="Details">
            <DetailList
              className="sm:grid-cols-1 sm:gap-y-3"
              items={[
                { label: "Description", value: p.description || <span className="text-muted-foreground">None</span> },
                { label: "Source", value: p.source },
                { label: "Created", value: formatDateTime(p.created_at) },
                { label: "Expires", value: formatDateTime(p.expires_at) },
                {
                  label: "Checkout link",
                  value: (
                    <span className="inline-flex max-w-full items-center gap-0.5">
                      <a href={p.checkout_url} target="_blank" rel="noreferrer" className="truncate text-[0.8125rem] underline-offset-4 hover:underline" title={p.checkout_url}>
                        {p.checkout_url}
                      </a>
                      <CopyButton value={p.checkout_url} label="Copy checkout link" />
                    </span>
                  ),
                },
                ...(p.return_url ? [{ label: "Return link", value: <span className="text-[0.8125rem] break-all">{p.return_url}</span> }] : []),
              ]}
            />
            {Object.keys(p.metadata).length ? (
              <div className="mt-4 border-t pt-4">
                <p className="text-[0.8125rem] font-medium">Metadata</p>
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-xs">
                  {Object.entries(p.metadata).map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-muted-foreground">{k}</dt>
                      <dd className="break-all">{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : null}
          </Panel>

          <Panel title="Webhook events" description="Sent to your endpoints for this payment.">
            {p.events.length ? (
              <ul className="space-y-2 text-sm">
                {p.events.map((e, i) => (
                  <li key={`${e.type}-${i}`} className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block font-mono text-[0.8125rem]">{e.type}</span>
                      <span className="block text-xs text-muted-foreground">{EVENT_LABEL[e.type] ?? ""}</span>
                    </span>
                    <time dateTime={e.created_at} className="shrink-0 text-xs text-muted-foreground">
                      {formatDateTime(e.created_at)}
                    </time>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No events yet.</p>
            )}
            <Link href="/merchant/developers/webhooks#deliveries" className="mt-3 inline-block text-[0.8125rem] font-medium underline-offset-4 hover:underline">
              Delivery log
            </Link>
          </Panel>
        </div>
      </div>
    </div>
  );
}
