// GPU cost of a scene on the real GPU, measured two ways — for "this scene
// is slow" reports, and for proving a shader optimisation didn't change the
// picture. Needs `npm run dev` running; headless Chromium drives the real
// Metal GPU (the flags below), not SwiftShader, so the numbers are this
// machine's own.
//
//   node tools/gpu-bench.mjs --port P --scenes caustics,ink [--w 3024 --h 1890] [--frames 60]
//     Renders each scene's own module (tools/gpu-bench/) into a fixed-size
//     canvas on a deterministic synthetic feed and prints the median GPU
//     time per frame (EXT_disjoint_timer_query_webgl2) and wall time. No
//     governor, no render cap, no drives — just the scene's draw. Absolute
//     numbers read higher than in the app (the GPU clocks down between the
//     synced frames); compare scenes or versions within one run, and
//     interleave a baseline when comparing edits, since clocks drift.
//
//   node tools/gpu-bench.mjs --port P --scenes caustics --dump 30,75 --out DIR [--seed N]
//     Writes those frames as raw RGBA (DIR/<scene>-<frame>.rgba, w*h*4
//     bytes). Same frame index = same picture on every run (with --seed for
//     a scene that draws from Math.random, as Chladni does), so dumping
//     before and after an edit and running
//   node tools/gpu-bench.mjs --compare a.rgba b.rgba
//     counts the pixels that changed and by how much.
//
//   node tools/gpu-bench.mjs --port P --app --scene caustics [--seconds 4] [--dpr 2] [--wait 2.5]
//     Times every draw call inside the running app instead (timer queries
//     wrapped around drawArrays & co.), grouped by shader program, on a
//     1512x945 viewport at the given devicePixelRatio (2 = a MacBook's
//     Retina canvas). This is what the user actually sees, render cap and
//     all — the fps it prints is draws per second. Timing starts --wait
//     seconds after the scene loads (raise it for a scene whose opening
//     costs differently from its steady state).
//
// Why each bench frame is followed by a 1-pixel readPixels: a tile-based GPU
// (every Apple GPU) skips shading opaque fragments that a later draw in the
// same render pass covers, so N back-to-back full-screen draws cost about one.
// The first version of this bench measured Caustics at 0.36 ms that way.
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const get = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i === -1 ? d : args[i + 1];
};
const has = (k) => args.includes(`--${k}`);

if (has("compare")) {
  const i = args.indexOf("--compare");
  const a = readFileSync(args[i + 1]);
  const b = readFileSync(args[i + 2]);
  if (a.length !== b.length) throw new Error("frames differ in size");
  let changed = 0;
  let maxDiff = 0;
  for (let p = 0; p < a.length; p += 4) {
    const d = Math.max(Math.abs(a[p] - b[p]), Math.abs(a[p + 1] - b[p + 1]), Math.abs(a[p + 2] - b[p + 2]));
    if (d) changed++;
    if (d > maxDiff) maxDiff = d;
  }
  const n = a.length / 4;
  console.log(`${changed}/${n} px changed (${((100 * changed) / n).toFixed(3)}%), max channel diff ${maxDiff}/255`);
  process.exit(0);
}

const port = get("port", "5173");
const browser = await chromium.launch({
  channel: "chromium",
  args: [
    "--enable-gpu",
    "--use-angle=metal",
    "--enable-gpu-rasterization",
    "--ignore-gpu-blocklist",
    "--use-fake-device-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
  ],
});

try {
  if (has("app")) await appMode();
  else await benchMode();
} finally {
  await browser.close();
}

