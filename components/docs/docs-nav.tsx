"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/client/utils";
import { DOCS_NAV } from "./nav-items";

function isActive(pathname: string, href: string) {
  return href === "/docs" ? pathname === "/docs" : pathname === href || pathname.startsWith(`${href}/`);
}

/** Sidebar list on desktop, horizontally scrolling link row on mobile. */
export function DocsNav({ variant }: { variant: "sidebar" | "bar" }) {
  const pathname = usePathname() ?? "/docs";
  if (variant === "bar") {
    return (
      <nav aria-label="Docs" className="-mx-4 overflow-x-auto px-4 sm:-mx-6 sm:px-6">
        <ul className="flex gap-1 pb-1">
          {DOCS_NAV.map((n) => {
            const active = isActive(pathname, n.href);
            return (
              <li key={n.href} className="shrink-0">
                <Link
                  href={n.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-h-9 items-center rounded-md px-3 text-[0.8125rem] whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                    active ? "bg-brand-soft font-medium text-brand-ink" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {n.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    );
  }
  return (
    <nav aria-label="Docs">
      <ul className="space-y-0.5">
        {DOCS_NAV.map((n) => {
          const active = isActive(pathname, n.href);
          return (
            <li key={n.href}>
              <Link
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-9 items-center rounded-md px-3 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  active ? "bg-brand-soft font-medium text-brand-ink" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {n.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
