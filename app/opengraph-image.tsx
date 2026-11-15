import { ImageResponse } from "next/og";
import { OgMark, OG_COLORS } from "@/components/brand/og-mark";

export const alt = "MezoCommerce: Your store. Your customers. MUSD payments.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 80,
          background: OG_COLORS.paper,
          color: OG_COLORS.ink,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <OgMark size={64} />
          <div style={{ fontSize: 36, fontWeight: 600, letterSpacing: -1 }}>MezoCommerce</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 80, fontWeight: 700, letterSpacing: -3, lineHeight: 1.05, maxWidth: 1000 }}>Your store. Your customers. MUSD payments.</div>
          <div style={{ fontSize: 36, color: OG_COLORS.muted }}>Accept payments in MUSD on Mezo.</div>
        </div>
        <div style={{ display: "flex", fontSize: 24, color: OG_COLORS.muted }}>Testnet. Non-custodial checkout.</div>
      </div>
    ),
    size,
  );
}
