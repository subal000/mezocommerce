import type { Metadata } from "next";
import { CodeBlock } from "@/components/shared/code-block";
import { C, DocTitle, List, Note, P, PageFooterNav, Section } from "@/components/docs/prose";
import { contracts, explorerAddress, isDeployed } from "@/lib/chain/config";

export const metadata: Metadata = {
  title: "Security and limits",
  description: "How MezoCommerce handles funds, what it verifies on-chain, and what it doesn't do yet.",
};

const revoke = `// From your owner wallet: stop the platform signer from approving new checkouts.
processor.setSigner(merchantId, platformSigner, false);

// Optional: authorise your own signer instead.
processor.setSigner(merchantId, yourSigner, true);`;

export default function SecurityPage() {
  return (
    <article>
      <DocTitle
        title="Security and limits"
        lead="MezoCommerce is testnet software. This page says plainly what it protects, how, and where it stops."
      />

      <Note title="Testnet only. Not audited." tone="warn">
        Everything runs on Mezo Testnet with test MUSD. The smart contracts have not been audited. Don&apos;t use them with real funds.
      </Note>

      <Section id="custody" title="Your money never sits with us" className="pt-8">
        <List
          items={[
            <>The payment contract moves MUSD straight from the customer&apos;s wallet to your payout wallet in the same transaction.</>,
            <>It holds no balance and has no withdraw function. There is no platform wallet to drain.</>,
            <>Refunds go from your owner or payout wallet straight back to the original payer.</>,
            <>The admin can pause new payments and choose supported tokens. It can&apos;t move funds or change merchants.</>,
          ]}
        />
      </Section>

      <Section id="signer" title="The platform signer">
        <P>
          When you register, you allow the MezoCommerce signer to sign checkouts, so your server can create payments without a wallet popup. A signature binds
          the payment id, merchant, payout wallet, token, exact amount, optional payer and expiry, and it only works on this contract and chain.
        </P>
        <P>
          A leaked signer key can&apos;t redirect money: the contract only pays to the payout wallet you set on-chain from your owner wallet. You can turn the
          signer off at any time in Settings, or directly on the contract.
        </P>
        <CodeBlock label="Revoke on-chain" code={revoke} />
      </Section>

      <Section id="verification" title="What we verify before paid">
        <List
          items={[
            <>The exact signed amount moves, or the transaction fails. Underpaying and overpaying can&apos;t happen through checkout.</>,
            <>Each payment id can be paid once. Its state is set before the transfer, and repeats are rejected.</>,
            <>
              An order is paid only after the <C>PaymentCompleted</C> event is found on-chain, every field matches the intent, and it has 2 confirmations by
              default with the block still in the chain.
            </>,
            <>Transaction hashes reported by a browser are hints. We read the receipt from the chain ourselves.</>,
            <>A reconciliation job re-reads recent payments and your merchant record from the chain and corrects any drift.</>,
            <>Approvals are for the exact amount. Checkout never asks for unlimited spending.</>,
          ]}
        />
      </Section>

      <Section id="keys" title="Keys and secrets">
        <List
          items={[
            <>
              API keys (<C>mc_test_sk_...</C>) are shown once. We store only a hash of the key and show its prefix.
            </>,
            <>Webhook secrets are shown once. Every event is signed and timestamped.</>,
            <>Shopify access tokens are stored encrypted.</>,
            <>The dashboard signs you in with a wallet signature. It never sends a transaction and costs nothing.</>,
          ]}
        />
      </Section>

      <Section id="fees" title="Fees">
        <P>The testnet MVP charges a 0% platform fee. You pay only network gas, in testnet BTC, for your own transactions such as registering and refunding.</P>
      </Section>

      <Section id="limits" title="Known limits">
        <List
          items={[
            <>Payments are in MUSD only. The MEZO token is not supported for payments.</>,
            <>No fiat conversion. Prices are set in MUSD. Shopify USD orders use a fixed 1 USD = 1 MUSD policy.</>,
            <>MUSD sent directly to your wallet, outside checkout, isn&apos;t matched to any order.</>,
            <>A cancel in the dashboard hides checkout at once. Cancel on-chain too if a customer may already have it open; otherwise a race payment is recorded as late.</>,
            <>Shopify refunds aren&apos;t synced back to Shopify.</>,
          ]}
        />
      </Section>

      <Section id="contracts" title="Contracts">
        <List
          items={[
            <>
              Payment contract:{" "}
              {isDeployed ? (
                <a href={explorerAddress(contracts.processor)} target="_blank" rel="noreferrer" className="font-mono text-[0.8125rem] break-all underline underline-offset-4">
                  {contracts.processor}
                </a>
              ) : (
                <span className="text-muted-foreground">not deployed yet</span>
              )}
            </>,
            <>
              MUSD on Mezo Testnet:{" "}
              <a href={explorerAddress(contracts.musd)} target="_blank" rel="noreferrer" className="font-mono text-[0.8125rem] break-all underline underline-offset-4">
                {contracts.musd}
              </a>
            </>,
          ]}
        />
      </Section>

      <PageFooterNav prev={{ href: "/docs/shopify", label: "Shopify" }} />
    </article>
  );
}
