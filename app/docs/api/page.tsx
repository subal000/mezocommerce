import type { Metadata } from "next";
import { CodeBlock } from "@/components/shared/code-block";
import { ENDPOINT_GROUPS, ENDPOINTS, ERROR_CODES, type Endpoint, type Field } from "@/components/docs/endpoints";
import { sampleError, json } from "@/components/docs/samples";
import { C, DocTable, DocTitle, H3, List, P, PageFooterNav, Section } from "@/components/docs/prose";
import { SITE } from "@/lib/client/site";
import { cn } from "@/lib/client/utils";

export const metadata: Metadata = {
  title: "API reference",
  description: "MezoCommerce public API: payment intents, payments, refunds, webhooks and health.",
};

function Method({ m }: { m: Endpoint["method"] }) {
  return <span className={cn("font-mono text-[0.8125rem] font-semibold", m === "DELETE" ? "text-bad" : m === "POST" ? "text-brand-ink" : "text-foreground")}>{m}</span>;
}

function Fields({ title, fields }: { title: string; fields: Field[] }) {
  return (
    <div className="space-y-2">
      <H3>{title}</H3>
      <DocTable
        caption={title}
        head={["Field", "Type", "Description"]}
        rows={fields.map((f) => [
          <span key="n" className="font-mono text-[0.8125rem] whitespace-nowrap">
            {f.name}
            {f.required ? <span className="ml-1.5 font-sans text-xs text-muted-foreground">required</span> : null}
          </span>,
          <span key="t" className="font-mono text-xs whitespace-nowrap text-muted-foreground">
            {f.type}
          </span>,
          <span key="d" className="text-foreground/90">
            {f.description}
          </span>,
        ])}
      />
    </div>
  );
}

function EndpointDoc({ e }: { e: Endpoint }) {
  return (
    <section id={e.id} aria-labelledby={`${e.id}-h`} className="scroll-mt-24 space-y-4 border-t py-8">
      <div className="space-y-2">
        <h3 id={`${e.id}-h`} className="text-lg font-semibold tracking-[-0.01em]">
          {e.title}
        </h3>
        <p className="flex flex-wrap items-center gap-2">
          <Method m={e.method} />
          <code className="font-mono text-[0.8125rem] break-all">{e.path}</code>
          {!e.auth ? <span className="text-xs text-muted-foreground">No API key needed</span> : null}
        </p>
        <P>{e.purpose}</P>
      </div>
      {e.params?.length ? <Fields title="Path and query parameters" fields={e.params} /> : null}
      {e.body?.length ? <Fields title="Body" fields={e.body} /> : null}
      <div className="grid gap-3 xl:grid-cols-2">
        <CodeBlock label="curl" code={e.curl} />
        <CodeBlock label={`Response ${e.status}`} code={e.response} className="[&_pre]:max-h-[28rem]" />
      </div>
    </section>
  );
}

export default function ApiReferencePage() {
  return (
    <article>
      <DocTitle
        title="API reference"
        lead={
          <>
            Base URL <C>{SITE.url}</C>. Every request is JSON over https. The API runs on Mezo Testnet; <C>livemode</C> is always false.
          </>
        }
      />

      <Section id="conventions" title="Conventions">
        <List
          items={[
            <>
              Authenticate with <C>Authorization: Bearer mc_test_sk_...</C>. Keys belong to one merchant. Keep them on your server.
            </>,
            <>
              Every POST accepts an <C>Idempotency-Key</C> header. Repeating a request with the same key returns the first result instead of doing the work
              twice.
            </>,
            <>
              <C>amount</C> is an integer string in token units (18 decimals). <C>amount_display</C> is the same value as a decimal string, like{" "}
              <C>&quot;24.5&quot;</C>. Send amounts as decimal strings.
            </>,
            <>Addresses and hashes are lowercase 0x strings. Times are ISO 8601 in UTC. Fields are snake_case.</>,
            <>Lists return {"{ data, page, page_size, total }"}.</>,
          ]}
        />
      </Section>

      <nav aria-label="Endpoints" className="mb-4 rounded-lg border bg-surface p-4">
        <ul className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
          {ENDPOINTS.map((e) => (
            <li key={e.id} className="flex min-w-0 items-baseline gap-2">
              <span className="w-12 shrink-0">
                <Method m={e.method} />
              </span>
              <a href={`#${e.id}`} className="truncate underline-offset-4 hover:underline">
                {e.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {ENDPOINT_GROUPS.map((g) => (
        <section key={g} aria-label={g} className="pt-6">
          <h2 className="text-xl font-semibold tracking-[-0.015em]">{g}</h2>
          {ENDPOINTS.filter((e) => e.group === g).map((e) => (
            <EndpointDoc key={e.id} e={e} />
          ))}
        </section>
      ))}

      <Section id="errors" title="Errors" className="border-t pt-8">
        <P>
          Failed requests return a 4xx or 5xx status with the same body shape. Branch on <C>error.code</C>; <C>message</C> is for people and may change.
        </P>
        <CodeBlock label="409 order_has_open_intent" code={json(sampleError)} />
        <DocTable
          caption="Error codes"
          head={["Status", "Code", "Meaning"]}
          rows={ERROR_CODES.map((c) => [
            <span key="s" className="num">
              {c.status}
            </span>,
            <span key="c" className="font-mono text-[0.8125rem] whitespace-nowrap">
              {c.code}
            </span>,
            c.meaning,
          ])}
        />
      </Section>

      <PageFooterNav prev={{ href: "/docs", label: "Quickstart" }} next={{ href: "/docs/lifecycle", label: "Payment lifecycle" }} />
    </article>
  );
}
