import type { CheckoutDTO, CheckoutStatusDTO, PreflightDTO } from "@/lib/api-types";
import { effectiveStatus, isPayable, isSettled } from "@/lib/chain/payment-state";
import type { TxError } from "./checkout-errors";
import { payCheckMessage, type PayCheckMessage } from "./checkout-messages";

/**
 * Pure checkout state derivation. Every screen of the hosted checkout is one CheckoutView.
 * HARD RULE: the "paid" family of views is only ever produced when CheckoutStatusDTO.verified === true.
 */

/** What the wallet flow on this page is doing right now (local, client-side). */
export type FlowState =
  | { step: "idle" }
  | { step: "permit_requested" }
  | { step: "approval_requested" }
  | { step: "approval_confirming"; approvalHash: string }
  | { step: "pay_requested" }
  | { step: "submitted"; txHash: string }
  | { step: "failed"; error: TxError; txHash?: string };

export type FlowAction =
  | { type: "permit_requested" }
  | { type: "approval_requested" }
  | { type: "approval_confirming"; approvalHash: string }
  | { type: "pay_requested" }
  | { type: "submitted"; txHash: string }
  | { type: "failed"; error: TxError; txHash?: string }
  | { type: "reset" };

export const initialFlow: FlowState = { step: "idle" };

export function flowReducer(state: FlowState, action: FlowAction): FlowState {
  switch (action.type) {
    case "reset":
      return initialFlow;
    case "permit_requested":
    case "approval_requested":
    case "pay_requested":
      // a submitted payment can't be re-requested on this page without a reset
      if (state.step === "submitted") return state;
      return { step: action.type };
    case "approval_confirming":
      if (state.step === "submitted") return state;
      return { step: "approval_confirming", approvalHash: action.approvalHash };
    case "submitted":
      return { step: "submitted", txHash: action.txHash };
    case "failed":
      return { step: "failed", error: action.error, txHash: action.txHash ?? (state.step === "submitted" ? state.txHash : undefined) };
  }
}

export type Loadable<T> = { kind: "loading" } | { kind: "not_found" } | { kind: "error"; message: string } | { kind: "ok"; data: T };

export interface WalletInfo {
  isClient: boolean;
  isConnected: boolean;
  isWrongNetwork: boolean;
  address?: string;
}

export type PreflightState = { kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string } | { kind: "ok"; data: PreflightDTO };

export type CheckoutView =
  | { kind: "loading" }
  | { kind: "not_found" }
  | { kind: "load_error"; message: string }
  // verified outcomes (CheckoutStatusDTO.verified === true only)
  | { kind: "paid"; txHash: string | null }
  | { kind: "already_paid"; txHash: string | null }
  | { kind: "late_paid"; txHash: string | null }
  // on-chain progress
  | { kind: "submitted"; txHash: string | null }
  | { kind: "confirming"; txHash: string | null; confirmations: number; required: number }
  // closed
  | { kind: "expired" }
  | { kind: "cancelled" }
  | { kind: "unavailable" }
  // wallet + preflight
  | { kind: "connect" }
  | { kind: "wrong_network" }
  | { kind: "checking" }
  | { kind: "preflight_error"; message: string }
  | { kind: "insufficient_musd"; message: string }
  | { kind: "insufficient_gas" }
  | { kind: "blocked"; check: PayCheckMessage }
  | { kind: "ready"; needsApproval: boolean }
  // wallet prompts
  | { kind: "permit_requested" }
  | { kind: "approval_requested" }
  | { kind: "approval_confirming"; approvalHash: string }
  | { kind: "pay_requested" }
  | { kind: "failed"; error: TxError; txHash?: string };

export type CheckoutViewKind = CheckoutView["kind"];

export interface DeriveInput {
  checkout: Loadable<CheckoutDTO>;
  status: CheckoutStatusDTO | null;
  wallet: WalletInfo;
  preflight: PreflightState;
  flow: FlowState;
  now: number;
}

/** Verified views. Used by tests and the embed bridge to guarantee nothing else ever reads as success. */
export const VERIFIED_VIEWS: readonly CheckoutViewKind[] = ["paid", "already_paid", "late_paid"];

