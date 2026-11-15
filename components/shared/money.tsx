import { musd, musdDisplay, musdExact } from "@/lib/client/format";
import { cn } from "@/lib/client/utils";

/** A MUSD amount from wei: tabular figures, full precision in the title. */
export function Musd({ value, compact, decimals, unit = true, className }: { value: bigint | string | null | undefined; compact?: boolean; decimals?: number; unit?: boolean; className?: string }) {
  const shown = musd(value, { compact, decimals });
  const exact = musdExact(value);
  return (
    <span className={cn("num whitespace-nowrap", className)} title={exact === "--" ? undefined : `${exact} MUSD`}>
      {shown}
      {unit && shown !== "--" ? <span className="ml-1 text-[0.85em] font-normal text-muted-foreground">MUSD</span> : null}
    </span>
  );
}

/** A MUSD amount from an API `*_display` decimal string. */
export function MusdDisplay({ value, unit = true, className }: { value: string | null | undefined; unit?: boolean; className?: string }) {
  const shown = musdDisplay(value);
  return (
    <span className={cn("num whitespace-nowrap", className)} title={value ? `${value} MUSD` : undefined}>
      {shown}
      {unit && shown !== "--" ? <span className="ml-1 text-[0.85em] font-normal text-muted-foreground">MUSD</span> : null}
    </span>
  );
}
