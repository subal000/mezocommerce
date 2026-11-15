"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { cn } from "@/lib/client/utils";

/**
 * QR code for a checkout URL (always the checkout link with its payment reference, never a bare address + amount).
 * Rendered as an SVG data URL in an <img>, so no markup is injected into the page.
 */
export function QrCode({ value, size = 184, className, label }: { value: string; size?: number; className?: string; label: string }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    QRCode.toString(value, { type: "svg", errorCorrectionLevel: "M", margin: 1, color: { dark: "#14161aff", light: "#ffffffff" } })
      .then((svg) => {
        if (alive) setSrc(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
      })
      .catch(() => {
        if (alive) setSrc(null);
      });
    return () => {
      alive = false;
    };
  }, [value]);

  return (
    <div
      className={cn("rounded-lg border bg-white p-2", className)}
      style={{ width: size + 18, height: size + 18 }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={label} width={size} height={size} className="block size-full" />
      ) : (
        <div className="size-full animate-pulse rounded bg-muted" role="img" aria-label={label} />
      )}
    </div>
  );
}
