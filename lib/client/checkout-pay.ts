import type { Address, Hash, Hex } from "viem";
import type { Config } from "wagmi";
import { getAccount, readContract, signTypedData, simulateContract, waitForTransactionReceipt, writeContract } from "@wagmi/core";
import { gasForRequest } from "@/lib/client/gas";
import { erc20Abi, processorAbi } from "@/lib/chain/abis";
import { MEZO_TESTNET_ID } from "@/lib/chain/config";
import type { CheckoutDTO, SubmittedRequest, CheckoutStatusDTO } from "@/lib/api-types";
import { api } from "./api";
import { isTypedDataUnsupported } from "./checkout-errors";
import { permitForIntent, splitPermitSignature, toIntentTuple } from "./checkout-permit";
import { assertChain } from "./wallet-network";

export type PayMode = "permit" | "approve";

export type PayStep =
  | { step: "permit_requested" }
  | { step: "approval_requested" }
  | { step: "approval_confirming"; approvalHash: string }
  | { step: "pay_requested" }
  | { step: "fallback_to_approve" };

export class CheckoutNotPayableError extends Error {
  constructor(message = "This checkout can't be paid right now.") {
    super(message);
    this.name = "CheckoutNotPayableError";
  }
}

/**
 * Runs the wallet side of a payment and returns the payment tx hash once the wallet has broadcast it.
 * Default: EIP-2612 permit for exactly intent.amount → payWithPermit (one signature + one tx).
 * Fallback (toggle, or automatic when the wallet can't sign typed data): approve(exact amount) if needed → pay.
 * Every write is simulated first so reverts surface as plain messages before the wallet prompt.
 */
export async function runPayment(opts: {
  config: Config;
  checkout: CheckoutDTO;
  mode: PayMode;
  onStep: (s: PayStep) => void;
}): Promise<Hash> {
  const { config, checkout, onStep } = opts;
  const signed = checkout.intent;
  if (!signed) throw new CheckoutNotPayableError();
  const processor = checkout.processor_address as Address;
  const intent = toIntentTuple(signed);
  const signature = signed.signature as Hex;

  const conn = getAccount(config);
  const payer = conn.address;
  if (!payer) throw new Error("Wallet not connected");
  assertChain(conn.chainId, MEZO_TESTNET_ID);

  if (opts.mode === "permit") {
    const nonce = await readContract(config, { address: intent.token, abi: erc20Abi, functionName: "nonces", args: [payer], chainId: MEZO_TESTNET_ID });
    const { deadline, typedData } = permitForIntent({ intent: signed, owner: payer, processor, nonce: nonce as bigint });
    onStep({ step: "permit_requested" });
    let permitSig: Hex | null = null;
    try {
      permitSig = await signTypedData(config, { account: payer, ...typedData });
    } catch (err) {
      if (!isTypedDataUnsupported(err)) throw err;
      onStep({ step: "fallback_to_approve" });
    }
    if (permitSig) {
      const { v, r, s } = splitPermitSignature(permitSig);
      const { request } = await simulateContract(config, {
        address: processor,
        abi: processorAbi,
        functionName: "payWithPermit",
        args: [intent, signature, deadline, v, r, s],
        account: payer,
        chainId: MEZO_TESTNET_ID,
      });
      assertChain(getAccount(config).chainId, MEZO_TESTNET_ID);
      onStep({ step: "pay_requested" });
      return writeContract(config, { ...request, gas: await gasForRequest(config, request, payer) });
    }
  }

  // approve (exact amount, only if needed) → pay
  const allowance = (await readContract(config, {
    address: intent.token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [payer, processor],
    chainId: MEZO_TESTNET_ID,
  })) as bigint;
  if (allowance < intent.amount) {
    const { request } = await simulateContract(config, {
      address: intent.token,
      abi: erc20Abi,
      functionName: "approve",
      args: [processor, intent.amount],
      account: payer,
      chainId: MEZO_TESTNET_ID,
    });
    onStep({ step: "approval_requested" });
    const approvalHash = await writeContract(config, { ...request, gas: await gasForRequest(config, request, payer) });
    onStep({ step: "approval_confirming", approvalHash });
    const receipt = await waitForTransactionReceipt(config, { hash: approvalHash, chainId: MEZO_TESTNET_ID, timeout: 180_000 });
    if (receipt.status !== "success") throw new Error("The approval transaction was reverted.");
  }
  const { request } = await simulateContract(config, {
    address: processor,
    abi: processorAbi,
    functionName: "pay",
    args: [intent, signature],
    account: payer,
    chainId: MEZO_TESTNET_ID,
  });
  assertChain(getAccount(config).chainId, MEZO_TESTNET_ID);
  onStep({ step: "pay_requested" });
  return writeContract(config, { ...request, gas: await gasForRequest(config, request, payer) });
}

/** Tell the server where to look (an UNVERIFIED hint; the server reads the receipt itself). */
export function reportSubmitted(checkoutId: string, body: SubmittedRequest): Promise<CheckoutStatusDTO> {
  return api<CheckoutStatusDTO>(`/api/public/checkout/${encodeURIComponent(checkoutId)}/submitted`, { method: "POST", json: body });
}

/** Watches the receipt only to surface a revert quickly. Success is never inferred from it. */
export async function watchForRevert(config: Config, hash: Hash): Promise<boolean> {
  try {
    const r = await waitForTransactionReceipt(config, { hash, chainId: MEZO_TESTNET_ID, timeout: 300_000 });
    return r.status !== "success";
  } catch {
    return false;
  }
}
