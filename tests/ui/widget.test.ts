// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MezoCommerceGlobal } from "@/components/storefront/widget-types";

const SRC = readFileSync(path.resolve(__dirname, "../../public/checkout.js"), "utf8");
const BASE = "https://pay.mezocommerce.test";
const PI = "pi_" + "Ab3".repeat(8);

function load(): MezoCommerceGlobal {
  delete (window as { MezoCommerce?: unknown }).MezoCommerce;
  Object.defineProperty(document, "currentScript", { configurable: true, get: () => ({ src: `${BASE}/checkout.js` }) });
  new Function(SRC)();
  Object.defineProperty(document, "currentScript", { configurable: true, get: () => null });
  return (window as unknown as { MezoCommerce: MezoCommerceGlobal }).MezoCommerce;
}

function modalRoot() {
  const host = document.querySelector('[data-mezocommerce="modal"]') as HTMLElement | null;
  return host?.shadowRoot ?? null;
}

function send(data: unknown, opts: { origin?: string; source?: MessageEventSource | null } = {}) {
  const frame = modalRoot()?.querySelector("iframe") ?? document.querySelector('[data-mezocommerce="inline"]')?.shadowRoot?.querySelector("iframe");
  window.dispatchEvent(
    new MessageEvent("message", {
      data,
      origin: opts.origin ?? BASE,
      source: opts.source === undefined ? (frame?.contentWindow ?? null) : opts.source,
    }),
  );
}

let MC: MezoCommerceGlobal;
beforeEach(() => {
  document.body.innerHTML = "";
  document.documentElement.style.overflow = "";
  MC = load();
});
afterEach(() => {
  document.querySelectorAll("[data-mezocommerce]").forEach((n) => n.remove());
  vi.restoreAllMocks();
});

describe("checkout.js: setup and id validation", () => {
  it("derives its base URL from its own script src", () => {
    expect(MC.baseUrl).toBe(BASE);
    expect(MC.version).toBe("1");
  });
  it("validates ids", () => {
    expect(MC.isValidId(PI)).toBe(true);
    expect(MC.isValidId("0x" + "0f".repeat(32))).toBe(true);
    for (const bad of ["pi_123", "pi_" + "a".repeat(25), "0x1234", "", "pi_" + "a".repeat(23) + "!", "../checkout/x"]) {
      expect(MC.isValidId(bad)).toBe(false);
    }
  });
  it("rejects invalid ids and foreign checkout URLs via onError", () => {
    const onError = vi.fn();
    expect(MC.checkout({ paymentId: "nope", onError })).toBeNull();
    expect(MC.checkout({ checkoutUrl: `https://evil.example/checkout/${PI}`, onError })).toBeNull();
    expect(onError).toHaveBeenCalledTimes(2);
    expect(modalRoot()).toBeNull();
  });
  it("throws without onError", () => {
    expect(() => MC.checkout({ paymentId: "nope" })).toThrow(/invalid payment id/);
  });
  it("accepts a checkoutUrl on its own origin", () => {
    MC.checkout({ checkoutUrl: `${BASE}/checkout/${PI}` });
    expect(modalRoot()!.querySelector("iframe")!.getAttribute("src")).toBe(`${BASE}/checkout/${PI}?embed=1`);
  });
});

