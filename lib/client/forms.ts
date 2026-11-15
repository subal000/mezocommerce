import { z } from "zod";
import { INTENT_LIMITS } from "@/lib/chain/config";
import { tryParseMusd } from "@/lib/money";

const optionalUrl = z
  .string()
  .trim()
  .max(300, "Keep it under 300 characters.")
  .refine((v) => v === "" || /^https?:\/\/[^\s]+\.[^\s]+/i.test(v), "Enter a full link starting with https://");

export const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export const profileSchema = z.object({
  name: z.string().trim().min(2, "Enter your store name.").max(80, "Keep it under 80 characters."),
  website: optionalUrl,
  logo_url: optionalUrl,
  description: z.string().trim().max(500, "Keep it under 500 characters."),
  support_email: z
    .string()
    .trim()
    .refine((v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Enter a valid email address."),
});
export type ProfileValues = z.infer<typeof profileSchema>;

export const onboardingProfileSchema = profileSchema.extend({
  payout_address: z.string().trim().regex(ADDRESS_RE, "Enter a wallet address (0x followed by 40 characters)."),
});
export type OnboardingProfileValues = z.infer<typeof onboardingProfileSchema>;

/** "" → null for optional API fields. */
export const orNull = (v: string) => (v.trim() === "" ? null : v.trim());

export const EXPIRY_OPTIONS = [
  { value: "1800", label: "30 minutes" },
  { value: "3600", label: "1 hour" },
  { value: "86400", label: "24 hours" },
  { value: "604800", label: "7 days" },
] as const;

export const createPaymentSchema = z.object({
  merchant_order_id: z
    .string()
    .trim()
    .min(1, "Enter an order ID.")
    .max(128, "Keep it under 128 characters.")
    .regex(/^[A-Za-z0-9_\-#:./]+$/, "Use letters, numbers and - _ # : . / only."),
  amount: z
    .string()
    .trim()
    .refine((v) => tryParseMusd(v) !== null, "Enter an amount like 25 or 25.50.")
    .refine((v) => {
      const w = tryParseMusd(v);
      return w === null || (w >= INTENT_LIMITS.MIN_AMOUNT_WEI && w <= INTENT_LIMITS.MAX_AMOUNT_WEI);
    }, "Amount must be between 0.01 and 1,000,000 MUSD."),
  description: z.string().trim().max(500, "Keep it under 500 characters."),
  expires_in_seconds: z.enum(["1800", "3600", "86400", "604800"]),
  payer_address: z
    .string()
    .trim()
    .refine((v) => v === "" || ADDRESS_RE.test(v), "Enter a wallet address, or leave it empty so anyone can pay."),
  return_url: optionalUrl,
});
export type CreatePaymentValues = z.infer<typeof createPaymentSchema>;

export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** URL check before we send it (the server also blocks private addresses). Pure, unit tested. */
export function webhookUrlError(v: string): string | null {
  const s = v.trim();
  if (!s) return "Enter your endpoint URL.";
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return "Enter a full URL like https://yourstore.com/webhooks/mezo";
  }
  if (u.protocol !== "https:" && !(u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1"))) return "Use an https:// URL.";
  return null;
}


/** Validates the connect form. Pure, unit tested. */
export function shopifyFormErrors(v: { shop_domain: string; admin_access_token: string; webhook_secret: string }) {
  const e: Partial<Record<keyof typeof v, string>> = {};
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(v.shop_domain.trim())) e.shop_domain = "Use your store's myshopify.com address, e.g. your-store.myshopify.com";
  if (!v.admin_access_token.trim().startsWith("shpat_")) e.admin_access_token = "Admin API tokens start with shpat_";
  if (v.webhook_secret.trim().length < 16) e.webhook_secret = "Paste the app's API secret key.";
  return e;
}
