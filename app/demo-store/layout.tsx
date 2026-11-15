import type { Metadata } from "next";
import { TestnetBanner } from "@/components/storefront/storefront";
import { STORE_NAME } from "@/components/storefront/catalog";

export const metadata: Metadata = {
  title: { default: `${STORE_NAME} (demo store)`, template: `%s | ${STORE_NAME} demo` },
  description: "A reference storefront that takes MUSD through MezoCommerce checkout on Mezo Testnet.",
  robots: { index: false, follow: true },
};

/** The demo store is a separate fictional shop, so it renders without MezoCommerce's site chrome (see app/checkout/layout.tsx). */
export default function DemoStoreLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-mc-surface="demo-store" className="flex min-h-dvh flex-1 flex-col bg-background">
      <style>{`body:has([data-mc-surface="demo-store"]) [data-site-chrome]{display:none!important}`}</style>
      <TestnetBanner />
      {children}
    </div>
  );
}
