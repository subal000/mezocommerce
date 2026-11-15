"use client";

import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { MerchantDTO, PaymentIntentDetailDTO, RefundDTO } from "@/lib/api-types";
import { errorMessage } from "@/lib/client/api";
import { musd, musdDisplay } from "@/lib/client/format";
import { refundableWei, validateRefundAmount } from "@/lib/client/refund";
import { walletMatches } from "@/lib/client/merchant-wallet";
import { musdToDecimalString } from "@/lib/money";
import { build } from "@/lib/client/writes";
import { createRefund, refundSubmitted } from "@/hooks/use-api";
import { useTx } from "@/hooks/use-tx";
import { useWallet } from "@/hooks/use-wallet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { TxPanel } from "@/components/shared/tx-panel";
import { NotDeployedNotice } from "@/components/shared/not-deployed";
import { Field } from "./field";
import { WalletRoleNotice } from "./wallet-guard";

/**
 * Refund: amount ≤ what's left → POST /api/merchant/refunds (returns the calls) → wallet approves the exact amount →
 * wallet sends refund → POST …/submitted with the hash so the server verifies RefundCompleted.
 * Sent from the merchant's owner or payout wallet; the MUSD comes from that wallet.
 */
export function RefundDialog({ intent, merchant, deployed, resume, trigger }: { intent: PaymentIntentDetailDTO; merchant: MerchantDTO; deployed: boolean; resume?: RefundDTO; trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(resume ? resume.amount_display : "");
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const [refund, setRefund] = useState<RefundDTO | null>(resume ?? null);
  const [creating, setCreating] = useState(false);
  const tx = useTx();
  const w = useWallet();

  const left = refundableWei(intent.amount, intent.amount_refunded);
  const check = validateRefundAmount(amount, resume ? BigInt(resume.amount) + left : left);
  const rightWallet = walletMatches(w.address, merchant.owner_address, merchant.payout_address, "owner_or_payout") && w.isReady;
  const done = tx.state.phase === "success" && !tx.state.recordError;
  const busy = creating || tx.isBusy;

  async function start() {
    setTouched(true);
    if (!check.ok) return;
    let r = refund;
    if (!r) {
      setCreating(true);
      try {
        r = await createRefund({ payment_intent_id: intent.id, amount: musdToDecimalString(check.wei), reason: reason.trim() || undefined });
        setRefund(r);
      } catch (err) {
        toast.error("Couldn't start the refund", { description: errorMessage(err) });
        return;
      } finally {
        setCreating(false);
      }
    }
    if (!r.tx) {
      toast.error("This refund can't be sent from here", { description: "The server didn't return the wallet calls. Refresh and try again." });
      return;
    }
    const approved = await tx.run(build.raw(`Approve ${musd(r.amount)} MUSD`, r.tx.approve), { progress: "Step 1 of 2", intermediate: true });
    if (!approved) return;
    const refundId = r.id;
    await tx.run(build.raw(`Refund ${musd(r.amount)} MUSD`, r.tx.refund), {
      progress: "Step 2 of 2",
      record: (hash) => refundSubmitted(refundId, hash),
      successMessage: "Refund sent",
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && busy) return;
        setOpen(v);
        if (!v) {
          tx.reset();
          setTouched(false);
          if (!resume) setRefund(null);
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{resume ? "Send refund" : "Refund payment"}</DialogTitle>
          <DialogDescription>
            The MUSD goes from your wallet back to the customer&apos;s wallet. Send it from your owner wallet or payout wallet; that wallet needs the MUSD and a little testnet BTC for gas.
          </DialogDescription>
        </DialogHeader>

        {!refund ? (
          <div className="grid gap-4">
            <Field
              id="refund-amount"
              label="Amount (MUSD)"
              hint={`Up to ${musd(left)} MUSD of ${musdDisplay(intent.amount_display)} can be refunded.`}
              error={touched && !check.ok ? check.error : undefined}
            >
              <div className="flex gap-2">
                <Input
                  id="refund-amount"
                  inputMode="decimal"
                  autoComplete="off"
                  className="num"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  onBlur={() => setTouched(true)}
                  aria-invalid={touched && !check.ok}
                  aria-describedby={touched && !check.ok ? "refund-amount-error" : "refund-amount-hint"}
                />
                <Button type="button" variant="outline" onClick={() => setAmount(musdToDecimalString(left))}>
                  Full amount
                </Button>
              </div>
            </Field>
            <Field id="refund-reason" label="Reason" optional hint="Kept with the refund and sent in the webhook.">
              <Textarea id="refund-reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} aria-describedby="refund-reason-hint" />
            </Field>
          </div>
        ) : (
          <p className="text-sm">
            Refunding <span className="num font-medium">{musdDisplay(refund.amount_display)} MUSD</span> to the customer.
          </p>
        )}

        {!deployed ? <NotDeployedNotice action="Refunds" /> : <WalletRoleNotice owner={merchant.owner_address} payout={merchant.payout_address} role="owner_or_payout" />}
        <TxPanel
          state={tx.state}
          description="Your wallet asks twice: first to allow this exact amount, then to send the refund. Nothing else can be spent."
          onRetryRecord={tx.retryRecord}
        />

        <DialogFooter>
          {done ? (
            <Button onClick={() => setOpen(false)}>Close</Button>
          ) : (
            <>
              <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
                Not now
              </Button>
              <Button disabled={busy || !deployed || !rightWallet || (touched && !check.ok)} onClick={() => void start()}>
                {creating ? "Preparing…" : tx.isBusy ? "Check your wallet…" : tx.state.phase === "error" ? "Try again" : "Refund"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
