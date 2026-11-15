/** Small display helpers for the checkout and storefront. Pure. */

/** Only http(s) URLs pass (blocks javascript:, data: etc. in return/cancel/logo/website links). */
export function safeHttpUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  try {
    const url = new URL(u);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function hostOf(u: string | null | undefined): string | null {
  const s = safeHttpUrl(u);
  if (!s) return null;
  return new URL(s).host.replace(/^www\./, "");
}

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

function channel(c: number) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a #rgb/#rrggbb colour, or null if invalid. */
export function luminance(hex: string): number | null {
  const m = HEX.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((x) => x + x).join("");
  const n = parseInt(h, 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

export function contrastRatio(l1: number, l2: number) {
  const [a, b] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (a + 0.05) / (b + 0.05);
}

/**
 * The merchant's brand colour as a restrained accent: the colour plus the readable text colour on it.
 * Falls back to null (use the platform ink) when the colour is invalid or can't carry AA text either way.
 */
export function merchantAccent(hex: string | null | undefined): { bg: string; fg: string } | null {
  if (!hex) return null;
  const l = luminance(hex);
  if (l === null) return null;
  const bg = hex.startsWith("#") ? hex : `#${hex}`;
  const white = contrastRatio(l, 1);
  const ink = contrastRatio(l, 0.012);
  if (white >= 4.5) return { bg, fg: "#ffffff" };
  if (ink >= 4.5) return { bg, fg: "#14161a" };
  return null;
}

export function shortHash(h: string | null | undefined, chars = 6): string {
  if (!h) return "";
  return h.length <= 2 + chars * 2 ? h : `${h.slice(0, 2 + chars)}…${h.slice(-chars)}`;
}

/** "14:03" style remaining time; hours shown when ≥ 1h. */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return h > 0 ? `${h}:${mm}:${String(s).padStart(2, "0")}` : `${mm}:${String(s).padStart(2, "0")}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** Valid checkout/payment id: pi_ + 24 alphanumerics, or a 0x bytes32 payment id. Mirrors public/checkout.js. */
export function isValidCheckoutId(id: string): boolean {
  return /^pi_[A-Za-z0-9]{24}$/.test(id) || /^0x[0-9a-fA-F]{64}$/.test(id);
}
