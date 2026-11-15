// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CreatedApiKeyDTO } from "@/lib/api-types";
import { dismiss, EMPTY_REVEAL, maskKey, reveal } from "@/lib/client/secrets";
import { SecretReveal } from "@/components/shared/secret-reveal";
import { CreateKeyDialog } from "@/components/merchant/developers";
import { button, byText, cleanup, click, flush, render, type } from "./dom-helpers";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/merchant/developers" }));

const SECRET = "mc_test_sk_" + "Ab3".repeat(13) + "x";
const created: CreatedApiKeyDTO = {
  id: "key_1",
  name: "Production",
  key_prefix: "mc_test_sk_Ab3A",
  permissions: ["*"],
  last_used_at: null,
  created_at: new Date().toISOString(),
  revoked_at: null,
  secret: SECRET,
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/api/merchant/api-keys") && init?.method === "POST") {
        return new Response(JSON.stringify(created), { status: 201, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const secretShown = () => document.body.textContent?.includes(SECRET) ?? false;

describe("secret helpers", () => {
  it("reveal holds the secret, dismiss wipes it for good", () => {
    expect(EMPTY_REVEAL.secret).toBeNull();
    expect(reveal("s").secret).toBe("s");
    expect(dismiss()).toEqual({ secret: null, acknowledged: true });
    expect(maskKey("mc_test_sk_Ab")).toBe("mc_test_sk_Ab••••••••");
  });
});

describe("SecretReveal", () => {
  it("only lets you continue after confirming it was saved", async () => {
    const onDone = vi.fn();
    render(<SecretReveal secret={SECRET} title="Key" body="Copy it now." onDone={onDone} />);
    expect(secretShown()).toBe(true);
    const done = button("Done")!;
    expect(done.disabled).toBe(true);
    await click(document.querySelector('[role="checkbox"]'));
    expect(button("Done")!.disabled).toBe(false);
    await click(button("Done"));
    expect(onDone).toHaveBeenCalledOnce();
  });
});

describe("Create API key dialog", () => {
  it("shows the full key once; after Done it is gone and reopening shows the form", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <CreateKeyDialog />
      </QueryClientProvider>,
    );
    await click(button("Create API key"));
    await type(document.getElementById("new-key-name"), "Production");
    await click(button("Create key"));
    await flush(10);
    expect(secretShown()).toBe(true);
    // the dialog has no close X while the secret is on screen
    expect(button("Close")).toBeNull();

    await click(document.querySelector('[role="checkbox"]'));
    await click(button("Done"));
    await flush(10);
    expect(secretShown()).toBe(false);

    await click(button("Create API key"));
    await flush(10);
    expect(secretShown()).toBe(false);
    expect(byText("Create key")).toBeTruthy();
  });
});
