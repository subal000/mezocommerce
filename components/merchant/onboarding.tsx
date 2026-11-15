"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check } from "lucide-react";
import { toast } from "sonner";
import type { Address } from "viem";
import type { CreatedApiKeyDTO, MerchantDTO, PublicConfigDTO, RegistrationParamsDTO } from "@/lib/api-types";
import { errorMessage } from "@/lib/client/api";
import { describeTxError } from "@/lib/client/errors";
import { shortAddress } from "@/lib/client/format";
import { onboardingProfileSchema, orNull, type OnboardingProfileValues } from "@/lib/client/forms";
import { ONBOARDING_STEPS, onchainAction, onboardingStep, stepIndex, type OnboardingStep } from "@/lib/client/onboarding";
import { walletMatches } from "@/lib/client/merchant-wallet";
import { build } from "@/lib/client/writes";
import { cn } from "@/lib/client/utils";
import { confirmMerchantTx, useApiKeys, useCreateApiKey, useCreateMerchant, useRegistration } from "@/hooks/use-api";
import { useAuth } from "@/hooks/use-auth";
import { useTx } from "@/hooks/use-tx";
import { ConnectWalletButton } from "@/components/wallet/connect-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { AddressText } from "@/components/shared/address";
import { TxPanel } from "@/components/shared/tx-panel";
import { NotDeployedNotice } from "@/components/shared/not-deployed";
import { QueryError } from "@/components/shared/query-error";
import { SecretReveal } from "@/components/shared/secret-reveal";
import { DetailList } from "@/components/shared/page-header";
import { Field, describedBy } from "./field";

/** Ordered progress list. Numbers are meaningful here: it's a real sequence. */
function Progress({ step }: { step: OnboardingStep }) {
  const current = stepIndex(step);
  return (
    <ol className="space-y-1" aria-label="Setup progress">
      {ONBOARDING_STEPS.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={s.id} aria-current={active ? "step" : undefined} className="flex items-center gap-3 py-1.5 text-sm">
            <span
              className={cn(
                "num flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium transition-colors duration-200",
                done ? "bg-brand text-brand-foreground" : active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
              )}
            >
              {done ? <Check className="size-3.5" aria-hidden /> : i + 1}
            </span>
            <span className={active ? "font-medium" : done ? "text-foreground" : "text-muted-foreground"}>
              {s.label}
              {done ? <span className="sr-only"> (done)</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function StepShell({ title, body, children }: { title: string; body?: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-xl font-semibold tracking-[-0.015em]">{title}</h2>
      {body ? <p className="mt-1.5 max-w-[60ch] text-sm text-muted-foreground">{body}</p> : null}
      <div className="mt-6">{children}</div>
    </div>
  );
}

function ProfileStep({ defaultPayout }: { defaultPayout: string }) {
  const create = useCreateMerchant();
  const form = useForm<OnboardingProfileValues>({
    resolver: zodResolver(onboardingProfileSchema),
    defaultValues: { name: "", website: "", logo_url: "", description: "", support_email: "", payout_address: defaultPayout },
  });
  const e = form.formState.errors;
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      await create.mutateAsync({
        name: v.name.trim(),
        description: v.description.trim(),
        website: orNull(v.website),
        logo_url: orNull(v.logo_url),
        support_email: orNull(v.support_email),
        payout_address: v.payout_address.trim().toLowerCase(),
      });
      toast.success("Store details saved");
    } catch (err) {
      toast.error("Couldn't save your store", { description: errorMessage(err) });
    }
  });
  return (
    <StepShell title="Tell customers who they're paying" body="This shows on your checkout page. You can change it later in Settings.">
      <form onSubmit={onSubmit} noValidate className="grid gap-5">
        <Field id="name" label="Store name" error={e.name?.message}>
          <Input id="name" autoComplete="organization" aria-invalid={!!e.name} aria-describedby={describedBy("name", e.name?.message)} {...form.register("name")} />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="website" label="Website" optional error={e.website?.message}>
            <Input id="website" type="url" inputMode="url" placeholder="https://yourstore.com" aria-invalid={!!e.website} aria-describedby={describedBy("website", e.website?.message)} {...form.register("website")} />
          </Field>
          <Field id="support_email" label="Support email" optional error={e.support_email?.message}>
            <Input id="support_email" type="email" autoComplete="email" aria-invalid={!!e.support_email} aria-describedby={describedBy("support_email", e.support_email?.message)} {...form.register("support_email")} />
          </Field>
        </div>
        <Field id="logo_url" label="Logo URL" optional hint="A square image works best." error={e.logo_url?.message}>
          <Input id="logo_url" type="url" inputMode="url" placeholder="https://yourstore.com/logo.png" aria-invalid={!!e.logo_url} aria-describedby={describedBy("logo_url", e.logo_url?.message, true)} {...form.register("logo_url")} />
        </Field>
        <Field id="description" label="Short description" optional error={e.description?.message}>
          <Textarea id="description" rows={3} aria-invalid={!!e.description} aria-describedby={describedBy("description", e.description?.message)} {...form.register("description")} />
        </Field>
        <Field
          id="payout_address"
          label="Payout wallet"
          hint="Every payment goes straight to this wallet. It defaults to the wallet you're connected with."
          error={e.payout_address?.message}
        >
          <Input
            id="payout_address"
            spellCheck={false}
            autoComplete="off"
            className="font-mono text-[0.8125rem]"
            aria-invalid={!!e.payout_address}
            aria-describedby={describedBy("payout_address", e.payout_address?.message, true)}
            {...form.register("payout_address")}
          />
        </Field>
        <div>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? "Saving…" : "Save and continue"}
          </Button>
        </div>
      </form>
    </StepShell>
  );
}

