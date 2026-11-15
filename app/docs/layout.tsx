import type { ReactNode } from "react";
import { SiteHeader } from "@/components/site/site-header";
import { SiteFooter } from "@/components/site/site-footer";
import { DocsNav } from "@/components/docs/docs-nav";

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      <div className="mx-auto w-full max-w-6xl flex-1 px-4 sm:px-6">
        <div className="border-b py-3 lg:hidden">
          <DocsNav variant="bar" />
        </div>
        <div className="lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-12">
          <aside className="hidden lg:block">
            <div className="sticky top-16 py-10">
              <p className="mb-2 px-3 text-sm font-medium">Documentation</p>
              <DocsNav variant="sidebar" />
            </div>
          </aside>
          <main id="main" className="min-w-0 py-10 lg:py-12">
            {children}
          </main>
        </div>
      </div>
      <SiteFooter />
    </>
  );
}
