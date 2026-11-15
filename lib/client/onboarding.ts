import type { MerchantDTO, RegistrationParamsDTO } from "@/lib/api-types";

/** Merchant onboarding, as a pure function of what we know. Unit tested. */
export type OnboardingStep = "connect" | "network" | "sign_in" | "profile" | "onchain" | "api_key" | "done";

export const ONBOARDING_STEPS: { id: Exclude<OnboardingStep, "network">; label: string }[] = [
  { id: "connect", label: "Connect wallet" },
  { id: "sign_in", label: "Sign in" },
  { id: "profile", label: "Store details" },
  { id: "onchain", label: "Register on-chain" },
  { id: "api_key", label: "First API key" },
  { id: "done", label: "Done" },
];

export interface OnboardingInput {
  connected: boolean;
  wrongNetwork: boolean;
  signedIn: boolean;
  merchant: MerchantDTO | null | undefined;
  registration: RegistrationParamsDTO | null | undefined;
  apiKeyCount: number;
  /** The merchant chose to skip the API key step for now. */
  skippedApiKey?: boolean;
}

export function onboardingStep(i: OnboardingInput): OnboardingStep {
  if (!i.connected) return "connect";
  if (!i.signedIn) return i.wrongNetwork ? "network" : "sign_in";
  if (!i.merchant) return "profile";
  if (!i.registration || i.registration.next !== "ready") return "onchain";
  if (i.apiKeyCount === 0 && !i.skippedApiKey) return "api_key";
  return "done";
}

/** Index in ONBOARDING_STEPS for the progress list ("network" shows as part of sign in). */
export function stepIndex(step: OnboardingStep): number {
  const s = step === "network" ? "sign_in" : step;
  return ONBOARDING_STEPS.findIndex((x) => x.id === s);
}

/** What the on-chain step asks the wallet to send next, and why, in one plain sentence. */
export function onchainAction(next: RegistrationParamsDTO["next"]): { fn: "registerMerchant" | "setSigner" | "setMerchantActive" | null; title: string; explain: string } {
  switch (next) {
    case "register":
      return {
        fn: "registerMerchant",
        title: "Register your store on Mezo",
        explain:
          "Your wallet sends one transaction that records your payout wallet and lets MezoCommerce sign checkouts for you. It costs a little testnet BTC for gas and never gives anyone access to your funds.",
      };
    case "enable_signer":
      return {
        fn: "setSigner",
        title: "Let MezoCommerce sign checkouts",
        explain: "Your wallet sends one transaction so we can create checkout links for your orders. We still can't move or redirect your money.",
      };
    case "activate":
      return {
        fn: "setMerchantActive",
        title: "Turn payments on",
        explain: "Your store is paused on-chain. Your wallet sends one transaction to start accepting payments again.",
      };
    default:
      return { fn: null, title: "Registered", explain: "Your store is registered and accepting payments." };
  }
}

/** Whether the merchant still needs onboarding (shell decides between wizard and dashboard). */
export function needsOnboarding(merchant: MerchantDTO | null | undefined, registration: RegistrationParamsDTO | null | undefined): boolean {
  if (!merchant) return true;
  return !registration || registration.next !== "ready";
}
