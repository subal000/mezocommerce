"use client";

import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { Hex } from "viem";
import type { MerchantDTO, PaymentIntentDetailDTO } from "@/lib/api-types";
import { errorMessage } from "@/lib/client/api";
import { walletMatches } from "@/lib/client/merchant-wallet";
import { build } from "@/lib/client/writes";
import { useCancelIntent } from "@/hooks/use-api";
import { useTx } from "@/hooks/use-tx";
import { useWallet } from "@/hooks/use-wallet";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { TxPanel } from "@/components/shared/tx-panel";
import { WalletRoleNotice } from "./wallet-guard";

/**
 * Cancel = DB cancel (checkout stops offering the signed payment right away) plus an optional on-chain cancelPayment,
 * so a signature that already reached a customer's browser can't be paid either.
 */
export function CancelDialog({ intent, merchant, deployed, trigger }: { intent: PaymentIntentDetailDTO; merchant: MerchantDTO; deployed: boolean; trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  const opened = intent.status !== "created";
  const canOnchain = deployed && !!merchant.onchain_merchant_id;
  const [onchain, setOnchain] = useState(opened && canOnchain);
  const [dbDone, setDbDone] = useState(intent.status === "cancelled");
  const cancel = useCancelIntent(intent.id);
  const tx = useTx();
  const w = useWallet();
  const rightWallet = walletMatches(w.address, merchant.owner_address, null, "owner") && w.isReady;
  const busy = cancel.isPending || tx.isBusy;
  const finished = dbDone && (!onchain || (tx.state.phase === "success" && !tx.state.recordError));

  async function go() {
    if (!dbDone) {
      try {
        await cancel.mutateAsync();
        setDbDone(true);
        if (!onchain) toast.success("Payment cancelled");
      } catch (err) {
        toast.error("Couldn't cancel", { description: errorMessage(err) });
        return;
      }
    }
    if (onchain && merchant.onchain_merchant_id) {
      await tx.run(build.cancelPayment(BigInt(merchant.onchain_merchant_id), intent.payment_id as Hex), { successMessage: "Cancelled on-chain too" });
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && busy) return;
        setOpen(v);
        if (!v) tx.reset();
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancel this payment?</DialogTitle>
          <DialogDescription>The checkout link stops working right away. This can&apos;t be undone.</DialogDescription>
        </DialogHeader>
        <div className="flex items-start gap-2">
          <Checkbox id="cancel-onchain" checked={onchain} disabled={!canOnchain || busy || tx.state.phase === "success"} onCheckedChange={(v) => setOnchain(v === true)} />
          <Label htmlFor="cancel-onchain" className="block text-sm leading-snug font-normal">
            Also cancel on-chain
            <span className="mt-0.5 block text-[0.8125rem] text-muted-foreground">
              {canOnchain
                ? opened
                  ? "Recommended: the customer already opened checkout. Your owner wallet sends one transaction so the payment can't go through even from an open tab."
                  : "Optional: the customer hasn't opened checkout yet. Your owner wallet sends one transaction."
                : "Not available until the contract is deployed and your store is registered."}
            </span>
          </Label>
        </div>
        {onchain ? <WalletRoleNotice owner={merchant.owner_address} payout={null} role="owner" /> : null}
        {onchain ? <TxPanel state={tx.state} onRetryRecord={tx.retryRecord} /> : null}
        {dbDone && !finished ? <p className="text-sm text-muted-foreground" role="status">Cancelled in MezoCommerce. Now confirm the on-chain cancel in your wallet.</p> : null}
        <DialogFooter>
          {finished ? (
            <Button onClick={() => setOpen(false)}>Close</Button>
          ) : (
            <>
              <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
                Keep payment
              </Button>
              <Button variant="destructive" disabled={busy || (onchain && !rightWallet)} onClick={() => void go()}>
                {cancel.isPending ? "Cancelling…" : tx.isBusy ? "Check your wallet…" : dbDone ? "Cancel on-chain" : "Cancel payment"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
