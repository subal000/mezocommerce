import type { PayCheck } from "@/lib/chain/config";
import { formatMusd } from "@/lib/money";

/** Short MUSD amount for sentences: 10000000000000000000 → "10", 4.2e18 → "4.2", 1234.5e18 → "1,234.5". */
export function shortMusd(wei: bigint | string): string {
  const s = formatMusd(wei, { decimals: 2 });
  if (s.startsWith("<")) return s;
  // Drop only a whole ".00" (12.00 → "12"); keep cents otherwise (12.50 stays "12.50", never "12.5").
  return s.endsWith(".00") ? s.slice(0, -3) : s;
}

export type PayCheckAction = "fund_musd" | "fund_btc" | "switch_wallet" | "contact_store" | "back_to_store" | "wait" | "none";

export interface PayCheckMessage {
  title: string;
  message: string;
  action: PayCheckAction;
  /** true when the shopper can still pay after fixing something on their side. */
  recoverable: boolean;
}

/** Plain explanation for every result of the contract's checkPayment preflight. */
export function payCheckMessage(check: PayCheck, ctx: { amountWei?: bigint | string; balanceWei?: bigint | string } = {}): PayCheckMessage {
  switch (check) {
    case "ok":
      return { title: "Ready to pay", message: "", action: "none", recoverable: true };
    case "insufficient_allowance":
      // Normal for a first payment: the permit (or approve) step sets it.
      return { title: "Ready to pay", message: "", action: "none", recoverable: true };
    case "insufficient_balance": {
      const need = ctx.amountWei !== undefined ? shortMusd(ctx.amountWei) : null;
      const has = ctx.balanceWei !== undefined ? shortMusd(ctx.balanceWei) : null;
      return {
        title: "Not enough MUSD",
        message: need && has ? `Not enough MUSD. You need ${need}, this wallet has ${has}.` : "This wallet doesn't hold enough MUSD for this order.",
        action: "fund_musd",
        recoverable: true,
      };
    }
    case "already_paid":
      return { title: "Already paid", message: "This order is already paid. You won't be charged again.", action: "wait", recoverable: false };
    case "cancelled":
      return { title: "Checkout cancelled", message: "The store cancelled this checkout. Return to the store to start again.", action: "back_to_store", recoverable: false };
    case "expired":
      return { title: "Checkout expired", message: "This checkout has expired. Return to the store to start again.", action: "back_to_store", recoverable: false };
    case "unsupported_token":
      return { title: "Token not accepted", message: "This store's token isn't accepted right now. Contact the store.", action: "contact_store", recoverable: false };
    case "unknown_merchant":
      return { title: "Store not set up", message: "This store isn't set up to take payments yet. Contact the store.", action: "contact_store", recoverable: false };
    case "merchant_inactive":
      return { title: "Payments paused", message: "This store has paused payments. Contact the store.", action: "contact_store", recoverable: false };
    case "payout_mismatch":
      return { title: "Checkout out of date", message: "The store changed its payout wallet. Ask the store for a new checkout link.", action: "back_to_store", recoverable: false };
    case "bad_signature":
      return { title: "Checkout link not valid", message: "This checkout link isn't valid. Ask the store for a new one.", action: "back_to_store", recoverable: false };
    case "wrong_payer":
      return { title: "Different wallet needed", message: "This order can only be paid from the wallet the store specified. Switch wallets in your wallet app.", action: "switch_wallet", recoverable: true };
    case "invalid_amount":
      return { title: "Amount not valid", message: "This order's amount isn't valid. Ask the store for a new checkout link.", action: "back_to_store", recoverable: false };
    case "paused":
      return { title: "Payments paused", message: "Payments are paused for maintenance. Try again later.", action: "wait", recoverable: true };
    default: {
      const never: never = check;
      return { title: "Can't pay right now", message: `This checkout can't be paid right now (${String(never)}).`, action: "contact_store", recoverable: false };
    }
  }
}

/** Plain line shown before any wallet prompt, so the shopper knows what each prompt is. */
export function walletPromptExplainer(mode: "permit" | "approve", amountWei: bigint | string, needsApproval: boolean): string {
  const amt = `${shortMusd(amountWei)} MUSD`;
  if (mode === "permit") return `Your wallet will ask you to sign a spending permission for exactly ${amt}, then confirm the payment.`;
  if (needsApproval) return `Your wallet will ask you to approve exactly ${amt}, then confirm the payment.`;
  return `Your wallet will ask you to confirm the payment of ${amt}.`;
}

export const GET_MUSD_URL = "https://testnet.mezo.org";
export const BTC_FAUCET_URL = "https://faucet.test.mezo.org";
