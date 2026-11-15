"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useConfig } from "wagmi";
import type { Hash } from "viem";
import { toast } from "sonner";
import type { CheckoutDTO, CheckoutStatusDTO, PreflightDTO } from "@/lib/api-types";
import { isPayable } from "@/lib/chain/payment-state";
import { api, ApiClientError, errorMessage, isNotFound } from "@/lib/client/api";
import { describeTxError } from "@/lib/client/checkout-errors";
import { reportSubmitted, runPayment, watchForRevert, type PayMode } from "@/lib/client/checkout-pay";
import {
  deriveCheckoutView,
  flowReducer,
  initialFlow,
  type CheckoutView,
  type Loadable,
  type PreflightState,
} from "@/lib/client/checkout-state";
import { useIsClient, useMezoNetwork } from "@/components/wallet/connect-dialog";

const enc = encodeURIComponent;

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** All data + actions for one hosted checkout. View derivation is pure (lib/client/checkout-state.ts). */
export function useCheckout(id: string) {
  const config = useConfig();
  const queryClient = useQueryClient();
  const isClient = useIsClient();
  const wallet = useMezoNetwork();
  const now = useNow();
  const [flow, dispatch] = useReducer(flowReducer, initialFlow);
  const [chosenMode, setMode] = useState<PayMode>("permit");
  // Mezo Passport Bitcoin wallets pay through a smart account, which can't sign an EIP-2612 permit
  // (MUSD checks it with ecrecover). They always use approve(exact amount) → pay.
  const mode: PayMode = wallet.isSmartAccount ? "approve" : chosenMode;
  const flowRef = useRef(flow);
  useEffect(() => {
    flowRef.current = flow;
  }, [flow]);

  const checkoutQ = useQuery({
    queryKey: ["public-checkout", id],
    queryFn: () => api<CheckoutDTO>(`/api/public/checkout/${enc(id)}`),
    refetchInterval: (q) => (q.state.error && isNotFound(q.state.error) ? false : 20_000),
    retry: (n, err) => !(err instanceof ApiClientError && err.status < 500) && n < 3,
  });

  const statusKey = ["public-checkout-status", id] as const;
  const statusQ = useQuery({
    queryKey: statusKey,
    queryFn: () => api<CheckoutStatusDTO>(`/api/public/checkout/${enc(id)}/status`),
    enabled: checkoutQ.isSuccess,
    refetchInterval: (q) => {
      const s = q.state.data;
      if (s?.verified) return false;
      if (flowRef.current.step === "submitted" || s?.status === "submitted" || s?.status === "confirming") return 2_500;
      if (s && (s.status === "expired" || s.status === "cancelled")) return 15_000;
      return 5_000;
    },
    refetchIntervalInBackground: true,
  });

  const c = checkoutQ.data;
  const payable = Boolean(c && c.intent && isPayable(c.status) && new Date(c.expires_at).getTime() > now);
  const flowIdle = flow.step === "idle" || flow.step === "failed";
  const preflightEnabled = Boolean(isClient && wallet.isReady && wallet.address && payable && flowIdle && !statusQ.data?.verified);

  const preflightQ = useQuery({
    queryKey: ["public-checkout-preflight", id, wallet.address?.toLowerCase()],
    queryFn: () => api<PreflightDTO>(`/api/public/checkout/${enc(id)}/preflight?payer=${enc(wallet.address ?? "")}`),
    enabled: preflightEnabled,
    refetchInterval: preflightEnabled ? 20_000 : false,
    staleTime: 4_000,
  });

  const checkout: Loadable<CheckoutDTO> = checkoutQ.data
    ? { kind: "ok", data: checkoutQ.data }
    : checkoutQ.error
      ? isNotFound(checkoutQ.error)
        ? { kind: "not_found" }
        : { kind: "error", message: errorMessage(checkoutQ.error) }
      : { kind: "loading" };

  const preflight: PreflightState = !preflightEnabled
    ? { kind: "idle" }
    : preflightQ.data && !preflightQ.isError
      ? { kind: "ok", data: preflightQ.data }
      : preflightQ.isError
        ? { kind: "error", message: errorMessage(preflightQ.error) }
        : { kind: "loading" };

  const view: CheckoutView = deriveCheckoutView({
    checkout,
    status: statusQ.data ?? null,
    wallet: { isClient, isConnected: wallet.isConnected, isWrongNetwork: wallet.isWrongNetwork, address: wallet.address },
    preflight,
    flow,
    now,
  });

  const pay = useCallback(async () => {
    const data = checkoutQ.data;
    if (!data) return;
    dispatch({ type: "reset" });
    let hash: Hash;
    try {
      hash = await runPayment({
        config,
        checkout: data,
        mode,
        onStep: (s) => {
          if (s.step === "fallback_to_approve") {
            setMode("approve");
            toast.info("Your wallet can't sign a spending permission, so we'll use a two-step approval instead.");
            return;
          }
          if (s.step === "approval_confirming") dispatch({ type: "approval_confirming", approvalHash: s.approvalHash });
          else dispatch({ type: s.step });
        },
      });
    } catch (err) {
      dispatch({ type: "failed", error: describeTxError(err) });
      return;
    }
    dispatch({ type: "submitted", txHash: hash });
    reportSubmitted(id, { tx_hash: hash, payer_address: wallet.address?.toLowerCase() })
      .then((s) => queryClient.setQueryData(statusKey, s))
      .catch(() => {
        /* only a hint; the indexer finds the payment on its own */
      })
      .finally(() => statusQ.refetch());
    watchForRevert(config, hash).then((reverted) => {
      if (reverted) {
        dispatch({
          type: "failed",
          txHash: hash,
          error: { kind: "revert", title: "Payment didn't go through", message: "The transaction failed on-chain. Nothing was charged." },
        });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkoutQ.data, config, mode, id, wallet.address, queryClient]);

  const retry = useCallback(() => {
    dispatch({ type: "reset" });
    void preflightQ.refetch();
    void statusQ.refetch();
  }, [preflightQ, statusQ]);

  return {
    view,
    checkout: checkoutQ.data ?? null,
    status: statusQ.data ?? null,
    preflight: preflightQ.data ?? null,
    wallet,
    mode,
    setMode,
    /** False for smart-account wallets, which can only use approve → pay. */
    canChooseMode: !wallet.isSmartAccount,
    pay,
    retry,
    recheck: () => void preflightQ.refetch(),
    reload: () => void checkoutQ.refetch(),
    now,
    isClient,
  };
}
