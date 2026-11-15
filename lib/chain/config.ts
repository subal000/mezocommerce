// FROZEN. Single source of chain + contract configuration. Never hardcode addresses or network settings elsewhere.
import { defineChain, type Address } from "viem";

export const MEZO_TESTNET_ID = 31611 as const;

export const mezoTestnet = defineChain({
  id: MEZO_TESTNET_ID,
  name: "Mezo Testnet",
  nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
  rpcUrls: {
    default: {
      http: [process.env.NEXT_PUBLIC_MEZO_RPC_URL || "https://rpc.test.mezo.org"],
      webSocket: ["wss://rpc-ws.test.mezo.org"],
    },
  },
  blockExplorers: { default: { name: "Mezo Explorer", url: "https://explorer.test.mezo.org" } },
  testnet: true,
});

/** Verified live 2026-11-10 on chain 31611 (block ~16.69M): symbol "MUSD", name "Mezo USD", 18 decimals,
 *  EIP-2612 permit (domain "Mezo USD" / "1"). Listed in the official Mezo contracts reference. */
export const MUSD_TESTNET: Address = "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503";
export const MUSD_DECIMALS = 18 as const;
export const MUSD_SYMBOL = "MUSD" as const;
export const MUSD_PERMIT_DOMAIN = { name: "Mezo USD", version: "1" } as const;

const ZERO = "0x0000000000000000000000000000000000000000" as Address;
function addr(v: string | undefined): Address {
  return v && /^0x[0-9a-fA-F]{40}$/.test(v) ? (v as Address) : ZERO;
}

/** MerchantPaymentProcessor on Mezo testnet, deployed 2026-11-13 (contracts/deployments/31611.json), source verified
 *  on the Mezo explorer. Env vars override these for a fresh deployment. */
export const PROCESSOR_TESTNET: Address = "0x94D35689d95b4C7ec9c8bD296ff606027e154df8";
export const PROCESSOR_TESTNET_DEPLOY_BLOCK = 16752201n;

/** Deployed MezoCommerce contract. Env (after `forge script Deploy`) wins; otherwise the testnet deployment above. */
const envProcessor = addr(process.env.NEXT_PUBLIC_PROCESSOR_ADDRESS);
export const contracts = {
  musd: addr(process.env.NEXT_PUBLIC_MUSD_ADDRESS) === ZERO ? MUSD_TESTNET : addr(process.env.NEXT_PUBLIC_MUSD_ADDRESS),
  processor: envProcessor === ZERO ? PROCESSOR_TESTNET : envProcessor,
  /** Block the processor was deployed at; the indexer starts here. */
  deployBlock:
    envProcessor === ZERO ? PROCESSOR_TESTNET_DEPLOY_BLOCK : BigInt(process.env.NEXT_PUBLIC_DEPLOY_BLOCK || "0"),
} as const;

export const isDeployed = contracts.processor !== ZERO;
export const ZERO_ADDRESS = ZERO;

export const EXPLORER = "https://explorer.test.mezo.org";
export const explorerTx = (hash: string) => `${EXPLORER}/tx/${hash}`;
export const explorerAddress = (a: string) => `${EXPLORER}/address/${a}`;

/** Tokens a payment intent may use. MUSD only in the MVP. MEZO is deliberately absent (not verified as a payment
 *  token on testnet); adding a token = contract setTokenSupported + an entry here behind a feature flag. */
export const PAYMENT_TOKENS = {
  MUSD: { symbol: MUSD_SYMBOL, decimals: MUSD_DECIMALS, address: () => contracts.musd },
} as const;
export type PaymentTokenSymbol = keyof typeof PAYMENT_TOKENS;

/** EIP-712 for intent signatures. Must match MerchantPaymentProcessor. */
export const INTENT_DOMAIN = { name: "MezoCommerce", version: "1" } as const;
export const INTENT_TYPES = {
  PaymentIntent: [
    { name: "paymentId", type: "bytes32" },
    { name: "merchantId", type: "uint256" },
    { name: "payout", type: "address" },
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "payer", type: "address" },
    { name: "expiresAt", type: "uint64" },
  ],
} as const;

/** Payment intent limits (API-enforced). */
export const INTENT_LIMITS = {
  MIN_AMOUNT_WEI: 10n ** 16n, // 0.01 MUSD
  MAX_AMOUNT_WEI: 1_000_000n * 10n ** 18n, // 1,000,000 MUSD
  DEFAULT_TTL_SECONDS: 30 * 60,
  MIN_TTL_SECONDS: 5 * 60,
  MAX_TTL_SECONDS: 7 * 24 * 3600,
  MAX_METADATA_KEYS: 20,
} as const;

/** On-chain enum orders (IMerchantPaymentProcessor). */
export const CHAIN_INTENT_STATE = ["none", "paid", "cancelled"] as const;
export const PAY_CHECK = [
  "ok",
  "already_paid",
  "cancelled",
  "expired",
  "unsupported_token",
  "unknown_merchant",
  "merchant_inactive",
  "payout_mismatch",
  "bad_signature",
  "wrong_payer",
  "invalid_amount",
  "paused",
  "insufficient_balance",
  "insufficient_allowance",
] as const;
export type PayCheck = (typeof PAY_CHECK)[number];

/** API key format: mc_test_sk_<40 base62>. Only a SHA-256 hash (with server pepper) is stored. */
export const API_KEY_PREFIX = "mc_test_sk_" as const;
