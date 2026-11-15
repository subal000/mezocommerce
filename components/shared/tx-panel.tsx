"use client";

import type { ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CircleAlert, CircleCheck, Loader2, Wallet } from "lucide-react";
import type { TxState } from "@/hooks/use-tx";
import { cn } from "@/lib/client/utils";
import { TxLink } from "./address";

const COPY: Record<TxState["phase"], string> = {
  idle: "",
  wallet: "Confirm in your wallet.",
  submitted: "Sent. Waiting for Mezo Testnet to include it.",
  recording: "Included. Updating MezoCommerce.",
  success: "Done.",
  error: "Failed.",
};

/**
 * Every transaction's progress, in one place. Before anything starts it shows `description`:
 * what the wallet is about to ask, in one plain sentence.
 */
export function TxPanel({ state, description, onRetryRecord, className }: { state: TxState; description?: ReactNode; onRetryRecord?: () => void; className?: string }) {
  const reduce = useReducedMotion();
  const busy = state.phase === "wallet" || state.phase === "submitted" || state.phase === "recording";
  const showDescription = description && (state.phase === "idle" || state.phase === "error" || state.phase === "wallet");

  return (
    <div className={cn("space-y-2", className)}>
      {showDescription ? (
        <div className="flex gap-2.5 rounded-lg bg-surface px-3 py-2.5 text-sm text-muted-foreground ring-1 ring-border">
          <Wallet className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} aria-hidden />
          <div className="min-w-0">{description}</div>
        </div>
      ) : null}
      <div aria-live="polite">
        <AnimatePresence initial={false}>
          {state.phase !== "idle" ? (
            <motion.div
              key="tx"
              initial={reduce ? false : { opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? undefined : { opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.25, 1, 0.5, 1] }}
              role={state.phase === "error" ? "alert" : "status"}
              className={cn(
                "rounded-lg border px-3 py-2.5 text-sm",
                state.phase === "error" ? "border-bad/35 bg-bad/5" : state.recordError ? "border-warn/40 bg-warn/5" : "bg-card",
              )}
            >
              <div className="flex items-start gap-2">
                {busy ? (
                  <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
                ) : state.phase === "error" || state.recordError ? (
                  <CircleAlert className={cn("mt-0.5 size-4 shrink-0", state.phase === "error" ? "text-bad" : "text-warn")} aria-hidden />
                ) : (
                  <CircleCheck className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {state.label}
                    {state.progress ? <span className="font-normal text-muted-foreground"> ({state.progress})</span> : null}
                  </p>
                  <p className="text-muted-foreground">
                    {state.phase === "error"
                      ? `${state.error?.title ?? "Failed"}. ${state.error?.message ?? ""}`
                      : state.recordError
                        ? `Done on-chain, but MezoCommerce couldn't update yet: ${state.recordError}`
                        : COPY[state.phase]}
                  </p>
                  {state.hash || (state.recordError && onRetryRecord) ? (
                    <div className="mt-1 flex flex-wrap items-center gap-3">
                      {state.hash ? <TxLink hash={state.hash} label="View transaction" /> : null}
                      {state.recordError && onRetryRecord ? (
                        <button type="button" onClick={onRetryRecord} className="cursor-pointer text-[0.8125rem] font-medium underline underline-offset-4">
                          Try again
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}
