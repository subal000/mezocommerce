// Platform intent signer (EIP-712). Holds no funds and needs no gas; its address is what merchants authorize
// on-chain with registerMerchant(payout, platformSigner) / setSigner.
//
// INTENT_SIGNER_PRIVATE_KEY is required in production. In development a key is generated once and persisted to
// .data/dev-signer.key (gitignored) so the platform signer address stays stable across restarts.

import fs from "node:fs";
import path from "node:path";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type { Hex } from "viem";
import { INTENT_DOMAIN, INTENT_TYPES, MEZO_TESTNET_ID, contracts } from "@/lib/chain/config";
import type { IntentStruct } from "./chain";
import { env } from "./env";
import { unavailable } from "./errors";

let cached: PrivateKeyAccount | null = null;
let cachedFrom: string | undefined;

function devKeyPath() {
  return path.join(process.cwd(), ".data", "dev-signer.key");
}

function loadDevKey(): Hex {
  const p = devKeyPath();
  if (fs.existsSync(p)) {
    const k = fs.readFileSync(p, "utf8").trim();
    if (/^0x[0-9a-fA-F]{64}$/.test(k)) return k as Hex;
  }
  const k = generatePrivateKey();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, k + "\n", { mode: 0o600 });
  return k;
}

/** The platform signer account. Throws 503 `signer_not_configured` in production without the env var. */
export function intentSigner(): PrivateKeyAccount {
  const raw = process.env.INTENT_SIGNER_PRIVATE_KEY;
  if (cached && cachedFrom === raw) return cached;
  let key: Hex;
  if (raw && /^(0x)?[0-9a-fA-F]{64}$/.test(raw)) {
    key = (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
  } else {
    if (env.isProd()) throw unavailable("signer_not_configured", "Payment signing is not configured on this server");
    key = loadDevKey();
    const addr = privateKeyToAccount(key).address;
    console.warn(
      "\n" +
        "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n" +
        `!! INTENT_SIGNER_PRIVATE_KEY is not set. Using a DEVELOPMENT signer from .data/dev-signer.key\n` +
        `!! Platform signer address: ${addr}\n` +
        "!! Set INTENT_SIGNER_PRIVATE_KEY before deploying. Merchants authorize THIS address on-chain.\n" +
        "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n",
    );
  }
  cached = privateKeyToAccount(key);
  cachedFrom = raw;
  return cached;
}

/**
 * Lowercase platform signer address. The API derives it from INTENT_SIGNER_PRIVATE_KEY; the worker (which must not
 * hold the key) reads PLATFORM_SIGNER_ADDRESS. Null when neither is available.
 */
export function platformSignerAddress(): string | null {
  const key = process.env.INTENT_SIGNER_PRIVATE_KEY;
  const addr = process.env.PLATFORM_SIGNER_ADDRESS;
  if (!key && addr && /^0x[0-9a-fA-F]{40}$/.test(addr)) return addr.toLowerCase();
  try {
    return intentSigner().address.toLowerCase();
  } catch {
    return null;
  }
}

export function intentDomain() {
  return { ...INTENT_DOMAIN, chainId: MEZO_TESTNET_ID, verifyingContract: contracts.processor } as const;
}

export async function signIntent(intent: IntentStruct): Promise<Hex> {
  return intentSigner().signTypedData({
    domain: intentDomain(),
    types: INTENT_TYPES,
    primaryType: "PaymentIntent",
    message: intent,
  });
}
