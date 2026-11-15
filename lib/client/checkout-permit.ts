import { parseSignature, type Address, type Hex } from "viem";
import { MEZO_TESTNET_ID, MUSD_PERMIT_DOMAIN } from "@/lib/chain/config";
import type { SignedIntentDTO } from "@/lib/api-types";

/** Longest a permit signature stays valid, even when the checkout has more time left. */
export const PERMIT_MAX_LIFETIME_SECONDS = 20 * 60;

/** The PaymentIntent tuple the processor expects, from the API's signed intent (wei/decimal strings → bigint). */
export function toIntentTuple(i: SignedIntentDTO) {
  return {
    paymentId: i.payment_id as Hex,
    merchantId: BigInt(i.merchant_id),
    payout: i.payout as Address,
    token: i.token as Address,
    amount: BigInt(i.amount),
    payer: i.payer as Address,
    expiresAt: BigInt(i.expires_at),
  };
}
export type IntentTuple = ReturnType<typeof toIntentTuple>;

/** Permit deadline = min(intent.expiresAt, now + 20 minutes), unix seconds. Never later than the intent. */
export function permitDeadline(intentExpiresAt: bigint, nowMs: number = Date.now()): bigint {
  const cap = BigInt(Math.floor(nowMs / 1000) + PERMIT_MAX_LIFETIME_SECONDS);
  return intentExpiresAt < cap ? intentExpiresAt : cap;
}

/**
 * EIP-2612 typed data for MUSD: a spending permission for EXACTLY `value` (the intent amount) to the processor.
 * Domain comes from the frozen MUSD_PERMIT_DOMAIN + chain id + the MUSD address.
 */
export function buildPermitTypedData(args: {
  token: Address;
  owner: Address;
  spender: Address;
  value: bigint;
  nonce: bigint;
  deadline: bigint;
  chainId?: number;
}) {
  return {
    domain: {
      name: MUSD_PERMIT_DOMAIN.name,
      version: MUSD_PERMIT_DOMAIN.version,
      chainId: args.chainId ?? MEZO_TESTNET_ID,
      verifyingContract: args.token,
    },
    types: {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "Permit" as const,
    message: { owner: args.owner, spender: args.spender, value: args.value, nonce: args.nonce, deadline: args.deadline },
  } as const;
}

/** Permit typed data for a checkout: value is the signed intent amount, never more. */
export function permitForIntent(args: { intent: SignedIntentDTO; owner: Address; processor: Address; nonce: bigint; nowMs?: number; chainId?: number }) {
  const tuple = toIntentTuple(args.intent);
  const deadline = permitDeadline(tuple.expiresAt, args.nowMs);
  return {
    deadline,
    typedData: buildPermitTypedData({
      token: tuple.token,
      owner: args.owner,
      spender: args.processor,
      value: tuple.amount,
      nonce: args.nonce,
      deadline,
      chainId: args.chainId,
    }),
  };
}

/** Split a 65-byte signature into v/r/s for payWithPermit. */
export function splitPermitSignature(sig: Hex): { v: number; r: Hex; s: Hex } {
  const p = parseSignature(sig);
  const v = p.v !== undefined ? Number(p.v) : (p.yParity ?? 0) + 27;
  return { v: v < 27 ? v + 27 : v, r: p.r, s: p.s };
}