async function benchMode() {
  const q = new URLSearchParams({ scenes: get("scenes", "caustics"), w: get("w", "1920"), h: get("h", "1080"), frames: get("frames", "60") });
  if (get("dump")) q.set("dump", get("dump"));
  const page = await browser.newPage({ ignoreHTTPSErrors: true });
  page.on("pageerror", (e) => console.error("[pageerror]", e.message));
  // --seed N: Math.random becomes a seeded generator (mulberry32) before the
  // page's own scripts run, for a scene that draws from it (Chladni seeds its
  // grains and steps them with it), so a dump repeats exactly run to run.
  if (get("seed")) {
    await page.addInitScript((seed) => {
      let a = seed >>> 0;
      Math.random = () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }, Number(get("seed")));
  }
  await page.goto(`https://localhost:${port}/tools/gpu-bench/index.html?${q}`);
  await page.waitForFunction(() => window.__bench, null, { timeout: 180_000 });
  const r = await page.evaluate(() => window.__bench);
  if (r.error) throw new Error(r.error);
  if (get("dump")) {
    const out = get("out", ".");
    mkdirSync(out, { recursive: true });
    const at = get("dump").split(",");
    for (const s of r.results) s.shots.forEach((b64, k) => {
      const file = join(out, `${s.id}-${at[k]}.rgba`);
      writeFileSync(file, Buffer.from(b64, "base64"));
      console.log(file);
    });
    return;
  }
  console.log(`${r.renderer} — ${r.w}x${r.h}${r.timerQuery ? "" : " (no timer query: GPU column empty)"}`);
  for (const s of r.results) console.log(`${s.id.padEnd(14)} gpu ${String(s.gpuMs).padStart(7)} ms   wall ${String(s.wallMs).padStart(7)} ms${s.glError ? `   glError ${s.glError}` : ""}`);
}

async function appMode() {
  const scene = get("scene", "caustics");
  const seconds = Number(get("seconds", "4"));
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1512, height: 945 }, deviceScaleFactor: Number(get("dpr", "2")) });
  await context.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, opts) {
      const gl = getContext.call(this, type, opts);
      if (type !== "webgl2" || !gl || gl.__timed) return gl;
      gl.__timed = true;
      const ext = gl.getExtension("EXT_disjoint_timer_query_webgl2");
      if (!ext) return gl;
      const pending = [];
      window.__gpuDraws ??= [];
      for (const name of ["drawArrays", "drawElements", "drawArraysInstanced", "drawElementsInstanced"]) {
        const draw = gl[name].bind(gl);
        gl[name] = (...a) => {
          if (!window.__gpuOn) return draw(...a);
          const q = gl.createQuery();
          gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
          draw(...a);
          gl.endQuery(ext.TIME_ELAPSED_EXT);
          const prog = gl.getParameter(gl.CURRENT_PROGRAM);
          if (prog && !prog.__id) prog.__id = Math.random().toString(36).slice(2, 6);
          const vp = gl.getParameter(gl.VIEWPORT);
          pending.push({ q, key: `program ${prog?.__id ?? "none"} ${vp[2]}x${vp[3]}${gl.getParameter(gl.FRAMEBUFFER_BINDING) ? " offscreen" : ""}` });
        };
      }
      const poll = () => {
        while (pending.length && gl.getQueryParameter(pending[0].q, gl.QUERY_RESULT_AVAILABLE)) {
          const p = pending.shift();
          if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) window.__gpuDraws.push({ key: p.key, ms: gl.getQueryParameter(p.q, gl.QUERY_RESULT) / 1e6 });
          gl.deleteQuery(p.q);
        }
        requestAnimationFrame(poll);
      };
      requestAnimationFrame(poll);
      return gl;
    };
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.error("[pageerror]", e.message));
  await page.goto(`https://localhost:${port}/?audio=synthetic&bpm=124#/v/${scene}`);
  await page.waitForFunction(() => window.__viz, null, { timeout: 30_000 });
  await page.waitForTimeout(Number(get("wait", "2.5")) * 1000);
  await page.evaluate(() => { window.__gpuDraws.length = 0; window.__gpuOn = true; });
  await page.waitForTimeout(seconds * 1000);
  await page.evaluate(() => { window.__gpuOn = false; });
  await page.waitForTimeout(500);
  const draws = await page.evaluate(() => window.__gpuDraws);
  const groups = new Map();
  for (const d of draws) groups.set(d.key, [...(groups.get(d.key) ?? []), d.ms]);
  console.log(`${scene}: ${await page.evaluate(() => { const c = document.querySelector("canvas"); return `${c.width}x${c.height}`; })} canvas`);
  for (const [key, ms] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
    ms.sort((a, b) => a - b);
    console.log(`  ${key.padEnd(34)} ${String(ms.length).padStart(4)} draws (${(ms.length / seconds).toFixed(0)}/s)   gpu p50 ${ms[ms.length >> 1].toFixed(2)} ms   max ${ms[ms.length - 1].toFixed(2)} ms`);
  }
}
