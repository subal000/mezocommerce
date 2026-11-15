/*! MezoCommerce checkout widget v1. No dependencies. Usage: see /docs on the MezoCommerce site. */
/* eslint-disable @typescript-eslint/no-unused-vars -- ES2017 target: catch bindings are required */
(function () {
  "use strict";
  if (window.MezoCommerce && window.MezoCommerce.version) return;

  var doc = document;
  var cur = doc.currentScript;
  var BASE = (function () {
    try { return new URL((cur && cur.src) || "", location.href).origin; } catch (e) { return location.origin; }
  })();
  var ID_RE = /^pi_[A-Za-z0-9]{24}$/;
  var HEX_RE = /^0x[0-9a-fA-F]{64}$/;
  var Z = 2147483000;
  var active = null; // the one open modal/inline session

  function isValidId(id) { return typeof id === "string" && (ID_RE.test(id) || HEX_RE.test(id)); }

  /** Resolve {paymentId|checkoutUrl} to the checkout URL on the widget's own origin, or throw. */
  function checkoutUrl(o) {
    var id = o.paymentId;
    if (!id && o.checkoutUrl) {
      var u;
      try { u = new URL(o.checkoutUrl, location.href); } catch (e) { throw new Error("MezoCommerce: checkoutUrl is not a valid URL"); }
      if (u.origin !== BASE) throw new Error("MezoCommerce: checkoutUrl must be on " + BASE);
      var m = /^\/checkout\/([^/?#]+)\/?$/.exec(u.pathname);
      id = m ? decodeURIComponent(m[1]) : "";
    }
    if (!isValidId(id)) throw new Error("MezoCommerce: invalid payment id");
    return BASE + "/checkout/" + encodeURIComponent(id);
  }

  function el(tag, attrs, text) {
    var n = doc.createElement(tag);
    for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) n.setAttribute(k, attrs[k]);
    if (text) n.textContent = text;
    return n;
  }

  function call(fn, arg) { if (typeof fn === "function") { try { fn(arg); } catch (e) { setTimeout(function () { throw e; }); } } }

  function fail(o, err) {
    if (typeof o.onError === "function") { call(o.onError, err); return null; }
    throw err;
  }

  var CSS =
    ":host{all:initial}" +
    ".ov{position:fixed;inset:0;z-index:" + Z + ";display:flex;align-items:center;justify-content:center;padding:16px;" +
    "background:rgba(17,20,26,.5);font:14px/1.4 system-ui,-apple-system,'Segoe UI',sans-serif;opacity:0}" +
    ".ov.in{opacity:1}" +
    ".dlg{position:relative;width:100%;max-width:460px;max-height:calc(100vh - 32px);overflow:auto;border-radius:12px;" +
    "background:#fff;color:#1b1e24;box-shadow:0 1px 2px rgba(0,0,0,.08),0 24px 48px -12px rgba(17,20,26,.35);outline:none}" +
    ".x{position:absolute;top:10px;right:10px;z-index:1;width:32px;height:32px;border:0;border-radius:8px;cursor:pointer;" +
    "background:transparent;color:inherit;font-size:20px;line-height:32px;opacity:.65}" +
    ".x:hover{opacity:1;background:rgba(127,127,127,.12)}.x:focus-visible{outline:2px solid #2f8f6f;outline-offset:2px;opacity:1}" +
    "iframe{display:block;width:100%;height:560px;border:0;background:transparent}" +
    ".ld{padding:56px 24px;text-align:center;color:#5b6170}.ld[hidden]{display:none}" +
    ".sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}" +
    "@media (prefers-reduced-motion:no-preference){.ov{transition:opacity .16s ease-out}}" +
    "@media (prefers-color-scheme:dark){.dlg{background:#1e2229;color:#eef0f3}.ld{color:#a3a9b5}}" +
    "@media (max-width:520px){.ov{align-items:flex-end;padding:0}.dlg{max-width:none;max-height:92vh;border-radius:12px 12px 0 0}}";

  function makeFrame(url) {
    return el("iframe", {
      src: url + "?embed=1",
      title: "Pay with MUSD",
      sandbox: "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox",
      allow: "clipboard-write",
      referrerpolicy: "origin",
    });
  }

  function open(o) {
    o = o || {};
    var url;
    try { url = checkoutUrl(o); } catch (e) { return fail(o, e); }
    var mode = o.mode || "modal";
    if (mode === "redirect") { location.assign(url); return { close: function () {} }; }
    if (active) active.close(true);

    var host = el("div", { "data-mezocommerce": mode });
    var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
    root.appendChild(el("style", {}, CSS));
    var frame = makeFrame(url);
    var loading = el("div", { class: "ld", role: "status" }, "Loading checkout…");
    var succeeded = false, expired = false, closed = false;
    var prevFocus = doc.activeElement;
    var lock = null, onKey = null;

    function close(silent, data) {
      if (closed) return;
      closed = true;
      window.removeEventListener("message", onMsg);
      if (onKey) doc.removeEventListener("keydown", onKey, true);
      if (lock) { doc.documentElement.style.overflow = lock[0]; doc.body.style.paddingRight = lock[1]; }
      if (host.parentNode) host.parentNode.removeChild(host);
      if (active === session) active = null;
      if (prevFocus && typeof prevFocus.focus === "function" && mode === "modal") { try { prevFocus.focus(); } catch (e) { /* gone */ } }
      if (!silent && !succeeded) call(o.onCancel, data || { paymentIntentId: null, status: null });
    }

    function onMsg(ev) {
      // Only our iframe, served from the widget's own origin.
      if (ev.origin !== BASE || ev.source !== frame.contentWindow) return;
      var d = ev.data;
      if (!d || typeof d !== "object" || d.source !== "mezocommerce" || typeof d.type !== "string") return;
      var info = { paymentIntentId: d.paymentIntentId || null, status: d.status || null, txHash: d.txHash || null };
      if (d.type === "ready") loading.hidden = true;
      else if (d.type === "resize" && typeof d.height === "number" && d.height > 0) {
        loading.hidden = true;
        frame.style.height = Math.min(Math.max(Math.ceil(d.height), 240), 4000) + "px";
      } else if (d.type === "status") {
        call(o.onStatus, info);
        if (d.status === "expired" && !expired) { expired = true; call(o.onExpired, info); }
      } else if (d.type === "success" && !succeeded) {
        succeeded = true;
        call(o.onSuccess, info);
      } else if (d.type === "close") {
        try { frame.contentWindow.postMessage({ source: "mezocommerce-widget", type: "close" }, BASE); } catch (e) { /* ignore */ }
        close(false, info);
      }
    }

    var session = { close: function () { close(false); } };

    if (mode === "inline") {
      var c = typeof o.container === "string" ? doc.querySelector(o.container) : o.container;
      if (!c || !c.appendChild) return fail(o, new Error("MezoCommerce: inline mode needs a container element"));
      root.appendChild(loading);
      root.appendChild(frame);
      c.appendChild(host);
    } else {
      var ov = el("div", { class: "ov" });
      var dlg = el("div", { class: "dlg", role: "dialog", "aria-modal": "true", "aria-label": "Pay with MUSD", tabindex: "-1" });
      var x = el("button", { class: "x", type: "button", "aria-label": "Close checkout" }, "×");
      var s1 = el("span", { tabindex: "0", class: "sr" }), s2 = el("span", { tabindex: "0", class: "sr" });
      x.addEventListener("click", function () { close(false); });
      ov.addEventListener("mousedown", function (e) { if (e.target === ov) close(false); });
      // focus trap: sentinels wrap focus between the close button and the checkout frame
      s1.addEventListener("focus", function () { frame.focus(); });
      s2.addEventListener("focus", function () { x.focus(); });
      onKey = function (e) { if (e.key === "Escape") { e.stopPropagation(); close(false); } };
      doc.addEventListener("keydown", onKey, true);
      dlg.appendChild(x); dlg.appendChild(loading); dlg.appendChild(frame);
      ov.appendChild(s1); ov.appendChild(dlg); ov.appendChild(s2);
      root.appendChild(ov);
      var sw = window.innerWidth - doc.documentElement.clientWidth;
      lock = [doc.documentElement.style.overflow, doc.body.style.paddingRight];
      doc.documentElement.style.overflow = "hidden";
      if (sw > 0) doc.body.style.paddingRight = sw + "px";
      doc.body.appendChild(host);
      x.focus();
      (window.requestAnimationFrame || setTimeout)(function () { ov.className = "ov in"; });
    }
    window.addEventListener("message", onMsg);
    active = session;
    return session;
  }

  var BTN_CSS =
    ":host{display:inline-block}button{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;" +
    "gap:8px;min-height:44px;padding:0 20px;border-radius:8px;background:#1b1e24;color:#fff;cursor:pointer;" +
    "font:600 15px/1 system-ui,-apple-system,'Segoe UI',sans-serif}button:hover{background:#2c313a}" +
    "button:focus-visible{outline:2px solid #2f8f6f;outline-offset:2px}button[disabled]{opacity:.6;cursor:progress}";

  function button(target, o) {
    o = o || {};
    var mount = typeof target === "string" ? doc.querySelector(target) : target;
    if (!mount || !mount.appendChild) throw new Error("MezoCommerce: button target not found");
    if (!o.paymentId && !o.createUrl) throw new Error("MezoCommerce: button needs paymentId or createUrl");
    if (o.paymentId && !isValidId(o.paymentId)) throw new Error("MezoCommerce: invalid payment id");
    var label = o.label || "Pay with MUSD";
    var host = el("span", { "data-mezocommerce": "button" });
    var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
    root.appendChild(el("style", {}, BTN_CSS));
    var b = el("button", { type: "button" }, label);
    root.appendChild(b);
    mount.appendChild(host);

    function opts(extra) {
      var r = {};
      for (var k in o) if (k !== "createUrl" && k !== "label" && k !== "body") r[k] = o[k];
      for (var j in extra) r[j] = extra[j];
      return r;
    }

    b.addEventListener("click", function () {
      if (b.disabled) return;
      if (o.paymentId) { open(opts({})); return; }
      b.disabled = true; b.setAttribute("aria-busy", "true"); b.textContent = "Opening checkout…";
      fetch(o.createUrl, {
        method: "POST",
        credentials: "same-origin",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(o.body || {}),
      })
        .then(function (r) {
          if (!r.ok) throw new Error("MezoCommerce: createUrl answered " + r.status);
          return r.json();
        })
        .then(function (j) {
          var next = j && j.payment_intent_id ? { paymentId: j.payment_intent_id } : j && j.checkout_url ? { checkoutUrl: j.checkout_url } : null;
          if (!next) throw new Error("MezoCommerce: createUrl must return payment_intent_id or checkout_url");
          open(opts(next));
        })
        .catch(function (e) { if (typeof o.onError === "function") call(o.onError, e); else if (window.console) console.error(e); })
        .then(function () { b.disabled = false; b.removeAttribute("aria-busy"); b.textContent = label; });
    });
    return { element: host, destroy: function () { if (host.parentNode) host.parentNode.removeChild(host); } };
  }

  window.MezoCommerce = { version: "1", baseUrl: BASE, checkout: open, button: button, isValidId: isValidId };
})();
