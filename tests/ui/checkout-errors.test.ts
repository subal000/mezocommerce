import { describe, expect, it } from "vitest";
import { BaseError, ContractFunctionRevertedError, encodeErrorResult, parseAbi, UserRejectedRequestError } from "viem";
import { processorAbi } from "@/lib/chain/abis";
import { describeTxError, ERROR_MESSAGES, isTypedDataUnsupported, messageForError } from "@/lib/client/checkout-errors";

const PROCESSOR_ERRORS = processorAbi.filter((x) => x.type === "error").map((x) => (x as { name: string }).name);
// errors declared in the FROZEN IMerchantPaymentProcessor interface
const INTERFACE_ERRORS = [
  "ZeroAddress", "NotMerchantOwner", "NotAuthorized", "UnknownMerchant", "MerchantInactive", "PayoutMismatch", "UnsupportedToken",
  "InvalidAmount", "IntentExpired", "IntentAlreadyPaid", "IntentCancelled", "BadSignature", "WrongPayer", "NotPaid", "RefundExceedsPayment",
];

describe("custom error → message", () => {
  it("every interface error and every error in the generated ABI has a plain message", () => {
    for (const name of new Set([...INTERFACE_ERRORS, ...PROCESSOR_ERRORS])) {
      expect(ERROR_MESSAGES[name], name).toBeTruthy();
      expect(messageForError(name)).not.toMatch(/0x/);
    }
  });

  it.each([
    ["IntentExpired", /expired/],
    ["IntentAlreadyPaid", /already paid/],
    ["BadSignature", /isn't valid/],
    ["WrongPayer", /different wallet/],
    ["MerchantInactive", /paused payments/],
  ])("decodes %s from raw revert data", (errorName, re) => {
    const data = encodeErrorResult({ abi: processorAbi, errorName: errorName as never });
    const err = new BaseError("Execution reverted", { cause: Object.assign(new Error("reverted"), { data }) });
    const m = describeTxError(err);
    expect(m.kind).toBe("revert");
    expect(m.errorName).toBe(errorName);
    expect(m.message).toMatch(re);
  });

  it("decodes OpenZeppelin ERC20 errors", () => {
    const abi = parseAbi(["error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)"]);
    const data = encodeErrorResult({ abi, errorName: "ERC20InsufficientBalance", args: ["0x0000000000000000000000000000000000000001", 1n, 2n] });
    expect(describeTxError({ shortMessage: "reverted", data }).message).toMatch(/doesn't hold enough MUSD/);
  });

  it("uses viem's decoded errorName", () => {
    const e = Object.create(ContractFunctionRevertedError.prototype);
    Object.assign(e, { name: "ContractFunctionRevertedError", data: { errorName: "IntentCancelled", args: [] }, message: "reverted" });
    expect(describeTxError(e).message).toMatch(/cancelled/);
  });

  it("wallet rejection", () => {
    const m = describeTxError(new UserRejectedRequestError(new Error("User rejected the request.")));
    expect(m.kind).toBe("rejected");
    expect(describeTxError({ code: 4001, message: "nope" }).kind).toBe("rejected");
  });

  it("gas, rpc and unknown fallbacks never leak hex", () => {
    expect(describeTxError(new Error("insufficient funds for gas * price + value")).kind).toBe("funds");
    expect(describeTxError(new Error("Failed to fetch")).kind).toBe("rpc");
    const m = describeTxError(new Error("x".repeat(300)));
    expect(m.message).toBe("Please try again.");
  });

  it("typed-data unsupported detection (drives the approve fallback)", () => {
    expect(isTypedDataUnsupported({ code: 4200, message: "Unsupported method" })).toBe(true);
    expect(isTypedDataUnsupported(new Error("eth_signTypedData_v4 is not supported"))).toBe(true);
    expect(isTypedDataUnsupported({ code: -32601, message: "Method not found" })).toBe(true);
    expect(isTypedDataUnsupported({ code: 4001, message: "User rejected" })).toBe(false);
    expect(isTypedDataUnsupported(new Error("execution reverted"))).toBe(false);
  });
});
