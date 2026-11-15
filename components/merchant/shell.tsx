"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BarChart3, Code2, CreditCard, Plus, Settings, ShoppingBag } from "lucide-react";
import { needsOnboarding } from "@/lib/client/onboarding";
import { MERCHANT_STATUS } from "@/lib/client/status";
import { cn } from "@/lib/client/utils";
import { usePublicConfig, useMerchant, useRegistration } from "@/hooks/use-api";
import { useAuth } from "@/hooks/use-auth";
import { useMounted } from "@/hooks/use-mounted";
import { ConnectWalletButton } from "@/components/wallet/connect-dialog";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { QueryError } from "@/components/shared/query-error";
import { StatusDot } from "@/components/shared/status-badge";
import { NetworkBanner } from "@/components/shared/network-banner";
import { NotDeployedNotice } from "@/components/shared/not-deployed";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MerchantProvider } from "./merchant-context";
import { NotificationBell } from "./notification-bell";
import { Onboarding } from "./onboarding";

const NAV = [
  { href: "/merchant", label: "Overview", icon: BarChart3 },
  { href: "/merchant/payments", label: "Payments", icon: CreditCard },
  { href: "/merchant/developers", label: "Developers", icon: Code2 },
  { href: "/merchant/shopify", label: "Shopify", icon: ShoppingBag },
  { href: "/merchant/settings", label: "Settings", icon: Settings },
] as const;

export function isNavActive(pathname: string, href: string) {
  return href === "/merchant" ? pathname === "/merchant" : pathname === href || pathname.startsWith(`${href}/`);
}

function NavLinks({ pathname, compact }: { pathname: string; compact?: boolean }) {
  return (
    <ul className={compact ? "-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" : "space-y-0.5"}>
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = isNavActive(pathname, href);
        return (
          <li key={href} className="shrink-0">
            <Link
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-9 items-center gap-2.5 rounded-md px-3 text-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                active ? "bg-brand-soft font-medium text-brand-ink" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                compact && "px-2.5 text-[0.8125rem]",
              )}
            >
              <Icon className={cn("size-4 shrink-0", compact && "hidden")} strokeWidth={1.75} aria-hidden />
              {label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function TopBar() {
  return (
    <header className="border-b">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link href="/" aria-label="MezoCommerce home" className="rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          <Logo />
        </Link>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <ConnectWalletButton />
        </div>
      </div>
    </header>
  );
}

function ShellSkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-10 sm:px-6" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-4 w-80 max-w-full" />
      <Skeleton className="h-40 w-full rounded-xl" />
    </div>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <NetworkBanner />
      <TopBar />
      <main id="main" className="flex-1">
        {children}
      </main>
    </div>
  );
}

/**
 * /merchant/*: signed-out → onboarding (connect + sign in); no profile or not registered on-chain → onboarding;
 * otherwise the dashboard. Once onboarding shows it stays until the merchant finishes it, so the API key
 * and done steps appear after registration flips the store to ready.
 */
export function MerchantShell({ children }: { children: ReactNode }) {
  const mounted = useMounted();
  const pathname = usePathname();
  const router = useRouter();
  const auth = useAuth();
  const config = usePublicConfig();
  const merchant = useMerchant(mounted && auth.signedIn);
  const registration = useRegistration(mounted && auth.signedIn && !!merchant.data);
  const [wizard, setWizard] = useState(false);

  const deployed = config.data?.deployed ?? false;
  const forceWizard = pathname === "/merchant/onboarding";
  const ready = auth.signedIn && merchant.isSuccess && (!merchant.data || registration.isSuccess || registration.isError);
  const incomplete = !auth.signedIn || (ready && needsOnboarding(merchant.data, registration.data));
  // Latch the wizard on for this visit (render-time state update is React's documented pattern for derived state).
  if (mounted && !auth.sessionLoading && incomplete && !wizard && (!auth.signedIn || ready)) setWizard(true);

  if (!mounted || auth.sessionLoading || (auth.signedIn && (merchant.isLoading || (merchant.data && registration.isLoading)))) {
    return (
      <Frame>
        <ShellSkeleton />
      </Frame>
    );
  }
  if (auth.signedIn && merchant.isError) {
    return (
      <Frame>
        <div className="mx-auto w-full max-w-xl px-4 py-16">
          <QueryError error={merchant.error} onRetry={() => void merchant.refetch()} title="Couldn't load your store" />
        </div>
      </Frame>
    );
  }

  const m = merchant.data ?? null;
  if (!m || wizard || forceWizard || incomplete) {
    return (
      <Frame>
        <Onboarding
          merchant={m}
          config={config.data ?? null}
          deployed={deployed}
          merchantLoading={merchant.isLoading}
          onFinish={() => {
            setWizard(false);
            if (forceWizard) router.push("/merchant");
          }}
        />
      </Frame>
    );
  }

  return (
    <MerchantProvider value={{ merchant: m, config: config.data ?? null, deployed }}>
      <div className="flex min-h-dvh flex-col lg:flex-row">
        <aside className="hidden w-60 shrink-0 border-r bg-surface lg:block">
          <div className="sticky top-0 flex h-dvh flex-col gap-6 px-3 py-5">
            <Link href="/" aria-label="MezoCommerce home" className="rounded-md px-3 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
              <Logo />
            </Link>
            <Button asChild className="mx-1 justify-start">
              <Link href="/merchant/payments/new">
                <Plus aria-hidden /> Create payment
              </Link>
            </Button>
            <nav aria-label="Dashboard">
              <NavLinks pathname={pathname} />
            </nav>
            <div className="mt-auto space-y-3 px-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium" title={m.name}>
                  {m.name}
                </p>
                <StatusDot meta={MERCHANT_STATUS[m.status]} className="text-muted-foreground" />
              </div>
              <div className="flex items-center gap-1">
                <ConnectWalletButton className="min-w-0 flex-1" />
                <NotificationBell />
                <ThemeToggle />
              </div>
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <NetworkBanner />
          <header className="border-b lg:hidden">
            <div className="flex h-14 items-center justify-between gap-2 px-4">
              <Link href="/" aria-label="MezoCommerce home" className="rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                <Logo />
              </Link>
              <div className="flex items-center gap-0.5">
                <NotificationBell />
                <ThemeToggle />
                <ConnectWalletButton />
              </div>
            </div>
            <nav aria-label="Dashboard" className="px-4 pb-2">
              <NavLinks pathname={pathname} compact />
            </nav>
          </header>
          <main id="main" className="min-w-0 flex-1">
            <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6 sm:py-10">
              {!deployed && config.isSuccess ? <NotDeployedNotice /> : null}
              {children}
            </div>
          </main>
        </div>
      </div>
    </MerchantProvider>
  );
}
