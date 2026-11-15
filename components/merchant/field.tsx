import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/client/utils";

/** Label above, hint below, error below that. `id` ties them together for screen readers. */
export function Field({ id, label, hint, error, optional, children, className }: { id: string; label: string; hint?: ReactNode; error?: string; optional?: boolean; children: ReactNode; className?: string }) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={id}>
        {label}
        {optional ? <span className="font-normal text-muted-foreground">(optional)</span> : null}
      </Label>
      {children}
      {hint && !error ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-bad">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export const describedBy = (id: string, error?: string, hint?: boolean) => (error ? `${id}-error` : hint ? `${id}-hint` : undefined);
