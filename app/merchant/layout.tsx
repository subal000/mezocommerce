import type { Metadata } from "next";
import { MerchantShell } from "@/components/merchant/shell";

export const metadata: Metadata = {
  title: { default: "Dashboard", template: "%s | MezoCommerce dashboard" },
  robots: { index: false, follow: false },
};

export default function MerchantLayout({ children }: { children: React.ReactNode }) {
  return <MerchantShell>{children}</MerchantShell>;
}
