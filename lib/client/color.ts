import { HEX_COLOR_RE } from "./forms";

/** Readable text colour on a brand colour (WCAG relative luminance). Pure, unit tested. */
export function textOn(hex: string): "#ffffff" | "#14171c" {
  if (!HEX_COLOR_RE.test(hex)) return "#ffffff";
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const L = 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  // contrast vs white = 1.05/(L+0.05); vs near-black ≈ (L+0.05)/0.059
  return 1.05 / (L + 0.05) >= (L + 0.05) / 0.059 ? "#ffffff" : "#14171c";
}
