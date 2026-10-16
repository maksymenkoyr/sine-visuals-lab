// node shot.mjs <outPrefix> [--port P] [--views 0,1,2] [--settings JSON] [--frames N] [--every MS] [--size WxH]
import { chromium } from "../../../../node_modules/playwright/index.mjs";

const args = process.argv.slice(2);
const out = args[0];
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const port = opt("port", "5291");
const views = opt("views", "0,1,2").split(",").map(Number);
const extra = JSON.parse(opt("settings", "{}"));
const frames = Number(opt("frames", "3"));
const every = Number(opt("every", "350"));
const [W, H] = opt("size", "960x540").split("x").map(Number);

const browser = await chromium.launch({
  channel: "chromium",
  args: [
    "--use-fake-device-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
    "--enable-gpu",
    "--use-angle=metal",
    "--enable-gpu-rasterization",
    "--ignore-gpu-blocklist",
  ],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, ignoreHTTPSErrors: true });
const errs = [];
page.on("console", (m) => {
  if (m.type() === "error" || /longplay|shader|GLSL|compile/i.test(m.text())) errs.push(m.text());
});
await page.goto(`https://localhost:${port}/?audio=synthetic&bpm=129#/v/longplay`);
await page.waitForTimeout(3500);
for (const v of views) {
  await page.evaluate(
    ([v, extra]) => window.__viz.setParams({ scene: "longplay", autoPin: true, settings: { auto: 0, view: v, ...extra } }),
    [v, extra],
  );
  await page.waitForTimeout(5500);
  for (let f = 0; f < frames; f++) {
    await page.screenshot({ path: `${out}_v${v}_${f}.png` });
    await page.waitForTimeout(every);
  }
  const probe = await page.evaluate(() => {
    try {
      return JSON.stringify(window.__viz.probe?.()?.scene ?? null);
    } catch (e) {
      return String(e);
    }
  });
  console.log(`view ${v} done`, probe?.slice?.(0, 200));
}
console.log("errors:", errs.slice(0, 8).join("\n"));
await browser.close();
