import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "@/components/shared/code-block";
import { C, DocTitle, List, Note, P, PageFooterNav } from "@/components/docs/prose";
import { SITE } from "@/lib/client/site";

export const metadata: Metadata = {
  title: "Quickstart",
  description: "Accept your first MUSD payment on Mezo Testnet in five steps.",
};

const createIntent = `curl -X POST ${SITE.url}/api/v1/payment-intents \\
  -H "Authorization: Bearer mc_test_sk_..." \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: order_1042" \\
  -d '{
    "merchant_order_id": "order_1042",
    "amount": "24.50",
    "return_url": "https://shop.example.com/orders/1042/thanks"
  }'`;

const intentResponse = `{
  "id": "pi_3Nq8vR2kX7mB5c",
  "status": "created",
  "amount_display": "24.5",
  "checkout_url": "${SITE.url}/checkout/pi_3Nq8vR2kX7mB5c",
  "expires_at": "2026-11-10T14:49:02.000Z",
  ...
}`;

const widget = `<script src="${SITE.url}/checkout.js" async></script>
<script>
  // after your server created the intent
  MezoCommerce.checkout({
    paymentId: "pi_3Nq8vR2kX7mB5c",
    mode: "modal",
    onSuccess: () => location.assign("/orders/1042/thanks"),
  });
</script>`;

const webhook = `app.post("/webhooks/mezocommerce", express.raw({ type: "application/json" }), (req, res) => {
  if (!verifySignature(req.body.toString("utf8"), req.get("MezoCommerce-Signature"), SECRET)) {
    return res.sendStatus(400);
  }
  const event = JSON.parse(req.body.toString("utf8"));
  if (event.type === "payment.confirmed") {
    markOrderPaid(event.data.payment_intent.merchant_order_id, event.id); // dedupe on event.id
  }
  res.sendStatus(200);
});`;

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="grid gap-4 border-t py-8 first:border-t-0 first:pt-0 sm:grid-cols-[2.5rem_minmax(0,1fr)]">
      <span aria-hidden className="num flex size-8 items-center justify-center rounded-full border text-sm font-medium text-muted-foreground">
        {n}
      </span>
      <div className="min-w-0 space-y-4">
        <h2 className="text-xl font-semibold tracking-[-0.015em]">
          <span className="sr-only">Step {n}: </span>
          {title}
        </h2>
        {children}
      </div>
    </li>
  );
}

export default function QuickstartPage() {
  return (
    <article>
      <DocTitle
        title="Quickstart"
        lead="Take your first MUSD payment on Mezo Testnet. You need a Bitcoin wallet (Unisat, OKX or Xverse) or an Ethereum wallet, plus a little testnet BTC for gas. Customers pay straight to your wallet."
      />

      <ol className="list-none">
        <Step n={1} title="Sign in and register your store">
          <P>
            Open the <Link href="/merchant" className="font-medium underline underline-offset-4">dashboard</Link>, connect your wallet and sign in with a free
            signature. Add your store details and a payout wallet, then send one registration transaction. It records your payout wallet on-chain and lets
            MezoCommerce sign checkouts for you.
          </P>
          <Note>The platform signer can only approve checkouts. It can&apos;t change your payout wallet or move funds. You can turn it off any time in Settings.</Note>
        </Step>

        <Step n={2} title="Create an API key">
          <P>
            In <strong className="font-medium">Developers</strong>, create a key. It starts with <C>mc_test_sk_</C> and is shown once. Keep it on your server;
            never put it in browser code.
          </P>
        </Step>

        <Step n={3} title="Create a payment intent">
          <P>
            Create one intent per order from your server. Amounts are decimal MUSD strings. Send an <C>Idempotency-Key</C> so a retried request never makes a
            second intent.
          </P>
          <CodeBlock label="Request" code={createIntent} />
          <CodeBlock label="Response (trimmed)" code={intentResponse} />
        </Step>

        <Step n={4} title="Send the customer to checkout">
          <P>
            Redirect to <C>checkout_url</C>, show its QR code, or open checkout in a modal on your own page with the widget. The customer connects a wallet and
            pays the exact amount.
          </P>
          <CodeBlock label="Widget" code={widget} />
          <P>
            See <Link href="/docs/widget" className="font-medium underline underline-offset-4">Checkout widget</Link> for modes and events.
          </P>
        </Step>

        <Step n={5} title="Fulfil on payment.confirmed">
          <P>
            Add a webhook endpoint in the dashboard. We send <C>payment.confirmed</C> only after the payment event is found on-chain, every field matches your
            intent, and enough blocks have passed. Fulfil the order then, not when the customer returns to your site.
          </P>
          <CodeBlock label="Express receiver" code={webhook} />
          <List
            items={[
              <>Verify the signature and reject anything older than 5 minutes.</>,
              <>Deliveries can repeat. Store the event id and skip ones you have seen.</>,
              <>Answer with any 2xx quickly. Do slow work after you respond.</>,
            ]}
          />
          <P>
            The full verification snippet is in <Link href="/docs/webhooks" className="font-medium underline underline-offset-4">Webhooks</Link>.
          </P>
        </Step>
      </ol>

      <PageFooterNav next={{ href: "/docs/api", label: "API reference" }} />
    </article>
  );
}
