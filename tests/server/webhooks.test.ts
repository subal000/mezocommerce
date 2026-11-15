import "./setup-env";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb, resetDbForTests } from "@/lib/server/db";
import { setChainForTests } from "@/lib/server/chain";
import { clock } from "@/lib/server/clock";
import { clearReadinessCache, type MerchantRow } from "@/lib/server/merchants";
import { createPaymentIntent } from "@/lib/server/intents";
import {
  assertPublicWebhookUrl,
  createEndpoint,
  deliverPendingWebhooks,
  isPrivateIp,
  signWebhook,
  validateEndpointUrl,
  verifyWebhookSignature,
  webhookBackoffSeconds,
  WEBHOOK_MAX_ATTEMPTS,
} from "@/lib/server/webhooks";
import { FakeChain, setupMerchant } from "./fakes";

let chain: FakeChain;
let merchant: MerchantRow;
const publicDns = async () => ["93.184.216.34"];

beforeEach(async () => {
  await resetDbForTests();
  clearReadinessCache();
  clock.set(null);
  chain = new FakeChain();
  setChainForTests(chain);
  merchant = await setupMerchant(chain);
});

describe("webhook signing", () => {
  it("signs t=,v1= and verifies; rejects tampering and stale timestamps", () => {
    const now = Math.floor(Date.now() / 1000);
    const h = signWebhook("whsec_x", '{"a":1}', now);
    expect(h).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(verifyWebhookSignature("whsec_x", '{"a":1}', h, 300, now)).toBe(true);
    expect(verifyWebhookSignature("whsec_x", '{"a":2}', h, 300, now)).toBe(false);
    expect(verifyWebhookSignature("whsec_y", '{"a":1}', h, 300, now)).toBe(false);
    expect(verifyWebhookSignature("whsec_x", '{"a":1}', h, 300, now + 301)).toBe(false);
    expect(verifyWebhookSignature("whsec_x", '{"a":1}', "garbage", 300, now)).toBe(false);
  });
});

describe("delivery", () => {
  async function setupEvent() {
    const sql = await getDb();
    const ep = await createEndpoint(sql, merchant.id, { url: "https://hooks.example.com/mc" }, "test");
    const i = await createPaymentIntent(sql, chain, { merchant, input: { merchant_order_id: "w1", amount: "1" }, source: "api", actor: "t" });
    return { sql, ep, i };
  }

  it("delivers with MezoCommerce headers + valid signature, payload shape per api-types", async () => {
    const { sql, ep, i } = await setupEvent();
    const seen: { url: string; headers: Record<string, string>; body: string }[] = [];
    const fetchImpl = (async (url: string, init: { headers: Record<string, string>; body: string }) => {
      seen.push({ url, headers: init.headers, body: init.body });
      return { status: 200 };
    }) as unknown as typeof fetch;
    const r = await deliverPendingWebhooks(sql, { fetchImpl, resolve: publicDns });
    expect(r.delivered).toBe(1);
    const h = seen[0].headers;
    const body = JSON.parse(seen[0].body);
    expect(body.type).toBe("payment.created");
    expect(body.object).toBe("event");
    expect(body.livemode).toBe(false);
    expect(body.data.payment_intent.id).toBe(i.id);
    expect(h["MezoCommerce-Event-Id"]).toBe(body.id);
    expect(h["MezoCommerce-Event-Type"]).toBe("payment.created");
    expect(h["user-agent"]).toBe("MezoCommerce-Webhooks/1");
    expect(verifyWebhookSignature(ep.secret, seen[0].body, h["MezoCommerce-Signature"])).toBe(true);
    const [d] = await sql`SELECT status FROM webhook_deliveries`;
    expect(d.status).toBe("delivered");
  });

  it("retries with exponential backoff, fails after 5 attempts, same event id every time", async () => {
    const { sql } = await setupEvent();
    const ids = new Set<string>();
    const fetchImpl = (async (_u: string, init: { headers: Record<string, string> }) => {
      ids.add(init.headers["MezoCommerce-Event-Id"]);
      return { status: 500 };
    }) as unknown as typeof fetch;
    let t = Date.now();
    clock.set(() => new Date(t));
    for (let a = 1; a <= WEBHOOK_MAX_ATTEMPTS; a++) {
      await deliverPendingWebhooks(sql, { fetchImpl, resolve: publicDns });
      const [d] = await sql`SELECT * FROM webhook_deliveries`;
      expect(Number(d.attempt_count)).toBe(a);
      if (a < WEBHOOK_MAX_ATTEMPTS) {
        expect(d.status).toBe("pending");
        expect(new Date(d.next_retry_at as string).getTime() - t).toBe(webhookBackoffSeconds(a) * 1000);
        // not due yet → nothing sent
        const before = ids.size;
        await deliverPendingWebhooks(sql, { fetchImpl, resolve: publicDns });
        expect(ids.size).toBe(before);
        t += webhookBackoffSeconds(a) * 1000 + 1;
      } else {
        expect(d.status).toBe("failed");
        expect(d.last_error).toBe("HTTP 500");
      }
    }
    expect(ids.size).toBe(1);
    expect([1, 2, 3, 4].map(webhookBackoffSeconds)).toEqual([30, 60, 120, 240]);
  });

  it("SSRF: private / loopback / metadata hosts are rejected at save time and at delivery time", async () => {
    for (const u of ["http://example.com/x", "https://localhost/x", "https://127.0.0.1/x", "https://169.254.169.254/latest", "https://10.0.0.5/x", "https://[::1]/x", "https://user:pw@example.com/", "https://example.com:8443/"]) {
      expect(() => validateEndpointUrl(u), u).toThrow();
    }
    expect(isPrivateIp("192.168.1.1")).toBe(true);
    expect(isPrivateIp("::ffff:10.0.0.1")).toBe(true);
    expect(isPrivateIp("8.8.8.8")).toBe(false);
    await expect(assertPublicWebhookUrl("https://rebind.example.com/x", async () => ["10.1.2.3"])).rejects.toThrow(/private/);
    // DNS changes after save: delivery fails, nothing is fetched
    const { sql } = await setupEvent();
    let called = 0;
    const fetchImpl = (async () => {
      called++;
      return { status: 200 };
    }) as unknown as typeof fetch;
    const r = await deliverPendingWebhooks(sql, { fetchImpl, resolve: async () => ["127.0.0.1"] });
    expect(called).toBe(0);
    expect(r.retried).toBe(1);
    const [d] = await sql`SELECT last_error FROM webhook_deliveries`;
    expect(String(d.last_error)).toMatch(/private/);
  });

  it("only subscribed endpoints get deliveries; dedupe keys prevent duplicate events", async () => {
    const sql = await getDb();
    await createEndpoint(sql, merchant.id, { url: "https://a.example.com/h", event_types: ["payment.confirmed"] }, "t");
    await createEndpoint(sql, merchant.id, { url: "https://b.example.com/h" }, "t");
    await createPaymentIntent(sql, chain, { merchant, input: { merchant_order_id: "w2", amount: "1" }, source: "api", actor: "t" });
    const rows = await sql`SELECT e.url FROM webhook_deliveries d JOIN webhook_endpoints e ON e.id = d.endpoint_id`;
    expect(rows.map((r) => r.url)).toEqual(["https://b.example.com/h"]);
  });
});
