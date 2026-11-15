"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import type { ShopifyConnectionDTO } from "@/lib/api-types";
import { errorMessage } from "@/lib/client/api";
import { shopifyFormErrors } from "@/lib/client/forms";
import { formatDateTime } from "@/lib/client/format";
import { intentStatusMeta, SHOPIFY_SYNC_STATUS } from "@/lib/client/status";
import { useConnectShopify, useDisconnectShopify, useShopify, useShopifyOrders } from "@/hooks/use-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DetailList, PageHeader, Panel } from "@/components/shared/page-header";
import { QueryError } from "@/components/shared/query-error";
import { CopyButton } from "@/components/shared/copy-button";
import { StatusDot } from "@/components/shared/status-badge";
import { Field } from "./field";

function ConnectForm() {
  const connect = useConnectShopify();
  const [v, setV] = useState({ shop_domain: "", admin_access_token: "", webhook_secret: "", payment_method_name: "Pay with MUSD" });
  const [touched, setTouched] = useState(false);
  const errs = shopifyFormErrors(v);
  const show = (k: keyof typeof errs) => (touched ? errs[k] : undefined);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV((s) => ({ ...s, [k]: e.target.value }));

  return (
    <form
      noValidate
      className="grid max-w-xl gap-5"
      onSubmit={async (e) => {
        e.preventDefault();
        setTouched(true);
        if (Object.keys(errs).length) return;
        try {
          await connect.mutateAsync({
            shop_domain: v.shop_domain.trim().toLowerCase(),
            admin_access_token: v.admin_access_token.trim(),
            webhook_secret: v.webhook_secret.trim(),
            payment_method_name: v.payment_method_name.trim() || undefined,
          });
          toast.success("Shopify connected");
        } catch (err) {
          toast.error("Couldn't connect Shopify", { description: errorMessage(err) });
        }
      }}
    >
      <Field id="shop_domain" label="Shop domain" error={show("shop_domain")}>
        <Input id="shop_domain" placeholder="your-store.myshopify.com" spellCheck={false} autoComplete="off" value={v.shop_domain} onChange={set("shop_domain")} aria-invalid={!!show("shop_domain")} aria-describedby={show("shop_domain") ? "shop_domain-error" : undefined} />
      </Field>
      <Field id="admin_access_token" label="Admin API access token" hint="From your custom app, with read_orders and write_orders. Stored encrypted." error={show("admin_access_token")}>
        <Input id="admin_access_token" type="password" autoComplete="off" placeholder="shpat_…" value={v.admin_access_token} onChange={set("admin_access_token")} aria-invalid={!!show("admin_access_token")} aria-describedby={show("admin_access_token") ? "admin_access_token-error" : "admin_access_token-hint"} />
      </Field>
      <Field id="webhook_secret" label="API secret key" hint="Used to check that order webhooks really come from Shopify." error={show("webhook_secret")}>
        <Input id="webhook_secret" type="password" autoComplete="off" value={v.webhook_secret} onChange={set("webhook_secret")} aria-invalid={!!show("webhook_secret")} aria-describedby={show("webhook_secret") ? "webhook_secret-error" : "webhook_secret-hint"} />
      </Field>
      <Field id="payment_method_name" label="Manual payment method name" hint="Must match the name customers pick at Shopify checkout exactly.">
        <Input id="payment_method_name" value={v.payment_method_name} onChange={set("payment_method_name")} aria-describedby="payment_method_name-hint" />
      </Field>
      <div>
        <Button type="submit" disabled={connect.isPending}>
          {connect.isPending ? "Connecting…" : "Connect Shopify"}
        </Button>
      </div>
    </form>
  );
}

