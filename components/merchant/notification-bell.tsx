"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import { useMarkNotificationsRead, useNotifications } from "@/hooks/use-api";
import { relativeTime } from "@/lib/client/format";
import { cn } from "@/lib/client/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function unreadCount(list: { read_at: string | null }[] | undefined): number {
  return (list ?? []).filter((n) => !n.read_at).length;
}

export function NotificationBell() {
  const q = useNotifications();
  const mark = useMarkNotificationsRead();
  const list = q.data ?? [];
  const unread = unreadCount(list);
  const recent = list.slice(0, 6);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}>
          <Bell strokeWidth={1.75} />
          {unread ? (
            <span aria-hidden className="num absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[0.625rem] font-semibold text-brand-foreground">
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <p className="text-sm font-medium">Notifications</p>
          {unread ? (
            <button
              type="button"
              disabled={mark.isPending}
              onClick={() => mark.mutate(undefined)}
              className="cursor-pointer rounded-sm text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              Mark all read
            </button>
          ) : null}
        </div>
        {q.isLoading ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">Loading…</p>
        ) : recent.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">Nothing yet. You&apos;ll hear about payments, refunds and failed webhooks here.</p>
        ) : (
          <ul className="max-h-80 divide-y overflow-y-auto">
            {recent.map((n) => {
              const body = (
                <>
                  <span className="flex items-start justify-between gap-3">
                    <span className={cn("text-sm", !n.read_at && "font-medium")}>{n.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(n.created_at)}</span>
                  </span>
                  {n.body ? <span className="mt-0.5 line-clamp-2 block text-[0.8125rem] text-muted-foreground">{n.body}</span> : null}
                </>
              );
              return (
                <li key={n.id} className="relative">
                  {!n.read_at ? <span aria-hidden className="absolute top-3.5 left-1.5 size-1.5 rounded-full bg-brand" /> : null}
                  {n.link ? (
                    <Link href={n.link} className="block px-4 py-3 hover:bg-muted focus-visible:bg-muted focus-visible:outline-none">
                      {body}
                    </Link>
                  ) : (
                    <div className="px-4 py-3">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <div className="border-t px-4 py-2">
          <Link href="/merchant/notifications" className="text-[0.8125rem] font-medium underline-offset-4 hover:underline">
            See all
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
