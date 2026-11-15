import type { ReactNode } from "react";
import { cn } from "@/lib/client/utils";

export function EmptyState({ title, body, action, className }: { title: string; body?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-start gap-2 rounded-lg border border-dashed px-5 py-8 sm:items-center sm:text-center", className)}>
      <p className="font-medium">{title}</p>
      {body ? <p className="max-w-[52ch] text-sm text-muted-foreground">{body}</p> : null}
      {action ? <div className="mt-2 flex flex-wrap gap-2">{action}</div> : null}
    </div>
  );
}
