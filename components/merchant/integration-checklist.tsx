import Link from "next/link";
import { Check } from "lucide-react";
import type { MerchantOverviewDTO } from "@/lib/api-types";
import { cn } from "@/lib/client/utils";

export interface ChecklistItem {
  id: string;
  label: string;
  detail: string;
  done: boolean;
  href: string;
  action: string;
  optional?: boolean;
}

/** Integration status → ordered checklist. Pure, unit tested. */
export function checklistItems(i: MerchantOverviewDTO["integration"]): ChecklistItem[] {
  return [
    {
      id: "onchain",
      label: "Registered on-chain",
      detail: i.onchain_ready ? "Active, and MezoCommerce can sign checkouts." : "Finish registration so checkouts can be paid.",
      done: i.onchain_ready,
      href: "/merchant/onboarding",
      action: "Finish setup",
    },
    {
      id: "api_key",
      label: "API key",
      detail: i.api_keys ? `${i.api_keys} active ${i.api_keys === 1 ? "key" : "keys"}.` : "Your server needs one to create payments.",
      done: i.api_keys > 0,
      href: "/merchant/developers",
      action: "Create key",
    },
    {
      id: "webhook",
      label: "Webhook endpoint",
      detail:
        i.webhook_endpoints === 0
          ? "Get told when an order is paid, so you don't have to poll."
          : i.last_webhook_status === "failed"
            ? "The last delivery failed. Check your endpoint."
            : i.last_webhook_status === "delivered"
              ? "The last delivery went through."
              : "Added. No deliveries yet.",
      done: i.webhook_endpoints > 0 && i.last_webhook_status !== "failed",
      href: i.webhook_endpoints === 0 ? "/merchant/developers/webhooks" : "/merchant/developers/webhooks#deliveries",
      action: i.webhook_endpoints === 0 ? "Add endpoint" : "View deliveries",
    },
    {
      id: "shopify",
      label: "Shopify",
      detail: i.shopify_connected ? "Connected. Paid orders are marked paid in Shopify." : "Only if you sell on Shopify.",
      done: i.shopify_connected,
      href: "/merchant/shopify",
      action: "Connect",
      optional: true,
    },
  ];
}

export function IntegrationChecklist({ integration }: { integration: MerchantOverviewDTO["integration"] }) {
  const items = checklistItems(integration);
  return (
    <ul className="divide-y">
      {items.map((it) => (
        <li key={it.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
          <span
            aria-hidden
            className={cn(
              "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border",
              it.done ? "border-transparent bg-brand text-brand-foreground" : "border-dashed border-input",
            )}
          >
            {it.done ? <Check className="size-3" strokeWidth={2.5} /> : null}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              {it.label}
              <span className="sr-only">{it.done ? ", done" : ", not done"}</span>
              {it.optional && !it.done ? <span className="ml-1.5 font-normal text-muted-foreground">(optional)</span> : null}
            </p>
            <p className="text-[0.8125rem] text-muted-foreground">{it.detail}</p>
          </div>
          {!it.done || it.id === "webhook" ? (
            <Link href={it.href} className="shrink-0 rounded-sm text-[0.8125rem] font-medium underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
              {it.action}
            </Link>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
