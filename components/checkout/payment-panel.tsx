"use client";

import { useState, type ReactNode } from "react";
import { ArrowUpRight, Smartphone } from "lucide-react";
import { toast } from "sonner";
import type { CheckoutDTO, CheckoutStatusDTO } from "@/lib/api-types";
import { explorerTx } from "@/lib/chain/config";
import { describeTxError } from "@/lib/client/checkout-errors";
import { BTC_FAUCET_URL, GET_MUSD_URL, shortMusd, walletPromptExplainer } from "@/lib/client/checkout-messages";
import type { PayMode } from "@/lib/client/checkout-pay";
import type { CheckoutView } from "@/lib/client/checkout-state";
import { merchantAccent, safeHttpUrl, shortHash } from "@/lib/client/checkout-format";
import { shortAddress } from "@/lib/client/wallet-network";
import { cn } from "@/lib/client/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ConnectDialog } from "@/components/wallet/connect-dialog";
import { QrCode } from "./qr-code";
import { Receipt } from "./receipt";
import { StatusDot, type StatusTone } from "./status-dot";

export interface PanelProps {
  view: CheckoutView;
  checkout: CheckoutDTO;
  status: CheckoutStatusDTO | null;
  address?: string;
  isSwitching: boolean;
  switchToMezo: () => Promise<void>;
  mode: PayMode;
  /** False for Mezo Passport Bitcoin wallets (smart accounts can only approve → pay). */
  canChooseMode?: boolean;
  setMode: (m: PayMode) => void;
  pay: () => void;
  retry: () => void;
  recheck: () => void;
  embed: boolean;
  /** No injected wallet available in this browsing context. */
  noWallet: boolean;
  checkoutUrl: string;
  onDone: () => void;
  onLeave: () => void;
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium underline-offset-4 hover:underline">
      {children}
      <ArrowUpRight className="size-3.5" aria-hidden />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

function TxLink({ hash, label = "View transaction" }: { hash: string | null | undefined; label?: string }) {
  if (!hash) return null;
  return (
    <p className="text-sm text-muted-foreground">
      <ExternalLink href={explorerTx(hash)}>
        {label} <span className="font-mono text-[0.8125rem] font-normal">{shortHash(hash)}</span>
      </ExternalLink>
    </p>
  );
}

/** Heading block of each state: dot + word status, then one or two plain sentences. */
function State({ tone, label, title, children }: { tone: StatusTone; label: string; title: string; children?: ReactNode }) {
  return (
    <div className="space-y-2">
      <StatusDot tone={tone}>{label}</StatusDot>
      <h2 className="text-lg font-semibold tracking-[-0.01em]">{title}</h2>
      {children ? <div className="space-y-2 text-sm text-muted-foreground">{children}</div> : null}
    </div>
  );
}

/** Two-step progress for wallet prompts. A real sequence, so numbered. */
function Steps({ mode, current, needsApproval }: { mode: PayMode; current: 1 | 2; needsApproval: boolean }) {
  const first = mode === "permit" ? "Sign spending permission" : needsApproval ? "Approve MUSD" : null;
  const items = first ? [first, "Confirm payment"] : ["Confirm payment"];
  const at = first ? current : 1;
  return (
    <ol className="space-y-2 text-sm" aria-label="Wallet steps">
      {items.map((t, i) => {
        const n = i + 1;
        const done = n < at;
        const active = n === at;
        return (
          <li key={t} className="flex items-center gap-3" aria-current={active ? "step" : undefined}>
            <span
              className={cn(
                "num flex size-6 items-center justify-center rounded-full text-xs font-medium",
                done ? "bg-brand text-brand-foreground" : active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
              )}
            >
              {n}
            </span>
            <span className={active ? "font-medium" : "text-muted-foreground"}>
              {t}
              {done ? <span className="sr-only"> (done)</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function PayOnPhone({ url, defaultOpen = false }: { url: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        <Smartphone className="size-4" aria-hidden /> Pay on your phone
      </button>
    );
  }
  return (
    <div className="flex items-center gap-4">
      <QrCode value={url} size={128} label="QR code linking to this checkout" />
      <div className="space-y-1 text-sm">
        <p className="font-medium">Scan to pay on your phone</p>
        <p className="text-muted-foreground">Opens this checkout. Use a phone with a wallet app.</p>
      </div>
    </div>
  );
}

export function PaymentPanel(p: PanelProps) {
  const { view, checkout } = p;
  const [connectOpen, setConnectOpen] = useState(false);
  const amount = shortMusd(checkout.amount);
  const accent = merchantAccent(checkout.merchant.brand_color);
  const backUrl = safeHttpUrl(checkout.cancel_url) ?? safeHttpUrl(checkout.return_url) ?? safeHttpUrl(checkout.merchant.website);

  const backToStore =
    p.embed ? (
      <Button variant="outline" size="lg" className="w-full" onClick={p.onLeave}>
        Close
      </Button>
    ) : backUrl ? (
      <Button variant="outline" size="lg" className="w-full" asChild>
        <a href={backUrl}>Return to {checkout.merchant.name}</a>
      </Button>
    ) : null;

  const walletRow = p.address ? (
    <p className="text-[0.8125rem] text-muted-foreground">
      Paying from <span className="font-mono text-foreground">{shortAddress(p.address)}</span>
    </p>
  ) : null;

  switch (view.kind) {
    case "loading":
    case "checking":
      return (
        <div className="space-y-4" aria-busy="true">
          {view.kind === "checking" ? (
            <StatusDot tone="idle">Checking your balance…</StatusDot>
          ) : (
            <>
              <span className="sr-only">Loading checkout…</span>
              <Skeleton className="h-4 w-28" />
            </>
          )}
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
      );

    case "not_found":
    case "load_error":
      // rendered full-page by CheckoutView
      return null;

    case "connect":
      return (
        <div className="space-y-5">
          <State tone="idle" label="Not connected" title="Pay with your wallet">
            <p>Connect a wallet on Mezo Testnet to pay {amount} MUSD.</p>
          </State>
          {p.noWallet ? (
            <div className="space-y-4">
              <p className="text-sm">
                {p.embed ? "No wallet found in this window." : "No wallet found in this browser."} Pay on your phone or open the checkout in a new tab.
              </p>
              <PayOnPhone url={p.checkoutUrl} defaultOpen />
              {p.embed ? (
                <Button size="lg" variant="outline" className="w-full" asChild>
                  <a href={p.checkoutUrl} target="_blank" rel="noopener">
                    Open in new tab
                  </a>
                </Button>
              ) : null}
            </div>
          ) : (
            <>
              <Button size="lg" className="w-full" onClick={() => setConnectOpen(true)}>
                Connect wallet
              </Button>
              <ConnectDialog open={connectOpen} onOpenChange={setConnectOpen} />
              <PayOnPhone url={p.checkoutUrl} />
            </>
          )}
        </div>
      );

    case "wrong_network":
      return (
        <div className="space-y-5">
          <State tone="warn" label="Wrong network" title="Switch to Mezo Testnet">
            <p>Your wallet is on a different network. Switch to Mezo Testnet to pay.</p>
          </State>
          <Button
            size="lg"
            className="w-full"
            disabled={p.isSwitching}
            onClick={() => p.switchToMezo().catch((e) => toast.error(describeTxError(e).message))}
          >
            {p.isSwitching ? "Check your wallet…" : "Switch network"}
          </Button>
        </div>
      );

    case "preflight_error":
      return (
        <div className="space-y-5">
          <State tone="warn" label="Couldn't check" title="We couldn't check your balance">
            <p>Mezo Testnet didn&apos;t answer. Try again in a moment.</p>
          </State>
          <Button size="lg" variant="outline" className="w-full" onClick={p.recheck}>
            Try again
          </Button>
        </div>
      );

    case "insufficient_musd":
      return (
        <div className="space-y-5">
          <State tone="warn" label="Not enough MUSD" title="Add MUSD to this wallet">
            <p>{view.message}</p>
            <p>
              <ExternalLink href={GET_MUSD_URL}>Get MUSD on testnet.mezo.org</ExternalLink>
            </p>
          </State>
          {walletRow}
          <Button size="lg" variant="outline" className="w-full" onClick={p.recheck}>
            Check again
          </Button>
        </div>
      );

    case "insufficient_gas":
      return (
        <div className="space-y-5">
          <State tone="warn" label="No BTC for fees" title="Add testnet BTC for the network fee">
            <p>Payments on Mezo cost a small network fee in BTC. This wallet doesn&apos;t have enough for it.</p>
            <p>
              <ExternalLink href={BTC_FAUCET_URL}>Get testnet BTC from the faucet</ExternalLink>
            </p>
          </State>
          {walletRow}
          <Button size="lg" variant="outline" className="w-full" onClick={p.recheck}>
            Check again
          </Button>
        </div>
      );

    case "blocked":
      return (
        <div className="space-y-5">
          <State tone={view.check.recoverable ? "warn" : "bad"} label={view.check.title} title={view.check.title}>
            <p>{view.check.message}</p>
          </State>
          {view.check.recoverable ? (
            <Button size="lg" variant="outline" className="w-full" onClick={p.recheck}>
              Check again
            </Button>
          ) : (
            backToStore
          )}
        </div>
      );

    case "ready": {
      const explainer = walletPromptExplainer(p.mode, checkout.amount, view.needsApproval);
      return (
        <div className="space-y-5">
          <State tone="ok" label="Ready" title={`Pay ${amount} MUSD`}>
            <p>{explainer}</p>
          </State>
          {walletRow}
          <Button
            size="lg"
            className="w-full"
            style={accent ? { background: accent.bg, color: accent.fg } : undefined}
            onClick={p.pay}
          >
            Pay {amount} MUSD
          </Button>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-[0.8125rem] text-muted-foreground">
            <span>Network fee paid in testnet BTC.</span>
            {p.canChooseMode !== false ? (
              <button
                type="button"
                className="cursor-pointer underline-offset-4 hover:text-foreground hover:underline"
                onClick={() => p.setMode(p.mode === "permit" ? "approve" : "permit")}
              >
                {p.mode === "permit" ? "Use two-step approval instead" : "Use one signature instead"}
              </button>
            ) : null}
          </div>
          <PayOnPhone url={p.checkoutUrl} />
        </div>
      );
    }

    case "permit_requested":
      return (
        <div className="space-y-5">
          <State tone="info" label="Waiting for your wallet" title="Sign the spending permission">
            <p>Your wallet is asking you to allow exactly {amount} MUSD for this payment. Signing is free.</p>
          </State>
          <Steps mode="permit" current={1} needsApproval />
        </div>
      );

    case "approval_requested":
      return (
        <div className="space-y-5">
          <State tone="info" label="Waiting for your wallet" title={`Approve ${amount} MUSD`}>
            <p>Your wallet is asking you to approve exactly {amount} MUSD for this payment.</p>
          </State>
          <Steps mode="approve" current={1} needsApproval />
        </div>
      );

    case "approval_confirming":
      return (
        <div className="space-y-5">
          <State tone="info" label="Approval sent" title="Waiting for the approval to confirm">
            <p>This takes a few seconds. Your wallet will then ask you to confirm the payment.</p>
          </State>
          <Steps mode="approve" current={1} needsApproval />
          <TxLink hash={view.approvalHash} label="View approval" />
        </div>
      );

    case "pay_requested":
      return (
        <div className="space-y-5">
          <State tone="info" label="Waiting for your wallet" title="Confirm the payment">
            <p>Your wallet is asking you to confirm the payment of {amount} MUSD.</p>
          </State>
          <Steps mode={p.mode} current={2} needsApproval={p.mode === "permit"} />
        </div>
      );

    case "submitted":
      return (
        <div className="space-y-5">
          <State tone="info" label="Transaction submitted" title="Waiting for the network">
            <p>Your payment was sent. We&apos;re waiting for Mezo Testnet to include it.</p>
          </State>
          <TxLink hash={view.txHash} />
          <p className="text-[0.8125rem] text-muted-foreground">Keep this page open to see the confirmation.</p>
        </div>
      );

    case "confirming": {
      const n = Math.min(view.confirmations, view.required);
      return (
        <div className="space-y-5">
          <State tone="info" label="Confirming" title="Confirming your payment">
            <p>
              <span className="num">{n}</span> of <span className="num">{view.required}</span> confirmations. This usually takes under a minute.
            </p>
          </State>
          <div className="flex gap-1.5" role="progressbar" aria-label="Confirmations" aria-valuemin={0} aria-valuemax={view.required} aria-valuenow={n}>
            {Array.from({ length: Math.max(1, view.required) }, (_, i) => (
              <span key={i} className={cn("h-1.5 flex-1 rounded-full transition-colors duration-300", i < n ? "bg-brand" : "bg-muted")} />
            ))}
          </div>
          <TxLink hash={view.txHash} />
        </div>
      );
    }

    case "paid":
    case "already_paid":
    case "late_paid":
      return <Receipt kind={view.kind} checkout={checkout} status={p.status} txHash={view.txHash} embed={p.embed} onDone={p.onDone} />;

    case "failed":
      return (
        <div className="space-y-5">
          <State tone={view.error.kind === "rejected" ? "idle" : "bad"} label={view.error.kind === "rejected" ? "Cancelled" : "Failed"} title={view.error.title}>
            <p>{view.error.message}</p>
            {view.error.kind === "funds" ? (
              <p>
                <ExternalLink href={BTC_FAUCET_URL}>Get testnet BTC from the faucet</ExternalLink>
              </p>
            ) : null}
          </State>
          <TxLink hash={view.txHash} />
          <Button size="lg" className="w-full" onClick={p.retry}>
            Try again
          </Button>
        </div>
      );

    case "expired":
      return (
        <div className="space-y-5">
          <State tone="idle" label="Expired" title="This checkout expired">
            <p>No payment was taken. Return to the store to start again.</p>
          </State>
          {backToStore}
        </div>
      );

    case "cancelled":
      return (
        <div className="space-y-5">
          <State tone="idle" label="Cancelled" title="This checkout was cancelled">
            <p>The store cancelled this checkout. No payment was taken.</p>
          </State>
          {backToStore}
        </div>
      );

    case "unavailable":
      return (
        <div className="space-y-5">
          <State tone="idle" label="Unavailable" title="This checkout can't be paid right now">
            <p>Return to the store and start the checkout again.</p>
          </State>
          {backToStore}
        </div>
      );
  }
}
