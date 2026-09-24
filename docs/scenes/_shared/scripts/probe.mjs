// Auto->manual sign-off: clears pins, prints every setting's probe mode
// (auto/manual), nudges one setting via setParams, and prints again — a
// quick check that a scene's Auto/manual wiring is behaving. Scene-agnostic
// (positional scene arg, defaults to "gates").
// Rescued from a working session on 2026-09-05.
// usage: node probe.mjs [port] [scene]
// May need adjusting to current code.
const { chromium } = await import(new URL("../../../../node_modules/playwright/index.mjs", import.meta.url));
const port = process.argv[2] ?? "5199";
const scene = process.argv[3] ?? "gates";
const browser = await chromium.launch({
  channel: "chromium",
  headless: true,
  args: ["--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--enable-gpu", "--use-angle=metal", "--ignore-gpu-blocklist"],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
await page.goto(`https://localhost:${port}/?audio=synthetic&bpm=126#/v/${scene}`);
await page.waitForTimeout(2000);
await page.evaluate(() => window.__viz.setParams({ autoPin: false, settings: {} }));
await page.waitForTimeout(1500);
const modes = () => page.evaluate(() => {
  const s = window.__viz.probe().settings;
  return Object.fromEntries(Object.entries(s).map(([k, v]) => [k, typeof v === "object" ? v.mode ?? JSON.stringify(v) : v]));
});
console.log("before:", JSON.stringify(await modes()));
await page.evaluate(() => window.__viz.setParams({ settings: { glow: 0.9 } }));
await page.waitForTimeout(800);
console.log("after glow set:", JSON.stringify(await modes()));
await browser.close();
