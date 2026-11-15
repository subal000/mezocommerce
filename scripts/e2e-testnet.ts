// End-to-end run against a configured deployment on Mezo Testnet (real chain, real MUSD). NOT run in CI.
//
//   E2E_BASE_URL=http://localhost:3000 E2E_MERCHANT_KEY=0x… E2E_CUSTOMER_KEY=0x… npm run e2e:testnet
//
// Merchant wallet: needs a little testnet BTC (gas). It registers as a merchant with ITSELF as payout, so it receives
// the 10 MUSD and can refund them. Customer wallet: testnet BTC (gas) + ≥ 10 MUSD.
// Webhooks: a local receiver listens on E2E_WEBHOOK_PORT (default 4455). The server must be able to reach it:
// either E2E_WEBHOOK_PUBLIC_URL (an https tunnel to that port) or a local dev server with WEBHOOK_ALLOW_LOCALHOST=1.
// The worker (npm run worker) must be running against the same DB, or set INDEXER_SECRET to drive passes from here.

import "../worker/load-env";
import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createPublicClient, createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { erc20Abi, processorAbi } from "@/lib/chain/abis";
import { contracts, explorerTx, isDeployed, mezoTestnet } from "@/lib/chain/config";
import type {
  CheckoutDTO,
  CheckoutStatusDTO,
  CreatedApiKeyDTO,
  CreatedWebhookEndpointDTO,
  NonceResponse,
  PaymentIntentDTO,
  RefundDTO,
  RegistrationParamsDTO,
} from "@/lib/api-types";

const BASE = (process.env.E2E_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, "");
const PORT = Number(process.env.E2E_WEBHOOK_PORT || 4455);
const HOOK_URL = process.env.E2E_WEBHOOK_PUBLIC_URL || `http://localhost:${PORT}/`;
const need = (k: string) => {
  const v = process.env[k];
  if (!v || !/^0x[0-9a-fA-F]{64}$/.test(v)) throw new Error(`${k} must be a 0x-prefixed 32-byte private key`);
  return v as Hex;
};

const merchant = privateKeyToAccount(need("E2E_MERCHANT_KEY"));
const customer = privateKeyToAccount(need("E2E_CUSTOMER_KEY"));
const transport = http(process.env.NEXT_PUBLIC_MEZO_RPC_URL || mezoTestnet.rpcUrls.default.http[0]);
const pub = createPublicClient({ chain: mezoTestnet, transport });
const mWallet = createWalletClient({ account: merchant, chain: mezoTestnet, transport });
const cWallet = createWalletClient({ account: customer, chain: mezoTestnet, transport });
const links: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (m: string) => console.log(`[e2e] ${m}`);

