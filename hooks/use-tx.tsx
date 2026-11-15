"use client";

import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useConfig } from "wagmi";
import { toast } from "sonner";
import type { Hash, TransactionReceipt } from "viem";
import { explorerTx } from "@/lib/chain/config";
import { describeTxError, type TxError } from "@/lib/client/errors";
import { executeWrite, type WriteSpec } from "@/lib/client/writes";
import { errorMessage } from "@/lib/client/api";
import { shortHash } from "@/lib/client/format";

/**
 * idle      nothing started; the UI explains what the wallet will ask
 * wallet    waiting for the person in their wallet
 * submitted sent, waiting for Mezo Testnet to include it (hash known)
 * recording included, telling MezoCommerce so it can verify and sync
 * success   done
 * error     failed (decoded reason). recordError = the tx worked but syncing failed (retryable)
 */
export type TxPhase = "idle" | "wallet" | "submitted" | "recording" | "success" | "error";

export interface TxState {
  phase: TxPhase;
  label: string;
  hash?: Hash;
  error?: TxError;
  recordError?: string;
  /** e.g. "Step 1 of 2" */
  progress?: string;
}

const IDLE: TxState = { phase: "idle", label: "" };

export interface RunOptions {
  /** After the receipt: report the hash to the API (verify + sync). Retried by `retryRecord`. */
  record?: (hash: Hash, receipt: TransactionReceipt) => Promise<unknown>;
  successMessage?: string;
  progress?: string;
  /** Intermediate step of a sequence: no success toast and stays busy-looking. */
  intermediate?: boolean;
}

function ExplorerLink({ hash }: { hash: Hash }) {
  return (
    <a href={explorerTx(hash)} target="_blank" rel="noreferrer" className="underline underline-offset-2">
      View {shortHash(hash)} on the explorer
    </a>
  );
}

/** One transaction flow for every on-chain write: wallet → submitted → confirmed → POST hash to the API → success. */
export function useTx() {
  const config = useConfig();
  const qc = useQueryClient();
  const [state, setState] = useState<TxState>(IDLE);
  const busy = useRef(false);
  const lastRecord = useRef<{ fn: NonNullable<RunOptions["record"]>; hash: Hash; receipt: TransactionReceipt } | null>(null);

  const reset = useCallback(() => {
    if (busy.current) return;
    setState(IDLE);
    lastRecord.current = null;
  }, []);

  const run = useCallback(
    async (s: WriteSpec, opts: RunOptions = {}): Promise<{ hash: Hash; receipt: TransactionReceipt; recorded: boolean } | null> => {
      if (busy.current) return null;
      busy.current = true;
      setState({ phase: "wallet", label: s.label, progress: opts.progress });
      let hash: Hash | undefined;
      try {
        const res = await executeWrite(config, s, (h) => {
          hash = h;
          setState({ phase: "submitted", label: s.label, hash: h, progress: opts.progress });
        });
        hash = res.hash;
        if (opts.record) {
          setState({ phase: "recording", label: s.label, hash, progress: opts.progress });
          lastRecord.current = { fn: opts.record, hash: res.hash, receipt: res.receipt };
          try {
            await opts.record(res.hash, res.receipt);
            lastRecord.current = null;
          } catch (err) {
            const msg = errorMessage(err);
            setState({ phase: "success", label: s.label, hash, recordError: msg, progress: opts.progress });
            toast.warning(`${s.label}: confirmed on-chain, not synced yet`, { description: msg });
            busy.current = false;
            void qc.invalidateQueries();
            return { ...res, recorded: false };
          }
        }
        if (!opts.intermediate) {
          setState({ phase: "success", label: s.label, hash, progress: opts.progress });
          toast.success(opts.successMessage ?? `${s.label}: done`, { description: <ExplorerLink hash={res.hash} /> });
        }
        busy.current = false;
        void qc.invalidateQueries();
        return { ...res, recorded: true };
      } catch (err) {
        busy.current = false;
        const e = describeTxError(err);
        const failedHash = (err as { hash?: Hash } | null)?.hash ?? hash;
        setState({ phase: "error", label: s.label, hash: failedHash, error: e, progress: opts.progress });
        if (e.kind === "rejected") toast.message(e.title, { description: e.message });
        else toast.error(`${s.label} failed`, { description: e.message });
        return null;
      }
    },
    [config, qc],
  );

  const retryRecord = useCallback(async () => {
    const r = lastRecord.current;
    if (!r) return;
    setState((s) => ({ ...s, phase: "recording", recordError: undefined }));
    try {
      await r.fn(r.hash, r.receipt);
      lastRecord.current = null;
      setState((s) => ({ ...s, phase: "success", recordError: undefined }));
      toast.success("Synced");
      void qc.invalidateQueries();
    } catch (err) {
      setState((s) => ({ ...s, phase: "success", recordError: errorMessage(err) }));
    }
  }, [qc]);

  return {
    state,
    run,
    reset,
    retryRecord,
    setState,
    isBusy: state.phase === "wallet" || state.phase === "submitted" || state.phase === "recording",
  };
}

export type UseTx = ReturnType<typeof useTx>;
