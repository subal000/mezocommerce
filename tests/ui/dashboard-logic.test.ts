import { describe, expect, it } from "vitest";
import type { PaymentIntentDetailDTO } from "@/lib/api-types";
import { pageInfo } from "@/lib/client/pagination";
import { shopifyFormErrors, webhookUrlError, createPaymentSchema } from "@/lib/client/forms";
import { textOn } from "@/lib/client/color";
import { walletMatches } from "@/lib/client/merchant-wallet";
import { buildTimeline } from "@/lib/client/timeline";
import { checklistItems } from "@/components/merchant/integration-checklist";
import { intentQueryString } from "@/hooks/use-api";
import { networkState } from "@/lib/client/guard";
import { describeTxError } from "@/lib/client/errors";

describe("pagination", () => {
  it("computes the window", () => {
    expect(pageInfo(1, 20, 0)).toEqual({ pages: 1, from: 0, to: 0, hasPrev: false, hasNext: false });
    expect(pageInfo(2, 20, 45)).toEqual({ pages: 3, from: 21, to: 40, hasPrev: true, hasNext: true });
    expect(pageInfo(3, 20, 45).to).toBe(45);
  });
  it("builds list query strings", () => {
    expect(intentQueryString({})).toBe("");
    expect(intentQueryString({ status: "paid", q: " A-1 ", page: 2 })).toBe("?status=paid&q=A-1&page=2");
    expect(intentQueryString({ page: 1 })).toBe("");
  });
});

describe("forms", () => {
  it("checks webhook URLs", () => {
    expect(webhookUrlError("")).toBeTruthy();
    expect(webhookUrlError("not a url")).toBeTruthy();
    expect(webhookUrlError("http://shop.example/hook")).toBe("Use an https:// URL.");
    expect(webhookUrlError("http://localhost:3000/hook")).toBeNull();
    expect(webhookUrlError("https://shop.example/hook")).toBeNull();
  });
  it("checks the Shopify connect form", () => {
    expect(shopifyFormErrors({ shop_domain: "x.myshopify.com", admin_access_token: "shpat_abc", webhook_secret: "s".repeat(32) })).toEqual({});
    const e = shopifyFormErrors({ shop_domain: "shop.com", admin_access_token: "abc", webhook_secret: "x" });
    expect(Object.keys(e).sort()).toEqual(["admin_access_token", "shop_domain", "webhook_secret"]);
  });
  it("validates create-payment amounts against intent limits", () => {
    const base = { merchant_order_id: "o-1", description: "", expires_in_seconds: "1800" as const, payer_address: "", return_url: "" };
    expect(createPaymentSchema.safeParse({ ...base, amount: "25.50" }).success).toBe(true);
    expect(createPaymentSchema.safeParse({ ...base, amount: "0.001" }).success).toBe(false);
    expect(createPaymentSchema.safeParse({ ...base, amount: "1000001" }).success).toBe(false);
    expect(createPaymentSchema.safeParse({ ...base, amount: "abc" }).success).toBe(false);
    expect(createPaymentSchema.safeParse({ ...base, amount: "5", merchant_order_id: "bad id!" }).success).toBe(false);
  });
});

describe("branding contrast", () => {
  it("picks readable text on the brand colour", () => {
    expect(textOn("#ffffff")).toBe("#14171c");
    expect(textOn("#1d222b")).toBe("#ffffff");
    expect(textOn("#f5d90a")).toBe("#14171c");
    expect(textOn("nope")).toBe("#ffffff");
  });
});

describe("merchant wallet roles", () => {
  const owner = "0xAAAA000000000000000000000000000000000001";
  const payout = "0xbbbb000000000000000000000000000000000002";
  it("owner only for settings, owner or payout for refunds", () => {
    expect(walletMatches(owner.toLowerCase(), owner, payout, "owner")).toBe(true);
    expect(walletMatches(payout, owner, payout, "owner")).toBe(false);
    expect(walletMatches(payout.toUpperCase().replace("0X", "0x"), owner, payout, "owner_or_payout")).toBe(true);
    expect(walletMatches(undefined, owner, payout, "owner_or_payout")).toBe(false);
  });
  it("network state", () => {
    expect(networkState(false, undefined).kind).toBe("disconnected");
    expect(networkState(true, 1).kind).toBe("wrong-network");
    expect(networkState(true, 31611).kind).toBe("ready");
  });
  it("decodes wallet rejection and contract errors into plain words", () => {
    expect(describeTxError({ code: 4001, message: "User rejected the request." }).kind).toBe("rejected");
    expect(describeTxError({ data: { errorName: "RefundExceedsPayment" } }).message).toMatch(/can't be more/);
    expect(describeTxError(new Error("insufficient funds for gas")).kind).toBe("funds");
  });
});

describe("integration checklist", () => {
  it("marks done items and links the rest", () => {
    const items = checklistItems({ api_keys: 0, webhook_endpoints: 1, last_webhook_status: "failed", shopify_connected: false, onchain_ready: true });
    const by = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(by.onchain.done).toBe(true);
    expect(by.api_key.done).toBe(false);
    expect(by.webhook.done).toBe(false);
    expect(by.webhook.detail).toMatch(/failed/);
    expect(by.shopify.optional).toBe(true);
  });
});

describe("timeline", () => {
  it("orders events oldest first and includes verification and refunds", () => {
    const t0 = "2026-11-10T10:00:00.000Z";
    const p = {
      created_at: t0,
      updated_at: "2026-11-10T10:09:00.000Z",
      expires_at: "2026-11-10T10:30:00.000Z",
      status: "partially_refunded",
      late: false,
      source: "api",
      attempts: [{ transaction_hash: "0x01", status: "succeeded", failure_reason: null, created_at: "2026-11-10T10:02:00.000Z" }],
      payment: { paid_at: "2026-11-10T10:02:10.000Z", confirmed_at: "2026-11-10T10:02:30.000Z", confirmations: 2, block_number: "100", status: "confirmed", transaction_hash: "0x01" },
      refunds: [{ id: "re_1", amount_display: "2", reason: "", status: "confirmed", created_at: "2026-11-10T10:05:00.000Z", confirmed_at: "2026-11-10T10:06:00.000Z", transaction_hash: "0x02" }],
      events: [],
    } as unknown as PaymentIntentDetailDTO;
    const titles = buildTimeline(p).map((x) => x.title);
    expect(titles[0]).toBe("Payment created");
    expect(titles).toContain("Payment found on-chain");
    expect(titles).toContain("Confirmed. Safe to fulfil");
    expect(titles.at(-1)).toBe("Refunded 2.00 MUSD");
  });
});
