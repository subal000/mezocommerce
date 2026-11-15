"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import type { CreatedApiKeyDTO } from "@/lib/api-types";
import { API_KEY_PREFIX } from "@/lib/chain/config";
import { errorMessage } from "@/lib/client/api";
import { formatDate, relativeTime } from "@/lib/client/format";
import { maskKey } from "@/lib/client/secrets";
import { cn } from "@/lib/client/utils";
import { useApiKeys, useCreateApiKey, useRevokeApiKey } from "@/hooks/use-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader, Panel } from "@/components/shared/page-header";
import { QueryError } from "@/components/shared/query-error";
import { EmptyState } from "@/components/shared/empty-state";
import { SecretReveal } from "@/components/shared/secret-reveal";
import { StatusDot } from "@/components/shared/status-badge";
import { Field } from "./field";

const TABS = [
  { href: "/merchant/developers", label: "API keys" },
  { href: "/merchant/developers/webhooks", label: "Webhooks" },
];

export function DevelopersHeader() {
  const pathname = usePathname();
  return (
    <div className="space-y-5">
      <PageHeader
        title="Developers"
        description="Create payments from your server and get told when they're paid."
        actions={
          <Button asChild variant="outline">
            <Link href="/docs/api">API reference</Link>
          </Button>
        }
      />
      <nav aria-label="Developer settings" className="flex gap-1 border-b">
        {TABS.map((t) => {
          const active = pathname === t.href;
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                active ? "border-brand font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

/** Create-key dialog. The secret lives only in this component's state and is wiped when the dialog closes. */
export function CreateKeyDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [created, setCreated] = useState<CreatedApiKeyDTO | null>(null);
  const create = useCreateApiKey();

  function close() {
    setOpen(false);
    setCreated(null);
    setName("");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        // Once a key is showing, only the explicit "Done" closes it (so it isn't lost by a stray click).
        if (!v && created) return;
        if (v) setOpen(true);
        else close();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden /> Create API key
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg" showCloseButton={!created}>
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>API key created</DialogTitle>
            </DialogHeader>
            <SecretReveal
              secret={created.secret}
              title={created.name}
              body="Copy it now and keep it on your server. We only store a fingerprint, so this is the only time you'll see it. Never put it in browser code."
              onDone={close}
            />
          </>
        ) : (
          <form
            className="grid gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                setCreated(await create.mutateAsync({ name: name.trim() || "Untitled key" }));
              } catch (err) {
                toast.error("Couldn't create the key", { description: errorMessage(err) });
              }
            }}
          >
            <DialogHeader>
              <DialogTitle>Create API key</DialogTitle>
              <DialogDescription>Keys can create payments, read them and issue refund requests for your store.</DialogDescription>
            </DialogHeader>
            <Field id="new-key-name" label="Name" hint="Where it's used, e.g. production server.">
              <Input id="new-key-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} aria-describedby="new-key-name-hint" autoFocus />
            </Field>
            <DialogFooter>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? "Creating…" : "Create key"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RevokeButton({ id, name }: { id: string; name: string }) {
  const revoke = useRevokeApiKey();
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(v) => !revoke.isPending && setOpen(v)}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          Revoke
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Revoke &ldquo;{name}&rdquo;?</DialogTitle>
          <DialogDescription>Requests using this key fail right away. Payments already created keep working.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Keep key
          </Button>
          <Button
            variant="destructive"
            disabled={revoke.isPending}
            onClick={async () => {
              try {
                await revoke.mutateAsync(id);
                toast.success("Key revoked");
                setOpen(false);
              } catch (err) {
                toast.error("Couldn't revoke the key", { description: errorMessage(err) });
              }
            }}
          >
            {revoke.isPending ? "Revoking…" : "Revoke key"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ApiKeysView() {
  const keys = useApiKeys();
  const list = keys.data ?? [];
  return (
    <div className="space-y-6">
      <DevelopersHeader />
      <Panel
        title="API keys"
        description={`Test keys start with ${API_KEY_PREFIX}. Send them as a Bearer token from your server.`}
        actions={<CreateKeyDialog />}
        bodyClassName="px-4 py-2 sm:px-5"
      >
        {keys.isLoading ? (
          <div className="space-y-2 py-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : keys.isError ? (
          <div className="py-3">
            <QueryError error={keys.error} onRetry={() => void keys.refetch()} title="Couldn't load your keys" />
          </div>
        ) : list.length === 0 ? (
          <EmptyState className="my-3" title="No API keys yet" body="Create one to start making payments from your store's server." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((k) => (
                <TableRow key={k.id} className={k.revoked_at ? "text-muted-foreground" : undefined}>
                  <TableCell className="font-medium">{k.name}</TableCell>
                  <TableCell className="font-mono text-[0.8125rem]">{maskKey(k.key_prefix)}</TableCell>
                  <TableCell className="text-[0.8125rem]">{k.last_used_at ? relativeTime(k.last_used_at) : "Never"}</TableCell>
                  <TableCell className="text-[0.8125rem]">{formatDate(k.created_at)}</TableCell>
                  <TableCell>
                    <StatusDot meta={k.revoked_at ? { label: "Revoked", tone: "idle", hint: `Revoked ${formatDate(k.revoked_at)}` } : { label: "Active", tone: "ok", hint: "" }} />
                  </TableCell>
                  <TableCell className="text-right">{k.revoked_at ? null : <RevokeButton id={k.id} name={k.name} />}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>
      <Panel title="Next steps">
        <ul className="grid gap-3 text-sm sm:grid-cols-3">
          <li>
            <Link href="/docs" className="font-medium underline-offset-4 hover:underline">
              Quickstart
            </Link>
            <p className="text-[0.8125rem] text-muted-foreground">Your first payment in five steps.</p>
          </li>
          <li>
            <Link href="/docs/widget" className="font-medium underline-offset-4 hover:underline">
              Checkout widget
            </Link>
            <p className="text-[0.8125rem] text-muted-foreground">Open checkout in a modal on your site.</p>
          </li>
          <li>
            <Link href="/docs/webhooks" className="font-medium underline-offset-4 hover:underline">
              Verify webhooks
            </Link>
            <p className="text-[0.8125rem] text-muted-foreground">Check the signature before you fulfil.</p>
          </li>
        </ul>
      </Panel>
    </div>
  );
}