function CopyRow({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="grid gap-1.5">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex items-center gap-2 rounded-lg border bg-surface p-2 pl-3">
        <code className="min-w-0 flex-1 truncate font-mono text-[0.8125rem]" title={value}>
          {value}
        </code>
        <CopyButton value={value} text="Copy" />
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function Connected({ c }: { c: ShopifyConnectionDTO }) {
  const orders = useShopifyOrders();
  const disconnect = useDisconnectShopify();
  const [confirm, setConfirm] = useState(false);
  const status =
    c.status === "active"
      ? { label: "Connected", tone: "ok" as const, hint: "" }
      : c.status === "error"
        ? { label: "Needs attention", tone: "bad" as const, hint: c.last_error ?? "" }
        : { label: "Disconnected", tone: "idle" as const, hint: "" };
  return (
    <>
      <Panel
        title={c.shop_domain}
        actions={
          <Dialog open={confirm} onOpenChange={(v) => !disconnect.isPending && setConfirm(v)}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="sm">
                Disconnect
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Disconnect Shopify?</DialogTitle>
                <DialogDescription>New Shopify orders won&apos;t get MUSD payment links, and paid orders won&apos;t be marked paid in Shopify. Existing payments keep working.</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setConfirm(false)}>
                  Stay connected
                </Button>
                <Button
                  variant="destructive"
                  disabled={disconnect.isPending}
                  onClick={() =>
                    disconnect.mutate(undefined, {
                      onSuccess: () => {
                        toast.success("Shopify disconnected");
                        setConfirm(false);
                      },
                      onError: (e) => toast.error("Couldn't disconnect", { description: errorMessage(e) }),
                    })
                  }
                >
                  {disconnect.isPending ? "Disconnecting…" : "Disconnect"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <DetailList
            items={[
              { label: "Status", value: <StatusDot meta={status} />, hint: c.status === "error" ? c.last_error : undefined },
              { label: "Payment method", value: c.payment_method_name },
              { label: "Connected", value: formatDateTime(c.created_at) },
            ]}
          />
          <div className="grid gap-5">
            <CopyRow label="Order webhook URL" value={c.webhook_url} hint="In Shopify: Settings, Notifications, Webhooks. Event: Order creation, format JSON." />
            <CopyRow label="Pay link template" value={c.pay_link_template} hint="Put this on the order status page or in the order confirmation email." />
          </div>
        </div>
      </Panel>
      <Panel title="Synced orders" description="Shopify orders that chose MUSD. Each is marked paid in Shopify once, after the payment confirms." bodyClassName="px-4 py-2 sm:px-5">
        {orders.isLoading ? (
          <Skeleton className="my-2 h-10 w-full" />
        ) : orders.isError ? (
          <div className="py-3">
            <QueryError error={orders.error} onRetry={() => void orders.refetch()} title="Couldn't load orders" />
          </div>
        ) : !orders.data?.length ? (
          <p className="py-3 text-sm text-muted-foreground">No MUSD orders yet. They show up after a customer picks &ldquo;{c.payment_method_name}&rdquo; at checkout.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Payment</TableHead>
                <TableHead>Shopify</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.data.map((o) => (
                <TableRow key={o.shopify_order_id}>
                  <TableCell className="font-medium">{o.order_name}</TableCell>
                  <TableCell>
                    {o.payment_intent_id && o.intent_status ? (
                      <Link href={`/merchant/payments/${encodeURIComponent(o.payment_intent_id)}`} className="underline-offset-4 hover:underline">
                        <StatusDot meta={intentStatusMeta(o.intent_status)} />
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">Not created</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusDot meta={SHOPIFY_SYNC_STATUS[o.sync_status]} />
                    {o.last_error ? (
                      <span className="block max-w-56 truncate text-xs text-muted-foreground" title={o.last_error}>
                        {o.last_error}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-[0.8125rem] whitespace-nowrap text-muted-foreground">{formatDateTime(o.created_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>
    </>
  );
}

export function ShopifyView() {
  const q = useShopify();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Shopify"
        description="Take MUSD for Shopify orders through a custom app and a manual payment method. This isn't a Shopify-approved payment gateway: customers pick “Pay with MUSD” at checkout, then pay on a MezoCommerce page."
        actions={
          <Button asChild variant="outline">
            <Link href="/docs/shopify">Setup guide</Link>
          </Button>
        }
      />
      {q.isLoading ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : q.isError ? (
        <QueryError error={q.error} onRetry={() => void q.refetch()} title="Couldn't load your Shopify connection" />
      ) : q.data && q.data.status !== "disconnected" ? (
        <Connected c={q.data} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <Panel title="Connect your store">
            <ConnectForm />
          </Panel>
          <Panel title="Before you start">
            <ol className="list-decimal space-y-3 pl-4 text-sm marker:text-muted-foreground">
              <li>In Shopify, add a manual payment method named &ldquo;Pay with MUSD&rdquo;.</li>
              <li>Create a custom app with the read_orders and write_orders Admin API scopes, then install it.</li>
              <li>Copy the Admin API access token and the API secret key into this form.</li>
              <li>After connecting, add the order webhook and the pay link we give you.</li>
            </ol>
            <p className="mt-4 text-[0.8125rem] text-muted-foreground">Orders must be in USD. They&apos;re charged at 1 USD = 1 MUSD.</p>
          </Panel>
        </div>
      )}
    </div>
  );
}
