// Shared helpers for the demo recorder: browser contexts per wallet, CDP screencast capture per
// scene, and slow, visible cursor movement.
import { chromium } from "playwright";
import { createPublicClient, createWalletClient, defineChain, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const mezoTestnet = defineChain({
  id: 31611,
  name: "Mezo Testnet",
  nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.test.mezo.org"] } },
});
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const VIEW = { width: 1440, height: 810 }; // 16:9, captured at 4/3 scale = 1920x1080
export const SCALE = 4 / 3;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const shim = fs.readFileSync(path.join(HERE, "wallet-shim.js"), "utf8");
const overlay = fs.readFileSync(path.join(HERE, "overlay.js"), "utf8");

export async function launch() {
  return chromium.launch({ headless: true, args: ["--font-render-hinting=none", "--disable-lcd-text"] });
}

/** A browser context with an optional local test wallet (anvil account) and the recording overlay. */
export async function newContext(browser, { wallet, role } = {}) {
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: SCALE, colorScheme: "light", reducedMotion: "no-preference" });
  if (wallet) {
    const account = privateKeyToAccount(wallet.privateKey);
    const client = createWalletClient({ account, chain: mezoTestnet, transport: http(wallet.rpcUrl) });
    const reader = createPublicClient({ chain: mezoTestnet, transport: http(wallet.rpcUrl) });
    // Mezo's public RPC is load-balanced over nodes that are not always in sync. A lagging node estimates a contract
    // call as a plain transfer (~21,800 gas) and the transaction then fails. Retry low estimates, then add 25%.
    async function estimate(t) {
      for (let i = 0; i < 6; i++) {
        const g = await reader.estimateGas({ account, to: t.to, data: t.data, value: t.value ? BigInt(t.value) : undefined }).catch(() => 0n);
        if (g > (t.data && t.data !== "0x" ? 30_000n : 0n)) return (g * 125n) / 100n;
        await sleep(700);
      }
      throw new Error("gas estimate kept failing");
    }
    const pub = { address: account.address, rpcUrl: wallet.rpcUrl, chainId: wallet.chainId, name: wallet.name };
    // Signing happens here in Node; the page never sees the key.
    await ctx.exposeFunction("__demoSign", async (method, params) => {
      try {
        if (method === "personal_sign") return { result: await account.signMessage({ message: { raw: params[0] } }) };
        if (method === "eth_signTypedData_v4") {
          const td = typeof params[1] === "string" ? JSON.parse(params[1]) : params[1];
          const { EIP712Domain, ...types } = td.types;
          return { result: await account.signTypedData({ domain: td.domain, types, primaryType: td.primaryType, message: td.message }) };
        }
        if (method === "eth_sendTransaction") {
          const t = params[0];
          const hash = await client.sendTransaction({
            to: t.to,
            data: t.data,
            value: t.value ? BigInt(t.value) : undefined,
            gas: t.gas && BigInt(t.gas) > 30_000n ? BigInt(t.gas) : await estimate(t),
          });
          wallet.onTx?.(hash);
          return { result: hash };
        }
        return { error: "unsupported " + method };
      } catch (e) {
        console.warn("[demo wallet]", method, e.shortMessage || e.message, JSON.stringify(params).slice(0, 600), (e.details || "").slice(0, 300));
        return { error: e.shortMessage || e.message };
      }
    });
    await ctx.addInitScript(`window.__DEMO_WALLET = ${JSON.stringify(pub)};`);
    await ctx.addInitScript(shim);
  }
  await ctx.addInitScript(`window.__DEMO_ROLE = ${JSON.stringify(role ?? null)};`);
  await ctx.addInitScript(overlay);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.warn("[pageerror]", e.message));
  return { ctx, page };
}

