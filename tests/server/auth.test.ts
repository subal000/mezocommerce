import "./setup-env";
import { beforeEach, describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { resetDbForTests } from "@/lib/server/db";
import { issueNonce, verifySignIn, SESSION_COOKIE } from "@/lib/server/auth";
import { setChainForTests } from "@/lib/server/chain";
import { FakeChain, call } from "./fakes";
import * as nonceRoute from "@/app/api/auth/nonce/route";
import * as verifyRoute from "@/app/api/auth/verify/route";
import * as sessionRoute from "@/app/api/auth/session/route";

const acct = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const origin = { domain: "localhost:3000", uri: "http://localhost:3000" };

describe("merchant sign-in", () => {
  let chain: FakeChain;
  beforeEach(async () => {
    await resetDbForTests();
    chain = new FakeChain();
    setChainForTests(chain);
  });

  it("signs in with a valid signature and rejects nonce replay", async () => {
    const sql = await resetDbForTests();
    const { message } = await issueNonce(sql, acct.address, origin);
    const signature = await acct.signMessage({ message });
    const s = await verifySignIn(sql, chain, { address: acct.address, message, signature }, { allowedDomains: ["localhost:3000"] });
    expect(s.address).toBe(acct.address.toLowerCase());
    await expect(verifySignIn(sql, chain, { address: acct.address, message, signature }, { allowedDomains: ["localhost:3000"] })).rejects.toMatchObject({
      code: "nonce_used",
    });
  });

  it("rejects a message for another domain and a wrong signer", async () => {
    const sql = await resetDbForTests();
    const { message } = await issueNonce(sql, acct.address, { domain: "evil.example", uri: "https://evil.example" });
    const signature = await acct.signMessage({ message });
    await expect(verifySignIn(sql, chain, { address: acct.address, message, signature }, { allowedDomains: ["localhost:3000"] })).rejects.toMatchObject({
      code: "domain_mismatch",
    });
    const other = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
    const n2 = await issueNonce(sql, acct.address, origin);
    const bad = await other.signMessage({ message: n2.message });
    await expect(verifySignIn(sql, chain, { address: acct.address, message: n2.message, signature: bad }, { allowedDomains: ["localhost:3000"] })).rejects.toMatchObject({
      code: "invalid_signature",
    });
  });

  it("route flow sets an httpOnly cookie usable for /api/auth/session", async () => {
    const n = await call(nonceRoute.POST, { method: "POST", path: "/api/auth/nonce", body: { address: acct.address }, headers: { host: "localhost:3000" } });
    expect(n.status).toBe(200);
    const signature = await acct.signMessage({ message: n.body.message });
    const v = await call(verifyRoute.POST, {
      method: "POST",
      path: "/api/auth/verify",
      body: { address: acct.address, message: n.body.message, signature },
      headers: { host: "localhost:3000" },
    });
    expect(v.status).toBe(200);
    const cookie = v.headers.get("set-cookie")!;
    expect(cookie).toContain(`${SESSION_COOKIE}=`);
    expect(cookie).toContain("HttpOnly");
    const s = await call(sessionRoute.GET, { headers: { cookie: cookie.split(";")[0] } });
    expect(s.status).toBe(200);
    expect(s.body.address).toBe(acct.address.toLowerCase());
    expect(s.body.merchant_id).toBeNull();
    const anon = await call(sessionRoute.GET);
    expect(anon.status).toBe(401);
  });
});
