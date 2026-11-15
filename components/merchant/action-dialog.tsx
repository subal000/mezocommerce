"use client";

import { useState, type ReactNode } from "react";
import { useTx, type UseTx } from "@/hooks/use-tx";
import { useWallet } from "@/hooks/use-wallet";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { TxPanel } from "@/components/shared/tx-panel";
import { NotDeployedNotice } from "@/components/shared/not-deployed";
import { WalletRoleNotice, walletMatches, type WalletRole } from "./wallet-guard";

/**
 * Confirmation dialog for one on-chain merchant action. Explains the wallet prompt in one sentence before it opens,
 * then shows progress. `onConfirm` returns true on success to auto-close.
 */
export function ActionDialog({
  trigger,
  title,
  body,
  walletAsk,
  confirmLabel,
  destructive,
  onConfirm,
  children,
  disabled,
  deployed,
  owner,
  payout,
  role = "owner",
}: {
  trigger: ReactNode;
  title: string;
  body?: ReactNode;
  walletAsk: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: (tx: UseTx) => Promise<boolean | void>;
  children?: ReactNode;
  disabled?: boolean;
  deployed: boolean;
  owner: string;
  payout: string | null;
  role?: WalletRole;
}) {
  const [open, setOpen] = useState(false);
  const tx = useTx();
  const w = useWallet();
  const done = tx.state.phase === "success" && !tx.state.recordError;
  const rightWallet = walletMatches(w.address, owner, payout, role) && w.isReady;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && tx.isBusy) return;
        setOpen(v);
        if (!v) tx.reset();
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {body ? (
            <DialogDescription asChild>
              <div>{body}</div>
            </DialogDescription>
          ) : null}
        </DialogHeader>
        {children}
        {!deployed ? <NotDeployedNotice /> : <WalletRoleNotice owner={owner} payout={payout} role={role} />}
        <TxPanel state={tx.state} description={walletAsk} onRetryRecord={tx.retryRecord} />
        <DialogFooter>
          {done ? (
            <Button onClick={() => setOpen(false)}>Close</Button>
          ) : (
            <>
              <Button variant="ghost" disabled={tx.isBusy} onClick={() => setOpen(false)}>
                Not now
              </Button>
              <Button
                variant={destructive ? "destructive" : "default"}
                disabled={disabled || tx.isBusy || !deployed || !rightWallet}
                onClick={async () => {
                  const ok = await onConfirm(tx);
                  if (ok === true) setTimeout(() => setOpen(false), 900);
                }}
              >
                {tx.isBusy ? "Working…" : confirmLabel}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
