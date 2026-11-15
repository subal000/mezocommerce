export const SITE = {
  name: "MezoCommerce",
  tagline: "Accept payments in MUSD. Sell beyond traditional payment rails.",
  description:
    "Checkout for online stores that takes MUSD on Mezo Testnet. Customers pay straight to your wallet, and every order is checked on-chain before it's marked paid.",
  url: (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, ""),
  faucetUrl: "https://testnet.mezo.org",
  mezoUrl: "https://mezo.org",
} as const;
