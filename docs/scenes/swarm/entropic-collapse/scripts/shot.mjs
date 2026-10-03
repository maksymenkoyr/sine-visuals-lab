// node shot.mjs <outPrefix> [--port P] [--times 2,12,25] [--settings JSON] [--quality Q] [--bpm N] [--w W --h H] [--gpu]
import { chromium } from "playwright";

const args = process.argv.slice(2);
const out = args[0];
const opt = (k, d) => {
  const i = args.indexOf("--" + k);
  return i >= 0 ? args[i + 1] : d;
};
const port = opt("port", "5190");
const times = opt("times", "2,12,25").split(",").map(Number);
const bpm = opt("bpm", "128");
const q = opt("quality", "");
const settings = opt("settings", "");
const W = +opt("w", "1280");
const H = +opt("h", "720");
const gpu = args.includes("--gpu");

const flags = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--enable-unsafe-swiftshader"];
if (gpu) flags.push("--enable-gpu", "--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist");
const browser = await chromium.launch({ headless: true, channel: gpu ? "chromium" : undefined, args: flags });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: W, height: H }, permissions: ["microphone"] });
const page = await ctx.newPage();
page.on("console", (m) => {
  const t = m.text();
  if (/error|swarm|shader/i.test(t) && !/ERR_CONNECTION_REFUSED|8787/.test(t)) console.log("[console]", t.slice(0, 400));
});
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
const url = `https://localhost:${port}/?audio=synthetic&bpm=${bpm}${q ? "&quality=" + q : ""}#/v/swarm`;
await page.goto(url);
await page.waitForTimeout(500);
if (settings) {
  await page.evaluate((s) => window.__viz.setParams({ scene: "swarm", autoPin: true, settings: JSON.parse(s) }), settings);
}
const t0 = Date.now();
for (const t of times) {
  const wait = t * 1000 - (Date.now() - t0);
  if (wait > 0) await page.waitForTimeout(wait);
  const path = `${out}-t${t}.png`;
  await page.screenshot({ path });
  console.log("shot", path, "hash", await page.evaluate(() => location.hash));
}
await browser.close();
