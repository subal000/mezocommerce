"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { WEBHOOK_EVENT_TYPES, type WebhookEventType } from "@/lib/chain/payment-state";
import type { CreatedWebhookEndpointDTO, WebhookEndpointDTO } from "@/lib/api-types";
import { errorMessage } from "@/lib/client/api";
import { formatDateTime, relativeTime } from "@/lib/client/format";
import { DELIVERY_STATUS } from "@/lib/client/status";
import { pageInfo } from "@/lib/client/pagination";
import { EVENT_LABEL } from "@/lib/client/timeline";
import { webhookUrlError } from "@/lib/client/forms";
import { useCreateWebhook, useDeleteWebhook, useDeliveries, useRetryDelivery, useTestWebhook, useWebhooks } from "@/hooks/use-api";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Panel } from "@/components/shared/page-header";
import { QueryError } from "@/components/shared/query-error";
import { EmptyState } from "@/components/shared/empty-state";
import { SecretReveal } from "@/components/shared/secret-reveal";
import { StatusDot } from "@/components/shared/status-badge";
import { DevelopersHeader } from "./developers";
import { Field } from "./field";

const SELECTABLE = WEBHOOK_EVENT_TYPES.filter((t) => t !== "ping");

function AddEndpointDialog() {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [all, setAll] = useState(true);
  const [types, setTypes] = useState<WebhookEventType[]>(["payment.confirmed", "payment.refunded"]);
  const [touched, setTouched] = useState(false);
  const [created, setCreated] = useState<CreatedWebhookEndpointDTO | null>(null);
  const create = useCreateWebhook();
  const urlErr = webhookUrlError(url);
  const typesErr = !all && types.length === 0 ? "Pick at least one event." : null;

  function close() {
    setOpen(false);
    setCreated(null);
    setUrl("");
    setTouched(false);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : created ? undefined : close())}>
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden /> Add endpoint
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg" showCloseButton={!created}>
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>Endpoint added</DialogTitle>
            </DialogHeader>
            <SecretReveal
              secret={created.secret}
              title="Signing secret"
              body="Use it to check the MezoCommerce-Signature header on every delivery. This is the only time you'll see it."
              onDone={close}
            />
          </>
        ) : (
          <form
            noValidate
            className="grid gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setTouched(true);
              if (urlErr || typesErr) return;
              try {
                setCreated(await create.mutateAsync({ url: url.trim(), event_types: all ? ["*"] : types }));
              } catch (err) {
                toast.error("Couldn't add the endpoint", { description: errorMessage(err) });
              }
            }}
          >
            <DialogHeader>
              <DialogTitle>Add webhook endpoint</DialogTitle>
              <DialogDescription>We POST signed JSON to this URL when a payment changes. Respond with a 2xx within 5 seconds.</DialogDescription>
            </DialogHeader>
            <Field id="wh-url" label="Endpoint URL" error={touched ? (urlErr ?? undefined) : undefined}>
              <Input
                id="wh-url"
                type="url"
                inputMode="url"
                placeholder="https://yourstore.com/webhooks/mezo"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                aria-invalid={touched && !!urlErr}
                aria-describedby={touched && urlErr ? "wh-url-error" : undefined}
                autoFocus
              />
            </Field>
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">Events</legend>
              <div className="flex items-center gap-2">
                <Checkbox id="wh-all" checked={all} onCheckedChange={(v) => setAll(v === true)} />
                <Label htmlFor="wh-all" className="font-normal">
                  All events
                </Label>
              </div>
              {!all ? (
                <div className="grid gap-2 pl-6 sm:grid-cols-2">
                  {SELECTABLE.map((t) => (
                    <div key={t} className="flex items-start gap-2">
                      <Checkbox
                        id={`wh-${t}`}
                        checked={types.includes(t)}
                        onCheckedChange={(v) => setTypes((cur) => (v === true ? [...cur, t] : cur.filter((x) => x !== t)))}
                      />
                      <Label htmlFor={`wh-${t}`} className="block font-normal leading-snug">
                        <span className="font-mono text-[0.8125rem]">{t}</span>
                        <span className="block text-xs text-muted-foreground">{EVENT_LABEL[t]}</span>
                      </Label>
                    </div>
                  ))}
                </div>
              ) : null}
              {touched && typesErr ? (
                <p role="alert" className="text-xs text-bad">
                  {typesErr}
                </p>
              ) : null}
            </fieldset>
            <DialogFooter>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? "Adding…" : "Add endpoint"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function EndpointRow({ ep }: { ep: WebhookEndpointDTO }) {
  const test = useTestWebhook();
  const del = useDeleteWebhook();
  const [confirm, setConfirm] = useState(false);
  return (
    <li className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="truncate font-mono text-[0.8125rem]" title={ep.url}>
          {ep.url}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <StatusDot meta={ep.status === "active" ? { label: "Active", tone: "ok", hint: "" } : { label: "Disabled", tone: "idle", hint: "" }} className="text-xs" />
          <span>{ep.event_types.includes("*") ? "All events" : ep.event_types.join(", ")}</span>
          <span>Added {relativeTime(ep.created_at)}</span>
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={test.isPending}
          onClick={() =>
            test.mutate(ep.id, {
              onSuccess: () => toast.success("Test event sent", { description: "Check the delivery log below." }),
              onError: (e) => toast.error("Couldn't send a test", { description: errorMessage(e) }),
            })
          }
        >
          {test.isPending ? "Sending…" : "Send test"}
        </Button>
        <Dialog open={confirm} onOpenChange={(v) => !del.isPending && setConfirm(v)}>
          <DialogTrigger asChild>
            <Button variant="ghost" size="sm">
              Delete
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Delete this endpoint?</DialogTitle>
              <DialogDescription className="break-all">{ep.url} stops getting events. Pending retries are dropped.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setConfirm(false)}>
                Keep it
              </Button>
              <Button
                variant="destructive"
                disabled={del.isPending}
                onClick={() =>
                  del.mutate(ep.id, {
                    onSuccess: () => {
                      toast.success("Endpoint deleted");
                      setConfirm(false);
                    },
                    onError: (e) => toast.error("Couldn't delete it", { description: errorMessage(e) }),
                  })
                }
              >
                {del.isPending ? "Deleting…" : "Delete endpoint"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </li>
  );
}

