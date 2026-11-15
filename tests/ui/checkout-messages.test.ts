import { describe, expect, it } from "vitest";
import { PAY_CHECK } from "@/lib/chain/config";
import { payCheckMessage, shortMusd, walletPromptExplainer } from "@/lib/client/checkout-messages";

const E18 = 10n ** 18n;

describe("shortMusd", () => {
  it("drops a whole .00, keeps cents, groups thousands", () => {
    expect(shortMusd(10n * E18)).toBe("10");
    expect(shortMusd(42n * 10n ** 17n)).toBe("4.20");
    expect(shortMusd(123450n * 10n ** 16n)).toBe("1,234.50");
    expect(shortMusd(1n)).toBe("<0.01");
  });
});

describe("payCheckMessage", () => {
  it("has a plain, non-empty message for every non-ok PayCheck", () => {
    for (const c of PAY_CHECK) {
      const m = payCheckMessage(c);
      expect(m.title.length).toBeGreaterThan(0);
      if (c !== "ok" && c !== "insufficient_allowance") {
        expect(m.message.length).toBeGreaterThan(10);
        expect(m.message).not.toMatch(/0x|revert|PayCheck|_/);
      }
    }
  });
  it("insufficient balance names both amounts", () => {
    expect(payCheckMessage("insufficient_balance", { amountWei: 10n * E18, balanceWei: 42n * 10n ** 17n }).message).toBe(
      "Not enough MUSD. You need 10, this wallet has 4.20.",
    );
  });
  it("insufficient allowance is not a blocker (permit/approve sets it)", () => {
    expect(payCheckMessage("insufficient_allowance").recoverable).toBe(true);
    expect(payCheckMessage("insufficient_allowance").action).toBe("none");
  });
  it("actions", () => {
    expect(payCheckMessage("insufficient_balance").action).toBe("fund_musd");
    expect(payCheckMessage("wrong_payer").action).toBe("switch_wallet");
    expect(payCheckMessage("expired").action).toBe("back_to_store");
    expect(payCheckMessage("bad_signature").recoverable).toBe(false);
    expect(payCheckMessage("paused").recoverable).toBe(true);
  });
});

describe("walletPromptExplainer", () => {
  it("explains each prompt before it appears", () => {
    expect(walletPromptExplainer("permit", 10n * E18, true)).toBe(
      "Your wallet will ask you to sign a spending permission for exactly 10 MUSD, then confirm the payment.",
    );
    expect(walletPromptExplainer("approve", 10n * E18, true)).toBe("Your wallet will ask you to approve exactly 10 MUSD, then confirm the payment.");
    expect(walletPromptExplainer("approve", 10n * E18, false)).toBe("Your wallet will ask you to confirm the payment of 10 MUSD.");
  });
});
