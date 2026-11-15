"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSignMessage } from "wagmi";
import type { NonceResponse, SessionDTO } from "@/lib/api-types";
import { api } from "@/lib/client/api";
import { useWallet } from "./use-wallet";
import { qk, useSession } from "./use-api";

/**
 * Wallet sign-in: POST /api/auth/nonce → personal_sign → POST /api/auth/verify.
 * `signedIn` is true only when the session belongs to the wallet that's connected right now.
 */
export function useAuth() {
  const w = useWallet();
  const session = useSession();
  const qc = useQueryClient();
  const { signMessageAsync } = useSignMessage();

  const sessionAddress = session.data?.address ?? null;
  const signedIn = Boolean(w.address && sessionAddress && sessionAddress.toLowerCase() === w.address.toLowerCase());

  const signIn = useMutation({
    mutationFn: async () => {
      if (!w.address) throw new Error("Connect a wallet first.");
      const address = w.address.toLowerCase();
      const { message } = await api<NonceResponse>("/api/auth/nonce", { method: "POST", json: { address } });
      const signature = await signMessageAsync({ message });
      return api<SessionDTO>("/api/auth/verify", { method: "POST", json: { address, message, signature } });
    },
    onSuccess: async (res) => {
      if (res && typeof res === "object" && "address" in res) qc.setQueryData(qk.session, res);
      await qc.invalidateQueries({ queryKey: qk.all });
    },
  });

  const signOut = useMutation({
    mutationFn: () => api<unknown>("/api/auth/logout", { method: "POST", json: {} }),
    onSettled: async () => {
      qc.setQueryData(qk.session, null);
      qc.removeQueries({ queryKey: ["api", "merchant"] });
    },
  });

  return {
    wallet: w,
    session: session.data ?? null,
    sessionAddress,
    sessionLoading: session.isLoading,
    signedIn,
    /** Session exists, but for a different wallet than the one connected. */
    mismatch: Boolean(w.address && sessionAddress && !signedIn),
    signIn,
    signOut,
  };
}
