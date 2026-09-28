// How much does an Affinity pad's live culture actually change over time?
// Opens the panel, scrolls to the Affinity card, samples the first pad's
// canvas as 12x12 block means of luminance (the pattern's shape, not agent
// flicker) every 0.5 s and again after 10 s, and saves two crops of the pads
// 3 s apart. Used 2026-09-28 to diagnose "these doesn't move at all" (see the
// record's Decisions entry): a pattern whose 10 s change is no bigger than
// its 0.5 s change has settled into a fixed network.
//
//   node padmotion.mjs --port 5342 --out /path/to/tmp
const { chromium } = await import(new URL("../../../../node_modules/playwright/index.mjs", import.meta.url));

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const port = opt("--port", "5342");
const out = opt("--out", ".");

const browser = await chromium.launch({
  channel: "chromium",
  headless: true,
  args: ["--enable-gpu", "--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
await page.goto(`https://localhost:${port}/?audio=synthetic&bpm=120#/v/physarum2`);
await page.waitForTimeout(1500);
await page.evaluate(() => document.getElementById("menuBtn")?.click());
await page.waitForTimeout(500);
await page.evaluate(() => document.querySelector(".vc-pads")?.scrollIntoView({ block: "center" }));
await page.waitForTimeout(3000);

const padSel = ".vc-pads canvas";
async function sample() {
  return page.evaluate((s) => {
    const c = document.querySelector(s);
    if (!c) return null;
    const g = c.getContext("2d");
    const W = c.width, H = c.height, d = g.getImageData(0, 0, W, H).data;
    const B = 12, sum = new Array(B * B).fill(0), n = new Array(B * B).fill(0);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, b = Math.floor((y * B) / H) * B + Math.floor((x * B) / W);
      sum[b] += (d[i] + d[i + 1] + d[i + 2]) / 3; n[b]++;
    }
    return sum.map((v, i) => v / n[i]);
  }, padSel);
}
const diff = (a, b) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length;

let prev = await sample();
if (!prev) {
  console.log("no pad canvas found");
  await browser.close();
  process.exit(1);
}
const steps = [];
for (let i = 0; i < 6; i++) {
  await page.waitForTimeout(500);
  const cur = await sample();
  steps.push(diff(prev, cur).toFixed(2));
  prev = cur;
}
console.log("block-mean change per 0.5 s:", steps.join(" "));
await page.locator(".vc-pads").screenshot({ path: `${out}/pads-t0.png` });
await page.waitForTimeout(3000);
await page.locator(".vc-pads").screenshot({ path: `${out}/pads-t3.png` });
const first = await sample();
await page.waitForTimeout(10000);
console.log("block-mean change over 10 s:", diff(first, await sample()).toFixed(2));
await browser.close();
