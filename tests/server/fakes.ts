import { encodeAbiParameters, encodeEventTopics, keccak256, toHex, type Address, type Hex } from "viem";
import { processorAbi } from "@/lib/chain/abis";
import { contracts, type PayCheck } from "@/lib/chain/config";
import type { PaymentIntentDTO } from "@/lib/api-types";
import type { ChainAdapter, ChainBlock, ChainIntentState, ChainMerchant, ChainPaymentRecord, RawLog, RawReceipt } from "@/lib/server/chain";
import { getDb, type Sql } from "@/lib/server/db";
import { ensureUser } from "@/lib/server/users";
import { signSessionId, SESSION_COOKIE } from "@/lib/server/auth";
import { clock } from "@/lib/server/clock";
import { platformSignerAddress } from "@/lib/server/signer";
import { createApiKey } from "@/lib/server/api-keys";
import { merchantById, type MerchantRow } from "@/lib/server/merchants";
import { randomBytes } from "node:crypto";

export const PROCESSOR = contracts.processor;
export const MUSD = contracts.musd;
export const OWNER = "0xaaaa00000000000000000000000000000000aaaa" as Address;
export const PAYOUT = "0xabab00000000000000000000000000000000abab" as Address;
export const CUSTOMER = "0xbbbb00000000000000000000000000000000bbbb" as Address;
export const STRANGER = "0xdddd00000000000000000000000000000000dddd" as Address;
export const LOOKALIKE = "0x9999999999999999999999999999999999999999" as Address;
export const E18 = 10n ** 18n;

let txCounter = 0;
export const txHash = (label = ""): Hex => keccak256(toHex(`tx-${label}-${++txCounter}-${Math.random()}`));
export const blockHashOf = (n: bigint, fork: number): Hex => keccak256(toHex(`block-${n}-${fork}`));

type AnyAbi = readonly { type: string; name?: string; inputs?: readonly { name: string; type: string; indexed?: boolean }[] }[];

/** Build a raw log exactly as an RPC would return it (ABI-encoded topics + data). */
export function rawLog(eventName: string, args: Record<string, unknown>, meta: { blockNumber: bigint; txHash: Hex; logIndex: number; address?: Address; fork?: number }): RawLog {
  const abi = processorAbi as unknown as AnyAbi;
  const ev = abi.find((x) => x.type === "event" && x.name === eventName);
  if (!ev) throw new Error(`no event ${eventName}`);
  const indexedArgs: Record<string, unknown> = {};
  for (const i of ev.inputs!) if (i.indexed) indexedArgs[i.name] = args[i.name];
  const topics = (encodeEventTopics as unknown as (a: unknown) => Hex[])({ abi, eventName, args: indexedArgs });
  const nonIndexed = ev.inputs!.filter((i) => !i.indexed);
  const data = encodeAbiParameters(nonIndexed as never, nonIndexed.map((i) => args[i.name]) as never);
  return {
    address: meta.address ?? PROCESSOR,
    topics,
    data,
    blockNumber: meta.blockNumber,
    blockHash: blockHashOf(meta.blockNumber, meta.fork ?? 0),
    transactionHash: meta.txHash,
    logIndex: meta.logIndex,
  };
}

const rpcError = (m: string) => {
  const e = new Error(`HTTP request failed (${m})`);
  e.name = "HttpRequestError";
  return e;
};

/** In-memory chain. Tests mutate its state directly. */
export class FakeChain implements ChainAdapter {
  head = 100n;
  fork = new Map<bigint, number>();
  logs: RawLog[] = [];
  receipts = new Map<string, RawReceipt>();
  merchants = new Map<bigint, ChainMerchant>();
  signers = new Set<string>(); // `${id}:${addr}`
  states = new Map<string, ChainIntentState>();
  cancelledBy = new Set<string>(); // `${paymentId}:${merchantId}`
  payments = new Map<string, ChainPaymentRecord>();
  payCheck: PayCheck = "ok";
  balance = 1000n * E18;
  allowanceValue = 0n;
  native = 10n ** 16n;
  failing = new Set<string>();
  getLogsCalls: { fromBlock: bigint; toBlock: bigint }[] = [];

