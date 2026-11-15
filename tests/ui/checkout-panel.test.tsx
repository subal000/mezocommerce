// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { CheckoutDTO } from "@/lib/api-types";
import type { CheckoutView } from "@/lib/client/checkout-state";
import { PaymentPanel, type PanelProps } from "@/components/checkout/payment-panel";

// @testing-library/dom (peer of @testing-library/react) isn't installed, so render with react-dom directly.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let roots: { root: Root; el: HTMLElement }[] = [];
function render(ui: ReactElement) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => root.render(ui));
  roots.push({ root, el });
  return { container: el };
}
function cleanup() {
  for (const { root, el } of roots) {
    act(() => root.unmount());
    el.remove();
  }
  roots = [];
}
afterEach(cleanup);
const byText = (t: string) => [...document.querySelectorAll("body *")].find((n) => n.children.length === 0 && n.textContent === t) ?? null;
const link = (name: string) => [...document.querySelectorAll("a")].find((a) => a.textContent === name) ?? null;

const HASH = "0x" + "ab".repeat(32);
const checkout: CheckoutDTO = {
  id: "pi_" + "a".repeat(24),
  payment_id: "0x" + "11".repeat(32),
  status: "awaiting_payment",
  late: false,
  merchant: { name: "Larkspur", slug: "larkspur", logo_url: null, website: "https://larkspur.example", brand_color: "#1a3d8f", payout_address: "0x" + "22".repeat(20) },
  merchant_order_id: "order-1",
  description: "Tea",
  amount: "10000000000000000000",
  amount_display: "10",
  currency: "MUSD",
  token: { address: "0x" + "33".repeat(20), symbol: "MUSD", decimals: 18 },
  network: { chain_id: 31611, name: "Mezo Testnet" },
  processor_address: "0x" + "44".repeat(20),
  expires_at: new Date(Date.now() + 600_000).toISOString(),
  return_url: "https://larkspur.example/thanks",
  cancel_url: "https://larkspur.example/cart",
  intent: null,
  payment: null,
  required_confirmations: 2,
};

function props(view: CheckoutView, over: Partial<PanelProps> = {}): PanelProps {
  return {
    view,
    checkout,
    status: null,
    address: "0x00000000000000000000000000000000000000aa",
    isSwitching: false,
    switchToMezo: vi.fn().mockResolvedValue(undefined),
    mode: "permit",
    setMode: vi.fn(),
    pay: vi.fn(),
    retry: vi.fn(),
    recheck: vi.fn(),
    embed: false,
    noWallet: false,
    checkoutUrl: "https://app.example/checkout/pi_x",
    onDone: vi.fn(),
    onLeave: vi.fn(),
    ...over,
  };
}

const VIEWS: CheckoutView[] = [
  { kind: "loading" },
  { kind: "connect" },
  { kind: "wrong_network" },
  { kind: "checking" },
  { kind: "preflight_error", message: "x" },
  { kind: "insufficient_musd", message: "Not enough MUSD. You need 10, this wallet has 4.20." },
  { kind: "insufficient_gas" },
  { kind: "blocked", check: { title: "Payments paused", message: "Try later.", action: "wait", recoverable: true } },
  { kind: "ready", needsApproval: true },
  { kind: "permit_requested" },
  { kind: "approval_requested" },
  { kind: "approval_confirming", approvalHash: HASH },
  { kind: "pay_requested" },
  { kind: "submitted", txHash: HASH },
  { kind: "confirming", txHash: HASH, confirmations: 1, required: 2 },
  { kind: "failed", error: { kind: "revert", title: "Payment didn't go through", message: "Expired." } },
  { kind: "expired" },
  { kind: "cancelled" },
  { kind: "unavailable" },
  { kind: "paid", txHash: HASH },
  { kind: "already_paid", txHash: HASH },
  { kind: "late_paid", txHash: HASH },
];

describe("PaymentPanel", () => {
  it.each(VIEWS.map((v) => [v.kind, v] as const))("renders %s", (k, v) => {
    const { container } = render(<PaymentPanel {...props(v)} />);
    expect(container.textContent!.length).toBeGreaterThan(0);
    const success = /Payment received|This order is paid/.test(container.textContent!);
    expect(success).toBe(k === "paid" || k === "already_paid" || k === "late_paid");
    expect(container.textContent).not.toMatch(/—/);
  });

  it("ready explains the wallet prompts and pays exactly the amount", () => {
    render(<PaymentPanel {...props({ kind: "ready", needsApproval: true })} />);
    expect(byText("Your wallet will ask you to sign a spending permission for exactly 10 MUSD, then confirm the payment.")).not.toBeNull();
    expect([...document.querySelectorAll("button")].some((b) => b.textContent === "Pay 10 MUSD")).toBe(true);
  });

  it("insufficient MUSD links to testnet.mezo.org; gas links to the faucet", () => {
    render(<PaymentPanel {...props({ kind: "insufficient_musd", message: "Not enough MUSD. You need 10, this wallet has 4.20." })} />);
    expect(byText("Not enough MUSD. You need 10, this wallet has 4.20.")).not.toBeNull();
    expect(document.querySelector('a[href="https://testnet.mezo.org"]')).not.toBeNull();
    cleanup();
    render(<PaymentPanel {...props({ kind: "insufficient_gas" })} />);
    expect(document.querySelector('a[href="https://faucet.test.mezo.org"]')).not.toBeNull();
  });

  it("success links to the return URL and the explorer", () => {
    render(<PaymentPanel {...props({ kind: "paid", txHash: HASH })} />);
    expect(link("Return to Larkspur")?.getAttribute("href")).toBe("https://larkspur.example/thanks");
    expect(document.querySelector(`a[href="https://explorer.test.mezo.org/tx/${HASH}"]`)).not.toBeNull();
  });

  it("embed without a wallet offers a new tab and the checkout QR", () => {
    render(<PaymentPanel {...props({ kind: "connect" }, { embed: true, noWallet: true })} />);
    expect(link("Open in new tab")?.getAttribute("href")).toBe("https://app.example/checkout/pi_x");
    expect(byText("Scan to pay on your phone")).not.toBeNull();
  });

  it("confirming exposes progress", () => {
    render(<PaymentPanel {...props({ kind: "confirming", txHash: HASH, confirmations: 1, required: 2 })} />);
    const bar = document.querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute("aria-valuenow")).toBe("1");
    expect(bar.getAttribute("aria-valuemax")).toBe("2");
  });
});

describe("Mezo Passport smart-account wallets", () => {
  it("shows the permit/approve toggle for normal wallets", () => {
    render(<PaymentPanel {...props({ kind: "ready", needsApproval: true })} />);
    expect(byText("Use two-step approval instead")).not.toBeNull();
  });
  it("hides the toggle when the wallet can only approve then pay", () => {
    render(<PaymentPanel {...props({ kind: "ready", needsApproval: true }, { mode: "approve", canChooseMode: false })} />);
    expect(byText("Use two-step approval instead")).toBeNull();
    expect(byText("Use one signature instead")).toBeNull();
  });
});
