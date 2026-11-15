import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createDeduper, parseSignatureHeader, verifySignature } from "../../examples/webhook-receiver.mjs";

const SECRET = "whsec_test_secret";
const body = JSON.stringify({ id: "evt_1", type: "payment.confirmed" });
const sign = (t: number, raw: string, secret = SECRET) => createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex");

describe("examples/webhook-receiver.mjs", () => {
  const now = 1_800_000_000;
  it("accepts a valid signature", () => {
    expect(verifySignature({ rawBody: body, header: `t=${now},v1=${sign(now, body)}`, secret: SECRET, nowSeconds: now })).toEqual({ ok: true });
  });
  it("accepts when any v1 matches (secret rotation)", () => {
    const header = `t=${now},v1=${"0".repeat(64)},v1=${sign(now, body)}`;
    expect(verifySignature({ rawBody: body, header, secret: SECRET, nowSeconds: now }).ok).toBe(true);
  });
  it("rejects tampered bodies, wrong secrets and bad headers", () => {
    expect(verifySignature({ rawBody: body + " ", header: `t=${now},v1=${sign(now, body)}`, secret: SECRET, nowSeconds: now }).reason).toBe("mismatch");
    expect(verifySignature({ rawBody: body, header: `t=${now},v1=${sign(now, body, "other")}`, secret: SECRET, nowSeconds: now }).reason).toBe("mismatch");
    expect(verifySignature({ rawBody: body, header: "garbage", secret: SECRET, nowSeconds: now }).reason).toBe("bad_header");
    expect(verifySignature({ rawBody: body, header: `t=${now},v1=${sign(now, body)}`, secret: "", nowSeconds: now }).reason).toBe("no_secret");
  });
  it("enforces the 5-minute tolerance", () => {
    const t = now - 301;
    expect(verifySignature({ rawBody: body, header: `t=${t},v1=${sign(t, body)}`, secret: SECRET, nowSeconds: now }).reason).toBe("too_old");
    const t2 = now - 299;
    expect(verifySignature({ rawBody: body, header: `t=${t2},v1=${sign(t2, body)}`, secret: SECRET, nowSeconds: now }).ok).toBe(true);
  });
  it("parses headers", () => {
    expect(parseSignatureHeader(`t=5,v1=${"a".repeat(64)}`)).toEqual({ t: 5, v1: ["a".repeat(64)] });
    expect(parseSignatureHeader("t=5")).toBeNull();
  });
  it("dedupes event ids", () => {
    const d = createDeduper();
    expect(d.first("evt_1")).toBe(true);
    expect(d.first("evt_1")).toBe(false);
    expect(d.first("")).toBe(false);
  });
});
