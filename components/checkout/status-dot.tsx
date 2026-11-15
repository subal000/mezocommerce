import { cn } from "@/lib/client/utils";

export type StatusTone = "ok" | "info" | "warn" | "bad" | "idle";

const TONE: Record<StatusTone, string> = {
  ok: "bg-ok",
  info: "bg-info",
  warn: "bg-warn",
  bad: "bg-bad",
  idle: "bg-idle",
};

/** Dot + word status. The word always carries the meaning; the dot is a secondary cue. */
export function StatusDot({ tone, children, className }: { tone: StatusTone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-sm font-medium", className)}>
      <span className={cn("size-2 shrink-0 rounded-full", TONE[tone])} aria-hidden />
      {children}
    </span>
  );
}
