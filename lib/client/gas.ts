import { estimateGas, type Config } from "@wagmi/core";
import { encodeFunctionData, type Abi, type Address, type Hex } from "viem";
import { MEZO_TESTNET_ID } from "@/lib/chain/config";

/** A contract call can't cost less than this; an estimate below it came from a node that doesn't see the contract. */
const PLAIN_TRANSFER_CEILING = 30_000n;
const RETRIES = 4;

/**
 * Gas limit with a 25% buffer, or undefined to let the wallet estimate.
 *
 * Mezo's public RPC is load-balanced over nodes that are not always in sync. A node behind the contract's deploy
 * block estimates a contract call as a plain transfer (about 21,800 gas), and the transaction then fails with
 * "gas limit below EIP-7623 floor". Wallets estimate through the same RPC, so we estimate here, retry an estimate
 * that looks like a plain transfer, and pass the limit explicitly. Reverts still throw (the caller simulated first).
 */
export async function safeGas(config: Config, tx: { to: Address; data: Hex; account: Address; value?: bigint }): Promise<bigint | undefined> {
  for (let i = 0; i < RETRIES; i++) {
    const g = await estimateGas(config, { ...tx, chainId: MEZO_TESTNET_ID });
    if (tx.data === "0x" || g > PLAIN_TRANSFER_CEILING) return (g * 125n) / 100n;
    await new Promise((r) => setTimeout(r, 600));
  }
  return undefined;
}

/** `safeGas` for a simulated contract request (the result of simulateContract). */
export async function gasForRequest(
  config: Config,
  request: { address: Address; abi: Abi | readonly unknown[]; functionName: string; args?: readonly unknown[] },
  account: Address,
): Promise<bigint | undefined> {
  const data = encodeFunctionData({ abi: request.abi as Abi, functionName: request.functionName, args: request.args as unknown[] });
  return safeGas(config, { to: request.address, data, account });
}
