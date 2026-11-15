import type { NextConfig } from "next";

// Security headers. /checkout/* must be embeddable anywhere (widget iframe); every other page refuses framing.
const base = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
];

const publicCors = [
  { key: "Access-Control-Allow-Origin", value: "*" },
  { key: "Access-Control-Allow-Methods", value: "GET, OPTIONS" },
  { key: "Access-Control-Allow-Headers", value: "Content-Type" },
  { key: "Access-Control-Max-Age", value: "86400" },
];

const nextConfig: NextConfig = {
  // PGlite ships WASM + data files that must be loaded from node_modules, not bundled (local fallback DB).
  serverExternalPackages: ["@electric-sql/pglite"],
  // Mezo Passport ships untranspiled ESM.
  transpilePackages: ["@mezo-org/passport", "@mezo-org/orangekit", "@mezo-org/orangekit-smart-account", "@mezo-org/orangekit-contracts"],
  turbopack: {
    // @coinbase/cdp-sdk (pulled in by wagmi connectors via Passport) lazily imports x402 packages this app never uses.
    resolveAlias: {
      "@x402/core/client": "./lib/stubs/empty-module.js",
      "@x402/evm": "./lib/stubs/empty-module.js",
      "@x402/evm/exact/client": "./lib/stubs/empty-module.js",
      "@x402/evm/upto/client": "./lib/stubs/empty-module.js",
      "@x402/svm/exact/client": "./lib/stubs/empty-module.js",
    },
    rules: {
      "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" },
    },
  },
  async headers() {
    return [
      {
        // Everything except the hosted checkout: no framing at all.
        source: "/((?!checkout(?:/|$)).*)",
        headers: [...base, { key: "Content-Security-Policy", value: "frame-ancestors 'none'" }, { key: "X-Frame-Options", value: "DENY" }],
      },
      {
        source: "/checkout",
        headers: [...base, { key: "Content-Security-Policy", value: "frame-ancestors *" }],
      },
      {
        source: "/checkout/:path*",
        headers: [...base, { key: "Content-Security-Policy", value: "frame-ancestors *" }],
      },
      {
        // Widget script: cross-origin loadable, short cache so fixes roll out quickly.
        source: "/checkout.js",
        headers: [
          ...publicCors,
          { key: "Cache-Control", value: "public, max-age=300, stale-while-revalidate=86400" },
          { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
        ],
      },
      {
        // Public read-only checkout API (CORS for GET only; POST stays same-origin).
        source: "/api/public/:path*",
        headers: publicCors,
      },
    ];
  },
};

export default nextConfig;
