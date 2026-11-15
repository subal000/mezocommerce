import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SiteHeader } from "@/components/site/site-header";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto flex w-full max-w-xl flex-1 flex-col items-start justify-center px-4 py-24">
        <p className="num text-sm text-muted-foreground">404</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.025em]">This page doesn&apos;t exist.</h1>
        <p className="mt-3 text-muted-foreground">The link may be old, or the payment may have been removed.</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild>
            <Link href="/">Go to the home page</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/docs">Read the docs</Link>
          </Button>
        </div>
      </main>
    </>
  );
}
