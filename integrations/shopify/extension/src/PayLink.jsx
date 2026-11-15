// Thank-you / order-status block: link the customer to MezoCommerce's hosted checkout for this order.
// The link only opens checkout; payment is verified on-chain by MezoCommerce, and the order is marked paid in
// Shopify by the MezoCommerce worker (orderMarkAsPaid). Nothing here is trusted as proof of payment.
// NOTE: written against the 2025-07 Checkout UI extensions React API; not built or tested in this repository.
import {
  reactExtension,
  Banner,
  BlockStack,
  Button,
  Text,
  useApi,
  useSettings,
} from "@shopify/ui-extensions-react/checkout";

export const thankYou = reactExtension("purchase.thank-you.block.render", () => <PayLink />);
export const orderStatus = reactExtension("customer-account.order-status.block.render", () => <PayLink />);

function numericId(gid) {
  const m = /\/(\d+)$/.exec(String(gid || ""));
  return m ? m[1] : null;
}

function PayLink() {
  const api = useApi();
  const settings = useSettings();
  const appUrl = String(settings.app_url || "").replace(/\/+$/, "");
  const methodName = String(settings.payment_method_name || "Pay with MUSD").toLowerCase();

  // orderConfirmation (thank-you) or order (order status) depending on the target.
  const order = api.orderConfirmation?.current?.order ?? api.order?.current;
  const orderId = numericId(order?.id);
  const shop = api.shop?.myshopifyDomain;
  const gateways = (api.paymentMethods?.current ?? api.selectedPaymentOptions?.current ?? [])
    .map((p) => String(p.name || p.handle || "").toLowerCase());

  if (!appUrl || !orderId || !shop) return null;
  // Only show for orders that picked the MUSD manual method (when the API exposes it).
  if (gateways.length && !gateways.includes(methodName)) return null;

  const href = `${appUrl}/pay/shopify/${shop}/${orderId}`;
  return (
    <Banner title="Complete your payment in MUSD" status="info">
      <BlockStack spacing="base">
        <Text>Your order is reserved. Pay the exact amount in MUSD on Mezo to complete it.</Text>
        <Button to={href} external>
          Pay with MUSD
        </Button>
      </BlockStack>
    </Banner>
  );
}
