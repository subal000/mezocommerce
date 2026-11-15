"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Download, Plus, Search } from "lucide-react";
import { intentQueryString, useIntents } from "@/hooks/use-api";
import { INTENT_FILTERS } from "@/lib/client/status";
import { pluralize } from "@/lib/client/format";
import { pageInfo } from "@/lib/client/pagination";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader, Panel } from "@/components/shared/page-header";
import { QueryError } from "@/components/shared/query-error";
import { EmptyState } from "@/components/shared/empty-state";
import { PaymentsTable } from "./payments-table";

export function PaymentsView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const status = params.get("status") ?? "";
  const q = params.get("q") ?? "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const [search, setSearch] = useState(q);

  function update(next: { status?: string; q?: string; page?: number }) {
    const merged = { status, q, page, ...next };
    router.replace(`${pathname}${intentQueryString(merged)}`, { scroll: false });
  }

  // Debounced search → URL (so filters survive reloads and are shareable).
  useEffect(() => {
    if (search === q) return;
    const t = setTimeout(() => update({ q: search, page: 1 }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const list = useIntents({ status, q, page });
  const data = list.data;
  const info = data ? pageInfo(data.page, data.page_size, data.total) : null;
  const exportHref = `/api/merchant/payment-intents/export.csv${intentQueryString({ status, q })}`;
  const filtered = Boolean(status || q);

  return (
    <>
      <PageHeader
        title="Payments"
        description="Every payment link and API checkout. A payment shows as paid only after it's verified on-chain."
        actions={
          <>
            <Button asChild variant="outline">
              <a href={exportHref} download>
                <Download aria-hidden /> Export CSV
              </a>
            </Button>
            <Button asChild>
              <Link href="/merchant/payments/new">
                <Plus aria-hidden /> Create payment
              </Link>
            </Button>
          </>
        }
      />
      <Panel bodyClassName="p-0">
        <div className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-end sm:px-5">
          <div className="grid flex-1 gap-1.5">
            <Label htmlFor="payment-search" className="sr-only">
              Search payments
            </Label>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                id="payment-search"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Order ID, payment ID, wallet or transaction"
                className="pl-8"
              />
            </div>
          </div>
          <div className="grid gap-1.5 sm:w-52">
            <Label htmlFor="payment-status" className="sr-only">
              Status
            </Label>
            <Select value={status || "all"} onValueChange={(v) => update({ status: v === "all" ? "" : v, page: 1 })}>
              <SelectTrigger id="payment-status" className="w-full">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                {INTENT_FILTERS.map((f) => (
                  <SelectItem key={f.value || "all"} value={f.value || "all"}>
                    {f.value ? f.label : "All statuses"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="px-4 py-2 sm:px-5" aria-busy={list.isFetching}>
          {list.isLoading ? (
            <div className="space-y-2 py-2" aria-label="Loading payments">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : list.isError ? (
            <div className="py-3">
              <QueryError error={list.error} onRetry={() => void list.refetch()} title="Couldn't load payments" />
            </div>
          ) : !data || data.data.length === 0 ? (
            <EmptyState
              className="my-3"
              title={filtered ? "No payments match" : "No payments yet"}
              body={filtered ? "Try another status or search term." : "Create a payment link, or create payments from your server with the API."}
              action={
                filtered ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setSearch("");
                      update({ status: "", q: "", page: 1 });
                    }}
                  >
                    Clear filters
                  </Button>
                ) : (
                  <Button asChild size="sm">
                    <Link href="/merchant/payments/new">Create payment</Link>
                  </Button>
                )
              }
            />
          ) : (
            <PaymentsTable rows={data.data} showTx />
          )}
        </div>

        {data && info && data.total > 0 ? (
          <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-sm sm:px-5">
            <p className="num text-muted-foreground" aria-live="polite">
              {info.from}-{info.to} of {pluralize(data.total, "payment")}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={!info.hasPrev} onClick={() => update({ page: page - 1 })}>
                Previous
              </Button>
              <Button variant="outline" size="sm" disabled={!info.hasNext} onClick={() => update({ page: page + 1 })}>
                Next
              </Button>
            </div>
          </nav>
        ) : null}
      </Panel>
    </>
  );
}
