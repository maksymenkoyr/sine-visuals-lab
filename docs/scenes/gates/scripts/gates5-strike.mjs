// Neon Gates: bursts frames around a strike moment (cutRate/beatFlash/
// buildGlow pinned to 0) with Lightning on vs off for contrast, then
// measures frame rate on the real GPU with Lightning 1 vs 0 via rAF gaps.
// Rescued from a working session on 2026-09-24.
// usage: node gates5-strike.mjs <outPrefix> <port>
// May need adjusting to current code — setting names (cutRate, beatFlash,
// buildGlow, lightning) may have changed.
const { chromium } = await import(new URL("../../../../node_modules/playwright/index.mjs", import.meta.url));

const [outPrefix, portArg] = process.argv.slice(2);
const port = Number(portArg);

const browser = await chromium.launch({
  channel: "chromium",
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--ignore-certificate-errors",
    "--enable-gpu", "--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist"],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 960, height: 540 }, permissions: ["microphone"] });
const page = await ctx.newPage();
let sawError = false;
page.on("console", (m) => { if (m.type() === "error") { sawError = true; console.log("PAGE ERROR:", m.text()); } });
page.on("pageerror", (e) => { sawError = true; console.log("PAGE EXCEPTION:", e.message); });

await page.goto(`https://localhost:${port}/?audio=synthetic&bpm=126#/v/gates`, { waitUntil: "load" });
await page.waitForTimeout(2500);
await page.evaluate(() =>
  window.__viz?.setParams?.({ scene: "gates", autoPin: true, settings: { cutRate: 0, beatFlash: 0, buildGlow: 0 } }),
);
await page.waitForTimeout(800);
// ~1.2 s of frames at ~60 ms, straddling two beats at 126 bpm.
for (let i = 0; i < 16; i++) {
  const p = `${outPrefix}-strike-${String(i).padStart(2, "0")}.png`;
  await page.screenshot({ path: p });
  await page.waitForTimeout(40);
}
// Same moment class with Lightning off, for contrast.
await page.evaluate(() =>
  window.__viz?.setParams?.({ scene: "gates", autoPin: true, settings: { cutRate: 0, beatFlash: 0, buildGlow: 0, lightning: 0 } }),
);
await page.waitForTimeout(300);
await page.screenshot({ path: `${outPrefix}-off.png` });
// Frame rate on the real GPU, Lightning 1 vs 0, sampled via rAF gaps over 3 s each.
const fps = async () => page.evaluate(() => new Promise((res) => {
  let n = 0; const t0 = performance.now();
  const tick = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(tick); else res(n / ((performance.now() - t0) / 1000)); };
  requestAnimationFrame(tick);
}));
const probeQ = async () => page.evaluate(() => { const p = window.__viz?.probe?.(); return p ? JSON.stringify({ q: p.quality, gov: p.govLevel, rs: p.renderScale }) : null; });
console.log("fps lightning 0:", (await fps()).toFixed(1), await probeQ());
await page.evaluate(() => window.__viz?.setParams?.({ scene: "gates", autoPin: true, settings: { cutRate: 0, beatFlash: 0, buildGlow: 0, lightning: 1 } }));
console.log("fps lightning 1:", (await fps()).toFixed(1), await probeQ());
console.log("sawError:", sawError);
await browser.close();