export function deriveCheckoutView(input: DeriveInput): CheckoutView {
  const { checkout, status, wallet, preflight, flow, now } = input;
  if (checkout.kind === "loading") return { kind: "loading" };
  if (checkout.kind === "not_found") return { kind: "not_found" };
  if (checkout.kind === "error") return { kind: "load_error", message: checkout.message };
  const c = checkout.data;

  // Server status wins over the cached checkout once it's in.
  const serverStatus = status?.status ?? c.status;
  const late = c.late;
  const localTx = flow.step === "submitted" ? flow.txHash : flow.step === "failed" ? flow.txHash : undefined;
  const attempt = status?.attempt ?? null;
  const paymentTx = status?.payment?.transaction_hash ?? c.payment?.transaction_hash ?? null;

  // 1. Verified on-chain (+ confirmations). The ONLY path to success.
  if (status?.verified === true) {
    const txHash = paymentTx ?? localTx ?? null;
    if (late) return { kind: "late_paid", txHash };
    if (localTx) return { kind: "paid", txHash };
    return { kind: "already_paid", txHash };
  }

  // Settled per the cached checkout, but the status poll hasn't confirmed verification yet: wait for it.
  if (isSettled(serverStatus) && !status) return { kind: "loading" };

  // 2. Seen on-chain, waiting for confirmations (or settled-but-unverified, which shouldn't happen: keep waiting).
  if (serverStatus === "confirming" || isSettled(serverStatus)) {
    return {
      kind: "confirming",
      txHash: paymentTx ?? localTx ?? attempt?.transaction_hash ?? null,
      confirmations: status?.payment?.confirmations ?? c.payment?.confirmations ?? 0,
      required: c.required_confirmations,
    };
  }

  // 3. Our transaction is out; the server reports the attempt failed → failed with its reason.
  if (flow.step === "submitted") {
    if (attempt && attempt.status === "failed" && sameHash(attempt.transaction_hash, flow.txHash)) {
      return {
        kind: "failed",
        txHash: flow.txHash,
        error: { kind: "revert", title: "Payment didn't go through", message: attempt.failure_reason || "The transaction failed on-chain. Nothing was charged." },
      };
    }
    return { kind: "submitted", txHash: flow.txHash };
  }
  // A transaction reported earlier (another tab, a reload) that the server is still looking at.
  if (serverStatus === "submitted" && flow.step === "idle") {
    return { kind: "submitted", txHash: attempt?.transaction_hash ?? null };
  }

  // 4. Closed checkouts. Expiry is evaluated against the clock even before the worker runs.
  const eff = effectiveStatus(serverStatus, c.expires_at, new Date(now));
  if (eff === "expired") return { kind: "expired" };
  if (eff === "cancelled") return { kind: "cancelled" };
  if (!isPayable(eff) || !c.intent) return { kind: "unavailable" };

  // 5. Wallet prompts in progress.
  switch (flow.step) {
    case "permit_requested":
      return { kind: "permit_requested" };
    case "approval_requested":
      return { kind: "approval_requested" };
    case "approval_confirming":
      return { kind: "approval_confirming", approvalHash: flow.approvalHash };
    case "pay_requested":
      return { kind: "pay_requested" };
    case "failed":
      return { kind: "failed", error: flow.error, txHash: flow.txHash };
  }

  // 6. Wallet + preflight.
  if (!wallet.isClient) return { kind: "loading" };
  if (!wallet.isConnected || !wallet.address) return { kind: "connect" };
  if (wallet.isWrongNetwork) return { kind: "wrong_network" };
  if (preflight.kind === "idle" || preflight.kind === "loading") return { kind: "checking" };
  if (preflight.kind === "error") return { kind: "preflight_error", message: preflight.message };

  const p = preflight.data;
  const amount = BigInt(c.amount);
  const balance = safeBig(p.musd_balance);
  if (p.check === "insufficient_balance" || (balance !== null && balance < amount)) {
    return { kind: "insufficient_musd", message: payCheckMessage("insufficient_balance", { amountWei: amount, balanceWei: balance ?? 0n }).message };
  }
  if (p.check === "expired") return { kind: "expired" };
  if (p.check === "cancelled") return { kind: "cancelled" };
  if (p.check !== "ok" && p.check !== "insufficient_allowance") return { kind: "blocked", check: payCheckMessage(p.check) };
  if (!p.gas_ok) return { kind: "insufficient_gas" };
  return { kind: "ready", needsApproval: p.needs_approval };
}

function sameHash(a: string | null | undefined, b: string | null | undefined) {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}

function safeBig(v: string): bigint | null {
  try {
    return BigInt(v);
  } catch {
    return null;
  }
}

/** Views in which the shopper is waiting on their wallet (used to disable navigation/close). */
export const WALLET_BUSY_VIEWS: readonly CheckoutViewKind[] = ["permit_requested", "approval_requested", "approval_confirming", "pay_requested"];

/** How often to poll /status for a view (ms), or false to stop. */
export function statusPollInterval(view: CheckoutView): number | false {
  switch (view.kind) {
    case "submitted":
    case "confirming":
      return 2_500;
    case "paid":
    case "already_paid":
    case "late_paid":
    case "not_found":
      return false;
    case "expired":
    case "cancelled":
      // a late on-chain payment can still turn up
      return 15_000;
    default:
      return 5_000;
  }
}
