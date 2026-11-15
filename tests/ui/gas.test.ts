import { beforeEach, describe, expect, it, vi } from "vitest";

// A plain function, not vi.fn: Vitest reports errors thrown inside vi.fn implementations as test failures.
let calls = 0;
let impl: () => Promise<bigint> = async () => 0n;
vi.mock("@wagmi/core", () => ({
  estimateGas: () => {
    calls++;
    return impl();
  },
}));

import { safeGas } from "@/lib/client/gas";

const tx = { to: "0x94D35689d95b4C7ec9c8bD296ff606027e154df8", data: "0xda4e2f0e", account: "0x4e1B08295435979e57fE15E585885D20c7d14B41" } as const;
const config = {} as never;
const sequence = (...vals: bigint[]) => {
  let k = 0;
  return async () => vals[Math.min(k++, vals.length - 1)];
};

describe("safeGas", () => {
  beforeEach(() => {
    calls = 0;
  });

  it("adds a 25% buffer", async () => {
    impl = sequence(100_000n);
    expect(await safeGas(config, tx)).toBe(125_000n);
  });

  it("retries an estimate that looks like a plain transfer (lagging RPC node)", async () => {
    impl = sequence(21_800n, 117_348n);
    expect(await safeGas(config, tx)).toBe(146_685n);
    expect(calls).toBe(2);
  });

  it("falls back to the wallet's own estimate when every try is low", async () => {
    impl = sequence(21_800n);
    expect(await safeGas(config, tx)).toBeUndefined();
  });

  it("passes reverts through", async () => {
    impl = () => Promise.reject(new Error("execution reverted: RefundExceedsPayment"));
    await expect(safeGas(config, tx)).rejects.toThrow(/RefundExceedsPayment/);
  });
});
