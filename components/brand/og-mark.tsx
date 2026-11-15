// Inline mark for next/og image routes (hex colours; ImageResponse doesn't read CSS variables).
export const OG_COLORS = { ink: "#1d222b", paper: "#fbfcfd", muted: "#5d6472", brand: "#2f8a6c", brandBright: "#46b38e" } as const;

export function OgMark({ size, dark = true }: { size: number; dark?: boolean }) {
  const bg = dark ? OG_COLORS.ink : OG_COLORS.paper;
  const fg = dark ? OG_COLORS.paper : OG_COLORS.ink;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32">
      <rect width="32" height="32" rx="8" fill={bg} />
      <path d="M10 21.5 22 10.5" stroke={fg} strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="10" cy="21.5" r="3.2" fill={fg} />
      <circle cx="22" cy="10.5" r="3.6" fill={OG_COLORS.brandBright} />
    </svg>
  );
}
