import { describe, expect, it } from "vitest";
import type { CheckoutDTO, CheckoutStatusDTO, PaymentDTO, PreflightDTO } from "@/lib/api-types";
import { INTENT_STATUSES, type IntentStatus } from "@/lib/chain/payment-state";
import {
  deriveCheckoutView,
  flowReducer,
  initialFlow,
  statusPollInterval,
  VERIFIED_VIEWS,
  type DeriveInput,
  type FlowState,
  type PreflightState,
} from "@/lib/client/checkout-state";

const NOW = Date.parse("2026-11-10T12:00:00Z");
const PAYER = "0x00000000000000000000000000000000000000aa";
const HASH = "0x" + "ab".repeat(32);
const WEI = (n: number) => (BigInt(Math.round(n * 100)) * 10n ** 16n).toString();

function checkout(over: Partial<CheckoutDTO> = {}): CheckoutDTO {
  return {
    id: "pi_" + "a".repeat(24),
    payment_id: "0x" + "11".repeat(32),
    status: "awaiting_payment",
    late: false,
    merchant: { name: "Larkspur", slug: "larkspur", logo_url: null, website: null, brand_color: "#2f6f5f", payout_address: "0x" + "22".repeat(20) },
    merchant_order_id: "order-1",
    description: "Tea",
    amount: WEI(10),
    amount_display: "10",
    currency: "MUSD",
    token: { address: "0x" + "33".repeat(20), symbol: "MUSD", decimals: 18 },
    network: { chain_id: 31611, name: "Mezo Testnet" },
    processor_address: "0x" + "44".repeat(20),
    expires_at: new Date(NOW + 20 * 60_000).toISOString(),
    return_url: "https://shop.example/thanks",
    cancel_url: "https://shop.example/cart",
    intent: {
      payment_id: "0x" + "11".repeat(32),
      merchant_id: "1",
      payout: "0x" + "22".repeat(20),
      token: "0x" + "33".repeat(20),
      amount: WEI(10),
      payer: "0x0000000000000000000000000000000000000000",
      expires_at: String(Math.floor((NOW + 20 * 60_000) / 1000)),
      signature: "0x" + "55".repeat(65),
    },
    payment: null,
    required_confirmations: 2,
    ...over,
  };
}

function payment(confirmations: number): PaymentDTO {
  return {
    id: "pay_1",
    object: "payment",
    payment_intent_id: "pi_" + "a".repeat(24),
    payment_id: "0x" + "11".repeat(32),
    payer_address: PAYER,
    payout_address: "0x" + "22".repeat(20),
    token_address: "0x" + "33".repeat(20),
    amount: WEI(10),
    amount_display: "10",
    transaction_hash: HASH,
    block_number: "100",
    confirmations,
    status: confirmations >= 2 ? "confirmed" : "confirming",
    explorer_url: "https://explorer.test.mezo.org/tx/" + HASH,
    paid_at: new Date(NOW).toISOString(),
    confirmed_at: confirmations >= 2 ? new Date(NOW).toISOString() : null,
  };
}

function status(s: IntentStatus, over: Partial<CheckoutStatusDTO> = {}): CheckoutStatusDTO {
  return { status: s, payment: null, attempt: null, verified: false, ...over };
}

const preOk = (over: Partial<PreflightDTO> = {}): PreflightState => ({
  kind: "ok",
  data: { check: "insufficient_allowance", musd_balance: WEI(50), musd_balance_display: "50", allowance: "0", btc_balance: "1000000000000000", needs_approval: true, gas_ok: true, ...over },
});

function input(over: Partial<DeriveInput> = {}): DeriveInput {
  return {
    checkout: { kind: "ok", data: checkout() },
    status: status("awaiting_payment"),
    wallet: { isClient: true, isConnected: true, isWrongNetwork: false, address: PAYER },
    preflight: preOk(),
    flow: initialFlow,
    now: NOW,
    ...over,
  };
}

const kind = (over: Partial<DeriveInput> = {}) => deriveCheckoutView(input(over)).kind;

describe("flowReducer", () => {
  it("walks the permit path", () => {
    let s: FlowState = initialFlow;
    s = flowReducer(s, { type: "permit_requested" });
    expect(s.step).toBe("permit_requested");
    s = flowReducer(s, { type: "pay_requested" });
    expect(s.step).toBe("pay_requested");
    s = flowReducer(s, { type: "submitted", txHash: HASH });
    expect(s).toEqual({ step: "submitted", txHash: HASH });
  });
  it("walks the approve path", () => {
    let s: FlowState = flowReducer(initialFlow, { type: "approval_requested" });
    s = flowReducer(s, { type: "approval_confirming", approvalHash: HASH });
    expect(s).toEqual({ step: "approval_confirming", approvalHash: HASH });
  });
  it("won't go back to a wallet prompt once submitted", () => {
    const s = flowReducer({ step: "submitted", txHash: HASH }, { type: "permit_requested" });
    expect(s.step).toBe("submitted");
  });
  it("keeps the tx hash when a submitted payment fails", () => {
    const s = flowReducer({ step: "submitted", txHash: HASH }, { type: "failed", error: { kind: "revert", title: "x", message: "y" } });
    expect(s).toMatchObject({ step: "failed", txHash: HASH });
  });
  it("resets", () => {
    expect(flowReducer({ step: "pay_requested" }, { type: "reset" })).toBe(initialFlow);
  });
});