function Deliveries() {
  const [page, setPage] = useState(1);
  const q = useDeliveries(page);
  const retry = useRetryDelivery();
  const d = q.data;
  const info = d ? pageInfo(d.page, d.page_size || 1, d.total) : null;
  return (
    <Panel id="deliveries" title="Delivery log" description="Every attempt to reach your endpoints. Failed deliveries retry 5 times with growing gaps." bodyClassName="px-4 py-2 sm:px-5">
      {q.isLoading ? (
        <div className="space-y-2 py-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : q.isError ? (
        <div className="py-3">
          <QueryError error={q.error} onRetry={() => void q.refetch()} title="Couldn't load deliveries" />
        </div>
      ) : !d || d.data.length === 0 ? (
        <p className="py-3 text-sm text-muted-foreground">No deliveries yet. Send a test to see one here.</p>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Response</TableHead>
                <TableHead className="text-right">Attempts</TableHead>
                <TableHead>When</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.data.map((x) => (
                <TableRow key={x.id}>
                  <TableCell>
                    <span className="block font-mono text-[0.8125rem]">{x.event_type}</span>
                    <span className="block max-w-56 truncate text-xs text-muted-foreground" title={x.endpoint_url}>
                      {x.endpoint_url}
                    </span>
                  </TableCell>
                  <TableCell>
                    <StatusDot meta={DELIVERY_STATUS[x.status]} />
                    {x.status === "pending" && x.next_retry_at ? <span className="block text-xs text-muted-foreground">Retry {relativeTime(x.next_retry_at)}</span> : null}
                  </TableCell>
                  <TableCell className="text-[0.8125rem]">
                    {x.response_status ? <span className="num">HTTP {x.response_status}</span> : <span className="text-muted-foreground">No response</span>}
                    {x.last_error ? (
                      <span className="block max-w-56 truncate text-xs text-muted-foreground" title={x.last_error}>
                        {x.last_error}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="num text-right">{x.attempt_count}</TableCell>
                  <TableCell className="text-[0.8125rem] whitespace-nowrap text-muted-foreground" title={formatDateTime(x.created_at)}>
                    {relativeTime(x.delivered_at ?? x.created_at)}
                  </TableCell>
                  <TableCell className="text-right">
                    {x.status === "failed" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={retry.isPending && retry.variables === x.id}
                        onClick={() =>
                          retry.mutate(x.id, {
                            onSuccess: () => toast.success("Queued for retry"),
                            onError: (e) => toast.error("Couldn't retry", { description: errorMessage(e) }),
                          })
                        }
                      >
                        Retry
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {info && info.pages > 1 ? (
            <nav aria-label="Delivery pages" className="flex items-center justify-between gap-3 border-t py-3 text-sm">
              <p className="num text-muted-foreground">
                {info.from}-{info.to} of {d.total}
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={!info.hasPrev} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <Button size="sm" variant="outline" disabled={!info.hasNext} onClick={() => setPage((p) => p + 1)}>
                  Next
                </Button>
              </div>
            </nav>
          ) : null}
        </>
      )}
    </Panel>
  );
}

export function WebhooksView() {
  const eps = useWebhooks();
  const list = eps.data ?? [];
  return (
    <div className="space-y-6">
      <DevelopersHeader />
      <Panel title="Endpoints" description="Fulfil orders on payment.confirmed. Check the signature first." actions={<AddEndpointDialog />} bodyClassName="px-4 py-1 sm:px-5">
        {eps.isLoading ? (
          <div className="py-3">
            <Skeleton className="h-12 w-full" />
          </div>
        ) : eps.isError ? (
          <div className="py-3">
            <QueryError error={eps.error} onRetry={() => void eps.refetch()} title="Couldn't load endpoints" />
          </div>
        ) : list.length === 0 ? (
          <EmptyState className="my-3" title="No endpoints yet" body="Add one so your store hears about paid orders without polling." />
        ) : (
          <ul className="divide-y">
            {list.map((ep) => (
              <EndpointRow key={ep.id} ep={ep} />
            ))}
          </ul>
        )}
      </Panel>
      <Deliveries />
    </div>
  );
}
