"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { CopyButton } from "./copy-button";

/**
 * Shows a secret exactly once. The parent drops the value from state on `onDone`, so after closing it's gone.
 * The close button stays disabled until the person confirms they saved it.
 */
export function SecretReveal({ secret, title, body, onDone, doneLabel = "Done" }: { secret: string; title: string; body: string; onDone: () => void; doneLabel?: string }) {
  const [saved, setSaved] = useState(false);
  return (
    <div className="space-y-4" data-testid="secret-reveal">
      <div>
        <p className="font-medium">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{body}</p>
      </div>
      <div className="flex items-center gap-2 rounded-lg border bg-surface p-2 pl-3">
        <code className="min-w-0 flex-1 font-mono text-[0.8125rem] break-all select-all" data-testid="secret-value">
          {secret}
        </code>
        <CopyButton value={secret} text="Copy" />
      </div>
      <div className="flex items-start gap-2">
        <Checkbox id="secret-saved" checked={saved} onCheckedChange={(v) => setSaved(v === true)} />
        <Label htmlFor="secret-saved" className="text-sm leading-snug font-normal">
          I saved it somewhere safe. I understand it won&apos;t be shown again.
        </Label>
      </div>
      <Button onClick={onDone} disabled={!saved}>
        {doneLabel}
      </Button>
    </div>
  );
}
