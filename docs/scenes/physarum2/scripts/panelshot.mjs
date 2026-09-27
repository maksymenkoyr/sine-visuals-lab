// Panel screenshot for physarum2: opens the controls panel, optionally
// scrolls the Scene card into view, screenshots at the given viewport size.
//   node panelshot.mjs <out.png> --port P [--width 1440] [--height 900]
//                       [--scene physarum2] [--bpm 120] [--scroll-scene]
const { chromium } = await import(new URL("../../../../node_modules/playwright/index.mjs", import.meta.url));

const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith("--"));
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const port = opt("--port", "5341");
const scene = opt("--scene", "physarum2");
const bpm = opt("--bpm", "120");
const width = parseInt(opt("--width", "1440"), 10);
const height = parseInt(opt("--height", "900"), 10);
const scrollScene = args.includes("--scroll-scene");
const scrollExtra = parseInt(opt("--scroll-extra", "0"), 10);

const browser = await chromium.launch({
  channel: "chromium",
  headless: true,
  args: [
    "--enable-gpu",
    "--use-angle=metal",
    "--enable-gpu-rasterization",
    "--ignore-gpu-blocklist",
    "--use-fake-device-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
  ],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width, height } });
const page = await ctx.newPage();

const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text().slice(0, 300));
});
page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));

const qs = new URLSearchParams({ audio: "synthetic", bpm: String(bpm) });
const url = `https://localhost:${port}/?${qs.toString()}#/v/${scene}`;
console.log("goto", url);
await page.goto(url);
await page.waitForTimeout(1200);

await page.evaluate(() => document.getElementById("menuBtn")?.click());
await page.waitForTimeout(500);

if (scrollScene) {
  await page.evaluate(() => {
    const heads = [...document.querySelectorAll(".vc-card-head")];
    const sceneHead = heads.find((h) => h.textContent?.includes("Scene"));
    sceneHead?.scrollIntoView({ block: "start" });
  });
  await page.waitForTimeout(300);
}

if (scrollExtra) {
  await page.evaluate((px) => {
    const el = document.querySelector(".vc-controls-col") || document.scrollingElement;
    el?.scrollBy(0, px);
  }, scrollExtra);
  await page.waitForTimeout(300);
}

await page.screenshot({ path: out, fullPage: true });
console.log("shot", out);
console.log("errors", JSON.stringify(errors.filter((e) => !/8787|ERR_CONNECTION_REFUSED|@fs.*40[13]/.test(e))));

await browser.close();
