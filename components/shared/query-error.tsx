"use client";

import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/client/api";

export function QueryError({ error, onRetry, title = "Couldn't load this" }: { error: unknown; onRetry?: () => void; title?: string }) {
  return (
    <div role="alert" className="rounded-lg border border-bad/30 bg-bad/5 px-4 py-3 text-sm">
      <p className="font-medium">{title}</p>
      <p className="mt-0.5 text-muted-foreground">{errorMessage(error)}</p>
      {onRetry ? (
        <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}
