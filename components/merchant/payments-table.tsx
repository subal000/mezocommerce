"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { PaymentIntentDTO } from "@/lib/api-types";
import { effectiveStatus } from "@/lib/chain/payment-state";
import { formatDateTime, relativeTime, shortAddress } from "@/lib/client/format";
import { StatusBadge } from "@/components/shared/status-badge";
import { MusdDisplay } from "@/components/shared/money";
import { TxLink } from "@/components/shared/address";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const paymentHref = (p: PaymentIntentDTO) => `/merchant/payments/${encodeURIComponent(p.id)}`;

/** Payment intents: a table from md up, a stacked list below. Rows open the detail page. */
export function PaymentsTable({ rows, showTx = false, linkRows = true }: { rows: PaymentIntentDTO[]; showTx?: boolean; linkRows?: boolean }) {
  const router = useRouter();
  return (
    <>
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Customer wallet</TableHead>
              {showTx ? <TableHead>Transaction</TableHead> : null}
              <TableHead className="text-right">Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((p) => (
              <TableRow
                key={p.id}
                className={linkRows ? "cursor-pointer" : undefined}
                onClick={linkRows ? (e) => {
                  if ((e.target as HTMLElement).closest("a,button")) return;
                  router.push(paymentHref(p));
                } : undefined}
              >
                <TableCell className="max-w-56">
                  {linkRows ? (
                    <Link href={paymentHref(p)} className="block truncate font-medium underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none" title={p.merchant_order_id}>
                      {p.merchant_order_id}
                    </Link>
                  ) : (
                    <span className="block truncate font-medium">{p.merchant_order_id}</span>
                  )}
                  {p.description ? <span className="block truncate text-xs text-muted-foreground">{p.description}</span> : null}
                </TableCell>
                <TableCell className="text-right">
                  <MusdDisplay value={p.amount_display} />
                </TableCell>
                <TableCell>
                  <StatusBadge status={effectiveStatus(p.status, p.expires_at)} late={p.late} />
                </TableCell>
                <TableCell className="font-mono text-[0.8125rem] text-muted-foreground" title={p.payment?.payer_address ?? p.payer_address ?? undefined}>
                  {shortAddress(p.payment?.payer_address ?? p.payer_address)}
                </TableCell>
                {showTx ? (
                  <TableCell>
                    <TxLink hash={p.payment?.transaction_hash} />
                  </TableCell>
                ) : null}
                <TableCell className="text-right text-[0.8125rem] whitespace-nowrap text-muted-foreground" title={formatDateTime(p.created_at)}>
                  {relativeTime(p.created_at)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul className="divide-y md:hidden">
        {rows.map((p) => (
          <li key={p.id}>
            <Link href={paymentHref(p)} className="flex items-start justify-between gap-3 py-3 focus-visible:bg-muted focus-visible:outline-none">
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{p.merchant_order_id}</span>
                <span className="mt-1 block">
                  <StatusBadge status={effectiveStatus(p.status, p.expires_at)} late={p.late} />
                </span>
              </span>
              <span className="shrink-0 text-right">
                <MusdDisplay value={p.amount_display} className="text-sm font-medium" />
                <span className="mt-1 block text-xs text-muted-foreground">{relativeTime(p.created_at)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
