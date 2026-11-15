import { formatMusd } from "@/lib/money";

/** Display-only helpers. Amounts stay bigint / wei strings everywhere else. */

export const DASH = "--";

function toWei(v: bigint | string | null | undefined): bigint | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") return v;
  const s = v.trim();
  if (!/^-?\d+$/.test(s)) return null;
  return BigInt(s);
}

/** wei → "1,234.50" (or "1.2K" compact). Null / invalid → "--". Never "-0.00". */
export function musd(v: bigint | string | null | undefined, opts: { compact?: boolean; decimals?: number; symbol?: boolean } = {}): string {
  const wei = toWei(v);
  if (wei === null) return DASH;
  const out = formatMusd(wei, { decimals: opts.decimals ?? 2, compact: opts.compact, symbol: opts.symbol });
  return /^-0(\.0+)?( MUSD)?$/.test(out) ? out.slice(1) : out;
}

/** Decimal display string from the API ("10.5") → grouped 2dp ("10.50"). Keeps full precision beyond 2dp out of tables. */
export function musdDisplay(display: string | null | undefined, opts: { decimals?: number } = {}): string {
  if (display === null || display === undefined || display === "") return DASH;
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(display.trim().replace(/,/g, ""));
  if (!m) return display;
  const whole = m[2] || "0";
  const frac = m[3] ?? "";
  const decimals = opts.decimals ?? 2;
  // integer math so "0.005" rounds half-up without floats
  const scaled = BigInt(whole + (frac + "0".repeat(18)).slice(0, 18));
  return musd((m[1] === "-" ? -scaled : scaled).toString(), { decimals });
}

/** Full precision with trailing zeros trimmed (aria-labels, titles, copy). */
export function musdExact(v: bigint | string | null | undefined): string {
  const wei = toWei(v);
  if (wei === null) return DASH;
  const neg = wei < 0n;
  const abs = neg ? -wei : wei;
  const whole = abs / 10n ** 18n;
  const frac = (abs % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole.toString()}${frac ? "." + frac : ""}`;
}

export function shortAddress(a: string | null | undefined): string {
  if (!a) return DASH;
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

export const shortHash = (h: string | null | undefined) => (h ? (h.length > 16 ? `${h.slice(0, 8)}…${h.slice(-6)}` : h) : DASH);

export function shortId(id: string | null | undefined): string {
  if (!id) return DASH;
  return id.length > 18 ? `${id.slice(0, 10)}…${id.slice(-4)}` : id;
}

function toDate(v: string | number | Date | null | undefined): Date | null {
  if (v === null || v === undefined || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(v: string | number | Date | null | undefined): string {
  const d = toDate(v);
  return d ? d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : DASH;
}

export function formatDateTime(v: string | number | Date | null | undefined): string {
  const d = toDate(v);
  return d ? d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : DASH;
}

/** "in 3 days" / "5 minutes ago" / "just now". */
export function relativeTime(v: string | number | Date | null | undefined, now: number = Date.now()): string {
  const d = toDate(v);
  if (!d) return DASH;
  const diff = d.getTime() - now;
  const abs = Math.abs(diff);
  if (abs < 45_000) return "just now";
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", 86_400_000],
    ["hour", 3_600_000],
    ["minute", 60_000],
  ];
  for (const [unit, ms] of units) {
    if (abs >= ms || unit === "minute") return rtf.format(Math.round(diff / ms), unit);
  }
  return DASH;
}

export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

export function percent(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
  return `${(v * 100).toFixed(digits).replace(/\.0+$/, "")}%`;
}
