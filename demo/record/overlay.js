// Recording aids injected by Playwright: a visible cursor (headless Chromium draws none)
// and a small corner tag naming the wallet in use. Nothing here touches app state.
(() => {
  const role = window.__DEMO_ROLE;
  function mount() {
    if (!document.body || !document.head || document.getElementById("__demo_cursor")) return;
    const style = document.createElement("style");
    style.textContent = `
      #__demo_cursor{position:fixed;left:0;top:0;width:22px;height:22px;z-index:2147483647;pointer-events:none;
        transform:translate(-100px,-100px);transition:none}
      #__demo_cursor svg{display:block;filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.35))}
      #__demo_click{position:fixed;width:30px;height:30px;margin:-15px 0 0 -15px;border-radius:50%;z-index:2147483646;
        pointer-events:none;border:2px solid oklch(0.52 0.105 165);opacity:0;transform:scale(.4)}
      #__demo_click.on{animation:__demo_ping .45s ease-out}
      @keyframes __demo_ping{0%{opacity:.9;transform:scale(.4)}100%{opacity:0;transform:scale(1.4)}}
      #__demo_role{position:fixed;right:20px;bottom:20px;z-index:2147483645;pointer-events:none;
        font:500 13px/1 "Geist",system-ui,sans-serif;color:#fff;background:oklch(0.22 0.014 255 / .9);
        padding:8px 11px;border-radius:6px;letter-spacing:0}
      #__demo_role b{font-weight:600}
      #__demo_role span{font-family:"Geist Mono",ui-monospace,monospace;font-weight:400;opacity:.8;margin-left:6px}
    `;
    document.head.appendChild(style);
    const c = document.createElement("div");
    c.id = "__demo_cursor";
    c.innerHTML =
      '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2 L3 18 L7.2 14.2 L10 20.5 L12.8 19.3 L10.1 13.2 L15.8 13.2 Z" fill="#111" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    document.body.appendChild(c);
    const k = document.createElement("div");
    k.id = "__demo_click";
    document.body.appendChild(k);
    if (role) {
      const r = document.createElement("div");
      r.id = "__demo_role";
      r.innerHTML = `<b>${role.label}</b><span>${role.short}</span>`;
      document.body.appendChild(r);
    }
    const pos = window.__demo_pos || { x: -100, y: -100 };
    c.style.transform = `translate(${pos.x}px,${pos.y}px)`;
    document.addEventListener(
      "mousemove",
      (e) => {
        window.__demo_pos = { x: e.clientX, y: e.clientY };
        c.style.transform = `translate(${e.clientX - 3}px,${e.clientY - 2}px)`;
      },
      true,
    );
    document.addEventListener(
      "mousedown",
      (e) => {
        k.style.left = e.clientX + "px";
        k.style.top = e.clientY + "px";
        k.classList.remove("on");
        void k.offsetWidth;
        k.classList.add("on");
      },
      true,
    );
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
  // Next.js client navigation keeps the body, but guard against re-renders removing the nodes.
  setInterval(mount, 500);
})();
