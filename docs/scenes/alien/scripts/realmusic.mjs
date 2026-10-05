// node realmusic.mjs <wav> <out.json> [--port P] [--seconds N] [--query Q] [--shots prefix@t1,t2,...]
import { chromium } from "../../../../node_modules/playwright/index.mjs";
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const [wav, out] = args;
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const port = opt("port", "5321");
const seconds = Number(opt("seconds", "50"));
const query = opt("query", "");
const shotSpec = opt("shots", null);
const shots = shotSpec ? { prefix: shotSpec.split("@")[0], at: shotSpec.split("@")[1].split(",").map(Number) } : null;

const browser = await chromium.launch({
  channel: "chromium",
  args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    `--use-file-for-fake-audio-capture=${wav}`,
    "--autoplay-policy=no-user-gesture-required",
    "--enable-gpu",
    "--use-angle=metal",
    "--enable-gpu-rasterization",
    "--ignore-gpu-blocklist",
  ],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 }, permissions: ["microphone"] });
const page = await ctx.newPage();
await page.goto(`https://localhost:${port}/${query ? "?" + query : ""}#/v/alien`);
await page.waitForTimeout(1500);
await page.mouse.click(640, 360);
const t0 = Date.now();
const rows = [];
let nextShot = 0;
while ((Date.now() - t0) / 1000 < seconds) {
  const t = (Date.now() - t0) / 1000;
  const s = await page.evaluate(() => {
    const a = window.__alien;
    if (!a) return null;
    const v = a.videos ? a.videos[a.reel.loop] : null;
    return { loop: a.reel.loop, head: v ? v.currentTime * 120 : null, paused: v ? v.paused : null, ready: v ? v.readyState : null, cuts: a.reel.cuts, ...a.last };
  });
  if (s) rows.push({ t: +t.toFixed(2), ...s });
  if (shots && nextShot < shots.at.length && t >= shots.at[nextShot]) {
    await page.screenshot({ path: `${shots.prefix}-${shots.at[nextShot]}.png` });
    nextShot++;
  }
  await page.waitForTimeout(100);
}
writeFileSync(out, JSON.stringify(rows));
console.log("rows", rows.length);
await browser.close();
