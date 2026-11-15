// Pure, isomorphic MUSD helpers (shared by API, worker and UI). Integer (bigint) math only; no floats touch amounts.

export const MUSD_DECIMALS = 18;
export const MUSD_UNIT = 10n ** 18n;
const SECONDS_PER_MONTH = 30n * 86400n; // fixed 30-day month, matches BILLING_INTERVALS.monthly

/**
 * Parse a human MUSD amount ("5", "4.99", "1,000.5", ".5") into wei.
 * Throws on empty / non-numeric / negative / more than 18 fraction digits.
 */
export function parseMusd(human: string): bigint {
  if (typeof human !== "string") throw new Error("Amount must be a string");
  const s = human.trim().replace(/,/g, "").replace(/_/g, "");
  if (s === "") throw new Error("Amount is required");
  if (s.startsWith("-")) throw new Error("Amount cannot be negative");
  const m = /^\+?(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (m[1] === "" && (m[2] === undefined || m[2] === ""))) throw new Error(`Invalid amount: ${human}`);
  const whole = m[1] || "0";
  const frac = m[2] ?? "";
  if (frac.length > MUSD_DECIMALS) throw new Error(`Too many decimal places (max ${MUSD_DECIMALS})`);
  return BigInt(whole) * MUSD_UNIT + BigInt((frac + "0".repeat(MUSD_DECIMALS)).slice(0, MUSD_DECIMALS) || "0");
}

/** Safe variant for forms: returns null instead of throwing. */
export function tryParseMusd(human: string): bigint | null {
  try {
    return parseMusd(human);
  } catch {
    return null;
  }
}

function toBig(wei: bigint | string | number): bigint {
  if (typeof wei === "bigint") return wei;
  if (typeof wei === "number") return BigInt(Math.trunc(wei));
  const s = wei.trim();
  if (!/^-?\d+$/.test(s)) throw new Error(`Invalid wei value: ${wei}`);
  return BigInt(s);
}

function groupThousands(int: string): string {
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export interface FormatMusdOptions {
  /** Fraction digits to show (default 2). Rounded half-up. */
  decimals?: number;
  /** 1.2K / 3.4M / 5.6B style (default false). */
  compact?: boolean;
  /** Append " MUSD" (default false). */
  symbol?: boolean;
}

/**
 * Format wei as a human MUSD string, e.g. formatMusd(4990000000000000000n) → "4.99".
 * Non-zero amounts that round to zero render as "<0.01" (for decimals = 2).
 */
export function formatMusd(wei: bigint | string, opts: FormatMusdOptions = {}): string {
  const decimals = Math.max(0, Math.min(MUSD_DECIMALS, Math.floor(opts.decimals ?? 2)));
  let v = toBig(wei);
  const negative = v < 0n;
  if (negative) v = -v;
  const suffix = opts.symbol ? " MUSD" : "";
  const sign = negative ? "-" : "";

  if (opts.compact) {
    const units: [bigint, string][] = [
      [10n ** 9n * MUSD_UNIT, "B"],
      [10n ** 6n * MUSD_UNIT, "M"],
      [10n ** 3n * MUSD_UNIT, "K"],
    ];
    for (const [threshold, label] of units) {
      if (v >= threshold) {
        // one decimal place, trimmed ("1.0K" → "1K")
        const tenths = (v * 10n + threshold / 2n) / threshold;
        const whole = tenths / 10n;
        const frac = tenths % 10n;
        return `${sign}${groupThousands(whole.toString())}${frac === 0n ? "" : "." + frac.toString()}${label}${suffix}`;
      }
    }
  }

  const scale = 10n ** BigInt(MUSD_DECIMALS - decimals);
  const rounded = (v + scale / 2n) / scale; // half-up at the requested precision
  if (rounded === 0n && v > 0n) {
    return `${sign}<${decimals === 0 ? "1" : "0." + "0".repeat(decimals - 1) + "1"}${suffix}`;
  }
  const div = 10n ** BigInt(decimals);
  const whole = rounded / div;
  const frac = rounded % div;
  const fracStr = decimals > 0 ? "." + frac.toString().padStart(decimals, "0") : "";
  return `${sign}${groupThousands(whole.toString())}${fracStr}${suffix}`;
}

/** Plain decimal string with no grouping or rounding, trailing zeros trimmed (for inputs): 4990000000000000000n → "4.99". */
export function musdToDecimalString(wei: bigint | string): string {
  let v = toBig(wei);
  const negative = v < 0n;
  if (negative) v = -v;
  const whole = v / MUSD_UNIT;
  const frac = (v % MUSD_UNIT).toString().padStart(MUSD_DECIMALS, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole.toString()}${frac ? "." + frac : ""}`;
}

/** amount × 30 days / interval, integer math (floor). Used for MRR. */
export function monthlyNormalized(amountWei: bigint, intervalSeconds: number): bigint {
  if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) return 0n;
  return (amountWei * SECONDS_PER_MONTH) / BigInt(Math.floor(intervalSeconds));
}
