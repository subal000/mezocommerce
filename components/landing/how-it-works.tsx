import type { ReactNode } from "react";
import { StatusBadge } from "@/components/shared/status-badge";
import { Reveal } from "./reveal";

const STEPS: { title: string; body: string; detail: ReactNode }[] = [
  {
    title: "You create a payment",
    body: "Your server, the dashboard or a Shopify order creates a payment intent for the exact MUSD amount. You get a checkout link, a QR code and a widget.",
    detail: <span className="font-mono text-[0.8125rem] text-muted-foreground">POST /api/v1/payment-intents</span>,
  },
  {
    title: "Your customer pays from their wallet",
    body: "The payment contract moves the exact amount from the customer's wallet straight to your payout wallet. MezoCommerce never holds the money.",
    detail: <StatusBadge status="confirming" />,
  },
  {
    title: "We check it on-chain, then mark it paid",
    body: "We read the PaymentCompleted event, match every field to the order, wait for confirmations, then mark the order paid and send your webhook.",
    detail: <StatusBadge status="paid" />,
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="how-title" className="scroll-mt-20 border-t">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16 lg:py-24">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <h2 id="how-title" className="text-3xl font-semibold tracking-[-0.025em] sm:text-4xl">
            How checkout works
          </h2>
          <p className="mt-4 max-w-[46ch] text-muted-foreground">
            Three steps, and only the last one decides that an order is paid. A transaction hash from the browser is never enough on its own.
          </p>
        </div>
        <ol className="relative space-y-10 before:absolute before:top-2 before:bottom-2 before:left-[15px] before:w-px before:bg-border">
          {STEPS.map((s, i) => (
            <li key={s.title} className="relative pl-14">
              <Reveal delay={i * 0.06}>
                <span
                  aria-hidden
                  className="num absolute top-0 left-0 flex size-8 items-center justify-center rounded-full border bg-background text-sm font-medium"
                >
                  {i + 1}
                </span>
                <h3 className="text-lg font-semibold tracking-[-0.01em]">{s.title}</h3>
                <p className="mt-2 max-w-[60ch] text-muted-foreground">{s.body}</p>
                <div className="mt-3">{s.detail}</div>
              </Reveal>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
