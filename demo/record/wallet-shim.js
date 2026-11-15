// Injected by Playwright (addInitScript) into the demo recording contexts only. A minimal EIP-1193 provider.
// Reads go straight to the Mezo testnet RPC. Signing calls go to a Node binding (window.__demoSign, see lib.mjs)
// that signs with the demo wallet's key, so every signature and transaction on screen is real.
// Expects window.__DEMO_WALLET = { address, rpcUrl, chainId, name } to be set first.
(() => {
  const cfg = window.__DEMO_WALLET;
  if (!cfg) return;
  const listeners = {};
  let id = 0;
  const chainHex = "0x" + Number(cfg.chainId).toString(16);
  async function rpc(method, params) {
    const res = await fetch(cfg.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params: params ?? [] }),
    });
    const j = await res.json();
    if (j.error) {
      const e = new Error(j.error.message);
      e.code = j.error.code;
      e.data = j.error.data;
      throw e;
    }
    return j.result;
  }
  async function sign(method, params) {
    const r = await window.__demoSign(method, params ?? []);
    if (r && r.error) {
      const e = new Error(r.error);
      e.code = 4001;
      throw e;
    }
    return r.result;
  }
  const provider = {
    isDemoWallet: true,
    async request({ method, params }) {
      switch (method) {
        case "eth_requestAccounts":
        case "eth_accounts":
          return [cfg.address];
        case "eth_chainId":
          return chainHex;
        case "net_version":
          return String(cfg.chainId);
        case "wallet_switchEthereumChain":
        case "wallet_addEthereumChain":
          return null;
        case "wallet_requestPermissions":
        case "wallet_getPermissions":
          return [{ parentCapability: "eth_accounts" }];
        case "personal_sign":
        case "eth_signTypedData_v4":
        case "eth_sendTransaction":
          return sign(method, params);
        default:
          return rpc(method, params);
      }
    },
    on(ev, fn) {
      (listeners[ev] ||= []).push(fn);
      return provider;
    },
    removeListener(ev, fn) {
      listeners[ev] = (listeners[ev] || []).filter((f) => f !== fn);
      return provider;
    },
  };
  window.ethereum = provider;
  const info = {
    uuid: "5d3b1f6e-0d3c-4a43-9a51-6f1c2d0b7a12",
    name: cfg.name || "Demo wallet",
    icon:
      "data:image/svg+xml;utf8," +
      encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#1b1f26"/><circle cx="16" cy="16" r="6" fill="none" stroke="#fff" stroke-width="2"/></svg>'),
    rdns: "local.demo.wallet",
  };
  const announce = () =>
    window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
})();