describe("deriveCheckoutView: loading and errors", () => {
  it("loading / not found / load error", () => {
    expect(kind({ checkout: { kind: "loading" } })).toBe("loading");
    expect(kind({ checkout: { kind: "not_found" } })).toBe("not_found");
    expect(deriveCheckoutView(input({ checkout: { kind: "error", message: "boom" } }))).toEqual({ kind: "load_error", message: "boom" });
  });
  it("waits for wallet state before the client mounts", () => {
    expect(kind({ wallet: { isClient: false, isConnected: false, isWrongNetwork: false } })).toBe("loading");
  });
});

describe("deriveCheckoutView: wallet and preflight", () => {
  it("connect wallet", () => {
    expect(kind({ wallet: { isClient: true, isConnected: false, isWrongNetwork: false } })).toBe("connect");
  });
  it("wrong network", () => {
    expect(kind({ wallet: { isClient: true, isConnected: true, isWrongNetwork: true, address: PAYER } })).toBe("wrong_network");
  });
  it("checking balance", () => {
    expect(kind({ preflight: { kind: "loading" } })).toBe("checking");
    expect(kind({ preflight: { kind: "idle" } })).toBe("checking");
  });
  it("preflight error", () => {
    expect(kind({ preflight: { kind: "error", message: "rpc" } })).toBe("preflight_error");
  });
  it("insufficient MUSD with a plain sentence", () => {
    const v = deriveCheckoutView(input({ preflight: preOk({ check: "insufficient_balance", musd_balance: WEI(4.2) }) }));
    expect(v).toEqual({ kind: "insufficient_musd", message: "Not enough MUSD. You need 10, this wallet has 4.20." });
  });
  it("insufficient MUSD even if the check reports something earlier in the list", () => {
    expect(kind({ preflight: preOk({ check: "ok", musd_balance: WEI(1) }) })).toBe("insufficient_musd");
  });
  it("insufficient BTC for gas", () => {
    expect(kind({ preflight: preOk({ gas_ok: false }) })).toBe("insufficient_gas");
  });
  it("ready (with and without approval needed)", () => {
    expect(deriveCheckoutView(input())).toEqual({ kind: "ready", needsApproval: true });
    expect(deriveCheckoutView(input({ preflight: preOk({ check: "ok", needs_approval: false }) }))).toEqual({ kind: "ready", needsApproval: false });
  });
  it("blocked by a contract check", () => {
    const v = deriveCheckoutView(input({ preflight: preOk({ check: "merchant_inactive" }) }));
    expect(v.kind).toBe("blocked");
    if (v.kind === "blocked") expect(v.check.message).toMatch(/paused payments/);
  });
  it("preflight expired / cancelled map to the closed views", () => {
    expect(kind({ preflight: preOk({ check: "expired" }) })).toBe("expired");
    expect(kind({ preflight: preOk({ check: "cancelled" }) })).toBe("cancelled");
  });
});

describe("deriveCheckoutView: wallet prompts", () => {
  it.each([
    [{ step: "permit_requested" }, "permit_requested"],
    [{ step: "approval_requested" }, "approval_requested"],
    [{ step: "approval_confirming", approvalHash: HASH }, "approval_confirming"],
    [{ step: "pay_requested" }, "pay_requested"],
  ] as [FlowState, string][])("%o → %s", (flow, k) => {
    expect(kind({ flow })).toBe(k);
  });
  it("failed with retry info", () => {
    const v = deriveCheckoutView(input({ flow: { step: "failed", error: { kind: "rejected", title: "Cancelled in wallet", message: "Nothing was sent." } } }));
    expect(v.kind).toBe("failed");
  });
});

