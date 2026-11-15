import Link from "next/link";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CodeBlock } from "@/components/shared/code-block";
import { SITE } from "@/lib/client/site";

const WIDGET = `<script src="${SITE.url}/checkout.js" async></script>

<button id="pay">Pay with MUSD</button>
<script>
  document.getElementById("pay").addEventListener("click", () => {
    MezoCommerce.checkout({
      paymentId: "pi_3kQ7xV2mT9",   // from your server
      mode: "modal",
      onSuccess: ({ paymentIntentId, txHash }) => {
        window.location.href = "/thanks?order=1042";
      },
    });
  });
</script>`;

const CURL = `curl -X POST ${SITE.url}/api/v1/payment-intents \\
  -H "Authorization: Bearer $MEZOCOMMERCE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: order-1042" \\
  -d '{
    "merchant_order_id": "1042",
    "amount": "48.60",
    "description": "Waxed canvas tote and 2 key rings",
    "return_url": "https://yourstore.example/thanks"
  }'`;

const WEBHOOK = `// payment.confirmed arrives only after the on-chain check
app.post("/webhooks/mezocommerce", express.raw({ type: "application/json" }), (req, res) => {
  const event = verify(req.body, req.get("MezoCommerce-Signature"), process.env.WEBHOOK_SECRET);
  if (event.type === "payment.confirmed") {
    markOrderPaid(event.data.payment_intent.merchant_order_id);
  }
  res.sendStatus(200);
});`;

export function Integration() {
  return (
    <section aria-labelledby="integrate-title" className="border-t bg-surface">
      <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6 lg:py-24">
        <h2 id="integrate-title" className="max-w-[22ch] text-3xl font-semibold tracking-[-0.025em] sm:text-4xl">
          A script tag and one API call
        </h2>
        <p className="mt-4 max-w-[60ch] text-muted-foreground">
          Create the payment on your server with your API key, then open checkout in a modal, inline or as a redirect. Your API key never touches the browser.
        </p>
        <Tabs defaultValue="widget" className="mt-8 min-w-0">
          <TabsList>
            <TabsTrigger value="widget">Widget</TabsTrigger>
            <TabsTrigger value="api">Create a payment</TabsTrigger>
            <TabsTrigger value="webhook">Webhook</TabsTrigger>
          </TabsList>
          <TabsContent value="widget" className="mt-4">
            <CodeBlock code={WIDGET} label="checkout.html" />
          </TabsContent>
          <TabsContent value="api" className="mt-4">
            <CodeBlock code={CURL} label="Terminal" />
          </TabsContent>
          <TabsContent value="webhook" className="mt-4">
            <CodeBlock code={WEBHOOK} label="server.js" />
          </TabsContent>
        </Tabs>
        <p className="mt-4 text-sm text-muted-foreground">
          Full examples in the{" "}
          <Link href="/docs/widget" className="text-foreground underline underline-offset-4">
            widget guide
          </Link>{" "}
          and the{" "}
          <Link href="/docs/api" className="text-foreground underline underline-offset-4">
            API reference
          </Link>
          .
        </p>
      </div>
    </section>
  );
}
