import type { IntentStatus } from "@/lib/chain/payment-state";
import { intentStatusMeta, TONE_CLASS, type StatusMeta } from "@/lib/client/status";
import { cn } from "@/lib/client/utils";

/** Dot + word. The word carries the meaning; the dot only reinforces it. Not a pill. */
export function StatusDot({ meta, className }: { meta: StatusMeta; className?: string }) {
  return (
    <span title={meta.hint || undefined} data-tone={meta.tone} className={cn("inline-flex items-center gap-1.5 text-[0.8125rem] whitespace-nowrap text-foreground", className)}>
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", TONE_CLASS[meta.tone].dot)} />
      {meta.label}
    </span>
  );
}

/** The one status display for every payment intent status. */
export function StatusBadge({ status, late = false, className }: { status: IntentStatus; late?: boolean; className?: string }) {
  return <StatusDot meta={intentStatusMeta(status, late)} className={className} />;
}
