"use client";

import { useAccount, useSwitchChain } from "wagmi";
import { isSmartAccountConnector } from "@/lib/client/wagmi";
import { mezoTestnet, MEZO_TESTNET_ID } from "@/lib/chain/config";
import { networkState } from "@/lib/client/guard";

/** Connected wallet + network state. Falls back to wallet_addEthereumChain when the switch fails. */
export function useWallet() {
  const conn = useAccount();
  const { switchChainAsync, isPending: isSwitching } = useSwitchChain();
  const network = networkState(conn.isConnected, conn.chainId);

  async function switchToMezo() {
    try {
      await switchChainAsync({ chainId: MEZO_TESTNET_ID });
    } catch (err) {
      const provider = (await conn.connector?.getProvider?.()) as { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> } | undefined;
      const code = (err as { code?: number; cause?: { code?: number } }).cause?.code ?? (err as { code?: number }).code;
      if (!provider || (code !== 4902 && code !== -32603 && code !== undefined)) throw err;
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: `0x${MEZO_TESTNET_ID.toString(16)}`,
            chainName: mezoTestnet.name,
            nativeCurrency: mezoTestnet.nativeCurrency,
            rpcUrls: mezoTestnet.rpcUrls.default.http,
            blockExplorerUrls: [mezoTestnet.blockExplorers.default.url],
          },
        ],
      });
    }
  }

  return {
    address: conn.address,
    chainId: conn.chainId,
    isConnected: conn.isConnected,
    connector: conn.connector,
    /** Mezo Passport Bitcoin wallet (smart account). */
    isSmartAccount: isSmartAccountConnector(conn.connector),
    network,
    isReady: network.kind === "ready",
    isSwitching,
    switchToMezo,
  };
}
