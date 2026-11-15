import type { Metadata } from "next";
import { CodeBlock } from "@/components/shared/code-block";
import { C, DocTable, DocTitle, H3, List, Note, P, PageFooterNav, Section } from "@/components/docs/prose";
import { SITE } from "@/lib/client/site";

export const metadata: Metadata = {
  title: "Checkout widget",
  description: "Open MezoCommerce checkout on your own page: script tag, modes, button helper, events and CSP.",
};

const APP = SITE.url;

const scriptTag = `<script src="${APP}/checkout.js" async></script>`;

const checkout = `// Your server created the intent with your API key and sent its id to the page.
MezoCommerce.checkout({
  paymentId: "pi_3Nq8vR2kX7mB5c",   // or checkoutUrl: "${APP}/checkout/pi_..."
  mode: "modal",                     // "modal" (default), "inline" or "redirect"
  onSuccess: ({ paymentIntentId, txHash }) => {
    // Verified on-chain. Still fulfil from your payment.confirmed webhook.
    location.assign("/orders/1042/thanks");
  },
  onCancel: () => console.log("closed without paying"),
  onExpired: () => console.log("payment window closed"),
  onError: (err) => console.error(err),
});`;

const inline = `<div id="pay-here"></div>
<script>
  MezoCommerce.checkout({
    paymentId: "pi_3Nq8vR2kX7mB5c",
    mode: "inline",
    container: "#pay-here",
  });
</script>`;

const button = `<div id="pay-button"></div>
<script>
  // createUrl is YOUR server endpoint. It holds the API key, creates the intent
  // and returns { payment_intent_id } or { checkout_url }.
  MezoCommerce.button(document.getElementById("pay-button"), {
    createUrl: "/api/create-mezocommerce-intent",
  });
</script>`;

const csp = `Content-Security-Policy:
  script-src 'self' ${APP};
  frame-src ${APP};`;

export default function WidgetPage() {
  return (
    <article>
      <DocTitle
        title="Checkout widget"
        lead={
          <>
            The widget opens MezoCommerce checkout on your own page. It is served from <C>{APP}/checkout.js</C> and adds <C>window.MezoCommerce</C>.
          </>
        }
      />

      <Section id="install" title="Add the script">
        <CodeBlock label="HTML" code={scriptTag} />
        <P>Never put your API key in the page. Create intents on your server, then hand the intent id to the browser.</P>
      </Section>

      <Section id="checkout" title="MezoCommerce.checkout">
        <CodeBlock label="JavaScript" code={checkout} />
        <DocTable
          caption="checkout options"
          head={["Option", "Description"]}
          rows={[
            [<C key="o">paymentId</C>, "The pi_ id or payment_id. Use this or checkoutUrl."],
            [<C key="o">checkoutUrl</C>, "The intent's checkout_url."],
            [<C key="o">mode</C>, "modal, inline or redirect. Defaults to modal."],
            [<C key="o">container</C>, "Element or selector for inline mode."],
            [<C key="o">onSuccess</C>, "Called once checkout's own status check says the payment is verified."],
            [<C key="o">onCancel</C>, "The customer closed checkout without paying."],
            [<C key="o">onExpired</C>, "The intent expired while open."],
            [<C key="o">onError</C>, "Checkout couldn't load or the intent isn't payable."],
          ]}
        />
        <H3>Modes</H3>
        <List
          items={[
            <>
              <strong className="font-medium">modal</strong>: a sandboxed iframe over your page. Closing it calls onCancel.
            </>,
            <>
              <strong className="font-medium">inline</strong>: the same iframe inside your container. It resizes to fit.
            </>,
            <>
              <strong className="font-medium">redirect</strong>: sends the browser to checkout_url. Checkout returns the customer to your return_url or
              cancel_url.
            </>,
          ]}
        />
        <CodeBlock label="Inline" code={inline} />
      </Section>

      <Section id="button" title="MezoCommerce.button">
        <P>
          Renders a pay button in an element. Pass <C>paymentId</C> for an existing intent, or <C>createUrl</C> to have the button POST to your own server
          endpoint first. That endpoint creates the intent with your API key and returns its id or checkout URL.
        </P>
        <CodeBlock label="HTML" code={button} />
      </Section>

      <Section id="events" title="Messages">
        <P>
          The iframe talks to your page with <C>postMessage</C>. The widget accepts a message only when its origin is the MezoCommerce app and it comes from its own iframe. The checkout page can&apos;t know who embeds it, so it sends only ids and statuses and accepts no commands. Every message has{" "}
          <C>{'{ source: "mezocommerce", type, paymentIntentId, status, txHash }'}</C>. The callbacks above wrap these, so most sites never read them directly.
        </P>
        <DocTable
          caption="postMessage types"
          head={["type", "Sent when"]}
          rows={[
            [<C key="t">ready</C>, "Checkout loaded."],
            [<C key="t">resize</C>, "Content height changed (inline mode)."],
            [<C key="t">status</C>, "The intent status changed, for example to confirming."],
            [<C key="t">success</C>, "Only after checkout's server status check returns verified: true."],
            [<C key="t">close</C>, "The customer closed checkout."],
          ]}
        />
        <Note title="success is a UX signal">Ship orders from the payment.confirmed webhook. A browser message can be faked; a signed webhook can&apos;t.</Note>
      </Section>

      <Section id="no-wallet" title="When the browser has no wallet">
        <P>
          Wallet extensions often aren&apos;t available inside iframes or on phones. Checkout then shows an Open in new tab button and a QR code, so the
          customer can pay in a wallet app and your page still receives the result.
        </P>
      </Section>

      <Section id="csp" title="Content Security Policy">
        <List
          items={[
            <>
              Checkout pages send <C>frame-ancestors *</C>, so any site can embed them. Every other MezoCommerce page sends <C>frame-ancestors &apos;none&apos;</C>.
            </>,
            <>If your site sets a CSP, allow the script and the frame from the MezoCommerce origin.</>,
          ]}
        />
        <CodeBlock label="Header" code={csp} />
      </Section>

      <PageFooterNav prev={{ href: "/docs/webhooks", label: "Webhooks" }} next={{ href: "/docs/shopify", label: "Shopify" }} />
    </article>
  );
}
