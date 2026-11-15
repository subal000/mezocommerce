import Link from "next/link";
import { contracts, explorerAddress, isDeployed, MEZO_TESTNET_ID } from "@/lib/chain/config";
import { shortAddress } from "@/lib/client/format";
import { Logo } from "@/components/brand/logo";

const LINKS = [
  { href: "/docs", label: "Docs" },
  { href: "/docs/api", label: "API reference" },
  { href: "/docs/security", label: "Security and limits" },
  { href: "/demo-store", label: "Demo store" },
  { href: "/merchant", label: "Dashboard" },
];

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t">
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1fr_auto]">
        <div className="space-y-3 text-sm text-muted-foreground">
          <Logo className="text-foreground" />
          <p className="max-w-[52ch]">
            Testnet software. Contracts are not audited. Payments use MUSD on Mezo Testnet (chain {MEZO_TESTNET_ID}) and have no real-world value.
          </p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt>Payment contract</dt>
            <dd>
              {isDeployed ? (
                <a href={explorerAddress(contracts.processor)} target="_blank" rel="noreferrer" className="font-mono text-foreground underline underline-offset-4" title={contracts.processor}>
                  {shortAddress(contracts.processor)}
                </a>
              ) : (
                <span>not deployed yet</span>
              )}
            </dd>
            <dt>MUSD token</dt>
            <dd>
              <a href={explorerAddress(contracts.musd)} target="_blank" rel="noreferrer" className="font-mono text-foreground underline underline-offset-4" title={contracts.musd}>
                {shortAddress(contracts.musd)}
              </a>
            </dd>
          </dl>
          {isDeployed && <p className="text-xs">Source code is verified on the Mezo explorer.</p>}
        </div>
        <nav aria-label="Footer">
          <ul className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm md:grid-cols-1">
            {LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
