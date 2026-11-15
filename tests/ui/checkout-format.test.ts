import { describe, expect, it } from "vitest";
import { formatRemaining, isValidCheckoutId, merchantAccent, safeHttpUrl } from "@/lib/client/checkout-format";
import { embedMessage, parseInbound } from "@/lib/client/checkout-embed";
import { addChainParams, isUnknownChainError, networkState } from "@/lib/client/wallet-network";

describe("checkout-format", () => {
  it("only allows http(s) links", () => {
    expect(safeHttpUrl("https://shop.example/x")).toBe("https://shop.example/x");
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("data:text/html,hi")).toBeNull();
    expect(safeHttpUrl(null)).toBeNull();
  });
  it("brand accent picks readable text or falls back", () => {
    expect(merchantAccent("#1a3d8f")).toEqual({ bg: "#1a3d8f", fg: "#ffffff" });
    expect(merchantAccent("#f5d90a")?.fg).toBe("#14161a");
    expect(merchantAccent("not-a-colour")).toBeNull();
    expect(merchantAccent("#777")).toBeNull(); // mid-grey: neither text colour reaches 4.5:1
  });
  it("countdown", () => {
    expect(formatRemaining(65_000)).toBe("1:05");
    expect(formatRemaining(3_725_000)).toBe("1:02:05");
    expect(formatRemaining(-5)).toBe("0:00");
  });
  it("id validation matches the widget", () => {
    expect(isValidCheckoutId("pi_" + "A1".repeat(12))).toBe(true);
    expect(isValidCheckoutId("0x" + "ab".repeat(32))).toBe(true);
    expect(isValidCheckoutId("pi_short")).toBe(false);
    expect(isValidCheckoutId("../../x")).toBe(false);
  });
});

describe("embed protocol", () => {
  it("builds protocol messages", () => {
    expect(embedMessage("success", { paymentIntentId: "pi_x", status: "paid", txHash: "0x1" })).toEqual({
      source: "mezocommerce",
      type: "success",
      paymentIntentId: "pi_x",
      status: "paid",
      txHash: "0x1",
    });
    expect(embedMessage("resize", { paymentIntentId: "pi_x", height: 431.2 }).height).toBe(432);
    expect(embedMessage("status", { paymentIntentId: "pi_x", height: 10 }).height).toBeUndefined();
  });
  it("accepts only the widget close ack inbound", () => {
    expect(parseInbound({ source: "mezocommerce-widget", type: "close" })).toBe("close_ack");
    expect(parseInbound({ source: "mezocommerce-widget", type: "pay" })).toBeNull();
    expect(parseInbound({ source: "evil", type: "close" })).toBeNull();
    expect(parseInbound("close")).toBeNull();
    expect(parseInbound(null)).toBeNull();
  });
});

describe("wallet-network", () => {
  it("network state", () => {
    expect(networkState(false, undefined).kind).toBe("disconnected");
    expect(networkState(true, 1).kind).toBe("wrong-network");
    expect(networkState(true, 31611).kind).toBe("ready");
  });
  it("detects unknown-chain errors for wallet_addEthereumChain", () => {
    expect(isUnknownChainError({ code: 4902 })).toBe(true);
    expect(isUnknownChainError({ message: "x", cause: { code: 4902 } })).toBe(true);
    expect(isUnknownChainError(new Error("Unrecognized chain ID 0x7b7b"))).toBe(true);
    expect(isUnknownChainError({ code: 4001 })).toBe(false);
  });
  it("add-chain params come from the frozen config", () => {
    const p = addChainParams();
    expect(p.chainId).toBe("0x7b7b");
    expect(p.nativeCurrency.symbol).toBe("BTC");
    expect(p.blockExplorerUrls[0]).toBe("https://explorer.test.mezo.org");
  });
});
