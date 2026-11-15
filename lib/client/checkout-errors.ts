import { decodeErrorResult, parseAbi, type Hex } from "viem";
import { erc20Abi, processorAbi } from "@/lib/chain/abis";

/**
 * Turns wallet, RPC and contract errors into one plain sentence a shopper can act on.
 * Custom errors are decoded with the processor ABI plus common OpenZeppelin errors; raw hex never reaches the screen.
 */
export type TxErrorKind = "rejected" | "network" | "revert" | "funds" | "rpc" | "unsupported" | "unknown";
export interface TxError {
  kind: TxErrorKind;
  title: string;
  message: string;
  errorName?: string;
}

/** OpenZeppelin 5 errors MUSD / SafeERC20 / Pausable can bubble up (not part of the frozen interface). */
const OZ_ERRORS = parseAbi([
  "error EnforcedPause()",
  "error ReentrancyGuardReentrantCall()",
  "error SafeERC20FailedOperation(address token)",
  "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
  "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
  "error ERC2612ExpiredSignature(uint256 deadline)",
  "error ERC2612InvalidSigner(address signer, address owner)",
  "error ECDSAInvalidSignature()",
  "error ECDSAInvalidSignatureLength(uint256 length)",
]);

/** Plain messages for every custom error a shopper can hit while paying. */
export const ERROR_MESSAGES: Record<string, string> = {
  // IMerchantPaymentProcessor
  ZeroAddress: "This payment has a missing address. Ask the store for a new checkout link.",
  NotMerchantOwner: "Only the store's owner wallet can do that.",
  NotAuthorized: "This wallet isn't allowed to do that.",
  UnknownMerchant: "This store isn't set up for payments yet. Contact the store.",
  MerchantInactive: "This store has paused payments. Contact the store.",
  PayoutMismatch: "The store changed its payout wallet. Ask the store for a new checkout link.",
  UnsupportedToken: "This token isn't accepted for payments.",
  InvalidAmount: "This payment amount isn't valid. Ask the store for a new checkout link.",
  IntentExpired: "This checkout has expired. Return to the store to start again.",
  IntentAlreadyPaid: "This order is already paid. You haven't been charged again.",
  IntentCancelled: "The store cancelled this checkout. Return to the store to start again.",
  BadSignature: "This checkout link isn't valid. Ask the store for a new one.",
  WrongPayer: "This checkout can only be paid from a different wallet. Switch wallets in your wallet app.",
  NotPaid: "This order hasn't been paid.",
  RefundExceedsPayment: "A refund can't be more than what was paid.",
  InvalidPayout: "The store's payout wallet isn't valid. Contact the store.",
  RenounceDisabled: "This action isn't allowed.",
  // OpenZeppelin / MUSD
  ExpectedPause: "Payments aren't paused.",
  OwnableUnauthorizedAccount: "This wallet isn't allowed to do that.",
  OwnableInvalidOwner: "That owner address isn't valid.",
  InvalidShortString: "Something in this payment isn't valid. Ask the store for a new checkout link.",
  StringTooLong: "Something in this payment isn't valid. Ask the store for a new checkout link.",
  EnforcedPause: "Payments are paused for maintenance. Try again later.",
  ReentrancyGuardReentrantCall: "Another transaction is in progress. Try again.",
  SafeERC20FailedOperation: "The MUSD transfer failed. Check your balance and try again.",
  ERC20InsufficientAllowance: "The spending permission didn't go through. Try again, or use the two-step approval instead.",
  ERC20InsufficientBalance: "This wallet doesn't hold enough MUSD.",
  ERC2612ExpiredSignature: "The spending permission expired. Try again.",
  ERC2612InvalidSigner: "The spending permission doesn't match this wallet. Try again.",
  ECDSAInvalidSignature: "This checkout link isn't valid. Ask the store for a new one.",
  ECDSAInvalidSignatureLength: "This checkout link isn't valid. Ask the store for a new one.",
};

export function messageForError(name: string): string {
  return ERROR_MESSAGES[name] ?? humanizeErrorName(name);
}

/** "IntentExpired" → "Intent expired." */
export function humanizeErrorName(name: string): string {
  const words = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/\s+/).filter(Boolean);
  if (!words.length) return "The payment was rejected.";
  return `${words.map((w, i) => (i === 0 ? w : w.toLowerCase())).join(" ")}.`;
}

const ALL_ERRORS = [...processorAbi, ...erc20Abi, ...OZ_ERRORS].filter((x) => (x as { type: string }).type === "error");

