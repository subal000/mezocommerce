"use client";

import { usePublicConfig } from "@/hooks/use-api";
import { isDeployed } from "@/lib/chain/config";
import { cn } from "@/lib/client/utils";

/** Deployed per GET /api/public/config, falling back to the build-time address while it loads. */
export function useDeployed(): boolean {
  const cfg = usePublicConfig();
  return cfg.data ? cfg.data.deployed : isDeployed;
}

export function NotDeployedNotice({ className, action = "On-chain steps" }: { className?: string; action?: string }) {
  return (
    <div role="status" className={cn("rounded-lg border border-warn/40 bg-warn/5 px-4 py-3 text-sm", className)}>
      <p className="font-medium">Contract not deployed yet</p>
      <p className="mt-0.5 text-muted-foreground">{action} turn on once the MezoCommerce payment contract is live on Mezo Testnet.</p>
    </div>
  );
}
