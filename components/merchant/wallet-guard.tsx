"use client";

import { toast } from "sonner";
import { describeTxError } from "@/lib/client/errors";
import { shortAddress } from "@/lib/client/format";
import { useWallet } from "@/hooks/use-wallet";
import { Button } from "@/components/ui/button";
import { walletMatches, type WalletRole } from "@/lib/client/merchant-wallet";

export { walletMatches, type WalletRole };

/** Inline warning shown above on-chain actions when the wrong wallet or network is active. */
export function WalletRoleNotice({ owner, payout, role }: { owner: string; payout: string | null; role: WalletRole }) {
  const w = useWallet();
  if (!w.isConnected) return <p className="text-sm text-muted-foreground">Connect your wallet to continue.</p>;
  if (w.network.kind === "wrong-network") {
    return (
      <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warn/40 bg-warn/5 px-3 py-2 text-sm">
        <span>Your wallet is on another network.</span>
        <Button size="sm" variant="outline" disabled={w.isSwitching} onClick={() => w.switchToMezo().catch((e) => toast.error(describeTxError(e).message))}>
          {w.isSwitching ? "Switching…" : "Switch to Mezo Testnet"}
        </Button>
      </div>
    );
  }
  if (!walletMatches(w.address, owner, payout, role)) {
    return (
      <p role="alert" className="rounded-lg border border-warn/40 bg-warn/5 px-3 py-2 text-sm">
        {role === "owner"
          ? `Switch to your owner wallet (${shortAddress(owner)}). Only it can do this.`
          : `Send this from your owner wallet (${shortAddress(owner)})${payout ? ` or payout wallet (${shortAddress(payout)})` : ""}. Connected: ${shortAddress(w.address)}.`}
      </p>
    );
  }
  return null;
}
