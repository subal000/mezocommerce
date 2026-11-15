import "./setup-env";
import { beforeEach, describe, expect, it } from "vitest";
import { HttpRequestError } from "viem";
import { resetDbForTests } from "@/lib/server/db";
import { issueNonce, verifySignIn } from "@/lib/server/auth";
import { isRpcUnavailable, setChainForTests } from "@/lib/server/chain";
import { unavailable } from "@/lib/server/errors";
import { FakeChain } from "./fakes";

// Mezo Passport Bitcoin wallets sign as a Mezo smart account. ECDSA recovery fails, so the server falls back to
// the on-chain ERC-1271 / ERC-6492 check (ChainAdapter.verifySmartSignature).
const smartAccount = "0x1111111111111111111111111111111111111111";
const origin = { domain: "localhost:3000", uri: "http://localhost:3000" };
const allowed = { allowedDomains: ["localhost:3000"] };
// ERC-6492-shaped signature (wrapped, longer than 65 bytes) — opaque to ECDSA.
const sig6492 = `0x${"ab".repeat(200)}6492649264926492649264926492649264926492649264926492649264926492` as `0x${string}`;

describe("sign-in with a Mezo Passport smart account", () => {
  let chain: FakeChain;
  beforeEach(() => {
    chain = new FakeChain();
    setChainForTests(chain);
  });

  it("accepts a signature the chain validates (ERC-1271/6492)", async () => {
    const sql = await resetDbForTests();
    chain.smartSig = true;
    const { message } = await issueNonce(sql, smartAccount, origin);
    const s = await verifySignIn(sql, chain, { address: smartAccount, message, signature: sig6492 }, allowed);
    expect(s.address).toBe(smartAccount);
    expect(chain.smartSigCalls).toBe(1);
  });

  it("rejects when the chain says the signature is invalid", async () => {
    const sql = await resetDbForTests();
    chain.smartSig = false;
    const { message } = await issueNonce(sql, smartAccount, origin);
    await expect(verifySignIn(sql, chain, { address: smartAccount, message, signature: sig6492 }, allowed)).rejects.toMatchObject({ code: "invalid_signature" });
  });

  it("an RPC outage is a retryable 503, not a bad signature, and the nonce stays usable", async () => {
    const sql = await resetDbForTests();
    chain.smartSig = unavailable("chain_unavailable", "down");
    const { message } = await issueNonce(sql, smartAccount, origin);
    await expect(verifySignIn(sql, chain, { address: smartAccount, message, signature: sig6492 }, allowed)).rejects.toMatchObject({
      code: "chain_unavailable",
      status: 503,
    });
    chain.smartSig = true;
    const s = await verifySignIn(sql, chain, { address: smartAccount, message, signature: sig6492 }, allowed);
    expect(s.address).toBe(smartAccount);
  });

  it("isRpcUnavailable detects transport failures only", () => {
    const http = new HttpRequestError({ url: "https://rpc.test.mezo.org" });
    expect(isRpcUnavailable(http)).toBe(true);
    expect(isRpcUnavailable(new Error("wrapper", { cause: http }))).toBe(true);
    expect(isRpcUnavailable(new Error("execution reverted"))).toBe(false);
  });
});
