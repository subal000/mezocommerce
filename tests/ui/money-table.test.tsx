// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PaymentIntentDTO } from "@/lib/api-types";
import { musd, musdDisplay, musdExact } from "@/lib/client/format";
import { PaymentsTable } from "@/components/merchant/payments-table";
import { byText, cleanup, render } from "./dom-helpers";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/merchant/payments" }));
afterEach(cleanup);

const future = new Date(Date.now() + 3600_000).toISOString();
function intent(over: Partial<PaymentIntentDTO>): PaymentIntentDTO {
  return {
    id: "pi_test",
    object: "payment_intent",
    payment_id: "0x" + "11".repeat(32),
    merchant_id: "m_1",
    merchant_order_id: "order-1",
    description: "",
    amount: "0",
    amount_display: "0",
    currency: "MUSD",
    token_address: "0x" + "33".repeat(20),
    payout_address: "0x" + "22".repeat(20),
    payer_address: null,
    status: "paid",
    late: false,
    checkout_url: "http://localhost/checkout/pi_test",
    return_url: null,
    cancel_url: null,
    metadata: {},
    source: "dashboard",
    expires_at: future,
    amount_refunded: "0",
    amount_refunded_display: "0",
    payment: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...over,
  };
}

describe("money formatting", () => {
  it("formats wei with grouping and 2dp, never -0.00", () => {
    expect(musd("1234500000000000000000")).toBe("1,234.50");
    expect(musd(5_000_000_000_000_000n)).toBe("0.01");
    expect(musd("1000000000000000")).toBe("<0.01");
    expect(musd("-1")).toBe("-<0.01");
    expect(musd(null)).toBe("--");
    expect(musd("not-a-number")).toBe("--");
    expect(musd("1500000000000000000000", { compact: true })).toBe("1.5K");
  });

  it("formats API display strings without floats", () => {
    expect(musdDisplay("10.5")).toBe("10.50");
    expect(musdDisplay("1234567.891")).toBe("1,234,567.89");
    expect(musdDisplay("0.005")).toBe("0.01");
    expect(musdDisplay("0.1")).toBe("0.10");
    expect(musdDisplay("")).toBe("--");
    expect(musdDisplay(null)).toBe("--");
  });

  it("keeps full precision for titles", () => {
    expect(musdExact("1234567890000000001")).toBe("1.234567890000000001");
    expect(musdExact("2000000000000000000")).toBe("2");
  });
});

describe("PaymentsTable", () => {
  it("shows amounts formatted in the table and the stacked mobile list", () => {
    render(
      <PaymentsTable
        rows={[
          intent({ id: "pi_a", merchant_order_id: "A-1001", amount_display: "1234.5" }),
          intent({ id: "pi_b", merchant_order_id: "A-1002", amount_display: "0.1", status: "awaiting_payment" }),
        ]}
      />,
    );
    const amounts = [...document.querySelectorAll(".num")].map((n) => n.firstChild?.textContent);
    expect(amounts.filter((a) => a === "1,234.50")).toHaveLength(2);
    expect(amounts.filter((a) => a === "0.10")).toHaveLength(2);
    expect(document.body.textContent).toContain("MUSD");
    expect(document.querySelector('a[href="/merchant/payments/pi_a"]')).toBeTruthy();
  });

  it("shows a payable intent past expiry as expired", () => {
    render(<PaymentsTable rows={[intent({ status: "awaiting_payment", expires_at: new Date(Date.now() - 60_000).toISOString() })]} />);
    expect(byText("Expired")).toBeTruthy();
    expect(byText("Awaiting payment")).toBeNull();
  });
});