/** Captures frames for one scene through the CDP screencast (much sharper than recordVideo). */
export class SceneRecorder {
  constructor(workDir) {
    this.dir = path.join(workDir, "scenes");
    fs.mkdirSync(this.dir, { recursive: true });
    this.manifest = [];
  }
  async start(id, page, audio) {
    const dir = path.join(this.dir, id);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const cdp = await page.context().newCDPSession(page);
    const frames = [];
    let n = 0;
    cdp.on("Page.screencastFrame", async (f) => {
      const file = path.join(dir, `f${String(n++).padStart(5, "0")}.jpg`);
      fs.writeFileSync(file, Buffer.from(f.data, "base64"));
      frames.push({ file: path.basename(file), t: Date.now() });
      try {
        await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId });
      } catch {}
    });
    // Force a fresh first frame even on a static page.
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
    const t0 = Date.now();
    const sc = { id, page, cdp, frames, t0, dir, audio };
    sc.elapsed = () => (Date.now() - t0) / 1000;
    /** Wait until `sec` seconds into the scene (raw scene time, ignores narration shifts). */
    sc.at = async (sec) => {
      const ms = t0 + sec * 1000 - Date.now();
      if (ms > 0) await sleep(ms);
    };
    // Narration sync: sentences can be pushed later when an action (a transaction) runs long.
    sc.shift = 0;
    sc.sentShift = audio ? audio.sentences.map(() => 0) : [];
    /** Wait until the narration reaches the given word (nth occurrence, 1-based). If we are late and
     *  the word starts a sentence, that sentence (and the rest) is delayed instead of drifting. */
    sc.atWord = async (word, nth = 1, lead = 0.15) => {
      const w = findWord(audio, word, nth);
      if (!w) throw new Error(`word "${word}" #${nth} not in narration for ${id}`);
      const target = w.start - lead + sc.shift;
      const now = sc.elapsed();
      if (now > target && w.first) {
        sc.shift += now - target;
        for (let k = w.sent; k < sc.sentShift.length; k++) sc.sentShift[k] = sc.shift;
        console.log(`  ${id}: sentence ${w.sent} pushed to ${now.toFixed(2)}s (shift ${sc.shift.toFixed(2)}s)`);
      } else if (now > target + 0.4) {
        console.log(`  ${id}: late ${(now - target).toFixed(2)}s at "${word}" (mid-sentence)`);
      }
      await sc.at(Math.max(0, w.start - lead + sc.shift));
    };
    this.current = sc;
    return sc;
  }
  async stop(sc, { tail = 0.7 } = {}) {
    const minDur = (sc.audio?.duration ?? 0) + sc.shift + tail;
    await sc.at(minDur);
    // Nudge a final frame so the last state is captured, then stop.
    await sc.page.evaluate(() => {
      const c = document.getElementById("__demo_cursor");
      if (c) c.style.opacity = c.style.opacity === "0.999" ? "1" : "0.999";
    }).catch(() => {});
    await sleep(120);
    const end = Date.now();
    await sc.cdp.send("Page.stopScreencast").catch(() => {});
    await sc.cdp.detach().catch(() => {});
    const dur = (end - sc.t0) / 1000;
    const entry = {
      id: sc.id,
      duration: dur,
      frames: sc.frames.map((f) => ({ file: f.file, t: (f.t - sc.t0) / 1000 })),
      // Narration pieces: [from, to) of the scene's clip, placed at `at` seconds into the scene.
      pieces: sc.audio ? audioPieces(sc.audio, sc.sentShift) : [],
    };
    fs.writeFileSync(path.join(sc.dir, "frames.json"), JSON.stringify(entry));
    const over = sc.audio ? dur - sc.audio.duration : 0;
    if (sc.shift > 0) console.log(`  ${sc.id}: narration shifted ${sc.shift.toFixed(2)}s in total`);
    console.log(`scene ${sc.id.padEnd(16)} ${dur.toFixed(2)}s  (audio ${sc.audio?.duration?.toFixed(2) ?? "-"}s, +${over.toFixed(2)}s)  ${sc.frames.length} frames`);
    this.manifest.push({ id: sc.id, duration: dur });
    return entry;
  }
}

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9.]/g, "").replace(/\.$/, "");
const firstTok = (s) => norm(s.split(/\s+/)[0]);
function findWord(audio, word, nth = 1) {
  if (!audio) return null;
  let k = 0;
  // A capitalised query matches case-sensitively, so "The" means a sentence start, not "the".
  const cs = /[A-Z]/.test(word[0]);
  const key = (t) => (cs ? t.split(/\s+/)[0].replace(/[^A-Za-z0-9.]/g, "") : firstTok(t));
  const want = cs ? word.replace(/[^A-Za-z0-9.]/g, "") : norm(word);
  for (const w of audio.words) if (key(w.text) === want && ++k === nth) return w;
  return null;
}
export function wordTime(audio, word, nth = 1) {
  return findWord(audio, word, nth)?.start ?? null;
}

