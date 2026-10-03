// Before/after shots of the Affinity card's Pairs pads, at rest and mid-drag.
// Opens physarum2 on synthetic audio, opens the panel (#menuBtn), scrolls the
// pads into view, then:
//   <out>-rest.png   the window with the pads on screen
//   <out>-pads.png   the pads grid alone
//   <out>-drag.png   the window while the first pad is held mid-drag (cursor
//                    hint and the scene's spotlight, when the build has them)
//   <out>-after.png  the pads grid 1 s after letting go
// Real presses (down, wait, up) — see the headless notes on panel clicks.
// Used 2026-10-02 for the "Clearer pads" build (record, Decisions).
//
//   node padshot.mjs --port 5347 --out /path/to/prefix [--layer touch]
// From a worktree with no node_modules of its own, point PLAYWRIGHT at the
// main checkout's node_modules/playwright/index.mjs.
const { chromium } = await import(process.env.PLAYWRIGHT ?? new URL("../../../../node_modules/playwright/index.mjs", import.meta.url).href);

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const port = opt("--port", "5347");
const out = opt("--out", "./padshot");
const layer = opt("--layer", "smell");

const browser = await chromium.launch({
  channel: "chromium",
  headless: true,
  args: ["--enable-gpu", "--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("8787")) errors.push(m.text()); });
await page.goto(`https://localhost:${port}/?audio=synthetic&bpm=120#/v/physarum2`);
await page.waitForTimeout(2000);
await page.evaluate(() => document.getElementById("menuBtn")?.click());
await page.waitForTimeout(600);
if (layer === "touch") {
  const b = await page.$(".vc-pair-layer-touch");
  if (b) {
    await b.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(300);
    const bb = await b.boundingBox();
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(250);
    await page.mouse.up();
  }
}
await page.evaluate(() => document.querySelector(".vc-pads")?.scrollIntoView({ block: "center" }));
await page.waitForTimeout(3500);
await page.screenshot({ path: `${out}-rest.png` });
const grid = await page.$(".vc-pads");
if (!grid) {
  console.log("no .vc-pads found", errors);
  await browser.close();
  process.exit(1);
}
await grid.screenshot({ path: `${out}-pads.png` });

const sq = (await page.$$(".vc-pad-sq"))[0];
const r = await sq.boundingBox();
await page.mouse.move(r.x + r.width * 0.5, r.y + r.height * 0.5);
await page.waitForTimeout(300);
await page.mouse.down();
for (let i = 1; i <= 8; i++) {
  await page.mouse.move(r.x + r.width * (0.5 + 0.03 * i), r.y + r.height * (0.5 - 0.025 * i));
  await page.waitForTimeout(40);
}
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}-drag.png` });
await page.mouse.up();
await page.waitForTimeout(1000);
await grid.screenshot({ path: `${out}-after.png` });
console.log("errors:", errors.length ? errors : "none");
await browser.close();
