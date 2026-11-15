// Mezo Passport's config module (loaded by lib/client/wagmi.ts in the browser) uses extensionless ESM imports that
// only resolve inside the Next bundler. Tests replace lib/client/wagmi with a plain wagmi config (no connectors);
// isSmartAccountConnector keeps its real logic.
import { vi } from "vitest";

vi.mock("@/lib/client/wagmi", async () => {
  const { createConfig, http } = await import("wagmi");
  const { mezoTestnet } = await import("@/lib/chain/config");
  return {
    wagmiConfig: createConfig({ chains: [mezoTestnet], transports: { [mezoTestnet.id]: http() }, connectors: [], ssr: true }),
    isSmartAccountConnector: (c: { type?: string } | null | undefined) => c?.type === "orangekit",
  };
});
