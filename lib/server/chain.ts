// Chain service. All chain access in the backend goes through the small `ChainAdapter` interface so tests can
// inject fakes (setChainForTests). The live adapter is a viem public client on NEXT_PUBLIC_MEZO_RPC_URL.

import {
  createPublicClient,
  decodeEventLog,
  http,
  verifyMessage,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { erc20Abi, processorAbi } from "@/lib/chain/abis";
import { unavailable } from "./errors";
import { CHAIN_INTENT_STATE, PAY_CHECK, contracts, mezoTestnet, type PayCheck } from "@/lib/chain/config";

// ---------------------------------------------------------------- types

export interface ChainMerchant {
  owner: Address; // zero address = unknown merchant
  payout: Address;
  active: boolean;
}

export interface ChainPaymentRecord {
  merchantId: bigint;
  payer: Address;
  token: Address;
  amount: bigint;
  refunded: bigint;
  paidAt: bigint;
}

export type ChainIntentState = (typeof CHAIN_INTENT_STATE)[number];

/** The EIP-712 struct exactly as submitted to the processor. */
export interface IntentStruct {
  paymentId: Hex;
  merchantId: bigint;
  payout: Address;
  token: Address;
  amount: bigint;
  payer: Address;
  expiresAt: bigint;
}

export interface RawLog {
  address: Address;
  topics: Hex[];
  data: Hex;
  blockNumber: bigint;
  blockHash: Hex;
  transactionHash: Hex;
  logIndex: number;
}

export interface RawReceipt {
  status: "success" | "reverted";
  to: Address | null;
  from: Address;
  blockNumber: bigint;
  blockHash: Hex;
  transactionHash: Hex;
  logs: RawLog[];
}

export interface ChainBlock {
  number: bigint;
  hash: Hex;
  timestamp: bigint;
}

export interface ChainAdapter {
  chainId(): Promise<number>;
  getBlockNumber(): Promise<bigint>;
  getBlock(n: bigint): Promise<ChainBlock>;
  /** Logs of the processor contract in [fromBlock, toBlock]. */
  getLogs(range: { fromBlock: bigint; toBlock: bigint }): Promise<RawLog[]>;
  getReceipt(hash: Hex): Promise<RawReceipt | null>;
  getMerchant(id: bigint): Promise<ChainMerchant>;
  isSigner(id: bigint, signer: Address): Promise<boolean>;
  /** State of `paymentId` for `merchantId`. On-chain state is scoped per merchant; other merchants can't change it. */
  intentState(merchantId: bigint, paymentId: Hex): Promise<ChainIntentState>;
  getPayment(merchantId: bigint, paymentId: Hex): Promise<ChainPaymentRecord>;
  checkPayment(intent: IntentStruct, signature: Hex, payer: Address): Promise<PayCheck>;
  balanceOf(token: Address, owner: Address): Promise<bigint>;
  allowance(token: Address, owner: Address, spender: Address): Promise<bigint>;
  nativeBalance(address: Address): Promise<bigint>;
  /** ERC-1271 / ERC-6492 smart-account signature check (EOA handled locally first). */
  verifySmartSignature(address: Address, message: string, signature: Hex): Promise<boolean>;
}

// ---------------------------------------------------------------- decoding

export interface DecodedLog {
  eventName: string;
  args: Record<string, unknown>; // bigint values kept as bigint
  address: Address;
  blockNumber: bigint;
  blockHash: Hex;
  txHash: Hex;
  logIndex: number;
}

export const lc = (a: string | null | undefined) => (a ?? "").toLowerCase();

/** Decode a log against the processor ABI regardless of emitter (callers decide whether to trust it). */
export function decodeAnyProcessorLog(log: RawLog): DecodedLog | null {
  try {
    const decoded = decodeEventLog({
      abi: processorAbi,
      topics: log.topics as [Hex, ...Hex[]],
      data: log.data,
      strict: true,
    });
    return {
      eventName: decoded.eventName as string,
      args: { ...(decoded.args as unknown as Record<string, unknown>) },
      address: log.address,
      blockNumber: log.blockNumber,
      blockHash: log.blockHash,
      txHash: log.transactionHash,
      logIndex: log.logIndex,
    };
  } catch {
    return null;
  }
}

/**
 * Decode a raw log emitted by OUR processor. Logs from any other address return null — a lookalike contract
 * emitting identical event signatures is never trusted.
 */
export function decodeLog(log: RawLog): DecodedLog | null {
  if (lc(log.address) !== lc(contracts.processor)) return null;
  return decodeAnyProcessorLog(log);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Receipt with a short retry window (a freshly mined tx can lag on the RPC). Never throws on "not found". */
export async function fetchReceipt(chain: ChainAdapter, hash: Hex, opts: { attempts?: number; delayMs?: number } = {}): Promise<RawReceipt | null> {
  const attempts = Math.max(1, opts.attempts ?? 1);
  const delay = opts.delayMs ?? 1500;
  for (let i = 0; i < attempts; i++) {
    const r = await chain.getReceipt(hash);
    if (r) return r;
    if (i < attempts - 1) await sleep(Math.min(delay * 2 ** i, 8000));
  }
  return null;
}

// ---------------------------------------------------------------- live adapter

let _client: PublicClient | null = null;
export function publicClient(): PublicClient {
  if (!_client) {
    _client = createPublicClient({
      chain: mezoTestnet,
      transport: http(process.env.NEXT_PUBLIC_MEZO_RPC_URL || mezoTestnet.rpcUrls.default.http[0], {
        retryCount: 2,
        timeout: 20_000,
      }),
    }) as PublicClient;
  }
  return _client;
}

function toRawLog(l: {
  address: Address;
  topics: readonly Hex[] | Hex[];
  data: Hex;
  blockNumber: bigint | null;
  blockHash: Hex | null;
  transactionHash: Hex | null;
  logIndex: number | null;
}): RawLog {
  return {
    address: l.address,
    topics: [...l.topics] as Hex[],
    data: l.data,
    blockNumber: l.blockNumber ?? 0n,
    blockHash: (l.blockHash ?? "0x") as Hex,
    transactionHash: (l.transactionHash ?? "0x") as Hex,
    logIndex: l.logIndex ?? 0,
  };
}

const asBig = (v: unknown): bigint => (typeof v === "bigint" ? v : BigInt((v as number | string | undefined) ?? 0));

export function createLiveChain(client: PublicClient = publicClient()): ChainAdapter {
  const processor = contracts.processor;
  return {
    chainId: () => client.getChainId(),
    getBlockNumber: () => client.getBlockNumber(),
    async getBlock(n) {
      const b = await client.getBlock({ blockNumber: n });
      return { number: b.number ?? n, hash: b.hash as Hex, timestamp: b.timestamp };
    },
    async getLogs({ fromBlock, toBlock }) {
      const logs = await client.getLogs({ address: processor, fromBlock, toBlock });
      return logs.map(toRawLog);
    },
    async getReceipt(hash) {
      try {
        const r = await client.getTransactionReceipt({ hash });
        return {
          status: r.status,
          to: r.to,
          from: r.from,
          blockNumber: r.blockNumber,
          blockHash: r.blockHash,
          transactionHash: r.transactionHash,
          logs: r.logs.map(toRawLog),
        };
      } catch (e) {
        if (e instanceof Error && /could not be found|not found/i.test(e.message)) return null;
        throw e;
      }
    },
    async getMerchant(id) {
      const r = (await client.readContract({ address: processor, abi: processorAbi, functionName: "merchant", args: [id] })) as unknown as {
        owner: Address;
        payout: Address;
        active: boolean;
      };
      return { owner: r.owner, payout: r.payout, active: Boolean(r.active) };
    },
    async isSigner(id, signer) {
      return Boolean(await client.readContract({ address: processor, abi: processorAbi, functionName: "isSigner", args: [id, signer] }));
    },
    async intentState(merchantId, paymentId) {
      const s = await client.readContract({ address: processor, abi: processorAbi, functionName: "intentState", args: [merchantId, paymentId] });
      return CHAIN_INTENT_STATE[Number(s)] ?? "none";
    },
    async getPayment(merchantId, paymentId) {
      const r = (await client.readContract({ address: processor, abi: processorAbi, functionName: "payment", args: [merchantId, paymentId] })) as unknown as Record<
        string,
        unknown
      >;
      return {
        merchantId: asBig(r.merchantId),
        payer: r.payer as Address,
        token: r.token as Address,
        amount: asBig(r.amount),
        refunded: asBig(r.refunded),
        paidAt: asBig(r.paidAt),
      };
    },
    async checkPayment(intent, signature, payer) {
      const r = await client.readContract({
        address: processor,
        abi: processorAbi,
        functionName: "checkPayment",
        args: [intent, signature, payer],
      });
      return PAY_CHECK[Number(r)] ?? "bad_signature";
    },
    async balanceOf(token, owner) {
      return (await client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [owner] })) as bigint;
    },
    async allowance(token, owner, spender) {
      return (await client.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [owner, spender] })) as bigint;
    },
    nativeBalance: (address) => client.getBalance({ address }),
    async verifySmartSignature(address, message, signature) {
      // Mezo Passport Bitcoin wallets sign as a Mezo smart account: ERC-1271, or ERC-6492 before deployment.
      try {
        return await client.verifyMessage({ address, message, signature });
      } catch (e) {
        if (isRpcUnavailable(e)) throw unavailable("chain_unavailable", "Couldn't reach Mezo to check this wallet's signature. Try again shortly.");
        return false;
      }
    },
  };
}

