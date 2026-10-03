// Throughput bench: forces N sim steps per frame and reports ms/frame from rAF.
// Needs a temporary hook applied to physarum2.ts's render(), right after
// stepAccumulator resolves `steps` — never commit it:
//   // TEMP perf hook (scripts/perf/tput.mjs) — never commit.
//   const forcedSteps = (globalThis as { __p2flags?: { steps?: number } }).__p2flags?.steps;
//   const stepsRun = typeof forcedSteps === "number" ? forcedSteps : steps;   // use stepsRun in the step loop
// and, at the very end of render():
//   if (typeof forcedSteps === "number") gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
// The readPixels forces the GPU to finish the forced step count before rAF
// resolves, so the measured time reflects the sim work, not just enqueuing it.
// Results: docs/scenes/physarum2.md, Measurements.
// node tput.mjs [--port 5320] [--quality high] [--w 1920 --h 1080] [--flags JSON] [--steps 20] [--secs 6] [--settings JSON]
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
const settings = opt("--settings", null);
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
if (settings) {
  await page.evaluate(
    ({ s, scene }) => window.__viz.setParams({ scene, autoPin: true, settings: JSON.parse(s) }),
    { s: settings, scene: "physarum2" },
  );
  await page.waitForTimeout(500);
}
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