  private f(m: string) {
    if (this.failing.has(m) || this.failing.has("*")) throw rpcError(m);
  }
  async chainId() {
    this.f("chainId");
    return 31611;
  }
  async getBlockNumber() {
    this.f("getBlockNumber");
    return this.head;
  }
  async getBlock(n: bigint): Promise<ChainBlock> {
    this.f("getBlock");
    return { number: n, hash: blockHashOf(n, this.fork.get(n) ?? 0), timestamp: 1_800_000_000n + n * 5n };
  }
  async getLogs(r: { fromBlock: bigint; toBlock: bigint }) {
    this.f("getLogs");
    this.getLogsCalls.push(r);
    return this.logs.filter((l) => l.blockNumber >= r.fromBlock && l.blockNumber <= r.toBlock && this.canonical(l.blockNumber, l.blockHash));
  }
  canonical(n: bigint, hash: Hex): boolean {
    return blockHashOf(n, this.fork.get(n) ?? 0) === hash;
  }
  async getReceipt(hash: Hex) {
    this.f("getReceipt");
    const r = this.receipts.get(hash.toLowerCase());
    if (!r) return null;
    if (!this.canonical(r.blockNumber, r.blockHash)) return null; // reorged out
    return r;
  }
  async getMerchant(id: bigint) {
    this.f("getMerchant");
    return this.merchants.get(id) ?? { owner: "0x0000000000000000000000000000000000000000" as Address, payout: "0x0000000000000000000000000000000000000000" as Address, active: false };
  }
  async isSigner(id: bigint, signer: Address) {
    this.f("isSigner");
    return this.signers.has(`${id}:${signer.toLowerCase()}`);
  }
  async intentState(mid: bigint, pid: Hex) {
    this.f("intentState");
    if (this.cancelledBy.has(`${pid.toLowerCase()}:${mid}`)) return "cancelled" as const;
    return this.states.get(pid.toLowerCase()) ?? "none";
  }
  async getPayment(_mid: bigint, pid: Hex) {
    this.f("getPayment");
    return this.payments.get(pid.toLowerCase()) ?? { merchantId: 0n, payer: CUSTOMER, token: MUSD, amount: 0n, refunded: 0n, paidAt: 0n };
  }
  async checkPayment() {
    this.f("checkPayment");
    return this.payCheck;
  }
  async balanceOf() {
    return this.balance;
  }
  async allowance() {
    return this.allowanceValue;
  }
  async nativeBalance() {
    return this.native;
  }
  /** Result of the on-chain ERC-1271/6492 check (Mezo Passport smart accounts); an Error is thrown. */
  smartSig: boolean | Error = false;
  smartSigCalls = 0;
  async verifySmartSignature() {
    this.smartSigCalls++;
    if (this.smartSig instanceof Error) throw this.smartSig;
    return this.smartSig;
  }

  /** Mine a tx with `logs` in `block` (default head). */
  addTx(hash: Hex, logs: RawLog[], opts: { to?: Address; from?: Address; status?: "success" | "reverted"; block?: bigint } = {}): RawReceipt {
    const bn = opts.block ?? logs[0]?.blockNumber ?? this.head;
    const r: RawReceipt = {
      status: opts.status ?? "success",
      to: opts.to ?? PROCESSOR,
      from: opts.from ?? CUSTOMER,
      blockNumber: bn,
      blockHash: blockHashOf(bn, this.fork.get(bn) ?? 0),
      transactionHash: hash,
      logs: opts.status === "reverted" ? [] : logs,
    };
    this.receipts.set(hash.toLowerCase(), r);
    if (r.status === "success") this.logs.push(...logs);
    return r;
  }

  /** A PaymentCompleted for `intent` (fields overridable) mined in `block`. */
  pay(intent: PaymentIntentDTO, over: Partial<{ merchantId: bigint; payer: Address; payout: Address; token: Address; amount: bigint; address: Address; block: bigint; status: "success" | "reverted" }> = {}) {
    const hash = txHash("pay");
    const block = over.block ?? this.head;
    const log = rawLog(
      "PaymentCompleted",
      {
        paymentId: intent.payment_id,
        merchantId: over.merchantId ?? 1n,
        payer: over.payer ?? CUSTOMER,
        payout: over.payout ?? (intent.payout_address as Address),
        token: over.token ?? (intent.token_address as Address),
        amount: over.amount ?? BigInt(intent.amount),
        timestamp: 1_800_000_000n,
      },
      { blockNumber: block, txHash: hash, logIndex: 0, address: over.address, fork: this.fork.get(block) ?? 0 },
    );
    this.addTx(hash, [log], { status: over.status, block });
    if ((over.status ?? "success") === "success" && !over.address) {
      this.states.set(intent.payment_id.toLowerCase(), "paid");
      this.payments.set(intent.payment_id.toLowerCase(), { merchantId: 1n, payer: over.payer ?? CUSTOMER, token: MUSD, amount: BigInt(intent.amount), refunded: 0n, paidAt: 1n });
    }
    return { hash, log };
  }

