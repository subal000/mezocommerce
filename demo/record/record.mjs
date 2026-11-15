// Records every scene of the MezoCommerce demo against the live site on Mezo testnet, with real transactions:
// a fresh merchant wallet onboards and registers on-chain, creates a payment link, and the customer wallet pays it.
// Usage: node record.mjs <workDir>
// Env: MERCHANT_PK, CUSTOMER_PK (hex private keys; used in Node only, never sent to the page), APP (default live site)
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { privateKeyToAccount } from "viem/accounts";
import { HERE, SceneRecorder, click, hover, launch, loadAudio, newContext, park, scrollTo, sleep, type } from "./lib.mjs";

const WORK = path.resolve(process.argv[2] ?? path.join(HERE, "../out/work"));
const APP = process.env.APP ?? "https://mezocommerce.vercel.app";
const RPC = "https://rpc.test.mezo.org";
const CARDS = pathToFileURL(path.join(HERE, "cards.html")).href;
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const MERCHANT_PK = process.env.MERCHANT_PK;
const CUSTOMER_PK = process.env.CUSTOMER_PK;
if (!MERCHANT_PK || !CUSTOMER_PK) throw new Error("set MERCHANT_PK and CUSTOMER_PK");
const merchantAddr = privateKeyToAccount(MERCHANT_PK).address;
const customerAddr = privateKeyToAccount(CUSTOMER_PK).address;
const txs = [];
const wallet = (pk, who) => ({ privateKey: pk, rpcUrl: RPC, chainId: 31611, name: "Demo wallet", onTx: (h) => txs.push({ who, hash: h }) });

const rec = new SceneRecorder(WORK);
const A = (id) => loadAudio(WORK, id);
const fast = { ms: 420, pause: 120 };

async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15_000 }).catch(() => {});
  await sleep(500);
}
async function card(p, id) {
  await p.goto(`${CARDS}#${id}`);
  await p.waitForLoadState("networkidle");
  await p.evaluate(() => document.fonts.ready);
  await park(p, -50, -50);
  await sleep(400);
}

const browser = await launch();
const cards = await newContext(browser, {});
const visitor = await newContext(browser, {});
const merchant = await newContext(browser, { wallet: wallet(MERCHANT_PK, "merchant"), role: { label: "Merchant", short: short(merchantAddr) } });
const customer = await newContext(browser, { wallet: wallet(CUSTOMER_PK, "customer"), role: { label: "Customer", short: short(customerAddr) } });
for (const c of [visitor, merchant, customer]) {
  c.page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) console.log("[console]", m.text().slice(0, 160));
  });
}

// Warm up the pages that load slowly.
const landingWarm = visitor.page.goto(APP, { timeout: 120_000 }).catch(() => {});
const merchantWarm = merchant.page.goto(`${APP}/merchant`, { timeout: 120_000 }).catch(() => {});

// 1. Intro: the problem ----------------------------------------------------------------------
{
  const p = cards.page;
  await card(p, "intro");
  const sc = await rec.start("intro", p, A("intro"));
  await sc.atWord("Then", 1, 0.1);
  await p.evaluate(() => window.step(1));
  await sc.atWord("Wrong", 1, 0.1);
  await p.evaluate(() => window.step(2));
  await sc.atWord("marked", 1, 0.3);
  await p.evaluate(() => window.step(3));
  await rec.stop(sc, { tail: 0.5 });
}

// 2. Landing page: what it is ---------------------------------------------------------------
await landingWarm;
{
  const p = visitor.page;
  await settle(p);
  await park(p, 700, 300);
  const sc = await rec.start("landing", p, A("landing"));
  await hover(p, p.locator("h1").first(), 700);
  await sc.atWord("hosted", 1, 0.3);
  await scrollTo(p, 620, 1600);
  await sc.atWord("straight", 1, 0.3);
  await scrollTo(p, 1250, 1600);
  await rec.stop(sc, { tail: 0.4 });
}

