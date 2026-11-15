import type { ReactNode } from "react";
import { cn } from "@/lib/client/utils";

export function Stat({ label, value, hint, className }: { label: string; value: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="text-[0.8125rem] text-muted-foreground">{label}</p>
      <p className="num mt-1 text-xl font-semibold tracking-[-0.01em]">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
