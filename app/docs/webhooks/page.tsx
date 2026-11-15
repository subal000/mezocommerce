import type { Metadata } from "next";
import { WEBHOOK_EVENT_TYPES, type WebhookEventType } from "@/lib/chain/payment-state";
import { CodeBlock } from "@/components/shared/code-block";
import { json, sampleWebhookPayload } from "@/components/docs/samples";
import { C, DocTable, DocTitle, List, Note, P, PageFooterNav, Section } from "@/components/docs/prose";

export const metadata: Metadata = {
  title: "Webhooks",
  description: "Signed MezoCommerce events: headers, signature verification in Node, event types, retries and idempotency.",
};

const WHEN: Record<WebhookEventType, string> = {
  "payment.created": "An intent was created, by the API, the dashboard or a Shopify order.",
  "payment.pending": "The payment event was found on-chain and checked. Waiting for confirmations. Don't ship yet.",
  "payment.confirmed": "Verified on-chain with enough confirmations. Fulfil the order now.",
  "payment.failed": "A transaction the customer sent reverted or didn't match. The intent stays payable.",
  "payment.expired": "The payment window closed without a payment.",
  "payment.cancelled": "You cancelled the intent, by API, dashboard or on-chain.",
  "payment.refunded": "A refund was verified on-chain. data.fully_refunded is true when nothing is left to refund.",
  ping: "A test event you sent from the dashboard.",
};

const verify = `import crypto from "node:crypto";

const TOLERANCE_SECONDS = 5 * 60;

/**
 * header: the MezoCommerce-Signature value, "t=<unix seconds>,v1=<hex>"
 * rawBody: the request body exactly as received (a string, not parsed JSON)
 */
export function verifySignature(rawBody, header, secret) {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i), p.slice(i + 1)];
    }),
  );
  const t = Number(parts.t);
  if (!Number.isFinite(t) || !parts.v1) return false;

  // Reject old or future timestamps (replay protection).
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - t) > TOLERANCE_SECONDS) return false;

  const expected = crypto.createHmac("sha256", secret).update(\`\${t}.\${rawBody}\`).digest();
  const received = Buffer.from(parts.v1, "hex");
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}`;

const handler = `import express from "express";
import { verifySignature } from "./verify-signature.js";

const app = express();
const SECRET = process.env.MEZOCOMMERCE_WEBHOOK_SECRET; // whsec_...

// Use the raw body. Re-serialised JSON won't match the signature.
app.post("/webhooks/mezocommerce", express.raw({ type: "application/json" }), async (req, res) => {
  const raw = req.body.toString("utf8");
  if (!verifySignature(raw, req.get("MezoCommerce-Signature"), SECRET)) {
    return res.sendStatus(400);
  }

  const eventId = req.get("MezoCommerce-Event-Id");
  if (await db.processedEvents.has(eventId)) return res.sendStatus(200); // already handled

  const event = JSON.parse(raw);
  res.sendStatus(200); // answer first, then do the work

  if (event.type === "payment.confirmed") {
    await fulfilOrder(event.data.payment_intent.merchant_order_id);
  }
  await db.processedEvents.add(eventId);
});`;

export default function WebhooksPage() {
  return (
    <article>
      <DocTitle
        title="Webhooks"
        lead="We POST a signed JSON event to your endpoint whenever a payment changes. Add endpoints under Developers in the dashboard or with the API."
      />

      <Section id="headers" title="What we send">
        <DocTable
          caption="Webhook request headers"
          head={["Header", "Value"]}
          rows={[
            [<C key="h">MezoCommerce-Signature</C>, <>t=&lt;unix seconds&gt;,v1=&lt;hex HMAC-SHA256 of &quot;t.rawBody&quot; with your secret&gt;</>],
            [<C key="h">MezoCommerce-Event-Id</C>, "The event id (evt_...). Identical on every retry of the same event."],
            [<C key="h">MezoCommerce-Event-Type</C>, "The event type, also in the body as type."],
            [<C key="h">Content-Type</C>, "application/json"],
          ]}
        />
        <CodeBlock label="Body: payment.confirmed" code={json(sampleWebhookPayload)} className="[&_pre]:max-h-[26rem]" />
      </Section>

      <Section id="verify" title="Verify the signature">
        <P>
          Each endpoint has its own secret starting with <C>whsec_</C>. It is shown once when you create the endpoint. Compute the HMAC over the raw body,
          compare in constant time, and reject timestamps more than 5 minutes off.
        </P>
        <CodeBlock label="verify-signature.js (Node 18+)" code={verify} />
        <CodeBlock label="Express handler" code={handler} />
      </Section>

      <Section id="events" title="Events">
        <DocTable
          caption="Webhook event types"
          head={["Event", "Sent when"]}
          rows={WEBHOOK_EVENT_TYPES.map((t) => [
            <span key="t" className="font-mono text-[0.8125rem] whitespace-nowrap">
              {t}
            </span>,
            WHEN[t],
          ])}
        />
        <Note title="Fulfil on payment.confirmed only">
          payment.pending means the money moved but blocks can still be replaced. A customer returning to your return_url proves nothing either.
        </Note>
      </Section>

      <Section id="retries" title="Retries and idempotency">
        <List
          items={[
            <>Any 2xx answer within 5 seconds counts as delivered. Anything else, or a timeout, is retried.</>,
            <>We try up to 5 times in total, waiting 30 seconds, then 60, 120 and 240 seconds between attempts.</>,
            <>After the last failure the delivery is marked failed. You can retry it from the dashboard&apos;s delivery log.</>,
            <>
              Delivery is at least once, so the same event can arrive twice. Store <C>MezoCommerce-Event-Id</C> and skip events you have already processed.
            </>,
            <>Events can arrive out of order. Read the intent&apos;s status in the payload, or fetch it from the API, rather than counting on order.</>,
            <>Endpoints must be public https URLs. Private and local network addresses are refused.</>,
          ]}
        />
      </Section>

      <PageFooterNav prev={{ href: "/docs/lifecycle", label: "Payment lifecycle" }} next={{ href: "/docs/widget", label: "Checkout widget" }} />
    </article>
  );
}
