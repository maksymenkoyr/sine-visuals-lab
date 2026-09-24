// Kaleidoscope: applies setting overrides via __viz.setParams (autoPin) and
// screenshots at fixed offsets. Prints any console error (a shader compile
// error shows here).
// Rescued from a working session on 2026-09-04.
// usage: node styleshot.mjs <outPrefix> [--port P] [--bpm N] [--quality Q] [--settings JSON] [--at 4,10] [--crop x,y,w,h]
// May need adjusting to current code.
const { chromium } = await import(new URL("../../../../node_modules/playwright/index.mjs", import.meta.url));
const args = process.argv.slice(2);
const out = args[0];
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const port = opt("--port", "5197");
const bpm = opt("--bpm", "120");
const quality = opt("--quality", "high");
const settings = opt("--settings", "{}");
const ats = opt("--at", "4,10").split(",").map(Number);
const crop = opt("--crop", null);
const browser = await chromium.launch({
  channel: "chromium",
  args: ["--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--enable-gpu", "--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist"],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", e.message.slice(0, 2000)));
page.on("console", (m) => { if (m.type() === "error" && !/8787|ERR_CONNECTION_REFUSED|403/.test(m.text())) console.log("CONSOLE", m.text().slice(0, 1500)); });
await page.goto(`https://localhost:${port}/?audio=synthetic&bpm=${bpm}&quality=${quality}#/v/kaleidoscope`, { waitUntil: "load" });
const t0 = Date.now();
await page.waitForTimeout(800);
await page.evaluate((s) => window.__viz?.setParams({ scene: "kaleidoscope", autoPin: true, settings: JSON.parse(s) }), settings);
for (const at of ats) {
  await page.waitForTimeout(Math.max(0, at * 1000 - (Date.now() - t0)));
  const clip = crop ? (() => { const [x, y, w, h] = crop.split(",").map(Number); return { x, y, width: w, height: h }; })() : undefined;
  await page.screenshot({ path: `${out}-${at}s.png`, clip });
}
console.log(await page.evaluate(() => (window.__viz?.probeText?.() ?? "").split("\n")[0]));
await browser.close();
console.log("STYLESHOT_OK");
