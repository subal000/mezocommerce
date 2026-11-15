export type WalletRole = "owner" | "owner_or_payout";

/** Whether the connected wallet may send a merchant action. Owner for settings; owner or payout for refunds. Unit tested. */
export function walletMatches(connected: string | undefined | null, owner: string, payout: string | null, role: WalletRole): boolean {
  if (!connected) return false;
  const c = connected.toLowerCase();
  if (c === owner.toLowerCase()) return true;
  return role === "owner_or_payout" && !!payout && c === payout.toLowerCase();
}