/** Split the clip at sentence boundaries; each piece keeps its natural offset plus its shift. */
function audioPieces(audio, sentShift) {
  const out = [];
  const S = audio.sentences;
  for (let k = 0; k < S.length; k++) {
    const from = k === 0 ? 0 : S[k].cut;
    const to = k === S.length - 1 ? audio.duration : S[k + 1].cut;
    out.push({ from, to, at: from + sentShift[k] });
  }
  // Merge neighbours that stay back to back.
  const merged = [];
  for (const p of out) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(last.at + (last.to - last.from) - p.at) < 1e-6) last.to = p.to;
    else merged.push({ ...p });
  }
  return merged;
}

const narration = JSON.parse(fs.readFileSync(path.join(HERE, "narration.json"), "utf8"));
/** Word timings plus each word's sentence index, and cut points between sentences. */
export function loadAudio(workDir, id) {
  const f = path.join(workDir, "audio", `${id}.json`);
  if (!fs.existsSync(f)) return null;
  const a = JSON.parse(fs.readFileSync(f, "utf8"));
  const text = narration.scenes.find((s) => s.id === id).text;
  const ends = [];
  const re = /[.!?](\s|$)/g;
  let m;
  while ((m = re.exec(text))) ends.push(m.index);
  let pos = 0;
  for (const w of a.words) {
    const i = text.indexOf(w.text, pos);
    const at = i >= 0 ? i : pos;
    if (i >= 0) pos = i + w.text.length;
    w.sent = ends.filter((e) => e < at).length;
  }
  a.sentences = [];
  a.words.forEach((w, i) => {
    if (i === 0 || a.words[i - 1].sent !== w.sent) {
      w.first = true;
      a.sentences.push({ start: w.start, cut: i === 0 ? 0 : (a.words[i - 1].end + w.start) / 2 });
    }
  });
  return a;
}

// --- cursor ---------------------------------------------------------------------------------
const cursors = new WeakMap();
export async function moveTo(page, x, y, ms = 650) {
  const from = cursors.get(page) ?? { x: VIEW.width * 0.62, y: VIEW.height * 0.55 };
  const steps = Math.max(8, Math.round(ms / 16));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const e = 1 - Math.pow(1 - t, 3); // ease-out
    await page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
    await sleep(ms / steps);
  }
  cursors.set(page, { x, y });
}
export async function park(page, x, y) {
  await page.mouse.move(x, y);
  cursors.set(page, { x, y });
}
async function center(loc) {
  await loc.scrollIntoViewIfNeeded();
  const b = await loc.boundingBox();
  if (!b) throw new Error("element has no box");
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
export async function hover(page, loc, ms) {
  const c = await center(loc);
  await moveTo(page, c.x, c.y, ms);
}
export async function click(page, loc, { ms = 650, pause = 180 } = {}) {
  await loc.waitFor({ state: "visible", timeout: 30_000 });
  let c = await center(loc);
  await moveTo(page, c.x, c.y, ms);
  await sleep(pause);
  // The layout can move while the cursor travels (data refetches); follow the element.
  const c2 = await center(loc);
  if (Math.hypot(c2.x - c.x, c2.y - c.y) > 3) {
    await moveTo(page, c2.x, c2.y, 250);
    c = c2;
  }
  await page.mouse.down();
  await sleep(70);
  await page.mouse.up();
}
export async function type(page, loc, text, { delay = 75, clear = true } = {}) {
  await click(page, loc);
  if (clear) {
    await loc.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await loc.press("Backspace");
  }
  await loc.pressSequentially(text, { delay });
}
/** Smooth page scroll to a y offset. */
export async function scrollTo(page, y, ms = 900) {
  await page.evaluate(
    ([y, ms]) =>
      new Promise((res) => {
        const s = window.scrollY, d = y - s, t0 = performance.now();
        const f = (t) => {
          const k = Math.min(1, (t - t0) / ms);
          window.scrollTo(0, s + d * (1 - Math.pow(1 - k, 3)));
          k < 1 ? requestAnimationFrame(f) : res();
        };
        requestAnimationFrame(f);
      }),
    [y, ms],
  );
}

/** Wait for a Sonner success toast whose text matches; fail loudly on an error toast. */
export async function waitToast(page, re, timeout = 60_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const err = page.locator('[data-sonner-toast][data-type="error"]');
    if (await err.count()) throw new Error("error toast: " + (await err.first().innerText()));
    const ok = page.locator("[data-sonner-toast]").filter({ hasText: re });
    if (await ok.count()) return;
    await sleep(200);
  }
  throw new Error(`timed out waiting for toast ${re}`);
}
