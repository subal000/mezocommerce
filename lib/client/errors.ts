import { decodeErrorResult, parseAbi, type Hex } from "viem";
import { erc20Abi, processorAbi } from "@/lib/chain/abis";

/**
 * Turns wallet, RPC and contract errors into one plain sentence a person can act on.
 * Custom errors are decoded with the generated ABIs (plus common OpenZeppelin errors); raw hex never reaches the screen.
 */
export type TxErrorKind = "rejected" | "network" | "revert" | "funds" | "rpc" | "unknown";
export interface TxError {
  kind: TxErrorKind;
  title: string;
  message: string;
  errorName?: string;
}

const OZ_ERRORS = parseAbi([
  "error EnforcedPause()",
  "error ExpectedPause()",
  "error ReentrancyGuardReentrantCall()",
  "error SafeERC20FailedOperation(address token)",
  "error OwnableUnauthorizedAccount(address account)",
  "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
  "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
  "error ERC2612ExpiredSignature(uint256 deadline)",
  "error ERC2612InvalidSigner(address signer, address owner)",
]);

/** Plain messages for every custom error a merchant can hit (IMerchantPaymentProcessor + OZ + MUSD). */
export const ERROR_MESSAGES: Record<string, string> = {
  ZeroAddress: "Enter a valid wallet address.",
  NotMerchantOwner: "Only the wallet that registered this store can do that. Switch to your owner wallet.",
  NotAuthorized: "This wallet can't do that. Use the store's owner wallet or payout wallet.",
  UnknownMerchant: "This store isn't registered on-chain yet.",
  MerchantInactive: "Payments are paused for this store.",
  PayoutMismatch: "The payout wallet changed after this payment was created.",
  UnsupportedToken: "This token isn't accepted.",
  InvalidAmount: "That amount isn't allowed.",
  IntentExpired: "This payment has expired.",
  IntentAlreadyPaid: "This payment was already paid.",
  IntentCancelled: "This payment was already cancelled.",
  BadSignature: "The payment signature isn't valid for this store.",
  WrongPayer: "This payment is locked to a different wallet.",
  NotPaid: "This payment hasn't been paid, so there's nothing to refund.",
  RefundExceedsPayment: "A refund can't be more than what's left of the payment.",
  EnforcedPause: "MezoCommerce payments are paused by the operator. Refunds and cancels still work.",
  ExpectedPause: "Payments aren't paused.",
  ReentrancyGuardReentrantCall: "Another transaction is in progress. Try again.",
  SafeERC20FailedOperation: "The MUSD transfer failed. Check the balance and allowance.",
  OwnableUnauthorizedAccount: "This wallet doesn't have permission for this action.",
  ERC20InsufficientAllowance: "The MUSD allowance is lower than the amount. Approve it again and retry.",
  ERC20InsufficientBalance: "This wallet doesn't hold enough MUSD.",
  ERC2612ExpiredSignature: "The signature expired. Sign again.",
  ERC2612InvalidSigner: "The signature doesn't match this wallet. Sign again.",
};

export function messageForError(name: string): string {
  return ERROR_MESSAGES[name] ?? humanizeErrorName(name);
}

/** "RefundExceedsPayment" → "Refund exceeds payment." */
export function humanizeErrorName(name: string): string {
  const words = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/\s+/).filter(Boolean);
  if (!words.length) return "The contract rejected this transaction.";
  return `${words.map((w, i) => (i === 0 ? w : w.toLowerCase())).join(" ")}.`;
}

const ALL_ERRORS = [...processorAbi, ...erc20Abi, ...OZ_ERRORS].filter((x) => (x as { type: string }).type === "error");

export function decodeRevertData(data: Hex): { errorName: string } | null {
  try {
    const r = decodeErrorResult({ abi: ALL_ERRORS as never, data });
    return { errorName: r.errorName };
  } catch {
    return null;
  }
}

type Loose = { name?: string; code?: number | string; message?: string; shortMessage?: string; details?: string; reason?: string; data?: unknown; raw?: unknown; cause?: unknown };

function links(err: unknown): Loose[] {
  const out: Loose[] = [];
  const seen = new Set<unknown>();
  let cur: unknown = err;
  while (cur && typeof cur === "object" && !seen.has(cur) && out.length < 12) {
    seen.add(cur);
    out.push(cur as Loose);
    cur = (cur as Loose).cause;
  }
  return out;
}

