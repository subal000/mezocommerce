import "./setup-env";
import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb, resetDbForTests } from "@/lib/server/db";
import { setChainForTests } from "@/lib/server/chain";
import { clock } from "@/lib/server/clock";
import { clearReadinessCache, type MerchantRow } from "@/lib/server/merchants";
import { findIntent } from "@/lib/server/dto";
import { resetIndexerPassCountForTests, runIndexerPass } from "@/lib/server/indexer";
import { connectShopify, runShopifySync, setShopifyFetchForTests, SHOPIFY_API_VERSION } from "@/lib/server/shopify";
import { decryptSecret } from "@/lib/server/crypto";
import { FakeChain, call, setupMerchant } from "./fakes";
import * as webhookRoute from "@/app/api/integrations/shopify/webhook/[merchantSlug]/route";
import * as payRoute from "@/app/pay/shopify/[shop]/[orderId]/route";

const SHOP = "tea-shop.myshopify.com";
const SECRET = "shpss_test_secret_123";
let chain: FakeChain;
let merchant: MerchantRow;
let gql: { query: string; variables: Record<string, unknown>; url: string; token: string }[];
let financial = "PENDING";

function shopifyFetch(): typeof fetch {
  return (async (url: string, init: { headers: Record<string, string>; body: string }) => {
    const { query, variables } = JSON.parse(init.body);
    gql.push({ query, variables, url, token: init.headers["x-shopify-access-token"] });
    let data: unknown = {};
    if (query.includes("shop { name }")) data = { shop: { name: "Tea" } };
    else if (query.includes("orderMarkAsPaid")) {
      financial = "PAID";
      data = { orderMarkAsPaid: { order: { id: variables.input.id, displayFinancialStatus: "PAID" }, userErrors: [] } };
    } else if (query.includes("order(id")) {
      data = {
        order: {
          id: variables.id,
          name: "#1002",
          currencyCode: "USD",
          displayFinancialStatus: financial,
          paymentGatewayNames: ["Pay with MUSD"],
          statusPageUrl: "https://tea-shop.myshopify.com/status/1",
          totalPriceSet: { shopMoney: { amount: "21.5", currencyCode: "USD" } },
        },
      };
    }
    return new Response(JSON.stringify({ data }), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}

function signed(body: unknown, opts: { secret?: string; id?: string; topic?: string } = {}) {
  const raw = JSON.stringify(body);
  return {
    body: raw,
    headers: {
      "x-shopify-hmac-sha256": createHmac("sha256", opts.secret ?? SECRET).update(raw).digest("base64"),
      "x-shopify-webhook-id": opts.id ?? `wh-${Math.random()}`,
      "x-shopify-topic": opts.topic ?? "orders/create",
      "x-shopify-shop-domain": SHOP,
    },
  };
}
const order = (over: Record<string, unknown> = {}) => ({
  id: 1001,
  name: "#1001",
  currency: "USD",
  financial_status: "pending",
  payment_gateway_names: ["Pay with MUSD"],
  total_price: "12.50",
  order_status_url: "https://tea-shop.myshopify.com/status/1001",
  ...over,
});
const post = (s: ReturnType<typeof signed>) => call(webhookRoute.POST, { method: "POST", params: { merchantSlug: merchant.slug }, body: s.body, headers: s.headers });

beforeEach(async () => {
  await resetDbForTests();
  clearReadinessCache();
  resetIndexerPassCountForTests();
  clock.set(null);
  chain = new FakeChain();
  setChainForTests(chain);
  merchant = await setupMerchant(chain);
  gql = [];
  financial = "PENDING";
  setShopifyFetchForTests(shopifyFetch());
  const sql = await getDb();
  await connectShopify(sql, merchant, { shop_domain: SHOP, admin_access_token: "shpat_abcdefghijkl", webhook_secret: SECRET }, "t");
});

describe("Shopify", () => {
  it("connect tests the token with a cheap query and stores credentials encrypted", async () => {
    expect(gql[0].url).toBe(`https://${SHOP}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`);
    expect(gql[0].token).toBe("shpat_abcdefghijkl");
    const sql = await getDb();
    const [c] = await sql`SELECT * FROM shopify_connections`;
    expect(String(c.access_token_enc)).not.toContain("shpat_");
    expect(decryptSecret(String(c.access_token_enc))).toBe("shpat_abcdefghijkl");
    await expect(connectShopify(sql, merchant, { shop_domain: "evil.com", admin_access_token: "shpat_abcdefghijkl", webhook_secret: SECRET }, "t")).rejects.toMatchObject({
      code: "invalid_shop_domain",
    });
  });

  it("verifies HMAC, dedupes webhook ids, creates a USD intent at 1 USD = 1 MUSD", async () => {
    const bad = signed(order(), { secret: "wrong" });
    expect((await post(bad)).status).toBe(401);
    const s = signed(order(), { id: "same-id" });
    const r = await post(s);
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("intent_ready");
    const sql = await getDb();
    const i = (await findIntent(sql, r.body.payment_intent_id))!;
    expect(i.amount).toBe(125n * 10n ** 17n);
    expect(i.merchant_order_id).toBe("shopify:1001");
    expect(i.source).toBe("shopify");
    const dup = await post(s);
    expect(dup.body.status).toBe("duplicate");
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM payment_intents`;
    expect(Number(n)).toBe(1);
  });

  it("skips non-USD currency with a reason and ignores other payment methods", async () => {
    const r = await post(signed(order({ id: 2001, currency: "EUR" })));
    expect(r.body.status).toBe("skipped");
    expect(r.body.reason).toMatch(/unsupported_currency_EUR/);
    const sql = await getDb();
    const [o] = await sql`SELECT sync_status, last_error FROM shopify_orders WHERE shopify_order_id = '2001'`;
    expect(o.sync_status).toBe("skipped");
    const other = await post(signed(order({ id: 2002, payment_gateway_names: ["Cash on Delivery"] })));
    expect(other.body.status).toBe("skipped");
    expect((await sql`SELECT * FROM shopify_orders WHERE shopify_order_id = '2002'`).length).toBe(0);
    const paidAlready = await post(signed(order({ id: 2003, financial_status: "paid" })));
    expect(paidAlready.body.status).toBe("skipped");
  });

  it("pay link creates the intent on demand from the Admin API and redirects to checkout", async () => {
    const res = await payRoute.GET(new Request(`http://localhost:3000/pay/shopify/${SHOP}/1002`), { params: Promise.resolve({ shop: SHOP, orderId: "1002" }) });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toMatch(/\/checkout\/pi_/);
    const again = await payRoute.GET(new Request("http://x"), { params: Promise.resolve({ shop: SHOP, orderId: "1002" }) });
    expect(again.headers.get("location")).toBe(res.headers.get("location"));
    const unknown = await payRoute.GET(new Request("http://x"), { params: Promise.resolve({ shop: "nope.myshopify.com", orderId: "1" }) });
    expect(unknown.status).toBe(404);
    expect(await unknown.text()).toContain("<!doctype html>");
  });

  it("marks the Shopify order paid exactly once after the intent is paid", async () => {
    const r = await post(signed(order()));
    const sql = await getDb();
    const i = (await findIntent(sql, r.body.payment_intent_id))!;
    // not paid yet → no sync
    await runShopifySync(sql);
    expect(gql.filter((g) => g.query.includes("orderMarkAsPaid"))).toHaveLength(0);
    chain.pay({ payment_id: i.payment_id, payout_address: i.payout_address, token_address: i.token_address, amount: i.amount.toString() } as never);
    chain.head += 5n;
    await runIndexerPass(sql, chain);
    await runShopifySync(sql);
    await runShopifySync(sql);
    expect(gql.filter((g) => g.query.includes("orderMarkAsPaid"))).toHaveLength(1);
    const [o] = await sql`SELECT sync_status, marked_paid_at FROM shopify_orders`;
    expect(o.sync_status).toBe("marked_paid");
    expect(o.marked_paid_at).not.toBeNull();
  });

  it("does not call orderMarkAsPaid when Shopify already shows PAID", async () => {
    const r = await post(signed(order()));
    const sql = await getDb();
    const i = (await findIntent(sql, r.body.payment_intent_id))!;
    chain.pay({ payment_id: i.payment_id, payout_address: i.payout_address, token_address: i.token_address, amount: i.amount.toString() } as never);
    chain.head += 5n;
    await runIndexerPass(sql, chain);
    financial = "PAID";
    await runShopifySync(sql);
    expect(gql.filter((g) => g.query.includes("orderMarkAsPaid"))).toHaveLength(0);
    const [o] = await sql`SELECT sync_status FROM shopify_orders`;
    expect(o.sync_status).toBe("marked_paid");
  });
});
