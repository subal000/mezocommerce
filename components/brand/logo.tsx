import { cn } from "@/lib/client/utils";

/**
 * MezoCommerce mark: a customer point and a merchant point joined by one straight line.
 * Money goes from one wallet to the other with nothing in between.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-6 shrink-0", className)}>
      <rect width="32" height="32" rx="8" className="fill-primary" />
      <path d="M10 21.5 22 10.5" strokeWidth="2.6" strokeLinecap="round" className="stroke-primary-foreground" />
      <circle cx="10" cy="21.5" r="3.2" className="fill-primary-foreground" />
      <circle cx="22" cy="10.5" r="3.6" className="fill-brand" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-[0.9375rem] font-semibold tracking-[-0.02em]", className)}>
      <LogoMark />
      <span>MezoCommerce</span>
    </span>
  );
}
