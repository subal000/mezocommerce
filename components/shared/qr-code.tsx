"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/client/utils";

/** QR code as an inline SVG (dark modules on a white quiet zone so phones read it in either theme). */
export function QrCode({ value, size = 176, label, className }: { value: string; size?: number; label: string; className?: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    QRCode.toString(value, { type: "svg", margin: 2, errorCorrectionLevel: "M", color: { dark: "#1d222b", light: "#ffffff" } })
      .then((s) => alive && setSvg(s))
      .catch(() => alive && setSvg(null));
    return () => {
      alive = false;
    };
  }, [value]);
  if (!svg) return <Skeleton className={cn("rounded-lg", className)} style={{ width: size, height: size }} />;
  return (
    <div
      role="img"
      aria-label={label}
      className={cn("overflow-hidden rounded-lg border bg-white [&_svg]:size-full", className)}
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