describe("checkout.js: modal", () => {
  it("opens an accessible, sandboxed dialog, locks scroll, and restores focus on close", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const onCancel = vi.fn();
    MC.checkout({ paymentId: PI, onCancel });

    const root = modalRoot()!;
    const dlg = root.querySelector('[role="dialog"]')!;
    expect(dlg.getAttribute("aria-modal")).toBe("true");
    const frame = root.querySelector("iframe")!;
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox");
    expect(frame.getAttribute("allow")).toBe("clipboard-write");
    expect(frame.getAttribute("src")).toBe(`${BASE}/checkout/${PI}?embed=1`);
    expect(document.documentElement.style.overflow).toBe("hidden");
    expect(root.activeElement?.getAttribute("aria-label")).toBe("Close checkout");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(modalRoot()).toBeNull();
    expect(document.documentElement.style.overflow).toBe("");
    expect(document.activeElement).toBe(opener);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("close button closes; focus trap sentinels wrap focus", () => {
    MC.checkout({ paymentId: PI });
    const root = modalRoot()!;
    const sentinels = root.querySelectorAll('span[tabindex="0"]');
    expect(sentinels).toHaveLength(2);
    (sentinels[1] as HTMLElement).focus();
    expect(root.activeElement?.getAttribute("aria-label")).toBe("Close checkout");
    (root.querySelector('button[aria-label="Close checkout"]') as HTMLButtonElement).click();
    expect(modalRoot()).toBeNull();
  });

  it("acts on messages from its own iframe and origin", () => {
    const onSuccess = vi.fn();
    const onStatus = vi.fn();
    const onExpired = vi.fn();
    const onCancel = vi.fn();
    MC.checkout({ paymentId: PI, onSuccess, onStatus, onExpired, onCancel });
    send({ source: "mezocommerce", type: "ready", paymentIntentId: PI });
    expect(modalRoot()!.querySelector(".ld")!.hasAttribute("hidden")).toBe(true);
    send({ source: "mezocommerce", type: "resize", paymentIntentId: PI, height: 612 });
    expect((modalRoot()!.querySelector("iframe") as HTMLIFrameElement).style.height).toBe("612px");
    send({ source: "mezocommerce", type: "status", paymentIntentId: PI, status: "confirming", txHash: "0xabc" });
    expect(onStatus).toHaveBeenCalledWith({ paymentIntentId: PI, status: "confirming", txHash: "0xabc" });
    send({ source: "mezocommerce", type: "success", paymentIntentId: PI, status: "paid", txHash: "0xabc" });
    send({ source: "mezocommerce", type: "success", paymentIntentId: PI, status: "paid", txHash: "0xabc" });
    expect(onSuccess).toHaveBeenCalledTimes(1);
    send({ source: "mezocommerce", type: "close", paymentIntentId: PI, status: "paid" });
    expect(modalRoot()).toBeNull();
    expect(onCancel).not.toHaveBeenCalled(); // closing after success is not a cancel
    expect(onExpired).not.toHaveBeenCalled();
  });

  it("ignores messages from a foreign origin, a foreign window, or with the wrong shape", () => {
    const onSuccess = vi.fn();
    const onStatus = vi.fn();
    MC.checkout({ paymentId: PI, onSuccess, onStatus });
    const ok = { source: "mezocommerce", type: "success", paymentIntentId: PI, status: "paid" };
    send(ok, { origin: "https://evil.example" });
    send(ok, { source: window });
    send(ok, { source: null });
    send({ ...ok, source: "someone-else" });
    send("success");
    send({ source: "mezocommerce", type: "close" }, { origin: "https://evil.example" });
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onStatus).not.toHaveBeenCalled();
    expect(modalRoot()).not.toBeNull();
  });

  it("fires onExpired once from status messages", () => {
    const onExpired = vi.fn();
    MC.checkout({ paymentId: PI, onExpired });
    send({ source: "mezocommerce", type: "status", paymentIntentId: PI, status: "expired" });
    send({ source: "mezocommerce", type: "status", paymentIntentId: PI, status: "expired" });
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it("only one modal at a time", () => {
    MC.checkout({ paymentId: PI });
    MC.checkout({ paymentId: PI });
    expect(document.querySelectorAll('[data-mezocommerce="modal"]')).toHaveLength(1);
  });

  it("never renders host-supplied strings as HTML", () => {
    const onError = vi.fn();
    MC.checkout({ paymentId: "<img src=x onerror=alert(1)>", onError });
    expect(document.querySelector("img")).toBeNull();
  });
});

describe("checkout.js: inline", () => {
  it("mounts into a container and needs one", () => {
    const c = document.createElement("div");
    c.id = "pay-here";
    document.body.appendChild(c);
    MC.checkout({ paymentId: PI, mode: "inline", container: "#pay-here" });
    expect(c.querySelector('[data-mezocommerce="inline"]')).not.toBeNull();
    const onError = vi.fn();
    MC.checkout({ paymentId: PI, mode: "inline", container: "#missing", onError });
    expect(onError).toHaveBeenCalled();
  });
});

describe("checkout.js: button()", () => {
  it("with paymentId opens the modal on click", () => {
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    const { element } = MC.button(mount, { paymentId: PI, label: "Pay now" });
    const b = element.shadowRoot!.querySelector("button")!;
    expect(b.textContent).toBe("Pay now");
    b.click();
    expect(modalRoot()).not.toBeNull();
  });

  it("with createUrl POSTs same-origin to the merchant server, then opens checkout", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ payment_intent_id: PI }) });
    vi.stubGlobal("fetch", fetchMock);
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    const { element } = MC.button(mount, { createUrl: "/create-intent", body: { sku: "tea" } });
    const b = element.shadowRoot!.querySelector("button")!;
    b.click();
    expect(b.disabled).toBe(true);
    expect(b.getAttribute("aria-busy")).toBe("true");
    await vi.waitFor(() => expect(modalRoot()).not.toBeNull());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/create-intent");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect(JSON.parse(init.body)).toEqual({ sku: "tea" });
    expect(modalRoot()!.querySelector("iframe")!.getAttribute("src")).toBe(`${BASE}/checkout/${PI}?embed=1`);
    await vi.waitFor(() => expect(b.disabled).toBe(false));
    vi.unstubAllGlobals();
  });

  it("accepts {checkout_url} and reports server errors via onError", async () => {
    const onError = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ checkout_url: `${BASE}/checkout/${PI}` }) })
        .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ something: "else" }) }),
    );
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    const { element } = MC.button(mount, { createUrl: "/create-intent", onError });
    const b = element.shadowRoot!.querySelector("button")!;
    b.click();
    await vi.waitFor(() => expect(modalRoot()).not.toBeNull());
    await vi.waitFor(() => expect(b.disabled).toBe(false));
    b.click();
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError.mock.calls[0][0].message).toMatch(/500/);
    await vi.waitFor(() => expect(b.disabled).toBe(false));
    b.click();
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(2));
    expect(onError.mock.calls[1][0].message).toMatch(/payment_intent_id or checkout_url/);
    vi.unstubAllGlobals();
  });

  it("refuses bad configuration", () => {
    const mount = document.createElement("div");
    expect(() => MC.button(mount, {})).toThrow();
    expect(() => MC.button(mount, { paymentId: "bad" })).toThrow();
    expect(() => MC.button("#nope", { paymentId: PI })).toThrow();
  });
});
