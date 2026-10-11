// Headless check for #449: with every reactive setting at 0, Caustics should
// hold still while the synthetic audio plays. Takes three frames ~1.7 s apart;
// compare their brightness, before (main) and after (the branch).
// Run from the repo root against a dev server:
//   node docs/scenes/caustics/scripts/music-off-shot.mjs <port> <tag> <outDir> ['{"extraSetting":0}']
// The extra JSON zeroes more settings (the PR also needed focus, sparkle,
// centroidHue, waveSpeed and the sparkle* settings at 0; causticDensity can't
// be zeroed, which is #453).
import { chromium } from "playwright";

const [port, tag, out, extra] = process.argv.slice(2);
const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
  args: ["--autoplay-policy=no-user-gesture-required", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--ignore-certificate-errors"],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 960, height: 540 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("pageerror", e.message.slice(0, 200)));
page.on("console", (m) => { if (m.type() === "error") console.log("console:", m.text().slice(0, 200)); });
await page.goto(`https://localhost:${port}/?audio=synthetic&bpm=120#/v/caustics`);
await page.waitForFunction(() => !!window.__viz, null, { timeout: 30000 });
const settings = { ripple: 0, drift: 0, driftLevel: 0, driftPump: 0, bass: 0, turbulence: 0, flash: 0, breathe: 0, sparkleBright: 0, injection: 0, ...(extra ? JSON.parse(extra) : {}) };
await page.evaluate((s) => window.__viz.setParams({ scene: "caustics", autoPin: true, settings: s }), settings);
await page.waitForTimeout(6000); // settings glide to their new values
for (let i = 0; i < 3; i++) {
  await page.screenshot({ path: `${out}/${tag}-${i}.png` });
  await page.waitForTimeout(1700);
}
await browser.close();
