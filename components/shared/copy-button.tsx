"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/client/utils";

export function CopyButton({ value, label = "Copy", text, className, variant = "outline" }: { value: string; label?: string; text?: string; className?: string; variant?: "outline" | "default" | "secondary" }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      toast.error("Couldn't copy. Select the text and copy it manually.");
    }
  }
  if (text) {
    return (
      <Button type="button" variant={variant} size="sm" onClick={copy} className={className}>
        {done ? <Check aria-hidden /> : <Copy aria-hidden />}
        <span aria-live="polite">{done ? "Copied" : text}</span>
      </Button>
    );
  }
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={done ? "Copied" : label}
      title={label}
      className={cn(
        "inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        className,
      )}
    >
      {done ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
    </button>
  );
}