let cookie = "";
async function api<T>(path: string, init: { method?: string; body?: unknown; key?: string } = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: {
      "content-type": "application/json",
      ...(init.key ? { authorization: `Bearer ${init.key}` } : cookie ? { cookie } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} → ${res.status} ${text}`);
  return (text ? JSON.parse(text) : null) as T;
}

async function send(wallet: typeof mWallet, req: { to: Address; data?: Hex; abi?: unknown; functionName?: string; args?: unknown[] }, label: string): Promise<Hex> {
  const hash = req.abi
    ? await wallet.writeContract({ address: req.to, abi: req.abi as typeof processorAbi, functionName: req.functionName as never, args: req.args as never })
    : await wallet.sendTransaction({ to: req.to, data: req.data });
  const r = await pub.waitForTransactionReceipt({ hash });
  links.push(`${label}: ${explorerTx(hash)}`);
  if (r.status !== "success") throw new Error(`${label} reverted: ${hash}`);
  log(`${label} mined in block ${r.blockNumber}`);
  return hash;
}

async function nudgeIndexer() {
  if (!process.env.INDEXER_SECRET) return;
  await fetch(`${BASE}/api/indexer/sync`, { method: "POST", headers: { authorization: `Bearer ${process.env.INDEXER_SECRET}` } }).catch(() => undefined);
}

async function main() {
  if (!isDeployed) throw new Error("NEXT_PUBLIC_PROCESSOR_ADDRESS is not set");
  log(`base ${BASE}, processor ${contracts.processor}, merchant ${merchant.address}, customer ${customer.address}`);

  // ── webhook receiver ────────────────────────────────────────────────────────────────────────────────
  let secret = "";
  const received: { id: string; type: string; ok: boolean }[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const header = String(req.headers["mezocommerce-signature"] || "");
      const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
      const expected = createHmac("sha256", secret).update(`${parts.t}.${raw}`).digest();
      const got = Buffer.from(parts.v1 || "", "hex");
      const fresh = Math.abs(Date.now() / 1000 - Number(parts.t)) < 300;
      const ok = fresh && got.length === expected.length && timingSafeEqual(got, expected);
      const body = JSON.parse(raw || "{}");
      received.push({ id: String(req.headers["mezocommerce-event-id"]), type: body.type, ok });
      log(`webhook ${body.type} signature ${ok ? "valid" : "INVALID"}`);
      res.writeHead(ok ? 200 : 400).end();
    });
  });
  await new Promise<void>((r) => server.listen(PORT, r));

  // ── merchant sign-in + onboarding ───────────────────────────────────────────────────────────────────
  const n = await api<NonceResponse>("/api/auth/nonce", { body: { address: merchant.address } });
  await api("/api/auth/verify", { body: { address: merchant.address, message: n.message, signature: await merchant.signMessage({ message: n.message }) } });
  try {
    await api("/api/merchants/me");
  } catch {
    await api("/api/merchants", { body: { name: `E2E Store ${Date.now().toString(36)}`, payout_address: merchant.address } });
  }
  for (let step = 0; step < 4; step++) {
    const reg = await api<RegistrationParamsDTO>("/api/merchants/me/registration");
    log(`registration next: ${reg.next}`);
    if (reg.next === "ready") break;
    const me = await api<{ onchain_merchant_id: string | null }>("/api/merchants/me");
    const id = me.onchain_merchant_id ? BigInt(me.onchain_merchant_id) : 0n;
    const tx =
      reg.next === "register"
        ? await send(mWallet, { to: contracts.processor, abi: processorAbi, functionName: "registerMerchant", args: [reg.payout_address, reg.platform_signer] }, "registerMerchant")
        : reg.next === "enable_signer"
          ? await send(mWallet, { to: contracts.processor, abi: processorAbi, functionName: "setSigner", args: [id, reg.platform_signer, true] }, "setSigner")
          : await send(mWallet, { to: contracts.processor, abi: processorAbi, functionName: "setMerchantActive", args: [id, true] }, "setMerchantActive");
    await api("/api/merchants/me/confirm", { body: { tx_hash: tx } });
  }

  const key = await api<CreatedApiKeyDTO>("/api/merchant/api-keys", { body: { name: "e2e" } });
  const ep = await api<CreatedWebhookEndpointDTO>("/api/merchant/webhooks", { body: { url: HOOK_URL } });
  secret = ep.secret;

  // ── 10 MUSD intent via the public v1 API ────────────────────────────────────────────────────────────
  const intent = await api<PaymentIntentDTO>("/api/v1/payment-intents", {
    key: key.secret,
    body: { merchant_order_id: `e2e-${Date.now()}`, amount: "10", description: "E2E test order" },
  });
  log(`intent ${intent.id} → ${intent.checkout_url}`);

  // ── customer: approve exact amount + pay ────────────────────────────────────────────────────────────
  const co = await api<CheckoutDTO>(`/api/public/checkout/${intent.id}`);
  if (!co.intent) throw new Error("checkout has no payable intent");
  const s = co.intent;
  const struct = {
    paymentId: s.payment_id as Hex,
    merchantId: BigInt(s.merchant_id),
    payout: s.payout as Address,
    token: s.token as Address,
    amount: BigInt(s.amount),
    payer: s.payer as Address,
    expiresAt: BigInt(s.expires_at),
  };
  await send(cWallet, { to: struct.token, abi: erc20Abi, functionName: "approve", args: [contracts.processor, struct.amount] }, "customer approve (exact)");
  const payTx = await send(cWallet, { to: contracts.processor, abi: processorAbi, functionName: "pay", args: [struct, s.signature] }, "customer pay");
  await api(`/api/public/checkout/${intent.id}/submitted`, { body: { tx_hash: payTx, payer_address: customer.address } });

  // ── wait for paid (worker / indexer confirms) ───────────────────────────────────────────────────────
  const deadline = Date.now() + 5 * 60_000;
  let st: CheckoutStatusDTO | null = null;
  while (Date.now() < deadline) {
    await nudgeIndexer();
    st = await api<CheckoutStatusDTO>(`/api/public/checkout/${intent.id}/status`);
    if (st.verified) break;
    await sleep(4000);
  }
  if (!st?.verified) throw new Error(`payment not verified in time (status ${st?.status})`);
  log(`paid: ${st.status}, ${st.payment?.confirmations} confirmations`);

  while (Date.now() < deadline && !received.some((r) => r.type === "payment.confirmed")) {
    await nudgeIndexer();
    await sleep(3000);
  }
  const confirmedHook = received.find((r) => r.type === "payment.confirmed");
  if (!confirmedHook?.ok) throw new Error("payment.confirmed webhook not received with a valid signature");

  // ── full refund from the merchant wallet ────────────────────────────────────────────────────────────
  const refund = await api<RefundDTO>("/api/merchant/refunds", { body: { payment_intent_id: intent.id, amount: "10", reason: "E2E refund" } });
  if (!refund.tx) throw new Error("refund has no tx calls");
  await send(mWallet, { to: refund.tx.approve.to as Address, data: refund.tx.approve.data as Hex }, "merchant approve refund (exact)");
  const refundTx = await send(mWallet, { to: refund.tx.refund.to as Address, data: refund.tx.refund.data as Hex }, "merchant refund");
  const done = await api<RefundDTO>(`/api/merchant/refunds/${refund.id}/submitted`, { body: { tx_hash: refundTx } });
  log(`refund ${done.status}`);
  if (done.status !== "confirmed") throw new Error("refund not confirmed");
  const final = await api<CheckoutStatusDTO>(`/api/public/checkout/${intent.id}/status`);
  log(`final status: ${final.status}`);

  server.close();
  console.log("\nExplorer links:\n" + links.map((l) => `  ${l}`).join("\n"));
  console.log(`\nWebhooks received: ${received.map((r) => `${r.type}${r.ok ? "" : " (bad sig)"}`).join(", ")}`);
}

main().catch((e) => {
  console.error("[e2e] FAILED:", e instanceof Error ? e.message : e);
  if (links.length) console.error("Explorer links so far:\n" + links.map((l) => `  ${l}`).join("\n"));
  process.exit(1);
});