// 3. Merchant onboarding: store details, register on Mezo (real tx) ----------------------------
// Sign-in (one free signature) happens before the camera rolls. The two network waits (saving the store, and
// confirming the registration transaction) are cut; the narration keeps playing across the cuts.
await merchantWarm;
{
  const p = merchant.page;
  await settle(p);
  await p.getByRole("button", { name: "Sign in" }).click({ timeout: 60_000 });
  await p.getByLabel("Store name").waitFor({ timeout: 60_000 });
  await sleep(500);
  await park(p, 900, 500);
  const audio = A("onboard");
  const sc = await rec.start("onboard", p, audio);
  await sc.atWord("names", 1, 0.3);
  await type(p, p.getByLabel("Store name"), "Larkspur Tea Co.", { delay: 45 });
  await click(p, p.getByRole("button", { name: "Save and continue" }), fast);
  const e1 = sc.elapsed();
  await rec.stop(sc, { tail: -100 }); // narration continues over the next pieces
  const reg = p.getByRole("button", { name: "Register your store on Mezo" });
  await reg.waitFor({ timeout: 60_000 });
  await sleep(300);
  const sb = await rec.start("onboard-b", p, null);
  await sleep(500);
  await click(p, reg, fast);
  await sleep(3200); // the wallet signs and the transaction is sent; the panel shows it confirming
  const e2 = sb.elapsed();
  await rec.stop(sb, { tail: 0 });
  await p.getByRole("button", { name: "Skip for now" }).waitFor({ timeout: 180_000 });
  await sleep(300);
  const sc3 = await rec.start("onboard-c", p, null);
  await sleep(700);
  await click(p, p.getByRole("button", { name: "Skip for now" }), fast);
  await click(p, p.getByRole("button", { name: "Go to dashboard" }), fast);
  await p.getByText("Paid orders").first().waitFor({ timeout: 30_000 }); // overview loaded, not skeletons
  await sleep(700);
  await sc3.at(Math.max(sc3.elapsed() + 1.2, audio.duration + sc.shift + 0.5 - e1 - e2));
  await rec.stop(sc3, { tail: 0 });
}

