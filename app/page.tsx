import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SiteHeader } from "@/components/site/site-header";
import { SiteFooter } from "@/components/site/site-footer";
import { HeroPreview } from "@/components/landing/hero-preview";
import { HowItWorks } from "@/components/landing/how-it-works";
import { Integration } from "@/components/landing/integration";
import { DashboardPreview } from "@/components/landing/dashboard-preview";
import { AboutMusd, Closing, Commerce, Security } from "@/components/landing/sections";
import { Reveal } from "@/components/landing/reveal";

export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="flex-1">
        <section aria-labelledby="hero-title">
          <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 pt-14 pb-20 sm:px-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-16 lg:pt-24 lg:pb-28">
            <div>
              <h1 id="hero-title" className="max-w-[16ch] text-4xl leading-[1.05] font-semibold tracking-[-0.035em] sm:text-5xl lg:text-6xl">
                Your store. Your customers. MUSD payments.
              </h1>
              <p className="mt-6 max-w-[46ch] text-lg text-muted-foreground">
                Accept payments in MUSD. Sell beyond traditional payment rails. Every payment lands in your own wallet.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button asChild size="lg">
                  <Link href="/merchant">Start accepting MUSD</Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <Link href="/demo-store">View checkout demo</Link>
                </Button>
              </div>
            </div>
            <HeroPreview />
          </div>
        </section>

        <HowItWorks />
        <AboutMusd />
        <Integration />

        <section aria-labelledby="dashboard-title" className="border-t">
          <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6 lg:py-24">
            <Reveal>
              <h2 id="dashboard-title" className="max-w-[24ch] text-3xl font-semibold tracking-[-0.025em] sm:text-4xl">
                See every payment, down to the transaction
              </h2>
              <p className="mt-4 max-w-[60ch] text-muted-foreground">
                Totals, a 30-day chart, refunds, webhook deliveries and an explorer link on every payment. Export to CSV whenever you need it.
              </p>
            </Reveal>
            <div className="mt-10">
              <DashboardPreview />
            </div>
          </div>
        </section>

        <Commerce />
        <Security />
        <Closing />
      </main>
      <SiteFooter />
    </>
  );
}