describe("deriveCheckoutView: on-chain progress", () => {
  it("transaction submitted", () => {
    expect(deriveCheckoutView(input({ flow: { step: "submitted", txHash: HASH } }))).toEqual({ kind: "submitted", txHash: HASH });
  });
  it("submitted from another tab (server status)", () => {
    const v = deriveCheckoutView(input({ status: status("submitted", { attempt: { transaction_hash: HASH, status: "submitted", failure_reason: null, created_at: "" } }) }));
    expect(v).toEqual({ kind: "submitted", txHash: HASH });
  });
  it("server-reported failed attempt for our tx → failed with the reason", () => {
    const v = deriveCheckoutView(
      input({
        flow: { step: "submitted", txHash: HASH },
        status: status("awaiting_payment", { attempt: { transaction_hash: HASH.toUpperCase().replace("0X", "0x"), status: "failed", failure_reason: "Reverted", created_at: "" } }),
      }),
    );
    expect(v.kind).toBe("failed");
    if (v.kind === "failed") expect(v.error.message).toBe("Reverted");
  });
  it("confirming n of N", () => {
    const v = deriveCheckoutView(input({ flow: { step: "submitted", txHash: HASH }, status: status("confirming", { payment: payment(1) }) }));
    expect(v).toEqual({ kind: "confirming", txHash: HASH, confirmations: 1, required: 2 });
  });
});

describe("deriveCheckoutView: closed", () => {
  it("expired by clock even before the worker runs", () => {
    expect(kind({ checkout: { kind: "ok", data: checkout({ expires_at: new Date(NOW - 1000).toISOString() }) } })).toBe("expired");
  });
  it("expired / cancelled from the server", () => {
    expect(kind({ status: status("expired") })).toBe("expired");
    expect(kind({ status: status("cancelled") })).toBe("cancelled");
  });
  it("unavailable when the signed intent is withheld", () => {
    expect(kind({ checkout: { kind: "ok", data: checkout({ intent: null }) } })).toBe("unavailable");
  });
  it("our submitted tx outranks a closed status (a late payment may still land)", () => {
    expect(kind({ status: status("expired"), flow: { step: "submitted", txHash: HASH } })).toBe("submitted");
  });
});

describe("deriveCheckoutView: success only when verified", () => {
  it("paid (this session)", () => {
    expect(
      deriveCheckoutView(input({ flow: { step: "submitted", txHash: HASH }, status: status("paid", { verified: true, payment: payment(2) }) })),
    ).toEqual({ kind: "paid", txHash: HASH });
  });
  it("already paid (opened after payment)", () => {
    expect(kind({ status: status("paid", { verified: true, payment: payment(3) }) })).toBe("already_paid");
  });
  it("late payment", () => {
    expect(kind({ checkout: { kind: "ok", data: checkout({ late: true, status: "paid" }) }, status: status("paid", { verified: true }) })).toBe("late_paid");
  });
  it("refunded still reads as paid when verified", () => {
    expect(kind({ status: status("refunded", { verified: true }) })).toBe("already_paid");
  });

  it("NEVER returns a success view unless status.verified === true (exhaustive)", () => {
    const flows: FlowState[] = [
      initialFlow,
      { step: "permit_requested" },
      { step: "pay_requested" },
      { step: "submitted", txHash: HASH },
      { step: "failed", error: { kind: "revert", title: "t", message: "m" }, txHash: HASH },
    ];
    const pre: PreflightState[] = [{ kind: "idle" }, preOk(), preOk({ check: "already_paid" })];
    for (const s of INTENT_STATUSES) {
      for (const flow of flows) {
        for (const preflight of pre) {
          for (const pay of [null, payment(0), payment(5)]) {
            for (const late of [false, true]) {
              // status poll says not verified, even when the status itself says paid
              const v1 = deriveCheckoutView(
                input({ checkout: { kind: "ok", data: checkout({ status: s, late, payment: pay }) }, status: status(s, { verified: false, payment: pay }), flow, preflight }),
              );
              expect(VERIFIED_VIEWS).not.toContain(v1.kind);
              // no status poll yet at all
              const v2 = deriveCheckoutView(input({ checkout: { kind: "ok", data: checkout({ status: s, late, payment: pay }) }, status: null, flow, preflight }));
              expect(VERIFIED_VIEWS).not.toContain(v2.kind);
            }
          }
        }
      }
    }
  });

  it("settled-but-unverified keeps waiting (confirming), never success", () => {
    expect(kind({ status: status("paid", { verified: false, payment: payment(1) }) })).toBe("confirming");
    expect(kind({ checkout: { kind: "ok", data: checkout({ status: "paid" }) }, status: null })).toBe("loading");
  });
});

describe("statusPollInterval", () => {
  it("polls fast while confirming and stops once verified", () => {
    expect(statusPollInterval({ kind: "confirming", txHash: null, confirmations: 0, required: 2 })).toBe(2500);
    expect(statusPollInterval({ kind: "paid", txHash: HASH })).toBe(false);
    expect(statusPollInterval({ kind: "ready", needsApproval: true })).toBe(5000);
  });
});
