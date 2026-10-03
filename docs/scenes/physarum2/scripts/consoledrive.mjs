// Real-mouse drive of the Strain Console (down / wait / up, never a scripted click): a lane
// drag, Link, double-click reset, then two stains set by hand and Synergy dragged up through its real slider (the
// hand-set stain stays where it was set, the others move to the nearest harmony).
//   node consoledrive.mjs [--port 5290] [--out <prefix>]
const { chromium } = await import(new URL("../../../../node_modules/playwright/index.mjs", import.meta.url));
const args = process.argv.slice(2);
const port = args[args.indexOf("--port") + 1] || "5290";
const out = args.includes("--out") ? args[args.indexOf("--out") + 1] : "consoledrive";
const browser = await chromium.launch({
  channel: "chromium",
  headless: true,
  args: ["--enable-gpu", "--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1300 } });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 400)));
page.on("pageerror", (e) => errors.push("PAGEERROR " + String(e).slice(0, 400)));
await page.goto(`https://localhost:${port}/?audio=synthetic&bpm=120&quality=low#/v/physarum2`);
await page.waitForTimeout(1500);
await page.evaluate(() => document.getElementById("menuBtn")?.click());
await page.waitForTimeout(1000);
await page.evaluate(() => document.querySelector(".vc-sc-lanes")?.scrollIntoView({ block: "start" }));
await page.waitForTimeout(400);

const vis = (l) => [...document.querySelectorAll(`[aria-label="${l}"]`)].find((e) => e.getBoundingClientRect().width > 0);
const val = (label) => page.evaluate((l) => [...document.querySelectorAll(`[aria-label="${l}"]`)].find((e) => e.getBoundingClientRect().width > 0)?.getAttribute("aria-valuenow"), label);
const box = async (label) => {
  const b = await page.evaluate((l) => {
    const e = [...document.querySelectorAll(`[aria-label="${l}"]`)].find((x) => x.getBoundingClientRect().width > 0);
    const r = e?.getBoundingClientRect();
    return r && r.width > 0 ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
  }, label);
  return b;
};
async function realDrag(from, to, opts = {}) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.waitForTimeout(260);
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
    await page.waitForTimeout(20);
  }
  await page.waitForTimeout(120);
  await page.mouse.up();
  await page.waitForTimeout(400);
}

// 1. Lane: Nutrient PP-B2 to ~80%.
let b = await box("Nutrient PP-B2");
console.log("lane box", JSON.stringify(b), "before", await val("Nutrient PP-B2"));
await realDrag({ x: b.x + b.w * 0.6, y: b.y + b.h / 2 }, { x: b.x + b.w * 0.8, y: b.y + b.h / 2 });
console.log("Nutrient PP-B2 after drag to 80%:", await val("Nutrient PP-B2"));
console.log("detail:", await page.evaluate(() => ({ hidden: document.querySelector(".vc-sc-detail")?.hidden, head: document.querySelector(".vc-sc-detail-head")?.textContent, rows: document.querySelector(".vc-sc-detail-row")?.children.length })));

// 2. Link: turn on for Sensor angle, drag PP-A1 → all move by the same delta.
await page.evaluate(() => {
  const rows = [...document.querySelectorAll(".vc-sc-row")];
  rows.find((r) => r.querySelector(".vc-sc-row-title")?.textContent === "Sensor angle")?.querySelector(".vc-sc-chip")?.click();
});
const angBefore = await Promise.all(["PP-A1", "PP-B2", "PP-C3", "PP-D4"].map((c) => val(`Sensor angle ${c}`)));
b = await box("Sensor angle PP-A1");
await realDrag({ x: b.x + b.w * 0.1, y: b.y + b.h / 2 }, { x: b.x + b.w * 0.2, y: b.y + b.h / 2 });
const angAfter = await Promise.all(["PP-A1", "PP-B2", "PP-C3", "PP-D4"].map((c) => val(`Sensor angle ${c}`)));
console.log("Link sensor angle", angBefore.join(), "->", angAfter.join());

// 3. Double-click resets.
b = await box("Nutrient PP-B2");
await page.mouse.dblclick(b.x + b.w * 0.5, b.y + b.h / 2);
await page.waitForTimeout(300);
console.log("Nutrient PP-B2 after dblclick (default 0.6):", await val("Nutrient PP-B2"));

// 4. Synergy on: set two stains by hand, then pull Synergy up through its real slider.
let sb = await box("Stain PP-A1");
await realDrag({ x: sb.x + sb.w * 0.5, y: sb.y + sb.h / 2 }, { x: sb.x + sb.w * 0.72, y: sb.y + sb.h / 2 });
sb = await box("Stain PP-B2");
await realDrag({ x: sb.x + sb.w * 0.5, y: sb.y + sb.h / 2 }, { x: sb.x + sb.w * 0.42, y: sb.y + sb.h / 2 });
console.log("set stains (raw):", (await Promise.all(["PP-A1", "PP-B2", "PP-C3", "PP-D4"].map((c) => val(`Stain ${c}`)))).join());
const syn = await page.evaluate(() => {
  const r = document.querySelector(".vc-sc-syn-row input.vc-slider");
  const t = r?.getBoundingClientRect();
  const all = [...document.querySelectorAll(".vc-sc-syn-row *")].map((e) => e.tagName + "." + e.className).slice(0, 12);
  return { rect: t ? { x: t.x, y: t.y, w: t.width, h: t.height } : null, tag: r?.tagName, all };
});
console.log("synergy row:", JSON.stringify(syn));
if (syn.rect) await realDrag({ x: syn.rect.x + 4, y: syn.rect.y + syn.rect.h / 2 }, { x: syn.rect.x + syn.rect.w - 2, y: syn.rect.y + syn.rect.h / 2 });
await page.waitForTimeout(1200);
const stainShown = await Promise.all(["PP-A1", "PP-B2", "PP-C3", "PP-D4"].map((c) => val(`Stain ${c}`)));
console.log("stain aria-valuenow with synergy=1 (shown):", stainShown.join());
console.log("harmony text:", await page.evaluate(() => document.querySelector(".vc-sc-harmony")?.textContent));
await page.evaluate(() => document.querySelector(".vc-sc-lanes")?.scrollIntoView({ block: "start" }));
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}-synergy.png` });
console.log("errors", JSON.stringify(errors.filter((e) => !/8787|ERR_CONNECTION_REFUSED|@fs.*40[13]/.test(e))));
await browser.close();