function OnchainStep({ merchant, registration, config, deployed }: { merchant: MerchantDTO; registration: RegistrationParamsDTO; config: PublicConfigDTO | null; deployed: boolean }) {
  const tx = useTx();
  const auth = useAuth();
  const action = onchainAction(registration.next);
  const isOwner = walletMatches(auth.wallet.address, merchant.owner_address, null, "owner");
  const merchantId = merchant.onchain_merchant_id ? BigInt(merchant.onchain_merchant_id) : null;
  const signer = (registration.platform_signer || config?.platform_signer || "") as Address;

  async function send() {
    const record = (hash: string) => confirmMerchantTx(hash);
    if (registration.next === "register") {
      await tx.run(build.registerMerchant(registration.payout_address as Address, signer), { record, successMessage: "Store registered on Mezo" });
    } else if (registration.next === "enable_signer" && merchantId !== null) {
      await tx.run(build.setSigner(merchantId, signer, true), { record, successMessage: "Checkout signing allowed" });
    } else if (registration.next === "activate" && merchantId !== null) {
      await tx.run(build.setMerchantActive(merchantId, true), { record, successMessage: "Payments turned on" });
    }
  }

  const blocked = !deployed || !isOwner || !auth.wallet.isReady || tx.isBusy || (registration.next !== "register" && merchantId === null);

  return (
    <StepShell title={action.title} body="This is the only step that sends a transaction. After it, checkout links work without your wallet.">
      <div className="grid gap-5">
        <div className="rounded-lg border bg-card p-4">
          <DetailList
            items={[
              { label: "Payout wallet", value: <AddressText address={registration.payout_address} /> },
              {
                label: "Checkout signer",
                value: <AddressText address={signer || null} />,
                hint: "MezoCommerce's key that signs each checkout. It holds no funds and can't change where payments go.",
              },
              { label: "Payment contract", value: <AddressText address={deployed ? registration.processor_address : null} /> },
            ]}
          />
        </div>
        {!deployed ? (
          <NotDeployedNotice action="Registration" />
        ) : !isOwner ? (
          <p role="alert" className="rounded-lg border border-warn/40 bg-warn/5 px-3 py-2 text-sm">
            Switch your wallet to {shortAddress(merchant.owner_address)}, the wallet you signed in with.
          </p>
        ) : null}
        <TxPanel state={tx.state} description={action.explain} onRetryRecord={tx.retryRecord} />
        <div className="flex flex-wrap gap-2">
          {auth.wallet.network.kind === "wrong-network" ? (
            <Button disabled={auth.wallet.isSwitching} onClick={() => auth.wallet.switchToMezo().catch((e) => toast.error(describeTxError(e).message))}>
              {auth.wallet.isSwitching ? "Switching…" : "Switch to Mezo Testnet"}
            </Button>
          ) : (
            <Button disabled={blocked} onClick={() => void send()}>
              {tx.isBusy ? "Check your wallet…" : tx.state.phase === "error" ? "Try again" : action.title}
            </Button>
          )}
        </div>
      </div>
    </StepShell>
  );
}

function ApiKeyStep({ onCreated, onSkip }: { onCreated: (k: CreatedApiKeyDTO) => void; onSkip: () => void }) {
  const create = useCreateApiKey();
  const [name, setName] = useState("Default");
  return (
    <StepShell title="Create your first API key" body="Your server uses it to create payments. We'll show the full key once, so have somewhere safe to paste it.">
      <form
        className="grid max-w-md gap-5"
        onSubmit={async (ev) => {
          ev.preventDefault();
          try {
            const k = await create.mutateAsync({ name: name.trim() || "Default" });
            onCreated(k);
          } catch (err) {
            toast.error("Couldn't create the key", { description: errorMessage(err) });
          }
        }}
      >
        <Field id="key-name" label="Key name" hint="Just for you, e.g. the server it lives on.">
          <Input id="key-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} aria-describedby="key-name-hint" />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? "Creating…" : "Create API key"}
          </Button>
          <Button type="button" variant="ghost" onClick={onSkip}>
            Skip for now
          </Button>
        </div>
      </form>
    </StepShell>
  );
}

function DoneStep({ onFinish }: { onFinish: () => void }) {
  return (
    <StepShell title="You're ready to take payments" body="Create a payment link from the dashboard, or call the API from your store.">
      <div className="flex flex-wrap gap-2">
        <Button onClick={onFinish}>Go to dashboard</Button>
        <Button asChild variant="outline">
          <Link href="/docs">Read the quickstart</Link>
        </Button>
      </div>
    </StepShell>
  );
}

