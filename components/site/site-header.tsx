import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { Button } from "@/components/ui/button";

const NAV = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/docs", label: "Docs" },
  { href: "/demo-store", label: "Demo store" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-[var(--z-sticky)] border-b bg-background/90 backdrop-blur-sm supports-[backdrop-filter]:bg-background/75">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link href="/" aria-label="MezoCommerce home" className="rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          <Logo />
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <Button asChild size="sm" variant="ghost" className="md:hidden">
            <Link href="/docs">Docs</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/merchant">Dashboard</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
