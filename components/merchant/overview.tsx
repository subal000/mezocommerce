"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { useOverview } from "@/hooks/use-api";
import { musdDisplay, percent, pluralize } from "@/lib/client/format";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader, Panel } from "@/components/shared/page-header";
import { QueryError } from "@/components/shared/query-error";
import { EmptyState } from "@/components/shared/empty-state";
import { useMerchantCtx } from "./merchant-context";
import { RevenueChart } from "./revenue-chart";
import { PaymentsTable } from "./payments-table";
import { IntegrationChecklist } from "./integration-checklist";

function Figure({ label, value, unit, hint }: { label: string; value: string; unit?: string; hint?: string }) {
  return (
    <div className="min-w-0 px-4 py-4 sm:px-5">
      <dt className="text-[0.8125rem] text-muted-foreground">{label}</dt>
      <dd className="num mt-1 text-xl font-semibold tracking-[-0.01em]">
        {value}
        {unit ? <span className="ml-1 text-sm font-normal text-muted-foreground">{unit}</span> : null}
      </dd>
      {hint ? <dd className="mt-0.5 text-xs text-muted-foreground">{hint}</dd> : null}
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading overview">
      <Skeleton className="h-24 w-full rounded-xl" />
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Skeleton className="h-72 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}

export function Overview() {
  const { merchant } = useMerchantCtx();
  const q = useOverview();
  const header = (
    <PageHeader
      title={`Hi, ${merchant.name}`}
      description="Payments verified on-chain. Amounts in MUSD."
      actions={
        <Button asChild>
          <Link href="/merchant/payments/new">
            <Plus aria-hidden /> Create payment
          </Link>
        </Button>
      }
    />
  );
  if (q.isLoading) return (<>{header}<OverviewSkeleton /></>);
  if (q.isError || !q.data) return (<>{header}<QueryError error={q.error} onRetry={() => void q.refetch()} title="Couldn't load your overview" /></>);
  const { totals: t, daily, recent, integration } = q.data;
  const anyPayments = t.successful_count + t.pending_count + t.expired_count + t.cancelled_count > 0 || recent.length > 0;

  return (
    <>
      {header}
      <section aria-label="Totals" className="overflow-hidden rounded-xl border bg-border shadow-panel">
        <dl className="grid grid-cols-2 gap-px lg:grid-cols-4 [&>div]:bg-card">
          <Figure label="Net received" value={musdDisplay(t.net_display)} unit="MUSD" hint={`${musdDisplay(t.received_display)} in, ${musdDisplay(t.refunded_display)} refunded`} />
          <Figure label="Paid orders" value={t.successful_count.toLocaleString()} hint={t.refunded_count ? `${pluralize(t.refunded_count, "refund")}` : "No refunds"} />
          <Figure label="Open" value={t.pending_count.toLocaleString()} hint="Waiting for the customer or confirmations" />
          <Figure label="Conversion" value={percent(t.conversion_rate)} hint={`${t.expired_count} expired, ${t.cancelled_count} cancelled, ${t.failed_attempts} failed attempts`} />
        </dl>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Panel title="Received, last 30 days" description="Confirmed payments by day (UTC).">
          {daily.some((d) => d.count > 0) ? (
            <RevenueChart daily={daily} />
          ) : (
            <EmptyState title="No confirmed payments yet" body="Your first paid order shows up here once it's verified on-chain." className="h-[220px] justify-center" />
          )}
        </Panel>
        <Panel title="Setup">
          <IntegrationChecklist integration={integration} />
        </Panel>
      </div>

      <Panel
        title="Recent payments"
        bodyClassName="px-4 py-2 sm:px-5"
        actions={
          anyPayments ? (
            <Button asChild variant="ghost" size="sm">
              <Link href="/merchant/payments">View all</Link>
            </Button>
          ) : null
        }
      >
        {recent.length ? (
          <PaymentsTable rows={recent} />
        ) : (
          <EmptyState
            className="my-3"
            title="No payments yet"
            body="Create a payment link here, or call the API from your store. Each one gets a checkout page, a QR code and works in the widget."
            action={
              <>
                <Button asChild size="sm">
                  <Link href="/merchant/payments/new">Create payment</Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link href="/docs">Read the quickstart</Link>
                </Button>
              </>
            }
          />
        )}
      </Panel>
    </>
  );
}
