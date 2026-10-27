// Droplets' current check: sprays with the given settings, sets Sparkle to 0 so no hole opens, waits --age ms and shoots, so every
// drop on screen is at least that old. Score with droplets-place.py; a drop the current carries stays beside its line. Needs `npm run dev`.
// node docs/scenes/caustics/scripts/droplets-old.mjs <outPrefix> --port P --settings JSON [--age 700] [--rounds 5]
import { chromium } from "playwright";

const args = process.argv.slice(2);
const out = args[0];
const get = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i === -1 ? d : args[i + 1];
};
const settings = JSON.parse(get("settings", "{}"));
const browser = await chromium.launch({
  channel: "chromium",
  args: ["--enable-gpu", "--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"],
});
try {
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 } });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message.slice(0, 800)));
  await page.goto(`https://localhost:${get("port", "5173")}/?audio=synthetic&bpm=120&quality=high#/v/caustics`);
  await page.waitForFunction(() => window.__viz, null, { timeout: 30_000 });
  await page.waitForTimeout(1500);
  await page.addStyleTag({ content: "body > *:not(canvas) { visibility: hidden !important; }" });
  const set = (s) => page.evaluate((x) => window.__viz.setParams({ scene: "caustics", autoPin: true, settings: x }), s);
  for (let k = 0; k < Number(get("rounds", "5")); k++) {
    await set({ ...settings, sparkle: 1 });
    await page.waitForTimeout(2500);
    await set({ ...settings, sparkle: 0 });
    await page.waitForTimeout(Number(get("age", "700")));
    await page.screenshot({ path: `${out}-${k}.png` });
    console.log(`${out}-${k}.png`);
  }
} finally {
  await browser.close();
}
