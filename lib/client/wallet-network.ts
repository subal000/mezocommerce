import { mezoTestnet, MEZO_TESTNET_ID } from "@/lib/chain/config";

/** Pure wallet/network helpers shared by the connect dialog and the checkout. */

export type NetworkState =
  | { kind: "disconnected" }
  | { kind: "wrong-network"; chainId: number | undefined }
  | { kind: "ready"; chainId: number };

export function networkState(isConnected: boolean, chainId: number | undefined, expected: number = MEZO_TESTNET_ID): NetworkState {
  if (!isConnected) return { kind: "disconnected" };
  if (chainId !== expected) return { kind: "wrong-network", chainId };
  return { kind: "ready", chainId };
}

export class WrongNetworkError extends Error {
  constructor(
    public readonly actual: number | undefined,
    public readonly expected: number = MEZO_TESTNET_ID,
  ) {
    super(`Wrong network: connected to ${actual ?? "unknown"}, expected ${expected}`);
    this.name = "WrongNetworkError";
  }
}

export function assertChain(actual: number | undefined, expected: number = MEZO_TESTNET_ID): void {
  if (actual !== expected) throw new WrongNetworkError(actual, expected);
}

/** wallet_addEthereumChain params for Mezo Testnet (from the frozen chain config). */
export function addChainParams() {
  return {
    chainId: `0x${MEZO_TESTNET_ID.toString(16)}`,
    chainName: mezoTestnet.name,
    nativeCurrency: mezoTestnet.nativeCurrency,
    rpcUrls: [...mezoTestnet.rpcUrls.default.http],
    blockExplorerUrls: [mezoTestnet.blockExplorers.default.url],
  };
}

/** True when a switchChain failure means "the wallet doesn't know this chain" (EIP-3085 4902 and common variants). */
export function isUnknownChainError(err: unknown): boolean {
  let cur: unknown = err;
  for (let i = 0; i < 6 && cur && typeof cur === "object"; i++) {
    const e = cur as { code?: number; message?: string; name?: string; cause?: unknown };
    if (e.code === 4902 || e.name === "SwitchChainNotSupportedError") return true;
    if (typeof e.message === "string" && /unrecognized chain|unknown chain|chain .*not.* (added|configured)|4902|try adding the chain/i.test(e.message)) {
      return true;
    }
    cur = e.cause;
  }
  return false;
}

export function shortAddress(a: string | null | undefined, chars = 4): string {
  if (!a) return "";
  return a.length <= 2 + chars * 2 ? a : `${a.slice(0, 2 + chars)}…${a.slice(-chars)}`;
}

/**
 * Whether the page has any wallet Mezo Passport can use (checked client-side only): an injected EIP-1193 provider,
 * or a Bitcoin wallet extension (Unisat, OKX, Xverse) that Passport turns into a Mezo smart account.
 */
export function hasInjectedProvider(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as { ethereum?: unknown; unisat?: unknown; okxwallet?: { bitcoin?: unknown }; XverseProviders?: unknown; BitcoinProvider?: unknown };
  return Boolean(w.ethereum || w.unisat || w.okxwallet?.bitcoin || w.XverseProviders || w.BitcoinProvider);
}
