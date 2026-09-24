// Sky: loads the scene and dumps location.hash/search plus whether
// window.__viz and its getState() are present — a quick routing/wiring
// sanity check.
// Rescued from a working session on 2026-09-23.
// usage: node check_hash.mjs [port]
// May need adjusting to current code.
const { chromium } = await import(new URL("../../../../node_modules/playwright/index.mjs", import.meta.url));

const port = process.argv[2] || "5183";
const browser = await chromium.launch({
  args: ["--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--enable-unsafe-swiftshader"],
});
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
await page.goto(`https://localhost:${port}/?audio=synthetic&bpm=120#/v/sky`, { waitUntil: "load" });
await page.waitForTimeout(1000);
const info = await page.evaluate(() => ({
  href: location.href,
  hash: location.hash,
  search: location.search,
  hasViz: !!window.__viz,
  scene: window.__viz && window.__viz.getState ? window.__viz.getState() : null,
}));
console.log(JSON.stringify(info, null, 2));
await browser.close();
