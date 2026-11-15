import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "@/components/shared/code-block";
import { C, DocTitle, H3, List, Note, P, PageFooterNav, Section } from "@/components/docs/prose";
import { SITE } from "@/lib/client/site";

export const metadata: Metadata = {
  title: "Shopify",
  description: "Take MUSD for Shopify orders with a custom app and a manual payment method. Not a Shopify payment gateway.",
};

const APP = SITE.url;
const webhookUrl = `${APP}/api/integrations/shopify/webhook/<your-store-slug>`;
const payLink = `${APP}/pay/shopify/<your-shop>.myshopify.com/{{ order.id }}`;
const liquid = `{% if order.gateway == "Pay with MUSD" and order.financial_status == "pending" %}
  <p>
    <a href="${APP}/pay/shopify/{{ shop.permanent_domain }}/{{ order.id }}">
      Pay {{ order.total_price | money }} in MUSD
    </a>
  </p>
{% endif %}`;

function Step({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <li className="space-y-3 pl-1">
      <H3>{title}</H3>
      {children}
    </li>
  );
}

export default function ShopifyPage() {
  return (
    <article>
      <DocTitle
        title="Shopify"
        lead="Shopify stores can take MUSD for orders using a custom app and a manual payment method. Customers pick MUSD at checkout, place the order, then pay on a MezoCommerce page."
      />

      <Note title="What this is, and isn't" tone="warn">
        MezoCommerce is not an approved Shopify payment gateway, and it doesn&apos;t appear inside Shopify&apos;s own checkout. A real checkout payment method
        needs Shopify&apos;s Payments Partner approval, which this testnet MVP doesn&apos;t have. Orders are placed first and paid right after, the same way
        manual methods like bank transfer work.
      </Note>

      <Section id="pricing" title="Currency" className="pt-8">
        <P>
          Only orders in USD are accepted. They are charged at 1 USD = 1 MUSD. That&apos;s a stated policy, since MUSD is a USD-pegged stablecoin, not a live
          exchange rate. Orders in any other currency are skipped and stay unpaid.
        </P>
      </Section>

      <Section id="setup" title="Set up">
        <ol className="list-decimal space-y-6 pl-5 text-[0.9375rem] marker:text-muted-foreground">
          <Step title="Add a manual payment method">
            <P>
              In Shopify admin, open Settings, Payments, Manual payment methods, and add a custom method named <C>Pay with MUSD</C>. If you use another name,
              enter the same name in MezoCommerce.
            </P>
          </Step>
          <Step title="Create a custom app">
            <P>
              In Settings, Apps and sales channels, Develop apps, create an app with the Admin API scopes <C>read_orders</C> and <C>write_orders</C>. Install
              it, then copy the Admin API access token (<C>shpat_...</C>) and the API secret key.
            </P>
          </Step>
          <Step title="Connect it in MezoCommerce">
            <P>
              In the <Link href="/merchant/shopify" className="font-medium underline underline-offset-4">dashboard&apos;s Shopify page</Link>, enter your shop
              domain (<C>your-shop.myshopify.com</C>), the access token, the API secret and the payment method name. The token is stored encrypted.
            </P>
          </Step>
          <Step title="Add the order webhook">
            <P>
              In Settings, Notifications, Webhooks, create an <C>Order creation</C> webhook in JSON format pointing to your webhook URL. The dashboard shows
              the exact URL to copy.
            </P>
            <CodeBlock label="Webhook URL" code={webhookUrl} />
            <P>
              We check the <C>X-Shopify-Hmac-Sha256</C> header with your API secret and ignore repeats of the same <C>X-Shopify-Webhook-Id</C>.
            </P>
          </Step>
          <Step title="Show customers the pay link">
            <P>
              Add the pay link to the order status page (with a Checkout UI extension) or to the order confirmation email. The link works even if the webhook
              hasn&apos;t arrived yet: we then fetch the order from Shopify and create the payment on the spot.
            </P>
            <CodeBlock label="Pay link template" code={payLink} />
            <CodeBlock label="Order confirmation email (Liquid)" code={liquid} />
          </Step>
        </ol>
      </Section>

      <Section id="flow" title="What happens to an order">
        <List
          ordered
          items={[
            <>The customer places an order and picks Pay with MUSD.</>,
            <>
              Shopify sends the order webhook. If the order uses your MUSD method, is pending and is in USD, we create a payment intent with order id{" "}
              <C>shopify:&lt;order id&gt;</C>.
            </>,
            <>The customer opens the pay link and pays the exact amount from their wallet to yours.</>,
            <>Once the payment is verified on-chain and confirmed, we mark the order paid in Shopify with orderMarkAsPaid.</>,
            <>
              We check the order&apos;s financial status first and record the result, so an order is never marked paid twice. Failed updates are retried with
              backoff and shown in the dashboard.
            </>,
          ]}
        />
      </Section>

      <Section id="limits" title="Limits">
        <List
          items={[
            <>USD orders only. No other currencies and no live conversion.</>,
            <>Refunds are sent from your wallet in the MezoCommerce dashboard. Shopify isn&apos;t updated for refunds; record them in Shopify yourself.</>,
            <>Testnet only. MUSD on Mezo Testnet has no real-world value.</>,
          ]}
        />
      </Section>

      <PageFooterNav prev={{ href: "/docs/widget", label: "Checkout widget" }} next={{ href: "/docs/security", label: "Security and limits" }} />
    </article>
  );
}