/**
 * Connect → sign in → store details → on-chain registration → first API key → done.
 * Rendered by the merchant shell until setup is finished (and on /merchant/onboarding).
 */
export function Onboarding({
  merchant,
  config,
  deployed,
  merchantLoading,
  onFinish,
}: {
  merchant: MerchantDTO | null;
  config: PublicConfigDTO | null;
  deployed: boolean;
  merchantLoading: boolean;
  onFinish: () => void;
}) {
  const reduce = useReducedMotion();
  const auth = useAuth();
  const w = auth.wallet;
  const registration = useRegistration(auth.signedIn && !!merchant);
  const keys = useApiKeys(auth.signedIn && !!merchant && registration.data?.next === "ready");
  const [secret, setSecret] = useState<CreatedApiKeyDTO | null>(null);
  const [skippedKey, setSkippedKey] = useState(false);
  const [finished, setFinished] = useState(false);

  const computed = onboardingStep({
    connected: w.isConnected,
    wrongNetwork: w.network.kind === "wrong-network",
    signedIn: auth.signedIn,
    merchant,
    registration: registration.data,
    apiKeyCount: keys.data?.length ?? 0,
    skippedApiKey: skippedKey || finished,
  });
  // Keep the key on screen until it's acknowledged, even though the key count has already gone up.
  const step: OnboardingStep = secret ? "api_key" : computed;
  const loading =
    auth.sessionLoading || (auth.signedIn && merchantLoading) || (step === "onchain" && registration.isLoading) || (computed === "api_key" && keys.isLoading);

  let content: React.ReactNode;
  if (loading) {
    content = (
      <div className="space-y-3" aria-busy="true" aria-label="Loading">
        <Skeleton className="h-6 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
        <Skeleton className="h-9 w-40" />
      </div>
    );
  } else if (step === "connect") {
    content = (
      <StepShell title="Connect the wallet you'll run your store from" body="This wallet becomes your store's owner. It's also your login, so there's no password.">
        <ConnectWalletButton size="default" />
      </StepShell>
    );
  } else if (step === "network") {
    content = (
      <StepShell title="Switch to Mezo Testnet" body="Your wallet is on another network. MezoCommerce runs on Mezo Testnet.">
        <Button disabled={w.isSwitching} onClick={() => w.switchToMezo().catch((e) => toast.error(describeTxError(e).message))}>
          {w.isSwitching ? "Switching…" : "Switch to Mezo Testnet"}
        </Button>
      </StepShell>
    );
  } else if (step === "sign_in") {
    content = (
      <StepShell title="Sign in with your wallet" body="Your wallet will ask you to sign a message. It's free and doesn't send a transaction.">
        <div className="space-y-3">
          <Button
            disabled={auth.signIn.isPending}
            onClick={() => auth.signIn.mutate(undefined, { onError: (e) => toast.error("Sign-in failed", { description: describeTxError(e).message }) })}
          >
            {auth.signIn.isPending ? "Check your wallet…" : "Sign in"}
          </Button>
          <p className="text-[0.8125rem] text-muted-foreground" aria-live="polite">
            Connected as <span className="font-mono">{shortAddress(w.address)}</span>
            {auth.mismatch ? ". You were signed in with a different wallet, so sign in again." : "."}
          </p>
        </div>
      </StepShell>
    );
  } else if (step === "profile") {
    content = <ProfileStep defaultPayout={w.address ?? ""} />;
  } else if (step === "onchain") {
    content = registration.isError ? (
      <QueryError error={registration.error} onRetry={() => void registration.refetch()} title="Couldn't load your registration" />
    ) : merchant && registration.data ? (
      <OnchainStep merchant={merchant} registration={registration.data} config={config} deployed={deployed} />
    ) : null;
  } else if (step === "api_key") {
    content = secret ? (
      <StepShell title="Your API key">
        <SecretReveal
          secret={secret.secret}
          title={`${secret.name}`}
          body="Copy it now. For your safety we only store a fingerprint, so this is the only time you'll see the full key."
          doneLabel="Continue"
          onDone={() => setSecret(null)}
        />
      </StepShell>
    ) : (
      <ApiKeyStep onCreated={setSecret} onSkip={() => setSkippedKey(true)} />
    );
  } else {
    content = (
      <DoneStep
        onFinish={() => {
          setFinished(true);
          onFinish();
        }}
      />
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-10 px-4 py-10 sm:px-6 md:grid-cols-[14rem_1fr] md:py-16">
      <div>
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">Set up your store</h1>
        <p className="mt-1 text-sm text-muted-foreground">About three minutes. One transaction.</p>
        <div className="mt-6">
          <Progress step={step} />
        </div>
      </div>
      <div aria-live="polite" className="min-w-0">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={loading ? "loading" : step}
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: [0.25, 1, 0.5, 1] }}
          >
            {content}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
