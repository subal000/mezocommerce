"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { embedMessage, isFramed, parseInbound, postToParent } from "@/lib/client/checkout-embed";
import { safeHttpUrl } from "@/lib/client/checkout-format";
import { VERIFIED_VIEWS, WALLET_BUSY_VIEWS } from "@/lib/client/checkout-state";
import { hasInjectedProvider } from "@/lib/client/wallet-network";
import { cn } from "@/lib/client/utils";
import { Button } from "@/components/ui/button";
import { OrderSummary } from "./order-summary";
import { PaymentPanel } from "./payment-panel";
import { useCheckout } from "./use-checkout";

const noopSubscribe = () => () => {};

/** Hosted checkout (/checkout/[id]) and its embedded variant (?embed=1, inside the widget iframe). */
export function CheckoutView({ id, embed }: { id: string; embed: boolean }) {
  const co = useCheckout(id);
  const { view, checkout } = co;
  const reduce = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const origin = useSyncExternalStore(noopSubscribe, () => window.location.origin, () => "");
  const [noWallet, setNoWallet] = useState(false);

  useEffect(() => {
    // EIP-6963 wallets announce within a tick; check for an injected provider shortly after mount.
    const t = setTimeout(() => setNoWallet(!hasInjectedProvider()), 400);
    return () => clearTimeout(t);
  }, []);

  const checkoutUrl = `${origin}/checkout/${encodeURIComponent(checkout?.id ?? id)}`;
  const piId = checkout?.id ?? id;
  const serverStatus = co.status?.status ?? checkout?.status ?? null;
  const verified = VERIFIED_VIEWS.includes(view.kind);
  const txHash = co.status?.payment?.transaction_hash ?? ("txHash" in view ? (view.txHash ?? null) : null);

  // ── embed bridge ──
  const framed = embed && origin !== "" && isFramed();
  useEffect(() => {
    if (!framed) return;
    postToParent(embedMessage("ready", { paymentIntentId: piId }));
    const onMsg = (e: MessageEvent) => {
      // No inbound commands. The widget's close ack is recognised and deliberately does nothing.
      if (e.source !== window.parent) return;
      parseInbound(e.data);
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [framed, piId]);

  useEffect(() => {
    if (!framed || !rootRef.current) return;
    const el = rootRef.current;
    const ro = new ResizeObserver(() => postToParent(embedMessage("resize", { paymentIntentId: piId, height: el.scrollHeight })));
    ro.observe(el);
    return () => ro.disconnect();
  }, [framed, piId]);

  useEffect(() => {
    if (!framed || !serverStatus) return;
    postToParent(embedMessage("status", { paymentIntentId: piId, status: serverStatus, txHash }));
  }, [framed, piId, serverStatus, txHash]);

  const sentSuccess = useRef(false);
  useEffect(() => {
    // success ONLY from a verified status poll
    if (!framed || !verified || !co.status?.verified || sentSuccess.current) return;
    sentSuccess.current = true;
    postToParent(embedMessage("success", { paymentIntentId: piId, status: co.status.status, txHash }));
  }, [framed, verified, co.status, piId, txHash]);

  const closeEmbed = () => postToParent(embedMessage("close", { paymentIntentId: piId, status: serverStatus, txHash }));

  // ── full-page states ──
  if (view.kind === "not_found" || view.kind === "load_error") {
    const nf = view.kind === "not_found";
    return (
      <Shell embed={embed} rootRef={rootRef}>
        <div className="mx-auto max-w-sm space-y-3 py-10 text-center" role="alert">
          <h1 className="text-xl font-semibold">{nf ? "Checkout not found" : "Couldn't load this checkout"}</h1>
          <p className="text-sm text-muted-foreground">
            {nf ? "Check the link, or return to the store and start the checkout again." : "Check your connection and try again."}
          </p>
          {nf ? null : (
            <Button variant="outline" onClick={co.reload}>
              Try again
            </Button>
          )}
          {embed ? (
            <Button variant="outline" onClick={closeEmbed}>
              Close
            </Button>
          ) : null}
        </div>
      </Shell>
    );
  }

  const busy = WALLET_BUSY_VIEWS.includes(view.kind);
  const cancelUrl = checkout ? safeHttpUrl(checkout.cancel_url) : null;
  const showCancel = checkout && !verified && !busy && view.kind !== "submitted" && view.kind !== "confirming";

  const panel = checkout ? (
    <PaymentPanel
      view={view}
      checkout={checkout}
      status={co.status}
      address={co.wallet.address}
      isSwitching={co.wallet.isSwitching}
      switchToMezo={co.wallet.switchToMezo}
      mode={co.mode}
      setMode={co.setMode}
      canChooseMode={co.canChooseMode}
      pay={co.pay}
      retry={co.retry}
      recheck={co.recheck}
      embed={embed}
      noWallet={noWallet}
      checkoutUrl={checkoutUrl}
      onDone={closeEmbed}
      onLeave={closeEmbed}
    />
  ) : (
    <div className="space-y-4" aria-busy="true">
      <span className="sr-only">Loading checkout…</span>
      <div className="h-4 w-28 animate-pulse rounded bg-muted" />
      <div className="h-6 w-2/3 animate-pulse rounded bg-muted" />
      <div className="h-11 w-full animate-pulse rounded-md bg-muted" />
    </div>
  );

  const animated = (
    <div aria-live="polite" aria-atomic="false">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={view.kind}
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduce ? 0.01 : 0.18, ease: [0.25, 1, 0.5, 1] }}
        >
          {panel}
        </motion.div>
      </AnimatePresence>
    </div>
  );

  const cancel = showCancel ? (
    embed ? (
      <button type="button" onClick={closeEmbed} className="cursor-pointer text-[0.8125rem] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
        Cancel payment
      </button>
    ) : cancelUrl ? (
      <a href={cancelUrl} className="text-[0.8125rem] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
        Cancel and return to {checkout.merchant.name}
      </a>
    ) : null
  ) : null;

  if (embed) {
    return (
      <Shell embed rootRef={rootRef}>
        <div className="space-y-6 p-5 sm:p-6">
          {checkout ? <OrderSummary checkout={checkout} now={co.now} compact /> : <SummarySkeleton compact />}
          <div className="border-t pt-6">{animated}</div>
          <div className="flex items-center justify-between gap-4">
            {cancel ?? <span />}
            <TestnetNote />
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell embed={false} rootRef={rootRef}>
      <div className="mx-auto grid w-full max-w-[980px] gap-8 px-4 py-8 sm:px-6 md:grid-cols-[minmax(0,1fr)_minmax(0,420px)] md:gap-16 md:py-20">
        <div className="md:pt-6">{checkout ? <OrderSummary checkout={checkout} now={co.now} /> : <SummarySkeleton />}</div>
        <div className="space-y-4">
          <div className="rounded-xl border bg-card p-5 shadow-panel sm:p-7">{animated}</div>
          <div className="flex flex-col items-start gap-2 px-1 sm:flex-row sm:items-center sm:justify-between">
            {cancel ?? <span />}
            <TestnetNote />
          </div>
        </div>
      </div>
    </Shell>
  );
}

function Shell({ embed, rootRef, children }: { embed: boolean; rootRef: React.RefObject<HTMLDivElement | null>; children: React.ReactNode }) {
  return (
    <div ref={rootRef} className={cn("w-full text-foreground", embed ? "bg-card" : "min-h-[100dvh] bg-surface")}>
      <main id="main">{children}</main>
    </div>
  );
}

function TestnetNote() {
  return <p className="text-[0.8125rem] text-muted-foreground">Testnet payment. MUSD here has no real value.</p>;
}

function SummarySkeleton({ compact = false }: { compact?: boolean }) {
  return (
    <div className="space-y-6" aria-hidden>
      <div className="flex items-center gap-3">
        <div className="size-9 animate-pulse rounded-lg bg-muted" />
        <div className="h-4 w-32 animate-pulse rounded bg-muted" />
      </div>
      <div className={cn("animate-pulse rounded bg-muted", compact ? "h-8 w-36" : "h-11 w-48")} />
      {compact ? null : <div className="h-4 w-64 animate-pulse rounded bg-muted" />}
    </div>
  );
}