  refund(intent: PaymentIntentDTO, amount: bigint, total: bigint, over: Partial<{ from: Address; payer: Address; block: bigint }> = {}) {
    const hash = txHash("refund");
    const block = over.block ?? this.head;
    const log = rawLog(
      "RefundCompleted",
      { paymentId: intent.payment_id, merchantId: 1n, payer: over.payer ?? CUSTOMER, from: over.from ?? OWNER, amount, totalRefunded: total },
      { blockNumber: block, txHash: hash, logIndex: 0, fork: this.fork.get(block) ?? 0 },
    );
    this.addTx(hash, [log], { from: over.from ?? OWNER, block });
    const rec = this.payments.get(intent.payment_id.toLowerCase());
    if (rec) rec.refunded = total;
    return { hash, log };
  }

  /** Reorg: blocks ≥ from get a new hash; logs in them disappear unless re-added. */
  reorgFrom(from: bigint) {
    for (let n = from; n <= this.head; n++) this.fork.set(n, (this.fork.get(n) ?? 0) + 1);
  }
}

/** Ready merchant: user + profile + on-chain id 1 (owner OWNER, payout PAYOUT, active, platform signer allowed). */
export async function setupMerchant(chain: FakeChain, opts: { owner?: Address; onchainId?: bigint; payout?: Address; name?: string } = {}): Promise<MerchantRow> {
  const sql = await getDb();
  const owner = (opts.owner ?? OWNER).toLowerCase();
  const id = opts.onchainId ?? 1n;
  const payout = (opts.payout ?? PAYOUT).toLowerCase();
  const userId = await ensureUser(sql, owner);
  const slug = `${(opts.name ?? "shop").toLowerCase()}-${id}`;
  const [row] = await sql`INSERT INTO merchants (owner_user_id, owner_address, onchain_merchant_id, payout_address, platform_signer_enabled, chain_active, status, name, slug)
                          VALUES (${userId}, ${owner}, ${id}, ${payout}, true, true, 'active', ${opts.name ?? "Shop"}, ${slug}) RETURNING id`;
  chain.merchants.set(id, { owner: owner as Address, payout: payout as Address, active: true });
  chain.signers.add(`${id}:${platformSignerAddress()}`);
  return (await merchantById(sql, String(row.id)))!;
}

export async function apiKeyFor(m: MerchantRow, permissions?: string[]): Promise<string> {
  const sql = await getDb();
  return (await createApiKey(sql, m.id, { name: "test", permissions }, "test")).secret;
}

export async function sessionCookieFor(address: string): Promise<string> {
  const sql = await getDb();
  const userId = await ensureUser(sql, address);
  const id = randomBytes(32).toString("hex");
  await sql`INSERT INTO sessions (id, user_id, address, expires_at) VALUES (${id}, ${userId}, ${address.toLowerCase()}, ${new Date(clock.now().getTime() + 3600_000)})`;
  return `${SESSION_COOKIE}=${signSessionId(id)}`;
}

/** Call a route handler like Next would. */
export async function call(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (req: Request, ctx: { params: Promise<any> }) => Promise<Response>,
  init: { method?: string; path?: string; body?: unknown; headers?: Record<string, string>; params?: Record<string, string> } = {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ status: number; body: any; headers: Headers }> {
  const req = new Request(`http://localhost:3000${init.path ?? "/"}`, {
    method: init.method ?? "GET",
    headers: { "content-type": "application/json", "x-real-ip": "10.0.0.1", ...(init.headers ?? {}) },
    body: init.body === undefined ? undefined : typeof init.body === "string" ? init.body : JSON.stringify(init.body),
  });
  const res = await handler(req, { params: Promise.resolve(init.params ?? {}) });
  const text = await res.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* text */
  }
  return { status: res.status, body, headers: res.headers };
}

export type { Sql };
