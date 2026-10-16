// The agent re-sort's measurements (physarum2Sort.ts; docs/scenes/physarum2.md,
// Measurements 2026-10-05). Needs the temporary hook in sort-measure-hook.diff
// applied to physarum2.ts — `git apply` it, measure, then `git checkout` the
// file; never commit it. The hook reads `globalThis.__p2flags`:
//   steps   force this many sim steps a frame (0 freezes the sim)
//   nosort  skip the re-sort entirely (the "before")
//   timer   time render() on the GPU per frame (EXT_disjoint_timer_query)
//   sync    1-pixel readPixels at the end of render(), so a forced-steps
//           frame can't end before the GPU has done its steps
// and exposes `globalThis.__p2dbg` (frames, landed, readAgents, kickSort).
//
// node sortbench.mjs --mode <m> [--port 5403] [--flags JSON] [--secs N] [--quality high]
//   steps    forced 10 steps a frame, vsync off: ms per step
//   natural  normal pacing, panel closed: GPU ms per scene frame, sorting frames apart
//   panel    panel open, Panel blur on: rAF rate and how long each readback waits
//   picture  the app's Picture meter averaged over the run (did the look change?)
//   check    freeze, read every agent, force a sort, read again: a permutation keeps
//            the order-free checksum; meanStep = mean screen distance between
//            storage neighbours (random ≈ 0.38)
// Interleave `--flags '{"nosort":true}'` and `--flags '{}'` runs: the GPU is shared
// with whatever else the machine is drawing.
const { chromium } = await import(new URL("../../../../../node_modules/playwright/index.mjs", import.meta.url));

const args = process.argv.slice(2);
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const mode = arg("--mode", "natural");
const port = arg("--port", "5403");
const quality = arg("--quality", "high");
const secs = Number(arg("--secs", mode === "picture" ? "30" : mode === "steps" ? "6" : "10"));
const flags = JSON.parse(arg("--flags", "{}"));
if (mode === "steps") Object.assign(flags, { steps: flags.steps ?? 10, sync: true });
if (mode === "natural") flags.timer = true;
if (mode === "check") flags.nosort = true;

const browser = await chromium.launch({
  channel: "chromium",
  headless: true,
  args: [
    "--enable-gpu", "--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist",
    "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required",
    ...(mode === "steps" ? ["--disable-gpu-vsync", "--disable-frame-rate-limit"] : []),
  ],
});
// The user's window: 1456×902 CSS at dpr 2, a 2912×1804 canvas.
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1456, height: 902 }, deviceScaleFactor: 2 });
await ctx.addInitScript((f) => { globalThis.__p2flags = f; }, flags);
if (mode === "panel") {
  await ctx.addInitScript(() => {
    localStorage.setItem("vibe.panelBlur", "1");
    const orig = WebGL2RenderingContext.prototype.getBufferSubData;
    globalThis.__rb = { n: 0, ms: 0 };
    WebGL2RenderingContext.prototype.getBufferSubData = function (...a) {
      const t = performance.now();
      const r = orig.apply(this, a);
      globalThis.__rb.n++;
      globalThis.__rb.ms += performance.now() - t;
      return r;
    };
  });
}
const page = await ctx.newPage();
await page.goto(`https://localhost:${port}/?audio=synthetic&bpm=124&quality=${quality}#/v/physarum2`);
await page.waitForTimeout(5000);
const label = JSON.stringify(flags).padEnd(44);

const rafFor = (s) =>
  page.evaluate(async (s) => {
    const t0 = performance.now();
    let n = 0;
    await new Promise((res) => {
      const f = () => { n++; if (performance.now() - t0 < s * 1000) requestAnimationFrame(f); else res(); };
      requestAnimationFrame(f);
    });
    return { perSec: n / s, msPerFrame: (performance.now() - t0) / n };
  }, s);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);

if (mode === "steps") {
  const r = await rafFor(secs);
  console.log(`${label} ${r.msPerFrame.toFixed(2)} ms/frame -> ${(r.msPerFrame / flags.steps).toFixed(3)} ms/step`);
} else if (mode === "natural") {
  await page.evaluate(() => { globalThis.__p2dbg.frames.length = 0; });
  const r = await rafFor(secs);
  const frames = await page.evaluate(() => globalThis.__p2dbg.frames.slice());
  const ms = frames.map((f) => f.ms).sort((a, b) => a - b);
  const q = (p) => ms[Math.min(ms.length - 1, Math.floor(p * ms.length))];
  const sorting = frames.filter((f) => f.sorting).map((f) => f.ms);
  const plain = frames.filter((f) => !f.sorting).map((f) => f.ms);
  console.log(`${label} rAF ${r.perSec.toFixed(0)}/s | GPU/frame mean ${mean(ms).toFixed(2)} ms, p95 ${q(0.95).toFixed(2)} | sorting frames ${sorting.length}/${frames.length} @ ${mean(sorting).toFixed(2)} ms, others ${mean(plain).toFixed(2)} ms`);
} else if (mode === "panel") {
  await page.evaluate(() => document.querySelector("#menuBtn")?.click());
  await page.waitForTimeout(3000);
  await page.evaluate(() => { globalThis.__rb = { n: 0, ms: 0 }; });
  const r = await rafFor(secs);
  const rb = await page.evaluate(() => globalThis.__rb);
  console.log(`${label} rAF ${r.perSec.toFixed(0)}/s | readback ${rb.n} × ${(rb.ms / Math.max(1, rb.n)).toFixed(1)} ms`);
} else if (mode === "picture") {
  await page.evaluate(() => window.__viz.pictureForce(true));
  await page.waitForTimeout(1000);
  await page.evaluate(() => window.__viz.pictureReset());
  await page.waitForTimeout(secs * 1000);
  const pic = await page.evaluate(() => window.__viz.picture());
  console.log(`${label} ${pic.samples} samples | ${Object.entries(pic.mean ?? {}).map(([k, v]) => `${k} ${Number(v).toFixed(3)}`).join("  ")}`);
} else if (mode === "check") {
  await page.evaluate(() => { globalThis.__p2flags.steps = 0; });
  await page.waitForTimeout(500);
  const a = await page.evaluate(() => globalThis.__p2dbg.readAgents());
  const landed0 = await page.evaluate(() => {
    globalThis.__p2flags.nosort = false;
    globalThis.__p2dbg.kickSort();
    return globalThis.__p2dbg.landed;
  });
  await page.waitForFunction((l0) => globalThis.__p2dbg.landed > l0, landed0, { timeout: 20000 });
  const b = await page.evaluate(() => globalThis.__p2dbg.readAgents());
  console.log(`unsorted: ${JSON.stringify(a)}\nsorted:   ${JSON.stringify(b)}`);
  console.log(a.sum === b.sum && a.xor === b.xor ? "permutation OK" : "CHECKSUM MISMATCH: agents lost or duplicated");
}
await browser.close();
