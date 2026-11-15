// Shared zod validators.
import { z } from "zod";
import { env } from "./env";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** True for https URLs (and http://localhost in development). Rejects data:, javascript:, credentials. */
export function isAllowedUrl(raw: string, opts: { allowLocalHttp?: boolean } = {}): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.username || u.password) return false;
  if (u.protocol === "https:") return Boolean(u.hostname);
  if (u.protocol === "http:" && opts.allowLocalHttp && !env.isProd() && LOCAL_HOSTS.has(u.hostname)) return true;
  return false;
}

/** https URL (logo/website): never data:, javascript:, http: … */
export const zHttpsUrl = z
  .string()
  .trim()
  .max(2048)
  .refine((v) => isAllowedUrl(v), "must be an https:// URL");

/** Customer redirect URLs: https, or http://localhost outside production. */
export const zRedirectUrl = z
  .string()
  .trim()
  .max(2048)
  .refine((v) => isAllowedUrl(v, { allowLocalHttp: true }), "must be an https:// URL (http://localhost allowed in development)");

export const zEmail = z.string().trim().max(254).email();
export const zBrandColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "must be a #rrggbb color");