/** Decode raw revert data. Returns null when unknown. */
export function decodeRevertData(data: Hex): { errorName: string; args: readonly unknown[] } | null {
  try {
    const r = decodeErrorResult({ abi: ALL_ERRORS as never, data });
    return { errorName: r.errorName, args: (r.args ?? []) as readonly unknown[] };
  } catch {
    return null;
  }
}

type Loose = {
  name?: string;
  code?: number | string;
  message?: string;
  shortMessage?: string;
  details?: string;
  reason?: string;
  data?: unknown;
  raw?: unknown;
  cause?: unknown;
};

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

function text(e: Loose) {
  return [e.shortMessage, e.details, e.message, e.reason].filter((s): s is string => typeof s === "string").join("\n");
}

const revert = (name: string): TxError => ({ kind: "revert", title: "Payment didn't go through", message: messageForError(name), errorName: name });

export function isUserRejection(err: unknown): boolean {
  return links(err).some(
    (e) =>
      e.name === "UserRejectedRequestError" ||
      e.code === 4001 ||
      e.code === "ACTION_REJECTED" ||
      /user (rejected|denied)|rejected the request|request rejected|denied (transaction|message) signature|user cancell?ed/i.test(text(e)),
  );
}

/** True when the wallet cannot produce EIP-712 typed-data signatures (→ fall back to approve + pay). */
export function isTypedDataUnsupported(err: unknown): boolean {
  if (isUserRejection(err)) return false;
  return links(err).some(
    (e) =>
      e.code === 4200 ||
      e.code === -32601 ||
      e.name === "MethodNotSupportedRpcError" ||
      e.name === "UnsupportedProviderMethodError" ||
      /eth_signTypedData(_v4)? (is )?not (supported|found|available)|method not (found|supported)|does not support|unsupported method|not implemented/i.test(text(e)),
  );
}

export function describeTxError(err: unknown): TxError {
  if (err == null) return { kind: "unknown", title: "Something went wrong", message: "Please try again." };
  if (typeof err === "string") return { kind: "unknown", title: "Something went wrong", message: err };
  const chain = links(err);

  for (const e of chain) {
    if (e.name === "WrongNetworkError" || e.name === "ChainMismatchError") {
      return { kind: "network", title: "Wrong network", message: "Switch your wallet to Mezo Testnet and try again." };
    }
  }
  if (isUserRejection(err)) {
    return { kind: "rejected", title: "Cancelled in wallet", message: "You cancelled the request. Nothing was sent." };
  }

  for (const e of chain) {
    const d = e.data as { errorName?: string; args?: readonly unknown[] } | undefined;
    if (d && typeof d === "object" && typeof d.errorName === "string") {
      if (d.errorName === "Error" && typeof d.args?.[0] === "string") {
        return { kind: "revert", title: "Payment didn't go through", message: d.args[0] };
      }
      if (d.errorName === "Panic") return { kind: "revert", title: "Payment didn't go through", message: "The payment contract rejected this." };
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
    return { kind: "funds", title: "Not enough BTC for fees", message: "Add a little testnet BTC to this wallet to pay the network fee." };
  }
  if (/nonce too low|replacement transaction underpriced|already known/i.test(all)) {
    return { kind: "rpc", title: "Another transaction is pending", message: "Wait for your wallet's pending transaction, then try again." };
  }
  if (/timeout|timed out|took too long/i.test(all)) {
    return { kind: "rpc", title: "Network is slow", message: "Mezo Testnet didn't answer in time. Try again in a moment." };
  }
  if (/fetch failed|failed to fetch|network error|HTTP request failed/i.test(all)) {
    return { kind: "rpc", title: "Can't reach Mezo Testnet", message: "Check your connection and try again." };
  }
  if (/chain mismatch|does not match the target chain/i.test(all)) {
    return { kind: "network", title: "Wrong network", message: "Switch your wallet to Mezo Testnet and try again." };
  }
  if (/not connected|connector not connected/i.test(all)) {
    return { kind: "unknown", title: "Wallet not connected", message: "Connect your wallet and try again." };
  }
  if (isTypedDataUnsupported(err)) {
    return { kind: "unsupported", title: "Not supported by this wallet", message: "Your wallet can't do this. Try the two-step option instead." };
  }
  if (/reverted/i.test(all)) return { kind: "revert", title: "Payment didn't go through", message: "The payment was rejected on-chain. Nothing was charged." };
  const first = chain[0];
  const msg = first?.shortMessage || first?.message;
  return { kind: "unknown", title: "Something went wrong", message: msg && msg.length < 160 ? msg : "Please try again." };
}
