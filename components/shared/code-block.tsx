import { cn } from "@/lib/client/utils";
import { CopyButton } from "./copy-button";

/** Monospace code with a copy button. No syntax colouring: one ink colour reads cleaner in both themes. */
export function CodeBlock({ code, label, className }: { code: string; label?: string; className?: string }) {
  return (
    <div className={cn("group relative min-w-0 overflow-hidden rounded-lg border bg-surface", className)}>
      {label ? (
        <div className="flex items-center justify-between border-b px-3 py-1.5">
          <span className="text-xs text-muted-foreground">{label}</span>
          <CopyButton value={code} label={`Copy ${label}`} />
        </div>
      ) : (
        <CopyButton value={code} label="Copy code" className="absolute top-1.5 right-1.5 bg-surface" />
      )}
      <pre className="overflow-x-auto p-3 pr-10 font-mono text-[0.8125rem] leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}