// 4. Create a payment link (no wallet prompt) ------------------------------------------------
let checkoutUrl;
{
  const p = merchant.page;
  await p.goto(`${APP}/merchant/payments/new`);
  await settle(p);
  await park(p, 900, 300);
  const audio = A("create");
  const sc = await rec.start("create", p, audio);
  await sc.atWord("12.50", 1, 0.4);
  await type(p, p.getByLabel("Amount (MUSD)"), "12.50", { delay: 60 });
  await type(p, p.getByLabel("Order ID"), "ORDER-1042", { delay: 30 });
  await sc.atWord("tea", 1, 0.5);
  await type(p, p.getByLabel(/What it's for/), "Darjeeling first flush, 100 g tin", { delay: 22 });
  await sc.atWord("One", 1, 0.2);
  await click(p, p.getByRole("button", { name: "Create payment link" }), fast);
  const e1 = sc.elapsed();
  await rec.stop(sc, { tail: -100 });
  const link = p.locator("a[href*='/checkout/']").first();
  await link.waitFor({ timeout: 30_000 });
  checkoutUrl = await link.getAttribute("href");
  await sleep(300);
  const sb = await rec.start("create-b", p, null);
  await hover(p, p.getByRole("img", { name: /QR code/ }).first(), 500);
  await sb.at(Math.max(2.2, audio.duration + sc.shift + 0.6 - e1));
  await rec.stop(sb, { tail: 0 });
}

// 5. Customer pays: permit signature + one transaction (real) -------------------------------
{
  const p = customer.page;
  await p.goto(checkoutUrl);
  await settle(p);
  await p.getByRole("button", { name: /^Pay .* MUSD$/ }).waitFor({ timeout: 60_000 });
  await park(p, 700, 450);
  const sc = await rec.start("pay", p, A("pay"));
  await sc.atWord("store", 1, 0.3);
  await hover(p, p.getByText("Larkspur Tea Co.").first(), 450);
  await sc.atWord("amount", 1, 0.3);
  await hover(p, p.getByText("12.50").first(), 450);
  await sc.atWord("locked", 1, 0.3);
  await hover(p, p.getByText(/spending permission for exactly/), 450);
  await sc.atWord("sign", 1, 0.3);
  await click(p, p.getByRole("button", { name: /^Pay .* MUSD$/ }), fast);
  await p.getByText(/Confirming your payment|Waiting for the network|Payment received/).first().waitFor({ timeout: 90_000 });
  await sleep(1500);
  await rec.stop(sc, { tail: 0.3 });
}

// 6. Verified on-chain: receipt ---------------------------------------------------------------
{
  const p = customer.page;
  // Not recorded: the wait for the second confirmation (the video cuts from "Confirming" to the receipt).
  const t0 = Date.now();
  await p.getByText(/Payment received/).first().waitFor({ timeout: 240_000 });
  console.log(`  confirmations took ${((Date.now() - t0) / 1000).toFixed(1)}s after the pay scene (cut)`);
  await sleep(600);
  await park(p, 1300, 260);
  const sc = await rec.start("paid", p, A("paid"));
  await sc.atWord("two", 1, 0.3);
  await hover(p, p.getByText("Payment received"), 450);
  await sc.atWord("link", 1, 0.4);
  await hover(p, p.locator("a[href*='explorer.test.mezo.org/tx/']").first(), 500);
  await rec.stop(sc, { tail: 0.5 });
}

// 7. Merchant dashboard -----------------------------------------------------------------------
{
  const p = merchant.page;
  await p.goto(`${APP}/merchant/payments`);
  await settle(p);
  await p.getByText("Paid", { exact: true }).first().waitFor({ timeout: 60_000 });
  await park(p, 1100, 600);
  const sc = await rec.start("dashboard", p, A("dashboard"));
  await sc.atWord("sees", 1, 0.3);
  await hover(p, p.getByRole("row").filter({ hasText: "ORDER-1042" }).getByText("Paid", { exact: true }), 500);
  await sc.atWord("Refunds", 1, 0.3);
  await click(p, p.getByRole("row").filter({ hasText: "ORDER-1042" }).getByText("ORDER-1042"), fast);
  await settle(p);
  const refundBtn = p.getByRole("button", { name: /refund/i }).first();
  if (await refundBtn.count()) await hover(p, refundBtn, 500);
  await rec.stop(sc, { tail: 0.5 });
}

// 8. How it works -----------------------------------------------------------------------------
{
  const p = cards.page;
  await card(p, "how");
  const sc = await rec.start("how", p, A("how"));
  await sc.atWord("paid", 1, 0.3);
  await p.evaluate(() => window.step(1));
  await sc.atWord("wrong", 1, 0.2);
  await p.evaluate(() => window.step(2));
  await sc.atWord("never", 1, 0.3);
  await p.evaluate(() => window.step(3));
  await rec.stop(sc, { tail: 0.6 });
}

// 9. Live on Mezo testnet: contracts in the footer, then the Mezo Passport wallet picker -------
{
  const p = visitor.page;
  const pp = await visitor.ctx.newPage();
  await pp.goto(`${APP}/merchant`);
  await settle(pp);
  await p.goto(APP);
  await settle(p);
  // Room under the footer so the subtitles don't sit on the contract list.
  await p.addStyleTag({ content: "footer{padding-bottom:150px}" });
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(600);
  await park(p, 900, 500);
  const audio = A("live");
  const sc = await rec.start("live", p, audio);
  await sc.atWord("verified", 1, 0.6);
  await hover(p, p.locator("footer dd a").first(), 500);
  await sc.atWord("Wallets", 1, 0.35);
  const e1 = sc.elapsed();
  await rec.stop(sc, { tail: -100 });
  await pp.bringToFront();
  await park(pp, 900, 400);
  const sb = await rec.start("live-b", pp, null);
  await click(pp, pp.getByRole("button", { name: /connect wallet/i }).first(), fast);
  await pp.getByText("Unisat", { exact: true }).waitFor({ timeout: 15_000 });
  await hover(pp, pp.getByText("Unisat", { exact: true }), 350);
  await sleep(300);
  await hover(pp, pp.getByText("Xverse", { exact: true }), 350);
  await sleep(300);
  await hover(pp, pp.getByText("Ethereum wallets", { exact: true }), 400);
  await sb.at(Math.max(sb.elapsed() + 0.6, audio.duration + sc.shift + 0.6 - e1));
  await rec.stop(sb, { tail: 0 });
}

// 10. Outro -----------------------------------------------------------------------------------
{
  const p = cards.page;
  await card(p, "outro");
  const sc = await rec.start("outro", p, A("outro"));
  await sc.atWord("Shopify", 1, 0.1);
  await p.evaluate(() => window.step(1));
  await sc.atWord("more", 1, 0.1);
  await p.evaluate(() => window.step(2));
  await sc.atWord("store", 1, 0.1);
  await p.evaluate(() => window.step(3));
  await rec.stop(sc, { tail: 1.8 });
}

await browser.close();
fs.writeFileSync(path.join(WORK, "scenes", "manifest.json"), JSON.stringify(rec.manifest, null, 1));
fs.writeFileSync(path.join(WORK, "txs.json"), JSON.stringify({ checkoutUrl, merchant: merchantAddr, customer: customerAddr, txs }, null, 1));
console.log("done", checkoutUrl, txs);
