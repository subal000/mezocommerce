import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MEZO_TESTNET_ID } from "@/lib/chain/config";
import { SITE } from "@/lib/client/site";
import { Reveal } from "./reveal";

export function AboutMusd() {
  const facts = [
    { k: "MUSD", v: "A stablecoin pegged to the US dollar, with 18 decimals. Prices stay in dollars, not in a volatile coin." },
    { k: "Mezo", v: "A Bitcoin network that runs EVM contracts. Pay with a Bitcoin wallet through Mezo Passport, or with MetaMask, Rabby and other Ethereum wallets." },
    { k: "Gas", v: "Network fees are paid in BTC, not MUSD. Customers need a small amount of testnet BTC." },
    { k: "Network", v: `Mezo Testnet, chain ${MEZO_TESTNET_ID}. Test MUSD has no real-world value.` },
  ];
  return (
    <section aria-labelledby="musd-title" className="border-t">
      <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6 lg:py-24">
        <Reveal>
          <h2 id="musd-title" className="max-w-[24ch] text-3xl font-semibold tracking-[-0.025em] sm:text-4xl">
            Dollar prices, settled on a Bitcoin network
          </h2>
          <p className="mt-4 max-w-[62ch] text-lg text-muted-foreground">
            Customers pay in MUSD from a Bitcoin wallet or an Ethereum wallet. You receive MUSD in your own wallet the moment the payment lands, with no card network, chargebacks or payout schedule in between.
          </p>
        </Reveal>
        <dl className="mt-12 grid gap-x-12 gap-y-8 sm:grid-cols-2">
          {facts.map((f) => (
            <div key={f.k} className="border-t pt-4">
              <dt className="font-semibold">{f.k}</dt>
              <dd className="mt-1.5 max-w-[48ch] text-muted-foreground">{f.v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-10 text-sm text-muted-foreground">
          Need test funds?{" "}
          <a href={SITE.faucetUrl} target="_blank" rel="noreferrer" className="text-foreground underline underline-offset-4">
            Get testnet funds from Mezo
          </a>
          .
        </p>
      </div>
    </section>
  );
}

export function Commerce() {
  const steps = [
    "Add a manual payment method in Shopify called “Pay with MUSD”.",
    "Create a custom app with read and write access to orders, then paste its keys into MezoCommerce.",
    "Point the orders/create webhook at the URL we give you.",
    "Customers who pick Pay with MUSD get a checkout link on the order page and in the confirmation email.",
    "Once the payment is confirmed on-chain, we mark the Shopify order as paid.",
  ];
  return (
    <section aria-labelledby="commerce-title" className="border-t bg-surface">
      <div className="mx-auto grid w-full max-w-6xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-2 lg:gap-16 lg:py-24">
        <Reveal>
          <h2 id="commerce-title" className="text-3xl font-semibold tracking-[-0.025em] sm:text-4xl">
            Works with the store you already run
          </h2>
          <p className="mt-4 max-w-[52ch] text-muted-foreground">
            Any store with a server can create payments through the API and open checkout with the widget. Custom carts, WooCommerce plugins and headless storefronts all work the same way.
          </p>
          <p className="mt-4 max-w-[52ch] text-muted-foreground">
            Shopify works too, through a custom app and a manual payment method. It is not an approved Shopify payment gateway, so MUSD appears as a manual option and customers pay on the next page.
          </p>
          <Button asChild variant="outline" className="mt-6">
            <Link href="/docs/shopify">
              Read the Shopify guide <ArrowRight aria-hidden />
            </Link>
          </Button>
        </Reveal>
        <Reveal delay={0.08}>
          <h3 className="font-semibold">Shopify setup</h3>
          <ol className="mt-4 space-y-4">
            {steps.map((s, i) => (
              <li key={s} className="flex gap-4">
                <span aria-hidden className="num w-5 shrink-0 pt-px text-sm font-medium text-muted-foreground">
                  {i + 1}.
                </span>
                <span className="text-[0.9375rem]">{s}</span>
              </li>
            ))}
          </ol>
          <p className="mt-6 text-sm text-muted-foreground">Orders in USD are charged 1 USD = 1 MUSD. Orders in other currencies are skipped.</p>
        </Reveal>
      </div>
    </section>
  );
}

export function Security() {
  const rows = [
    { k: "You hold the money", v: "Payments go from the customer's wallet straight to your payout wallet. There's no MezoCommerce balance and no withdrawal step." },
    { k: "Exact amount or nothing", v: "The contract transfers exactly the signed amount or reverts, so an order can't be underpaid or overpaid." },
    { k: "Paid means verified", v: "An order turns paid only after we find the PaymentCompleted event, match every field and wait for confirmations." },
    { k: "No platform fee", v: "0% platform fee while MezoCommerce runs on testnet. You only pay network gas for setup and refunds." },
    { k: "Refunds from your wallet", v: "You send refunds from your owner or payout wallet. The contract caps them at what the customer paid." },
    { k: "Not audited", v: "The contracts have tests but no external audit yet. Use testnet funds only." },
  ];
  return (
    <section aria-labelledby="security-title" className="border-t">
      <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6 lg:py-24">
        <Reveal>
          <h2 id="security-title" className="max-w-[22ch] text-3xl font-semibold tracking-[-0.025em] sm:text-4xl">
            Every paid order is checked on-chain
          </h2>
          <p className="mt-4 max-w-[60ch] text-muted-foreground">What we promise, and what we don&apos;t.</p>
        </Reveal>
        <dl className="mt-10 divide-y border-y">
          {rows.map((r) => (
            <div key={r.k} className="grid gap-1 py-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] sm:gap-8">
              <dt className="font-semibold">{r.k}</dt>
              <dd className="max-w-[62ch] text-muted-foreground">{r.v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-6 text-sm text-muted-foreground">
          Details in{" "}
          <Link href="/docs/security" className="text-foreground underline underline-offset-4">
            security and limitations
          </Link>
          .
        </p>
      </div>
    </section>
  );
}

export function Closing() {
  return (
    <section aria-labelledby="closing-title" className="border-t bg-surface">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-16 sm:px-6 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 id="closing-title" className="text-2xl font-semibold tracking-[-0.02em]">
            Take your first MUSD payment today
          </h2>
          <p className="mt-2 max-w-[56ch] text-muted-foreground">Connect a wallet, register your store and create a payment link in a few minutes.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link href="/merchant">Start accepting MUSD</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/docs">Read the docs</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
