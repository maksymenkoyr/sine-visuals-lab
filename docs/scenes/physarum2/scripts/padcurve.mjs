// Sweeps the pointer across the first Pairs pad's zero line (horizontally,
// centre row) and prints the A1 -> B2 value at each position, so the pad's
// response around the line where a relation flips sign can be compared
// before and after a mapping change (PAD_CURVE in physarum2Affinity.ts).
// Screenshots the pads grid at the end.
//   node padcurve.mjs --port 5347 --out /path/to/shot.png
const { chromium } = await import(new URL("../../../../node_modules/playwright/index.mjs", import.meta.url));

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const port = opt("--port", "5347");
const out = opt("--out", "pads.png");

const browser = await chromium.launch({
  channel: "chromium",
  headless: true,
  args: ["--enable-gpu", "--use-angle=metal", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(`https://localhost:${port}/?audio=synthetic&bpm=120#/v/physarum2`);
await page.evaluate(() => { try { localStorage.clear(); } catch {} });
await page.reload();
await page.waitForSelector("#menuBtn", { state: "visible", timeout: 15000 });
await page.evaluate(() => document.getElementById("menuBtn")?.click());
await page.waitForTimeout(600);
await page.evaluate(() => document.querySelector(".vc-widget-card")?.scrollIntoView({ block: "start" }));
await page.waitForTimeout(1500);

const sq = page.locator(".vc-pads .vc-pad-sq").first();
const box = await sq.boundingBox();
const read = () => page.evaluate(() => JSON.parse(localStorage.getItem("vibe.sceneSettings") || "{}").physarum2?.att01);
const row = [];
const y = box.y + box.height * 0.5;
await page.mouse.move(box.x + box.width * 0.3, y);
await page.mouse.down();
for (let f = 0.3; f <= 0.7001; f += 0.025) {
  await page.mouse.move(box.x + box.width * f, y, { steps: 2 });
  await page.waitForTimeout(40);
  row.push(`${((f - 0.5) * 100).toFixed(1).padStart(5)}%:${String(await read()).padStart(6)}`);
}
await page.mouse.up();
console.log(`pad ${Math.round(box.width)}px wide; pointer offset from the zero line -> A1->B2 value`);
for (let i = 0; i < row.length; i += 6) console.log("  " + row.slice(i, i + 6).join("  "));
await page.waitForTimeout(800);
await page.locator(".vc-pads").screenshot({ path: out });
console.log(errors.length ? `page errors: ${errors.join(" | ")}` : "no page errors");
await browser.close();
