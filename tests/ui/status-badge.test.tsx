// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { byText, cleanup, render } from "./dom-helpers";
import { INTENT_STATUSES } from "@/lib/chain/payment-state";
import { INTENT_STATUS, intentStatusMeta, TONE_CLASS } from "@/lib/client/status";
import { StatusBadge } from "@/components/shared/status-badge";

afterEach(cleanup);

describe("StatusBadge", () => {
  it("has a label, tone and hint for every intent status", () => {
    expect(Object.keys(INTENT_STATUS).sort()).toEqual([...INTENT_STATUSES].sort());
    for (const s of INTENT_STATUSES) {
      const m = INTENT_STATUS[s];
      expect(m.label.length).toBeGreaterThan(0);
      expect(m.hint.length).toBeGreaterThan(0);
      expect(TONE_CLASS[m.tone]).toBeDefined();
    }
  });

  it.each(INTENT_STATUSES)("renders %s as a dot plus its word", (s) => {
    const { container } = render(<StatusBadge status={s} />);
    const el = byText(INTENT_STATUS[s].label)!;
    expect(el.getAttribute("data-tone")).toBe(INTENT_STATUS[s].tone);
    expect(el.getAttribute("title")).toBe(INTENT_STATUS[s].hint);
    const dot = container.querySelector("[aria-hidden]");
    expect(dot?.className).toContain(TONE_CLASS[INTENT_STATUS[s].tone].dot);
    // dot + word, not a pill: no background or border on the badge itself
    expect(el.className).not.toMatch(/\bbg-|\bborder\b|rounded-full/);
  });

  it("maps the important statuses to the right tone", () => {
    expect(INTENT_STATUS.paid.tone).toBe("ok");
    expect(INTENT_STATUS.confirming.tone).toBe("warn");
    expect(INTENT_STATUS.awaiting_payment.tone).toBe("info");
    expect(INTENT_STATUS.expired.tone).toBe("idle");
    expect(INTENT_STATUS.cancelled.tone).toBe("idle");
    expect(INTENT_STATUS.paid.label).toBe("Paid");
  });

  it("marks late payments", () => {
    render(<StatusBadge status="paid" late />);
    expect(byText("Paid, late")).toBeTruthy();
    expect(intentStatusMeta("expired", true).label).toBe("Expired");
  });

  it("uses sentence case labels", () => {
    for (const s of INTENT_STATUSES) {
      const l = INTENT_STATUS[s].label;
      expect(l[0]).toBe(l[0].toUpperCase());
      expect(l.slice(1)).toBe(l.slice(1).toLowerCase());
    }
  });
});
