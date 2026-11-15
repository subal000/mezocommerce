"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import type { Address } from "viem";
import type { MerchantDTO } from "@/lib/api-types";
import { errorMessage } from "@/lib/client/api";
import { ADDRESS_RE, HEX_COLOR_RE, orNull, profileSchema, type ProfileValues } from "@/lib/client/forms";
import { build } from "@/lib/client/writes";
import { textOn } from "@/lib/client/color";
import { confirmMerchantTx, useUpdateMerchant } from "@/hooks/use-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { AddressText } from "@/components/shared/address";
import { DetailList, PageHeader, Panel } from "@/components/shared/page-header";
import { StatusDot } from "@/components/shared/status-badge";
import { useMerchantCtx } from "./merchant-context";
import { ActionDialog } from "./action-dialog";
import { Field, describedBy } from "./field";

function ProfileForm({ m }: { m: MerchantDTO }) {
  const update = useUpdateMerchant();
  const form = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { name: m.name, website: m.website ?? "", logo_url: m.logo_url ?? "", description: m.description ?? "", support_email: m.support_email ?? "" },
  });
  const e = form.formState.errors;
  return (
    <form
      noValidate
      className="grid max-w-2xl gap-5"
      onSubmit={form.handleSubmit(async (v) => {
        try {
          await update.mutateAsync({ name: v.name.trim(), description: v.description.trim(), website: orNull(v.website), logo_url: orNull(v.logo_url), support_email: orNull(v.support_email) });
          form.reset(v);
          toast.success("Profile saved");
        } catch (err) {
          toast.error("Couldn't save", { description: errorMessage(err) });
        }
      })}
    >
      <Field id="s-name" label="Store name" error={e.name?.message}>
        <Input id="s-name" aria-invalid={!!e.name} aria-describedby={describedBy("s-name", e.name?.message)} {...form.register("name")} />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="s-website" label="Website" optional error={e.website?.message}>
          <Input id="s-website" type="url" aria-invalid={!!e.website} aria-describedby={describedBy("s-website", e.website?.message)} {...form.register("website")} />
        </Field>
        <Field id="s-email" label="Support email" optional error={e.support_email?.message}>
          <Input id="s-email" type="email" aria-invalid={!!e.support_email} aria-describedby={describedBy("s-email", e.support_email?.message)} {...form.register("support_email")} />
        </Field>
      </div>
      <Field id="s-logo" label="Logo URL" optional error={e.logo_url?.message}>
        <Input id="s-logo" type="url" aria-invalid={!!e.logo_url} aria-describedby={describedBy("s-logo", e.logo_url?.message)} {...form.register("logo_url")} />
      </Field>
      <Field id="s-desc" label="Short description" optional error={e.description?.message}>
        <Textarea id="s-desc" rows={3} aria-invalid={!!e.description} aria-describedby={describedBy("s-desc", e.description?.message)} {...form.register("description")} />
      </Field>
      <div>
        <Button type="submit" disabled={update.isPending || !form.formState.isDirty}>
          {update.isPending ? "Saving…" : "Save profile"}
        </Button>
      </div>
    </form>
  );
}

