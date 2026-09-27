// Throughput bench: forces N sim steps per frame and reports ms/frame from rAF.
// Needs the temporary hooks from p2-prof-sort-prototype.diff + _p2prof.ts/_p2sort.ts
// in this folder applied to physarum2.ts (window.__p2flags: steps, sortEvery,
// noDiffuse/noSim/noDeposit, sortedSeed, fastBlur). The diff was made against the
// 2026-09-26 single-table physarum2.ts (before per-strain settings), so expect to
// re-apply it by hand. Never commit those hooks. Results: docs/scenes/physarum2.md,
// Measurements.
// node tput.mjs [--port 5320] [--quality high] [--w 1920 --h 1080] [--flags JSON] [--steps 20] [--secs 6]
const { chromium } = await import(new URL("../../../../../node_modules/playwright/index.mjs", import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const port = opt("--port", "5320");
const quality = opt("--quality", "high");
const w = +opt("--w", "1920");
const h = +opt("--h", "1080");
const secs = +opt("--secs", "6");
const steps = +opt("--steps", "20");
const flags = { ...JSON.parse(opt("--flags", "{}")), steps };
const browser = await chromium.launch({
  channel: "chromium",
  headless: true,
  args: [
    "--enable-gpu", "--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist",
    "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required",
    "--disable-gpu-vsync", "--disable-frame-rate-limit",
  ],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: w, height: h } });
await ctx.addInitScript((f) => { globalThis.__p2flags = f; }, flags);
const page = await ctx.newPage();
const errs = [];
page.on("console", (m) => { if (m.type() === "error" && !/8787|ERR_CONNECTION|403/.test(m.text())) errs.push(m.text().slice(0, 300)); });
await page.goto(`https://localhost:${port}/?audio=synthetic&bpm=120&quality=${quality}#/v/physarum2`);
await page.waitForTimeout(3000);
const r = await page.evaluate(async (secs) => {
  const t0 = performance.now();
  let n = 0;
  await new Promise((res) => {
    const f = () => { n++; if (performance.now() - t0 < secs * 1000) requestAnimationFrame(f); else res(); };
    requestAnimationFrame(f);
  });
  return { ms: (performance.now() - t0) / n, hash: location.hash };
}, secs);
console.log(`${JSON.stringify(flags)} q=${quality} ${w}x${h} ${r.hash}: ${r.ms.toFixed(2)} ms/frame  -> ${(r.ms / steps).toFixed(3)} ms/step`);
if (errs.length) console.log("ERRORS:", errs.slice(0, 3));
await browser.close();
