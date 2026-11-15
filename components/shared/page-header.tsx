import type { ReactNode } from "react";
import { cn } from "@/lib/client/utils";

export function PageHeader({ title, description, actions, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">{title}</h1>
        {description ? <p className="mt-1 max-w-[65ch] text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Panel({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
  id,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn("rounded-xl border bg-card shadow-panel", className)}>
      {title ? (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 className="text-[0.9375rem] font-semibold">{title}</h2>
            {description ? <p className="mt-0.5 text-[0.8125rem] text-muted-foreground">{description}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className={cn("px-4 py-4 sm:px-5", bodyClassName)}>{children}</div>
    </section>
  );
}

/** Label / value rows for detail pages. */
export function DetailList({ items, className }: { items: { label: string; value: ReactNode; hint?: ReactNode }[]; className?: string }) {
  return (
    <dl className={cn("grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[minmax(9rem,auto)_1fr]", className)}>
      {items.map((it) => (
        <div key={it.label} className="contents">
          <dt className="text-muted-foreground">{it.label}</dt>
          <dd className="min-w-0 break-words">
            {it.value}
            {it.hint ? <span className="mt-0.5 block text-xs text-muted-foreground">{it.hint}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
