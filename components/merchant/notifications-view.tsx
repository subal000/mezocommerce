"use client";

import Link from "next/link";
import { useMarkNotificationsRead, useNotifications } from "@/hooks/use-api";
import { formatDateTime } from "@/lib/client/format";
import { cn } from "@/lib/client/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader, Panel } from "@/components/shared/page-header";
import { QueryError } from "@/components/shared/query-error";
import { EmptyState } from "@/components/shared/empty-state";
import { unreadCount } from "./notification-bell";

export function NotificationsView() {
  const q = useNotifications();
  const mark = useMarkNotificationsRead();
  const list = q.data ?? [];
  const unread = unreadCount(list);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        description="Payments, refunds and anything that needs a look. Change what you get in Settings."
        actions={
          unread ? (
            <Button variant="outline" disabled={mark.isPending} onClick={() => mark.mutate(undefined)}>
              Mark all read
            </Button>
          ) : null
        }
      />
      <Panel bodyClassName="px-4 py-1 sm:px-5">
        {q.isLoading ? (
          <div className="space-y-2 py-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : q.isError ? (
          <div className="py-3">
            <QueryError error={q.error} onRetry={() => void q.refetch()} title="Couldn't load notifications" />
          </div>
        ) : list.length === 0 ? (
          <EmptyState className="my-3" title="No notifications" body="You'll hear about paid orders, refunds and failed webhooks here." />
        ) : (
          <ul className="divide-y">
            {list.map((n) => (
              <li key={n.id} className="flex items-start gap-3 py-3">
                <span aria-hidden className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-brand")} />
                <div className="min-w-0 flex-1">
                  <p className={cn("text-sm", !n.read_at && "font-medium")}>
                    {n.title}
                    {!n.read_at ? <span className="sr-only"> (unread)</span> : null}
                  </p>
                  {n.body ? <p className="text-[0.8125rem] text-muted-foreground">{n.body}</p> : null}
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    <time dateTime={n.created_at}>{formatDateTime(n.created_at)}</time>
                    {n.link ? (
                      <>
                        {" "}
                        <Link href={n.link} className="ml-2 font-medium text-foreground underline-offset-4 hover:underline">
                          Open
                        </Link>
                      </>
                    ) : null}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
