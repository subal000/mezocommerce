import type { Metadata } from "next";

/**
 * Checkout routes render without site chrome. The root layout (app agent) currently has no header/footer; if one is
 * added, it should carry `data-site-chrome` and this layout hides it for /checkout/* via the rule below.
 * Providers come from the root layout. CSP `frame-ancestors *` for /checkout/* is set by the backend (next.config).
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function CheckoutLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-mc-surface="checkout" className="flex min-h-dvh flex-1 flex-col">
      <style>{`body:has([data-mc-surface="checkout"]) [data-site-chrome]{display:none!important}`}</style>
      {children}
    </div>
  );
}
