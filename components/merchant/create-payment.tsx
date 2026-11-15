"use client";

import { useState } from "react";
import Link from "next/link";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ExternalLink } from "lucide-react";
import { toast } from "sonner";
import type { PaymentIntentDTO } from "@/lib/api-types";
import { ApiClientError, errorMessage } from "@/lib/client/api";
import { createPaymentSchema, EXPIRY_OPTIONS, orNull, type CreatePaymentValues } from "@/lib/client/forms";
import { formatDateTime } from "@/lib/client/format";
import { useCreateIntent } from "@/hooks/use-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader, Panel } from "@/components/shared/page-header";
import { CopyButton } from "@/components/shared/copy-button";
import { QrCode } from "@/components/shared/qr-code";
import { MusdDisplay } from "@/components/shared/money";
import { StatusBadge } from "@/components/shared/status-badge";
import { Field, describedBy } from "./field";

function newOrderId(): string {
  const d = new Date();
  const stamp = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  return `order-${stamp}-${Math.random().toString(36).slice(2, 7)}`;
}

/** 409 order_has_open_intent carries the existing intent in details. */
function existingIntent(err: unknown): PaymentIntentDTO | null {
  if (!(err instanceof ApiClientError) || err.code !== "order_has_open_intent") return null;
  const d = err.details as { payment_intent?: PaymentIntentDTO } | PaymentIntentDTO | undefined;
  if (d && "checkout_url" in d) return d;
  return (d as { payment_intent?: PaymentIntentDTO } | undefined)?.payment_intent ?? null;
}

function Result({ intent, reused, onAnother }: { intent: PaymentIntentDTO; reused: boolean; onAnother: () => void }) {
  return (
    <Panel title={reused ? "This order already has an open payment" : "Payment link ready"} description={reused ? "We reused it instead of making a second one." : "Send the link, or let the customer scan the code."}>
      <div className="grid gap-6 sm:grid-cols-[auto_1fr]">
        <QrCode value={intent.checkout_url} size={176} label={`QR code for the checkout of order ${intent.merchant_order_id}`} />
        <div className="min-w-0 space-y-4">
          <div>
            <p className="text-[0.8125rem] text-muted-foreground">Order {intent.merchant_order_id}</p>
            <p className="mt-1 text-2xl font-semibold tracking-[-0.01em]">
              <MusdDisplay value={intent.amount_display} />
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8125rem] text-muted-foreground">
              <StatusBadge status={intent.status} />
              <span>Expires {formatDateTime(intent.expires_at)}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-lg border bg-surface p-2 pl-3">
            <code className="min-w-0 flex-1 truncate font-mono text-[0.8125rem]" title={intent.checkout_url}>
              {intent.checkout_url}
            </code>
            <CopyButton value={intent.checkout_url} text="Copy link" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <a href={intent.checkout_url} target="_blank" rel="noreferrer">
                Open checkout <ExternalLink aria-hidden />
              </a>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/merchant/payments/${encodeURIComponent(intent.id)}`}>View payment</Link>
            </Button>
            <Button size="sm" variant="ghost" onClick={onAnother}>
              Create another
            </Button>
          </div>
        </div>
      </div>
    </Panel>
  );
}

export function CreatePayment() {
  const create = useCreateIntent();
  const [result, setResult] = useState<{ intent: PaymentIntentDTO; reused: boolean } | null>(null);
  const form = useForm<CreatePaymentValues>({
    resolver: zodResolver(createPaymentSchema),
    defaultValues: { merchant_order_id: newOrderId(), amount: "", description: "", expires_in_seconds: "1800", payer_address: "", return_url: "" },
  });
  const e = form.formState.errors;

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      const intent = await create.mutateAsync({
        merchant_order_id: v.merchant_order_id.trim(),
        amount: v.amount.trim().replace(/,/g, ""),
        currency: "MUSD",
        description: v.description.trim() || undefined,
        expires_in_seconds: Number(v.expires_in_seconds),
        payer_address: orNull(v.payer_address)?.toLowerCase() ?? null,
        return_url: orNull(v.return_url),
        metadata: { source: "dashboard" },
      });
      setResult({ intent, reused: false });
    } catch (err) {
      const existing = existingIntent(err);
      if (existing) setResult({ intent: existing, reused: true });
      else toast.error("Couldn't create the payment", { description: errorMessage(err) });
    }
  });

  return (
    <>
      <PageHeader title="Create payment" description="Make a one-off payment link for an order. The customer pays from their wallet, straight to your payout wallet." />
      <div aria-live="polite">
        {result ? (
          <Result
            intent={result.intent}
            reused={result.reused}
            onAnother={() => {
              setResult(null);
              form.reset({ merchant_order_id: newOrderId(), amount: "", description: "", expires_in_seconds: "1800", payer_address: "", return_url: "" });
            }}
          />
        ) : null}
      </div>
      {!result ? (
        <Panel>
          <form onSubmit={onSubmit} noValidate className="grid max-w-2xl gap-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field id="amount" label="Amount (MUSD)" hint="MUSD is pegged to the US dollar. 1 MUSD is about $1." error={e.amount?.message}>
                <Input id="amount" inputMode="decimal" placeholder="25.00" autoComplete="off" className="num" aria-invalid={!!e.amount} aria-describedby={describedBy("amount", e.amount?.message, true)} {...form.register("amount")} />
              </Field>
              <Field id="merchant_order_id" label="Order ID" hint="Your own reference. One open payment per order." error={e.merchant_order_id?.message}>
                <Input id="merchant_order_id" spellCheck={false} className="font-mono text-[0.8125rem]" aria-invalid={!!e.merchant_order_id} aria-describedby={describedBy("merchant_order_id", e.merchant_order_id?.message, true)} {...form.register("merchant_order_id")} />
              </Field>
            </div>
            <Field id="description" label="What it's for" optional hint="Shown to the customer at checkout." error={e.description?.message}>
              <Textarea id="description" rows={2} aria-invalid={!!e.description} aria-describedby={describedBy("description", e.description?.message, true)} {...form.register("description")} />
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field id="expires" label="Link expires after">
                <Controller
                  control={form.control}
                  name="expires_in_seconds"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="expires" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {EXPIRY_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
              <Field id="return_url" label="Send customer back to" optional hint="Where checkout returns after payment." error={e.return_url?.message}>
                <Input id="return_url" type="url" inputMode="url" placeholder="https://yourstore.com/thanks" aria-invalid={!!e.return_url} aria-describedby={describedBy("return_url", e.return_url?.message, true)} {...form.register("return_url")} />
              </Field>
            </div>
            <Field id="payer_address" label="Only this wallet can pay" optional hint="Leave empty so any wallet can pay." error={e.payer_address?.message}>
              <Input id="payer_address" spellCheck={false} autoComplete="off" placeholder="0x…" className="font-mono text-[0.8125rem]" aria-invalid={!!e.payer_address} aria-describedby={describedBy("payer_address", e.payer_address?.message, true)} {...form.register("payer_address")} />
            </Field>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? "Creating…" : "Create payment link"}
              </Button>
              <p className="text-xs text-muted-foreground">No wallet prompt. MezoCommerce signs the checkout for you.</p>
            </div>
          </form>
        </Panel>
      ) : null}
    </>
  );
}
