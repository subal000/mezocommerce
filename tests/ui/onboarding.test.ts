import { describe, expect, it } from "vitest";
import type { MerchantDTO, RegistrationParamsDTO } from "@/lib/api-types";
import { needsOnboarding, onboardingStep, onchainAction, stepIndex, ONBOARDING_STEPS, type OnboardingInput } from "@/lib/client/onboarding";

const merchant = { id: "m_1", owner_address: "0xabc" } as MerchantDTO;
const reg = (next: RegistrationParamsDTO["next"]): RegistrationParamsDTO => ({ processor_address: "0x1", platform_signer: "0x2", payout_address: "0x3", next });
const base: OnboardingInput = { connected: true, wrongNetwork: false, signedIn: true, merchant, registration: reg("ready"), apiKeyCount: 1 };

describe("onboardingStep", () => {
  it("walks connect → sign in → profile → on-chain → api key → done", () => {
    expect(onboardingStep({ ...base, connected: false, signedIn: false })).toBe("connect");
    expect(onboardingStep({ ...base, signedIn: false })).toBe("sign_in");
    expect(onboardingStep({ ...base, merchant: null, registration: null })).toBe("profile");
    expect(onboardingStep({ ...base, registration: reg("register") })).toBe("onchain");
    expect(onboardingStep({ ...base, apiKeyCount: 0 })).toBe("api_key");
    expect(onboardingStep(base)).toBe("done");
  });

  it("asks for the network switch before signing in", () => {
    expect(onboardingStep({ ...base, signedIn: false, wrongNetwork: true })).toBe("network");
  });

  it("keeps the on-chain step until registration says ready", () => {
    for (const n of ["register", "enable_signer", "activate"] as const) {
      expect(onboardingStep({ ...base, registration: reg(n), apiKeyCount: 0 })).toBe("onchain");
    }
    expect(onboardingStep({ ...base, registration: null })).toBe("onchain");
  });

  it("lets the merchant skip the API key", () => {
    expect(onboardingStep({ ...base, apiKeyCount: 0, skippedApiKey: true })).toBe("done");
  });

  it("disconnecting always goes back to connect", () => {
    expect(onboardingStep({ ...base, connected: false })).toBe("connect");
  });
});

describe("onboarding helpers", () => {
  it("indexes steps, with network shown as part of sign in", () => {
    expect(stepIndex("connect")).toBe(0);
    expect(stepIndex("network")).toBe(stepIndex("sign_in"));
    expect(stepIndex("done")).toBe(ONBOARDING_STEPS.length - 1);
  });

  it("maps each registration step to one contract call with a plain explanation", () => {
    expect(onchainAction("register").fn).toBe("registerMerchant");
    expect(onchainAction("enable_signer").fn).toBe("setSigner");
    expect(onchainAction("activate").fn).toBe("setMerchantActive");
    expect(onchainAction("ready").fn).toBeNull();
    for (const n of ["register", "enable_signer", "activate"] as const) {
      const e = onchainAction(n).explain;
      expect(e.length).toBeGreaterThan(20);
      expect(e).not.toMatch(/[–—]/);
    }
  });

  it("needsOnboarding until the store is ready on-chain", () => {
    expect(needsOnboarding(null, null)).toBe(true);
    expect(needsOnboarding(merchant, reg("register"))).toBe(true);
    expect(needsOnboarding(merchant, undefined)).toBe(true);
    expect(needsOnboarding(merchant, reg("ready"))).toBe(false);
  });
});