// ---------------------------------------------------------------- singleton + helpers

/** True for transport-level failures (RPC down / timeout), as opposed to a signature that simply doesn't verify. */
export function isRpcUnavailable(e: unknown): boolean {
  let cur: unknown = e;
  for (let i = 0; i < 8 && cur && typeof cur === "object"; i++) {
    const name = (cur as { name?: string }).name ?? "";
    if (name === "HttpRequestError" || name === "TimeoutError" || name === "WebSocketRequestError") return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

let _chain: ChainAdapter | null = null;
export function getChain(): ChainAdapter {
  if (!_chain) _chain = createLiveChain();
  return _chain;
}
export function setChainForTests(c: ChainAdapter | null) {
  _chain = c;
}

/** EOA ecrecover first (no network), then ERC-1271/6492 via the RPC for smart accounts. */
export async function verifyWalletSignature(chain: ChainAdapter, address: Address, message: string, signature: Hex): Promise<boolean> {
  try {
    if (await verifyMessage({ address, message, signature })) return true;
  } catch {
    // malformed / non-65-byte signature: fall through to smart-account check
  }
  return chain.verifySmartSignature(address, message, signature);
}

/** Bigint-safe JSON (bigint → decimal string) for blockchain_events.args. */
export function argsToJson(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) out[k] = typeof v === "bigint" ? v.toString() : typeof v === "string" ? v.toLowerCase() : v;
  return out;
}

export function isRpcError(e: unknown): boolean {
  if (!(e instanceof Error)) return true;
  const n = e.name || "";
  return /HttpRequestError|TimeoutError|RpcRequestError|FetchError|SocketClosedError|WebSocketRequestError|InternalRpcError|LimitExceeded|fetch failed/i.test(
    n + " " + e.message,
  );
}

/** Await a promise with a deadline (health checks). */
export async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p, new Promise<T>((_r, rej) => (t = setTimeout(() => rej(new Error("timeout")), ms)))]);
  } finally {
    if (t) clearTimeout(t);
  }
}
