import type { Metadata } from "next";
import { INTENT_STATUSES, canTransition, PAYABLE, SETTLED, WEBHOOK_EVENT_TYPES } from "@/lib/chain/payment-state";
import { INTENT_STATUS } from "@/lib/client/status";
import { StatusBadge } from "@/components/shared/status-badge";
import { LifecycleDiagram } from "@/components/docs/lifecycle-diagram";
import { C, DocTable, DocTitle, List, Note, P, PageFooterNav, Section } from "@/components/docs/prose";

export const metadata: Metadata = {
  title: "Payment lifecycle",
  description: "Every payment intent status, how intents move between them, and when a payment counts as paid.",
};

const EVENT_FOR: Partial<Record<(typeof INTENT_STATUSES)[number], (typeof WEBHOOK_EVENT_TYPES)[number]>> = {
  created: "payment.created",
  confirming: "payment.pending",
  paid: "payment.confirmed",
  expired: "payment.expired",
  cancelled: "payment.cancelled",
  partially_refunded: "payment.refunded",
  refunded: "payment.refunded",
};

export default function LifecyclePage() {
  return (
    <article>
      <DocTitle
        title="Payment lifecycle"
        lead="A payment intent is one order's payment. It moves through these statuses. Only our indexer, after checking the chain, can mark it paid."
      />

      <Section id="diagram" title="States and transitions">
        <LifecycleDiagram />
      </Section>

      <Section id="statuses" title="Statuses">
        <DocTable
          caption="Payment intent statuses"
          head={["Status", "API value", "What it means", "Webhook"]}
          rows={INTENT_STATUSES.map((s) => [
            <StatusBadge key="b" status={s} />,
            <span key="v" className="font-mono text-[0.8125rem] whitespace-nowrap">
              {s}
            </span>,
            INTENT_STATUS[s].hint,
            EVENT_FOR[s] ? (
              <span key="e" className="font-mono text-[0.8125rem] whitespace-nowrap">
                {EVENT_FOR[s]}
              </span>
            ) : (
              <span key="e" className="text-muted-foreground">
                none
              </span>
            ),
          ])}
        />
        <P>
          Customers can pay while the intent is {PAYABLE.map((s, i) => (
            <span key={s}>
              {i > 0 ? (i === PAYABLE.length - 1 ? " or " : ", ") : null}
              <C>{s}</C>
            </span>
          ))}
          . You have been paid when it is {SETTLED.map((s, i) => (
            <span key={s}>
              {i > 0 ? (i === SETTLED.length - 1 ? " or " : ", ") : null}
              <C>{s}</C>
            </span>
          ))}
          . A payable intent past its <C>expires_at</C> already shows as expired, even before the worker updates it.
        </P>
      </Section>

      <Section id="transitions" title="Allowed transitions">
        <DocTable
          caption="Allowed transitions from each status"
          head={["From", "Can move to"]}
          rows={INTENT_STATUSES.map((from) => {
            const to = INTENT_STATUSES.filter((t) => t !== from && canTransition(from, t));
            return [
              <StatusBadge key="f" status={from} />,
              to.length ? (
                <span key="t" className="flex flex-wrap gap-x-4 gap-y-1">
                  {to.map((t) => (
                    <StatusBadge key={t} status={t} />
                  ))}
                </span>
              ) : (
                <span key="t" className="text-muted-foreground">
                  Final. Nothing else happens.
                </span>
              ),
            ];
          })}
        />
      </Section>

      <Section id="paid" title="When a payment counts as paid">
        <P>An intent becomes paid only when all of these hold. The indexer, the checkout status check and reconciliation all use the same check.</P>
        <List
          ordered
          items={[
            <>The log comes from the MezoCommerce payment contract on Mezo Testnet (chain 31611), and the transaction succeeded.</>,
            <>
              It is a <C>PaymentCompleted</C> event, and its <C>paymentId</C> matches a known intent.
            </>,
            <>Merchant, payout wallet, token and amount equal the signed intent. If the intent was locked to one payer, the payer matches too.</>,
            <>Enough blocks have passed (2 by default), and the block is still part of the chain.</>,
          ]}
        />
        <P>
          Anything else is recorded as a mismatch and never marked paid. The transaction hash a customer&apos;s browser reports only tells us where to look
          first. We fetch the receipt ourselves.
        </P>
      </Section>

      <Section id="late" title="Late payments">
        <P>
          Expiry is enforced on-chain, so an expired intent can&apos;t be paid. A cancel in the dashboard hides the checkout at once, but a customer who already
          had it open could still pay before an on-chain cancel lands. If money arrives for a cancelled or expired intent, we record it as paid with{" "}
          <C>late: true</C>. The money is in your wallet: fulfil the order or refund it.
        </P>
        <Note>To make an open checkout unpayable for certain, cancel on-chain from your owner wallet. The dashboard offers this on the payment page.</Note>
      </Section>

      <Section id="amounts" title="No underpaid or overpaid">
        <P>
          The contract moves exactly the signed amount from the customer to your payout wallet, or the whole transaction fails. Partial and extra payments
          can&apos;t happen through checkout. MUSD sent straight to your wallet outside checkout isn&apos;t linked to any order.
        </P>
      </Section>

      <PageFooterNav prev={{ href: "/docs/api", label: "API reference" }} next={{ href: "/docs/webhooks", label: "Webhooks" }} />
    </article>
  );
}
