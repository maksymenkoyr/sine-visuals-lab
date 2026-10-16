// node shot.mjs <outPrefix> [--port P] [--query "audio=synthetic&bpm=128&loop=0"] [--frames N] [--every MS] [--wait MS] [--size 1600x900] [--eval JS]
import { chromium } from "../../../../node_modules/playwright/index.mjs";

const args = process.argv.slice(2);
const out = args[0];
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const port = opt("port", "5321");
const query = opt("query", "audio=synthetic&bpm=128");
const frames = Number(opt("frames", "1"));
const every = Number(opt("every", "500"));
const wait = Number(opt("wait", "4000"));
const [w, h] = opt("size", "1600x900").split("x").map(Number);
const evalJs = opt("eval", null);

const browser = await chromium.launch({
  channel: "chromium",
  args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
    "--enable-gpu",
    "--use-angle=metal",
    "--enable-gpu-rasterization",
    "--ignore-gpu-blocklist",
  ],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: w, height: h } });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") errors.push(`${m.type()}: ${m.text().slice(0, 400)}`);
});
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
await page.goto(`https://localhost:${port}/?${query}#/v/alien`);
await page.waitForTimeout(wait);
if (evalJs) console.log("eval:", JSON.stringify(await page.evaluate(evalJs)));
for (let i = 0; i < frames; i++) {
  const probe = await page.evaluate(() => {
    const a = window.__alien;
    return a ? { loop: a.reel.loop, head: +a.reel.heads[a.reel.loop].toFixed(1), cuts: a.reel.cuts } : null;
  });
  const file = `${out}-${String(i).padStart(2, "0")}.png`;
  await page.screenshot({ path: file });
  console.log(file, JSON.stringify(probe));
  if (i < frames - 1) await page.waitForTimeout(every);
}
console.log(errors.filter((e) => !e.includes("8787")).slice(0, 12).join("\n"));
await browser.close();
