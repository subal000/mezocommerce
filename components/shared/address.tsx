import { ExternalLink } from "lucide-react";
import { explorerAddress, explorerTx } from "@/lib/chain/config";
import { DASH, shortAddress, shortHash } from "@/lib/client/format";
import { cn } from "@/lib/client/utils";
import { CopyButton } from "./copy-button";

/** Truncated address with explorer link and copy. Full value in title for hover. */
export function AddressText({ address, link = true, copy = true, full = false, className }: { address: string | null | undefined; link?: boolean; copy?: boolean; full?: boolean; className?: string }) {
  if (!address) return <span className="text-muted-foreground">{DASH}</span>;
  const body = <span className={cn("font-mono text-[0.8125rem]", full && "break-all")}>{full ? address : shortAddress(address)}</span>;
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-0.5", className)} title={address}>
      {link ? (
        <a href={explorerAddress(address)} target="_blank" rel="noreferrer" className="rounded-sm underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          {body}
          <span className="sr-only"> (opens the explorer)</span>
        </a>
      ) : (
        body
      )}
      {copy ? <CopyButton value={address} label="Copy address" /> : null}
    </span>
  );
}

/** Transaction hash linking to the explorer. */
export function TxLink({ hash, label, copy = false, className }: { hash: string | null | undefined; label?: string; copy?: boolean; className?: string }) {
  if (!hash) return <span className="text-muted-foreground">{DASH}</span>;
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)}>
      <a
        href={explorerTx(hash)}
        target="_blank"
        rel="noreferrer"
        title={hash}
        className="inline-flex items-center gap-1 rounded-sm text-[0.8125rem] underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <span className={label ? undefined : "font-mono"}>{label ?? shortHash(hash)}</span>
        <ExternalLink className="size-3.5 text-muted-foreground" aria-hidden />
        <span className="sr-only">(opens the explorer)</span>
      </a>
      {copy ? <CopyButton value={hash} label="Copy transaction hash" /> : null}
    </span>
  );
}

/** A long id (payment_id, pi_…) shown mono + truncated + copy. */
export function IdText({ value, className }: { value: string | null | undefined; className?: string }) {
  if (!value) return <span className="text-muted-foreground">{DASH}</span>;
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-0.5", className)} title={value}>
      <span className="truncate font-mono text-[0.8125rem]">{shortHash(value)}</span>
      <CopyButton value={value} label="Copy" />
    </span>
  );
}
