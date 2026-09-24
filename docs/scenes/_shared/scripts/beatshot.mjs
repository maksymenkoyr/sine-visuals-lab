// Beat-synced screenshotter: waits in-page for a beat to fire, then
// screenshots right away (and again after --delay ms), so frames land on
// the attack instead of the tail. Scene-agnostic (--scene flag); used while
// tuning Powder and other beat-reactive scenes.
// Rescued from a working session on 2026-09-04.
// usage: node beatshot.mjs <outPrefix> [--port P] [--bpm N] [--quality Q] [--scene S] [--settings JSON] [--beats N] [--delays 0,150]
// May need adjusting to current code.
const { chromium } = await import(new URL("../../../../node_modules/playwright/index.mjs", import.meta.url));
const args = process.argv.slice(2);
const out = args[0];
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const port = opt("--port", "5195");
const bpm = opt("--bpm", "120");
const quality = opt("--quality", "high");
const scene = opt("--scene", "powder");
const settings = opt("--settings", null);
const beats = +opt("--beats", "2");
const delays = opt("--delays", "0,150").split(",").map(Number);
const browser = await chromium.launch({
  channel: "chromium",
  args: ["--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--enable-gpu", "--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist"],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", e.message.slice(0, 2000)));
page.on("console", (m) => { if (m.type() === "error" && !/8787|ERR_CONNECTION_REFUSED|403/.test(m.text())) console.log("CONSOLE", m.text().slice(0, 600)); });
await page.goto(`https://localhost:${port}/?audio=synthetic&bpm=${bpm}&quality=${quality}#/v/${scene}`, { waitUntil: "load" });
await page.waitForTimeout(1500);
if (settings) await page.evaluate((s) => window.__viz?.setParams({ scene, autoPin: true, settings: JSON.parse(s) }), settings);
else await page.evaluate(() => window.__viz?.setParams({ autoPin: false, settings: {} }));
await page.waitForTimeout(800);
for (let b = 0; b < beats; b++) {
  const t = await page.evaluate(async () => {
    for (;;) {
      const p = window.__viz.probe();
      if (p.beat.fired) return p.t;
      await new Promise((r) => requestAnimationFrame(r));
    }
  });
  const t0 = Date.now();
  const lags = [];
  for (let d = 0; d < delays.length; d++) {
    await page.waitForTimeout(Math.max(0, delays[d] - (Date.now() - t0)));
    await page.screenshot({ path: `${out}-b${b}-${delays[d]}.png` });
    lags.push(Date.now() - t0);
  }
  console.log(`beat ${b} at t=${t.toFixed(3)} shots done at ~${lags.join("/")}ms`);
}
console.log(await page.evaluate(() => window.__viz?.probeText?.() ?? "no probe"));
await browser.close();
console.log("BEATSHOT_OK");