function Branding({ m }: { m: MerchantDTO }) {
  const update = useUpdateMerchant();
  const [color, setColor] = useState(m.brand_color || "#2f8a6c");
  const valid = HEX_COLOR_RE.test(color);
  const fg = textOn(color);
  return (
    <div className="grid gap-6 md:grid-cols-[1fr_18rem]">
      <div className="grid content-start gap-4">
        <Field id="brand-hex" label="Checkout colour" hint="Used for the pay button and header on your checkout page." error={valid ? undefined : "Use a hex colour like #2f8a6c."}>
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label="Pick checkout colour"
              value={valid ? color : "#000000"}
              onChange={(e) => setColor(e.target.value)}
              className="h-9 w-12 cursor-pointer rounded-md border border-input bg-transparent p-1"
            />
            <Input id="brand-hex" value={color} onChange={(e) => setColor(e.target.value.trim())} className="w-32 font-mono text-[0.8125rem]" maxLength={7} aria-invalid={!valid} aria-describedby={valid ? "brand-hex-hint" : "brand-hex-error"} />
          </div>
        </Field>
        <div>
          <Button
            disabled={!valid || color.toLowerCase() === (m.brand_color || "").toLowerCase() || update.isPending}
            onClick={() =>
              update.mutate(
                { brand_color: color.toLowerCase() },
                { onSuccess: () => toast.success("Checkout colour saved"), onError: (e) => toast.error("Couldn't save", { description: errorMessage(e) }) },
              )
            }
          >
            {update.isPending ? "Saving…" : "Save colour"}
          </Button>
        </div>
      </div>
      <figure className="m-0">
        <div aria-hidden className="overflow-hidden rounded-xl border bg-card shadow-panel">
          <div className="h-1.5" style={{ background: valid ? color : undefined }} />
          <div className="space-y-3 p-4">
            <div className="flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {m.logo_url ? <img src={m.logo_url} alt="" className="size-6 rounded object-cover" /> : <span className="size-6 rounded" style={{ background: valid ? color : undefined }} />}
              <span className="text-sm font-medium">{m.name}</span>
            </div>
            <p className="num text-2xl font-semibold">
              25.00 <span className="text-sm font-normal text-muted-foreground">MUSD</span>
            </p>
            <div className="flex h-9 items-center justify-center rounded-md text-sm font-medium" style={{ background: valid ? color : undefined, color: fg }}>
              Pay 25.00 MUSD
            </div>
          </div>
        </div>
        <figcaption className="mt-2 text-xs text-muted-foreground">Preview. Text colour adjusts for contrast.</figcaption>
      </figure>
    </div>
  );
}

function Notifications({ m }: { m: MerchantDTO }) {
  const update = useUpdateMerchant();
  const rows = [
    { key: "notify_payment" as const, label: "Payment confirmed", hint: "When an order is paid and confirmed on-chain." },
    { key: "notify_failure" as const, label: "Problems", hint: "Failed payment transactions and webhook deliveries that keep failing." },
    { key: "notify_refund" as const, label: "Refunds", hint: "When a refund is confirmed on-chain." },
  ];
  return (
    <ul className="divide-y">
      {rows.map((r) => (
        <li key={r.key} className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
          <div>
            <Label htmlFor={r.key}>{r.label}</Label>
            <p id={`${r.key}-hint`} className="mt-1 text-[0.8125rem] text-muted-foreground">
              {r.hint}
            </p>
          </div>
          <Switch
            id={r.key}
            aria-describedby={`${r.key}-hint`}
            checked={m[r.key]}
            disabled={update.isPending}
            onCheckedChange={(v) => update.mutate({ [r.key]: v }, { onError: (e) => toast.error("Couldn't save", { description: errorMessage(e) }) })}
          />
        </li>
      ))}
    </ul>
  );
}

