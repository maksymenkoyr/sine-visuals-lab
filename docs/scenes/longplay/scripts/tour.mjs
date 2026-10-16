// Auto change check: Hold 0.5 min, shoot once a second from 28 s to 40 s.
import { chromium } from "../../../../node_modules/playwright/index.mjs";
const out = process.argv[2];
const browser = await chromium.launch({
  channel: "chromium",
  args: ["--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--enable-gpu", "--use-angle=metal", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 640, height: 360 }, ignoreHTTPSErrors: true });
await page.goto(`https://localhost:5291/?audio=synthetic&bpm=129#/v/longplay`);
await page.waitForTimeout(2500);
await page.evaluate(() => window.__viz.setParams({ scene: "longplay", autoPin: true, settings: { view: 1, auto: 1, hold: 0.5, flicker: 0 } }));
const t0 = Date.now();
await page.waitForTimeout(28000);
for (let i = 0; i < 13; i++) {
  await page.screenshot({ path: `${out}_${String(i).padStart(2, "0")}.png` });
  await page.waitForTimeout(Math.max(0, 28000 + (i + 1) * 1000 - (Date.now() - t0)));
}
await browser.close();
