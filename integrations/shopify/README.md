# Shopify: accept MUSD with MezoCommerce

MezoCommerce connects to Shopify as a **custom app + manual payment method**. It is **not** a Shopify Payments
gateway: Shopify only lets approved Payments Partners add a real checkout payment method, so the customer places
the order with a manual method called "Pay with MUSD" and pays in MUSD on the next page.

## What happens

1. The customer chooses **Pay with MUSD** at checkout and places the order. Shopify marks it *Payment pending*.
2. Shopify sends `orders/create` to MezoCommerce. If the order uses the MUSD method, is pending and is in **USD**,
   MezoCommerce creates a payment intent for the order total at **1 USD = 1 MUSD** (MUSD is a USD-pegged
   stablecoin; no price oracle). Orders in any other currency are skipped and listed with the reason.
3. The customer opens the pay link (`https://<app>/pay/shopify/<shop>.myshopify.com/<order id>`) from the
   thank-you page, the order-status page or the order confirmation email, and pays on the hosted checkout.
4. When the payment is verified on-chain and has enough confirmations, the MezoCommerce worker calls
   `orderMarkAsPaid` once (it checks `displayFinancialStatus` first, retries with backoff and never marks twice).

Funds go straight from the customer's wallet to your payout wallet. MezoCommerce never holds them.

## Setup (about 10 minutes)

1. **Finish MezoCommerce onboarding** (merchant registered on-chain, platform signer enabled, active).
2. **Add the manual payment method.** Shopify admin → Settings → Payments → Manual payment methods → *Create custom
   payment method*. Name it exactly `Pay with MUSD` (or another name, and enter the same name in step 4).
   Suggested instructions: "After placing your order, use the Pay with MUSD link on the next page to pay in MUSD."
3. **Create a custom app.** Shopify admin → Settings → Apps and sales channels → Develop apps → *Create an app*.
   Under *Configuration → Admin API integration* grant `read_orders` and `write_orders`. Install the app, then copy
   the **Admin API access token** (`shpat_…`, shown once) and the app's **API secret key**.
4. **Connect in MezoCommerce.** Dashboard → Settings → Shopify: shop domain (`your-store.myshopify.com`), Admin API
   access token, API secret key and the payment method name. MezoCommerce tests the token with a small read and
   stores both secrets encrypted (AES-256-GCM).
5. **Add the webhook.** In the same custom app (or Settings → Notifications → Webhooks), create an `Order creation`
   webhook, JSON format, API version `2025-07`, pointing at the **Webhook URL** shown on the Shopify settings page:
   `https://<app>/api/integrations/shopify/webhook/<your-merchant-slug>`. Webhooks created by the custom app are
   signed with the API secret key from step 3; MezoCommerce rejects anything with a bad `X-Shopify-Hmac-Sha256` and
   ignores repeated `X-Shopify-Webhook-Id`s.
6. **Give customers the pay link.** Pick one or both:
   - *Order confirmation email* (Settings → Notifications → Order confirmation), inside a block that only renders
     for the MUSD method:
     ```liquid
     {% if transaction.gateway == "Pay with MUSD" or order.gateway == "Pay with MUSD" %}
       <a href="https://<app>/pay/shopify/{{ shop.permanent_domain }}/{{ order.id }}">Pay with MUSD</a>
     {% endif %}
     ```
   - *Thank-you / order-status page*: the Checkout UI extension in `extension/` (see below).

## Checkout UI extension (`extension/`)

Source for a block on the thank-you and order-status pages that shows a "Pay with MUSD" button linking to
`/pay/shopify/<shop>/<order id>`. To use it: create a Shopify app with the Shopify CLI (`shopify app init`), copy
`extension/` into `extensions/mezocommerce-pay-link`, run `shopify app deploy`, then add the block in the checkout
editor and set the `app_url` setting.

**It has not been built, deployed or tested in this repository** (no Shopify CLI, partner account or dev store was
available). The React API target names and `useApi()` fields were written against the 2025-07 extension docs and may
need small adjustments when you build it. The order confirmation email link above needs no app deployment.

## Limits (honest list)

- Not a Shopify Payments gateway; the order is placed first and paid right after. Unpaid orders stay *Payment
  pending* in Shopify; cancel them as you would any manual-payment order.
- USD orders only, priced 1 USD = 1 MUSD. Other currencies are skipped (visible in Dashboard → Shopify → Orders).
- Shopify's order total is read once when the intent is created. If you edit an order afterwards, cancel the intent
  in the MezoCommerce dashboard and reopen the pay link to create a new one.
- Refunds are sent from your wallet in the MezoCommerce dashboard; MezoCommerce does not create Shopify refunds.
- Testnet only (Mezo Testnet, chain 31611); MUSD has no real value here.
