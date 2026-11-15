"use client";

/**
 * Stable wallet API (imported by the app agent's header, dashboard and docs):
 *   <ConnectWalletButton size? className? label? />
 *   <ConnectDialog open onOpenChange />
 *   useMezoNetwork() → { isConnected, address, chainId, isWrongNetwork, isReady, isSwitching, network, switchToMezo() }
 * Connection goes through Mezo Passport (lib/client/wagmi.ts): Bitcoin wallets via a Mezo smart account, or
 * Ethereum wallets. useMezoNetwork().isSmartAccount tells the checkout to skip the EIP-2612 permit.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useAccount, useDisconnect, useSwitchChain } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { isSmartAccountConnector } from "@/lib/client/wagmi";
import { ChevronDown, Copy, ExternalLink, LogOut } from "lucide-react";
import { toast } from "sonner";
import { explorerAddress, MEZO_TESTNET_ID } from "@/lib/chain/config";
import { describeTxError } from "@/lib/client/checkout-errors";
import { addChainParams, isUnknownChainError, networkState, shortAddress } from "@/lib/client/wallet-network";
import { cn } from "@/lib/client/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const noopSubscribe = () => () => {};
/** false during SSR/hydration, true afterwards. Wallet state only exists client-side. */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

type Eip1193 = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };

/** Connected wallet + Mezo Testnet network state. switchToMezo() adds the chain when the wallet doesn't know it. */
export function useMezoNetwork() {
  const conn = useAccount();
  const { switchChainAsync, isPending: isSwitching } = useSwitchChain();
  const network = networkState(conn.isConnected, conn.chainId);

  async function switchToMezo(): Promise<void> {
    try {
      await switchChainAsync({ chainId: MEZO_TESTNET_ID });
    } catch (err) {
      if (!isUnknownChainError(err)) throw err;
      const provider = (await conn.connector?.getProvider?.()) as Eip1193 | undefined;
      if (!provider) throw err;
      await provider.request({ method: "wallet_addEthereumChain", params: [addChainParams()] });
      // Most wallets switch after adding; ask again in case this one doesn't.
      try {
        await switchChainAsync({ chainId: MEZO_TESTNET_ID });
      } catch {
        /* already switched or the wallet switched itself */
      }
    }
  }

  return {
    address: conn.address,
    chainId: conn.chainId,
    connector: conn.connector,
    isConnected: conn.isConnected,
    /** Mezo Passport Bitcoin wallet: a smart account sends txs; EIP-2612 permits don't work. */
    isSmartAccount: isSmartAccountConnector(conn.connector),
    isWrongNetwork: network.kind === "wrong-network",
    isReady: network.kind === "ready",
    isSwitching,
    network,
    switchToMezo,
  };
}

/**
 * Opens Mezo Passport's connect modal (Bitcoin wallets via a Mezo smart account, or Ethereum wallets).
 * Keeps the controlled `open`/`onOpenChange` shape so call sites stay the same: `onOpenChange(false)` fires once
 * the modal closes, connected or not.
 */
export function ConnectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { openConnectModal, connectModalOpen } = useConnectModal();
  const shown = useRef(false);

  useEffect(() => {
    if (open && !connectModalOpen && !shown.current) {
      if (!openConnectModal) {
        // Already connected: nothing to open.
        onOpenChange(false);
        return;
      }
      shown.current = true;
      openConnectModal();
    }
  }, [open, connectModalOpen, openConnectModal, onOpenChange]);

  useEffect(() => {
    if (shown.current && !connectModalOpen) {
      shown.current = false;
      onOpenChange(false);
    }
  }, [connectModalOpen, onOpenChange]);

  return null;
}

export function ConnectWalletButton({
  size = "sm",
  className,
  label = "Connect wallet",
}: {
  size?: "sm" | "default" | "lg";
  className?: string;
  label?: string;
}) {
  const isClient = useIsClient();
  const w = useMezoNetwork();
  const { disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);

  if (!isClient) {
    return (
      <Button size={size} variant="outline" className={className} disabled aria-hidden tabIndex={-1}>
        {label}
      </Button>
    );
  }
  if (!w.isConnected || !w.address) {
    return (
      <>
        <Button size={size} variant="outline" className={className} onClick={() => setOpen(true)}>
          {label}
        </Button>
        <ConnectDialog open={open} onOpenChange={setOpen} />
      </>
    );
  }
  const address = w.address;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size={size} variant="outline" className={cn("font-mono text-[0.8125rem]", className)}>
          {w.isWrongNetwork ? <span className="size-1.5 rounded-full bg-warn" aria-hidden /> : null}
          {shortAddress(address)}
          <span className="sr-only">{w.isWrongNetwork ? ", wrong network" : ", connected"}</span>
          <ChevronDown className="text-muted-foreground" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <span className="block text-xs text-muted-foreground">{w.isWrongNetwork ? "Wrong network" : "Mezo Testnet"}</span>
          <span className="font-mono text-[0.8125rem]">{shortAddress(address, 6)}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {w.isWrongNetwork ? (
          <DropdownMenuItem
            onSelect={() => {
              w.switchToMezo().catch((e) => toast.error(describeTxError(e).message));
            }}
          >
            Switch to Mezo Testnet
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          onSelect={() => {
            navigator.clipboard?.writeText(address).then(
              () => toast.success("Address copied"),
              () => toast.error("Couldn't copy the address"),
            );
          }}
        >
          <Copy aria-hidden /> Copy address
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={explorerAddress(address)} target="_blank" rel="noreferrer">
            <ExternalLink aria-hidden /> View on explorer
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => disconnect()}>
          <LogOut aria-hidden /> Disconnect
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
