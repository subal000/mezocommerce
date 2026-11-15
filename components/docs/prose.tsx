import type { ReactNode } from "react";
import { cn } from "@/lib/client/utils";

/** Docs typography: h1 text-3xl, h2 text-xl, h3 text-base, body text-[0.9375rem], prose capped at ~70ch. */
export function DocTitle({ title, lead }: { title: string; lead?: ReactNode }) {
  return (
    <header className="mb-10">
      <h1 className="text-3xl font-semibold tracking-[-0.025em]">{title}</h1>
      {lead ? <p className="mt-3 max-w-[68ch] text-base text-muted-foreground">{lead}</p> : null}
    </header>
  );
}

export function Section({ id, title, children, className }: { id?: string; title: string; children: ReactNode; className?: string }) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-h` : undefined} className={cn("scroll-mt-24 space-y-4 py-8 first:pt-0", className)}>
      <h2 id={id ? `${id}-h` : undefined} className="text-xl font-semibold tracking-[-0.015em]">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function H3({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h3 id={id} className="scroll-mt-24 pt-2 text-base font-semibold">
      {children}
    </h3>
  );
}

export function P({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("max-w-[70ch] text-[0.9375rem] leading-relaxed text-foreground/90", className)}>{children}</p>;
}

export function List({ items, ordered }: { items: ReactNode[]; ordered?: boolean }) {
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag className={cn("max-w-[70ch] space-y-2 pl-5 text-[0.9375rem] leading-relaxed text-foreground/90", ordered ? "list-decimal" : "list-disc marker:text-muted-foreground")}>
      {items.map((it, i) => (
        <li key={i} className="pl-1">
          {it}
        </li>
      ))}
    </Tag>
  );
}

/** Inline code. */
export function C({ children }: { children: ReactNode }) {
  return <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{children}</code>;
}

/** Plain bordered note. Not a coloured side stripe. */
export function Note({ title, children, tone = "plain" }: { title?: string; children: ReactNode; tone?: "plain" | "warn" }) {
  return (
    <div className={cn("max-w-[70ch] rounded-lg border px-4 py-3 text-sm", tone === "warn" ? "border-warn/40 bg-warn/5" : "bg-surface")}>
      {title ? <p className="font-medium">{title}</p> : null}
      <div className={cn("text-muted-foreground", title && "mt-0.5")}>{children}</div>
    </div>
  );
}

export function DocTable({ head, rows, caption }: { head: string[]; rows: ReactNode[][]; caption?: string }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-left text-sm">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead className="bg-surface">
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="px-3 py-2 font-medium whitespace-nowrap text-muted-foreground">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r, i) => (
            <tr key={i} className="align-top">
              {r.map((cell, j) => (
                <td key={j} className="px-3 py-2.5">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Previous / next links at the end of each page. */
export function PageFooterNav({ prev, next }: { prev?: { href: string; label: string }; next?: { href: string; label: string } }) {
  return (
    <nav aria-label="Pagination" className="mt-12 flex flex-wrap justify-between gap-4 border-t pt-6 text-sm">
      {prev ? (
        <a href={prev.href} className="rounded-md text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
          Previous: {prev.label}
        </a>
      ) : (
        <span />
      )}
      {next ? (
        <a href={next.href} className="rounded-md font-medium underline-offset-4 hover:underline">
          Next: {next.label}
        </a>
      ) : null}
    </nav>
  );
}
