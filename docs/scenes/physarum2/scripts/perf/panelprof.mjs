// Panel-open cost profile: rAF frame gaps, a CPU profile (self time per
// function and per file) and every synchronous GL read timed by caller, with
// the panel closed and then open — optionally scrolled to a card. Built for
// the 2026-10-04 "strong lags" session (docs/scenes/physarum2.md,
// Measurements): the readback timer is what showed each getBufferSubData
// waiting 10–15 ms behind the GPU once Panel blur was on.
//
// fps from a headless run on a machine the user is also using swings by 2×
// between identical runs; compare the SUMMARY line's main-thread share and
// readback stall instead, and interleave runs of the two builds.
//
// node panelprof.mjs [--port 5402] [--scene physarum2] [--quality high]
//   [--seconds 6] [--panel-only] [--blur on|off] [--card <title prefix>] [--top 25]
// zsh: pass `--card Scene` as two words — a quoted "$var" holding both is
// one argument and silently skips the scroll.
const { chromium } = await import(new URL("../../../../../node_modules/playwright/index.mjs", import.meta.url));

const args = process.argv.slice(2);
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const port = arg("--port", "5402");
const quality = arg("--quality", "high");
const seconds = Number(arg("--seconds", "6"));
const scene = arg("--scene", "physarum2");
const top = Number(arg("--top", "25"));
const blur = arg("--blur", null);
const card = arg("--card", null);

const browser = await chromium.launch({
  channel: "chromium",
  headless: true,
  args: ["--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--enable-gpu", "--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist"],
});
// The user's window: 1456×902 CSS at dpr 2 = a 2912×1804 canvas.
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1456, height: 902 }, deviceScaleFactor: 2 });
if (blur) await ctx.addInitScript((b) => localStorage.setItem("vibe.panelBlur", b), blur === "on" ? "1" : "0");
// Times every call of the GL reads that can block, keyed by caller.
await ctx.addInitScript(() => {
  const stats = new Map();
  window.__glStats = stats;
  for (const name of ["getBufferSubData", "readPixels", "getParameter", "getError", "clientWaitSync", "getQueryParameter"]) {
    const orig = WebGL2RenderingContext.prototype[name];
    WebGL2RenderingContext.prototype[name] = function (...a) {
      const t = performance.now();
      const r = orig.apply(this, a);
      if (window.__glStatsOn) {
        const dt = performance.now() - t;
        const at = new Error().stack.split("\n")[2]?.trim().replace(/\?[^:]*/, "").replace(/https:\/\/[^/]+/, "") ?? "?";
        const k = `${name} ${at}`;
        const e = stats.get(k) ?? { n: 0, ms: 0, max: 0 };
        e.n++;
        e.ms += dt;
        e.max = Math.max(e.max, dt);
        stats.set(k, e);
      }
      return r;
    };
  }
});
const page = await ctx.newPage();
await page.goto(`https://localhost:${port}/?audio=synthetic&bpm=124&quality=${quality}#/v/${scene}`);
await page.waitForTimeout(8000);
const cdp = await ctx.newCDPSession(page);
await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 250 });

async function measure(label) {
  await page.evaluate(() => {
    window.__glStats.clear();
    window.__glStatsOn = true;
  });
  await cdp.send("Profiler.start");
  const gaps = await page.evaluate(
    (ms) =>
      new Promise((res) => {
        const out = [];
        let last = performance.now();
        const t0 = last;
        const f = (t) => {
          out.push(t - last);
          last = t;
          if (t - t0 < ms) requestAnimationFrame(f);
          else res(out);
        };
        requestAnimationFrame(f);
      }),
    seconds * 1000,
  );
  const { profile } = await cdp.send("Profiler.stop");
  const gl = await page.evaluate(() => {
    window.__glStatsOn = false;
    return [...window.__glStats].filter(([, e]) => e.ms > 2).sort((a, b) => b[1].ms - a[1].ms);
  });
  const sorted = [...gaps].sort((a, b) => a - b);
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  console.log(`\n=== ${label}: ${gaps.length} rAF frames, mean ${mean.toFixed(1)} ms (${(1000 / mean).toFixed(1)} fps), p95 ${q(0.95).toFixed(1)}, max ${sorted[sorted.length - 1].toFixed(1)}`);
  for (const [k, e] of gl) console.log(`  GL ${e.n} calls ${e.ms.toFixed(0)} ms (mean ${(e.ms / e.n).toFixed(1)}, max ${e.max.toFixed(1)})  ${k}`);

  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  profile.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0)));
  const byFn = new Map();
  const byFile = new Map();
  for (const [id, us] of self) {
    const cf = byId.get(id).callFrame;
    const file = cf.url ? cf.url.split("/").pop().split("?")[0] : cf.functionName;
    const fn = `${cf.functionName || "(anon)"} ${file}:${cf.lineNumber + 1}`;
    byFn.set(fn, (byFn.get(fn) ?? 0) + us);
    byFile.set(file, (byFile.get(file) ?? 0) + us);
  }
  const wall = seconds * 1000;
  for (const [k, us] of [...byFn].sort((a, b) => b[1] - a[1]).slice(0, top)) {
    console.log(`${(us / 1000).toFixed(0).padStart(6)} ms ${((us / 1000 / wall) * 100).toFixed(1).padStart(5)}%  ${k}`);
  }
  const idle = (byFile.get("(idle)") ?? 0) / 1000;
  const reads = gl.filter(([k]) => k.startsWith("getBufferSubData"));
  const stall = reads.reduce((a, [, e]) => a + e.ms, 0);
  const calls = reads.reduce((a, [, e]) => a + e.n, 0);
  console.log(`SUMMARY ${label} port=${port}: fps ${(1000 / mean).toFixed(0)} p95 ${q(0.95).toFixed(1)}ms | main busy ${(100 - (idle / wall) * 100).toFixed(0)}% | readback ${calls} calls ${stall.toFixed(0)} ms`);
}

if (!args.includes("--panel-only")) await measure("panel closed");
await page.evaluate(() => document.querySelector("#menuBtn")?.click());
await page.waitForTimeout(3000);
if (card) {
  await page.evaluate((name) => {
    const el = [...document.querySelectorAll(".vc-card")].find((e) => e.querySelector(".vc-card-head")?.textContent?.trim().startsWith(name));
    el?.scrollIntoView({ block: "start" });
  }, card);
  await page.waitForTimeout(1500);
}
await measure("panel open" + (card ? ` @${card}` : ""));
await browser.close();
