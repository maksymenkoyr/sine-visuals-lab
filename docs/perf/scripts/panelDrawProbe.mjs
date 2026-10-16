// Panel draw probe (PR #538: the panel draws on the scene's frames): counts
// clearRect calls per canvas while the panel is open on Caustics (synthetic
// audio at the tempo set by the `bpm` query parameter, the quality set in the
// URL, and energy saving on by default, so the scene renders at
// RENDER_FPS_CAP_FLOOR while rAF runs faster). Prints rAF ticks/s, how often
// the busiest on-screen canvas redraws (= drawn panel ticks/s), and how many
// draws landed on canvases scrolled out of view (OFF: card|class|label|count),
// plus Web Animations started per card per second (the Tempo dot's beat
// flash shows as "Tempo <n>/s", about one per beat at that tempo).
//
// Run from the repo root with the app's dev server up on the port you pass
// (`node node_modules/vite/bin/vite.js --port P --strictPort`):
//
//   node docs/perf/scripts/panelDrawProbe.mjs --port P [--power on|off] [--card NAME]
//
// --card NAME scrolls the card whose heading starts with NAME to the top of its
// column first (for example `Scene`). Prints one summary line and writes nothing
// to disk. Needs: Chromium through Playwright with the real GPU flags it sets
// (ANGLE on Metal, GPU rasterization, ignore GPU blocklist, fake media devices),
// and a dev server at https://localhost:PORT (the vite config serves basic SSL in
// dev).
import { chromium } from "playwright";
const args = process.argv.slice(2);
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const port = arg("--port", "5462");
const power = arg("--power", "on");
const card = arg("--card", null);
const browser = await chromium.launch({
  channel: "chromium",
  headless: true,
  args: ["--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--enable-gpu", "--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist"],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1456, height: 902 }, deviceScaleFactor: 2 });
await ctx.addInitScript((p) => {
  localStorage.setItem("vibe.panelBlur", "0");
  localStorage.setItem("vibe.powerMode", p);
  const counts = new Map();
  window.__draws = counts;
  const flashes = new Map();
  window.__flashes = flashes;
  const origAnimate = Element.prototype.animate;
  Element.prototype.animate = function (...a) {
    if (window.__counting) {
      const head = this.closest(".vc-card")?.querySelector(".vc-card-head")?.textContent?.trim().slice(0, 5) ?? "?";
      flashes.set(head, (flashes.get(head) ?? 0) + 1);
    }
    return origAnimate.apply(this, a);
  };
  const orig = CanvasRenderingContext2D.prototype.clearRect;
  CanvasRenderingContext2D.prototype.clearRect = function (...a) {
    if (window.__counting) counts.set(this.canvas, (counts.get(this.canvas) ?? 0) + 1);
    return orig.apply(this, a);
  };
}, power);
const page = await ctx.newPage();
await page.goto(`https://localhost:${port}/?audio=synthetic&bpm=124&quality=low#/v/caustics`);
await page.waitForTimeout(6000);
await page.evaluate(() => document.querySelector("#menuBtn")?.click());
await page.waitForTimeout(2500);
if (card) {
  await page.evaluate((name) => {
    const el = [...document.querySelectorAll(".vc-card")].find((e) => e.querySelector(".vc-card-head")?.textContent?.trim().startsWith(name));
    el?.scrollIntoView({ block: "start" });
  }, card);
  await page.waitForTimeout(1500);
}
const r = await page.evaluate(
  () =>
    new Promise((res) => {
      window.__draws.clear();
      window.__flashes.clear();
      window.__counting = true;
      let ticks = 0;
      const t0 = performance.now();
      const f = (t) => {
        ticks++;
        if (t - t0 < 3000) requestAnimationFrame(f);
        else {
          window.__counting = false;
          const sec = (t - t0) / 1000;
          const inView = (el) => {
            const b = el.getBoundingClientRect();
            return b.width > 0 && b.bottom > 0 && b.top < innerHeight && b.right > 0 && b.left < innerWidth;
          };
          let onMax = 0, offMeters = 0, offSparks = 0, offMeterCanvases = 0, offSparkCanvases = 0, onSparks = 0, onSparkCanvases = 0, curve = -1;
          for (const [c, n] of window.__draws) {
            if (c.title.startsWith("The shape")) curve = inView(c) ? n : -2;
            if (inView(c) && c.classList.contains("vc-drive-spark")) { onSparks += n; onSparkCanvases++; }
            if (inView(c)) onMax = Math.max(onMax, n);
            else if (c.classList.contains("vc-drive-spark")) { offSparks += n; offSparkCanvases++; }
            else if (c.closest(".vc-card")) { offMeters += n; offMeterCanvases++; (window.__offList ??= []).push(`${(c.closest(".vc-card").querySelector(".vc-card-head")?.textContent ?? "?").trim().slice(0, 12)}|${c.className}|${c.getAttribute("aria-label") ?? c.title.slice(0, 30)}|${n}`); }
          }
          res({ rafPerSec: ticks / sec, drawnPerSec: onMax / sec, offMeters, offMeterCanvases, offSparks, offSparkCanvases, onSparkPerSec: onSparkCanvases ? onSparks / onSparkCanvases / sec : 0, onSparkCanvases, curvePerSec: curve >= 0 ? curve / sec : curve, off: (window.__offList ?? []).join(' ; '), flashes: [...window.__flashes].map(([k, n]) => `${k} ${(n / sec).toFixed(2)}/s`).join(' ') });
        }
      };
      requestAnimationFrame(f);
    }),
);
console.log(`port ${port} power ${power}${card ? " card " + card : ""}: rAF ${r.rafPerSec.toFixed(0)}/s | panel draws ${r.drawnPerSec.toFixed(0)}/s (ratio ${(r.drawnPerSec / r.rafPerSec).toFixed(2)}) | off-screen draws: meters ${r.offMeters} on ${r.offMeterCanvases} canvases, sparklines ${r.offSparks} on ${r.offSparkCanvases} | on-screen: sparklines ${r.onSparkPerSec.toFixed(0)}/s each on ${r.onSparkCanvases}, sparkle curve ${r.curvePerSec >= 0 ? r.curvePerSec.toFixed(0) + '/s' : r.curvePerSec === -2 ? 'off-screen' : 'none'} | flashes: ${r.flashes || 'none'}${r.off ? ' | OFF: ' + r.off : ''}`);
await browser.close();