const text = (e: Loose) => [e.shortMessage, e.details, e.message, e.reason].filter((s): s is string => typeof s === "string").join("\n");
const revert = (name: string): TxError => ({ kind: "revert", title: "The contract rejected this", message: messageForError(name), errorName: name });

export function describeTxError(err: unknown): TxError {
  if (err == null) return { kind: "unknown", title: "Something went wrong", message: "Please try again." };
  if (typeof err === "string") return { kind: "unknown", title: "Something went wrong", message: err };
  const chain = links(err);

  for (const e of chain) {
    if (e.name === "WrongNetworkError" || e.name === "ChainMismatchError") {
      return { kind: "network", title: "Wrong network", message: "Switch your wallet to Mezo Testnet and try again." };
    }
    if (e.name === "NotDeployedError") {
      return { kind: "unknown", title: "Contract not deployed yet", message: "On-chain actions turn on once the payment contract is live." };
    }
    if (
      e.name === "UserRejectedRequestError" ||
      e.code === 4001 ||
      e.code === "ACTION_REJECTED" ||
      /user (rejected|denied)|rejected the request|request rejected|denied (transaction|message) signature/i.test(text(e))
    ) {
      return { kind: "rejected", title: "Cancelled in wallet", message: "You cancelled the request. Nothing was sent." };
    }
  }

  for (const e of chain) {
    const d = e.data as { errorName?: string; args?: readonly unknown[] } | undefined;
    if (d && typeof d === "object" && typeof d.errorName === "string") {
      if (d.errorName === "Error" && typeof d.args?.[0] === "string") return { kind: "revert", title: "The contract rejected this", message: d.args[0] };
      if (d.errorName === "Panic") return { kind: "revert", title: "The contract rejected this", message: "The contract hit an internal check." };
      return revert(d.errorName);
    }
    for (const candidate of [e.raw, e.data]) {
      if (typeof candidate === "string" && /^0x[0-9a-fA-F]{8}/.test(candidate)) {
        const dec = decodeRevertData(candidate as Hex);
        if (dec) return revert(dec.errorName);
      }
    }
  }

  const all = chain.map(text).join("\n");
  const hex = /0x[0-9a-fA-F]{8,}/.exec(all);
  if (hex) {
    const dec = decodeRevertData(hex[0] as Hex);
    if (dec) return revert(dec.errorName);
  }
  const named = /(?:reverted with (?:the following )?(?:custom )?(?:error|reason)?:?|Error:)\s*'?([A-Z][A-Za-z0-9]+)\(/.exec(all);
  if (named && ERROR_MESSAGES[named[1]]) return revert(named[1]);

  if (/insufficient funds|exceeds balance|gas required exceeds/i.test(all)) {
    return { kind: "funds", title: "Not enough BTC for gas", message: "Add a little testnet BTC to this wallet to pay network fees." };
  }
  if (/nonce too low|replacement transaction underpriced|already known/i.test(all)) {
    return { kind: "rpc", title: "Another transaction is pending", message: "Wait for your wallet's pending transaction, then retry." };
  }
  if (/timeout|timed out|took too long/i.test(all)) {
    return { kind: "rpc", title: "Network is slow", message: "Mezo Testnet didn't answer in time. Check the explorer before retrying." };
  }
  if (/fetch failed|failed to fetch|network error|HTTP request failed/i.test(all)) {
    return { kind: "rpc", title: "Can't reach Mezo Testnet", message: "Check your connection and retry." };
  }
  if (/chain mismatch|does not match the target chain/i.test(all)) {
    return { kind: "network", title: "Wrong network", message: "Switch your wallet to Mezo Testnet and try again." };
  }
  if (/not connected/i.test(all)) return { kind: "unknown", title: "Wallet not connected", message: "Connect your wallet and try again." };
  if (/reverted/i.test(all)) return { kind: "revert", title: "The contract rejected this", message: "The transaction was reverted." };
  const first = chain[0];
  const msg = first?.shortMessage || first?.message;
  return { kind: "unknown", title: "Something went wrong", message: msg && msg.length < 160 ? msg : "Please try again." };
}
