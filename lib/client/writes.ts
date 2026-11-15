import type { Abi, Address, Hash, Hex, TransactionReceipt } from "viem";
import type { Config } from "wagmi";
import { getAccount, sendTransaction, simulateContract, waitForTransactionReceipt, writeContract } from "@wagmi/core";
import { gasForRequest, safeGas } from "@/lib/client/gas";
import { processorAbi } from "@/lib/chain/abis";
import { contracts, isDeployed, MEZO_TESTNET_ID } from "@/lib/chain/config";
import { assertChain } from "./guard";

/** A single contract write described as data, so it can be previewed and simulated before the wallet opens. */
export interface ContractWrite {
  kind: "contract";
  label: string;
  address: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
}
/** A prepared call from the API (e.g. RefundDTO.tx.approve / .refund). */
export interface RawWrite {
  kind: "raw";
  label: string;
  to: Address;
  data: Hex;
}
export type WriteSpec = ContractWrite | RawWrite;

const P = () => contracts.processor;
const c = (label: string, functionName: string, args: readonly unknown[]): ContractWrite => ({
  kind: "contract",
  label,
  address: P(),
  abi: processorAbi as Abi,
  functionName,
  args,
});

/** Every merchant-side processor write the dashboard sends. */
export const build = {
  registerMerchant: (payout: Address, platformSigner: Address) => c("Register your store", "registerMerchant", [payout, platformSigner]),
  setPayout: (merchantId: bigint, payout: Address) => c("Change payout wallet", "setPayout", [merchantId, payout]),
  setSigner: (merchantId: bigint, signer: Address, allowed: boolean) =>
    c(allowed ? "Allow MezoCommerce to sign checkouts" : "Stop MezoCommerce signing checkouts", "setSigner", [merchantId, signer, allowed]),
  setMerchantActive: (merchantId: bigint, active: boolean) => c(active ? "Resume payments" : "Pause payments", "setMerchantActive", [merchantId, active]),
  cancelPayment: (merchantId: bigint, paymentId: Hex) => c("Cancel payment on-chain", "cancelPayment", [merchantId, paymentId]),
  raw: (label: string, call: { to: string; data: string }): RawWrite => ({ kind: "raw", label, to: call.to as Address, data: call.data as Hex }),
};

export interface WriteResult {
  hash: Hash;
  receipt: TransactionReceipt;
}

export class NotDeployedError extends Error {
  constructor() {
    super("The MezoCommerce contract isn't deployed yet.");
    this.name = "NotDeployedError";
  }
}

/** Checks deployment + chain, simulates (so reverts surface before the wallet opens), sends, waits for the receipt. */
export async function executeWrite(config: Config, s: WriteSpec, onSubmitted?: (hash: Hash) => void): Promise<WriteResult> {
  if (!isDeployed) throw new NotDeployedError();
  const conn = getAccount(config);
  if (!conn.address) throw new Error("Wallet not connected");
  assertChain(conn.chainId, MEZO_TESTNET_ID);
  let hash: Hash;
  if (s.kind === "contract") {
    const { request } = await simulateContract(config, {
      address: s.address,
      abi: s.abi,
      functionName: s.functionName,
      args: s.args,
      account: conn.address,
      chainId: MEZO_TESTNET_ID,
    } as Parameters<typeof simulateContract>[1]);
    assertChain(getAccount(config).chainId, MEZO_TESTNET_ID);
    const gas = await gasForRequest(config, request as Parameters<typeof gasForRequest>[1], conn.address);
    hash = await writeContract(config, { ...request, gas } as Parameters<typeof writeContract>[1]);
  } else {
    // estimateGas surfaces reverts (e.g. RefundExceedsPayment) before the wallet opens.
    const gas = await safeGas(config, { to: s.to, data: s.data, account: conn.address });
    assertChain(getAccount(config).chainId, MEZO_TESTNET_ID);
    hash = await sendTransaction(config, { to: s.to, data: s.data, gas, chainId: MEZO_TESTNET_ID });
  }
  onSubmitted?.(hash);
  const receipt = await waitForTransactionReceipt(config, { hash, chainId: MEZO_TESTNET_ID, timeout: 180_000 });
  if (receipt.status !== "success") {
    const err = new Error("The transaction was reverted on-chain.") as Error & { hash: Hash };
    err.hash = hash;
    throw err;
  }
  return { hash, receipt };
}
