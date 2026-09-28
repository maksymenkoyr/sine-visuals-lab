// Screenshots the whole device menu, one viewport at a time: opens the panel
// on a scene and steps every scrollable panel column (`.vc-scroll`) from top
// to bottom, saving `<out>/panel-s<column>-<nn>.png` at 2x. Useful for
// judging a panel layout as a whole — cards, gaps, rows — rather than one
// widget (first used 2026-09-28 on Physarum 2's Affinity card).
//
//   node panelscroll.mjs --port 5342 --scene physarum2 --out /path/to/tmp
const { chromium } = await import(new URL("../../../../node_modules/playwright/index.mjs", import.meta.url));

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const port = opt("--port", "5342");
const scene = opt("--scene", "physarum2");
const out = opt("--out", ".");

const browser = await chromium.launch({
  channel: "chromium",
  headless: true,
  args: ["--enable-gpu", "--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto(`https://localhost:${port}/?audio=synthetic&bpm=120#/v/${scene}`);
await page.waitForTimeout(1500);
await page.evaluate(() => document.getElementById("menuBtn")?.click());
await page.waitForTimeout(800);
const cols = await page.evaluate(() =>
  [...document.querySelectorAll(".vc-scroll")]
    .filter((e) => e.scrollHeight > e.clientHeight + 10)
    .map((e) => ({ h: e.scrollHeight, ch: e.clientHeight, x: e.getBoundingClientRect().x, w: e.getBoundingClientRect().width })),
);
for (let s = 0; s < cols.length; s++) {
  const { h, ch, x, w } = cols[s];
  for (let i = 0, y = 0; y < h && i < 20; i++, y += ch - 80) {
    await page.evaluate(([idx, yy]) => {
      const list = [...document.querySelectorAll(".vc-scroll")].filter((e) => e.scrollHeight > e.clientHeight + 10);
      list[idx].scrollTop = yy;
    }, [s, y]);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/panel-s${s}-${String(i).padStart(2, "0")}.png`, clip: { x, y: 0, width: w, height: 1000 } });
  }
}
console.log(`columns: ${cols.length}`);
await browser.close();