function OnchainSettings({ m, deployed, signer }: { m: MerchantDTO; deployed: boolean; signer: string | null }) {
  const [payout, setPayout] = useState("");
  const id = m.onchain_merchant_id ? BigInt(m.onchain_merchant_id) : null;
  const payoutValid = ADDRESS_RE.test(payout.trim()) && payout.trim().toLowerCase() !== (m.payout_address ?? "").toLowerCase();
  const record = (hash: string) => confirmMerchantTx(hash);
  const common = { deployed, owner: m.owner_address, payout: m.payout_address, role: "owner" as const };
  const notRegistered = id === null;

  return (
    <div className="space-y-5">
      <DetailList
        items={[
          { label: "Owner wallet", value: <AddressText address={m.owner_address} />, hint: "Only this wallet can change the settings below." },
          { label: "On-chain store ID", value: m.onchain_merchant_id ? <span className="num">{m.onchain_merchant_id}</span> : "Not registered" },
        ]}
      />
      <ul className="divide-y rounded-lg border">
        <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium">Payout wallet</p>
            <div className="mt-0.5">
              <AddressText address={m.payout_address} />
            </div>
          </div>
          <ActionDialog
            {...common}
            trigger={
              <Button variant="outline" size="sm" disabled={notRegistered}>
                Change
              </Button>
            }
            title="Change payout wallet"
            body="New payments go to the new wallet. Open checkouts created for the old wallet stop working, so customers need a fresh link."
            walletAsk="Your owner wallet sends one transaction that updates the payout wallet on-chain."
            confirmLabel="Change payout wallet"
            disabled={!payoutValid}
            onConfirm={async (tx) => !!(id !== null && (await tx.run(build.setPayout(id, payout.trim() as Address), { record, successMessage: "Payout wallet changed" })))}
          >
            <Field id="new-payout" label="New payout wallet" error={payout && !ADDRESS_RE.test(payout.trim()) ? "Enter a wallet address (0x followed by 40 characters)." : undefined}>
              <Input id="new-payout" value={payout} onChange={(e) => setPayout(e.target.value)} placeholder="0x…" spellCheck={false} autoComplete="off" className="font-mono text-[0.8125rem]" />
            </Field>
          </ActionDialog>
        </li>
        <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium">MezoCommerce signs checkouts</p>
            <p className="mt-0.5 text-[0.8125rem] text-muted-foreground">
              Needed for payment links and the API. Turning it off stops new checkouts from working. The signer can never move or redirect your money.
            </p>
            <StatusDot className="mt-1" meta={m.platform_signer_enabled ? { label: "On", tone: "ok", hint: "" } : { label: "Off", tone: "warn", hint: "" }} />
          </div>
          <ActionDialog
            {...common}
            trigger={
              <Button variant="outline" size="sm" disabled={notRegistered || !signer}>
                {m.platform_signer_enabled ? "Turn off" : "Turn on"}
              </Button>
            }
            title={m.platform_signer_enabled ? "Stop MezoCommerce signing checkouts?" : "Let MezoCommerce sign checkouts"}
            body={m.platform_signer_enabled ? "Checkout links and API payments stop working until you turn it back on." : "Payment links and API checkouts start working again."}
            walletAsk="Your owner wallet sends one transaction that updates which keys may sign checkouts for your store."
            confirmLabel={m.platform_signer_enabled ? "Turn off" : "Turn on"}
            destructive={m.platform_signer_enabled}
            onConfirm={async (tx) => !!(id !== null && signer && (await tx.run(build.setSigner(id, signer as Address, !m.platform_signer_enabled), { record })))}
          />
        </li>
        <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium">Accept payments</p>
            <p className="mt-0.5 text-[0.8125rem] text-muted-foreground">Pausing blocks new payments on-chain. Refunds still work.</p>
            <StatusDot className="mt-1" meta={m.chain_active ? { label: "Accepting", tone: "ok", hint: "" } : { label: "Paused", tone: "warn", hint: "" }} />
          </div>
          <ActionDialog
            {...common}
            trigger={
              <Button variant="outline" size="sm" disabled={notRegistered}>
                {m.chain_active ? "Pause" : "Resume"}
              </Button>
            }
            title={m.chain_active ? "Pause payments?" : "Resume payments"}
            body={m.chain_active ? "Customers can't pay any of your checkouts until you resume." : "Customers can pay your checkouts again."}
            walletAsk="Your owner wallet sends one transaction that switches your store on or off on-chain."
            confirmLabel={m.chain_active ? "Pause payments" : "Resume payments"}
            destructive={m.chain_active}
            onConfirm={async (tx) => !!(id !== null && (await tx.run(build.setMerchantActive(id, !m.chain_active), { record })))}
          />
        </li>
      </ul>
    </div>
  );
}

export function SettingsView() {
  const { merchant: m, deployed, config } = useMerchantCtx();
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Your store profile, checkout look and on-chain controls." />
      <Panel title="Store profile" description="Shown to customers at checkout.">
        <ProfileForm m={m} />
      </Panel>
      <Panel title="Checkout branding">
        <Branding m={m} />
      </Panel>
      <Panel title="Wallet and payments" description="These live on-chain, so changing them needs your owner wallet.">
        <OnchainSettings m={m} deployed={deployed} signer={config?.platform_signer ?? null} />
      </Panel>
      <Panel title="Notifications" description="What shows up under the bell.">
        <Notifications m={m} />
      </Panel>
    </div>
  );
}
