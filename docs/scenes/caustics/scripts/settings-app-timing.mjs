// tools/gpu-bench.mjs's --app timing (every draw call timed, grouped by program; " step" marks a transform-feedback pass) with
// Caustics' stored settings seeded first, so an effect like Droplets can be timed in the live app. --notime skips the timer
// queries (they cost frames themselves) and reports only the rAF rate. Interleave runs: GPU clocks and other load drift.
// node docs/scenes/caustics/scripts/settings-app-timing.mjs --port P [--settings JSON] [--seconds 5] [--dpr 2] [--notime]
import { chromium } from "playwright";

const args = process.argv.slice(2);
const get = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i === -1 ? d : args[i + 1];
};
const seconds = Number(get("seconds", "5"));
const settings = JSON.parse(get("settings", "{}"));
const browser = await chromium.launch({
  channel: "chromium",
  args: ["--enable-gpu", "--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"],
});
try {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1512, height: 945 }, deviceScaleFactor: Number(get("dpr", "2")) });
  await context.addInitScript(({ s, timed }) => {
    localStorage.setItem("vibe.sceneSettings", JSON.stringify({ caustics: s }));
    window.__gpuDraws = [];
    if (!timed) return;
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, opts) {
      const gl = getContext.call(this, type, opts);
      if (type !== "webgl2" || !gl || gl.__timed) return gl;
      gl.__timed = true;
      const ext = gl.getExtension("EXT_disjoint_timer_query_webgl2");
      if (!ext) return gl;
      const pending = [];
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
          const step = gl.isEnabled(gl.RASTERIZER_DISCARD) ? " step" : "";
          pending.push({ q, key: `${name} program ${prog?.__id ?? "none"} ${vp[2]}x${vp[3]}${gl.getParameter(gl.FRAMEBUFFER_BINDING) ? " offscreen" : ""}${step}` });
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
  }, { s: settings, timed: !args.includes("--notime") });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.error("[pageerror]", e.message.slice(0, 1000)));
  await page.goto(`https://localhost:${get("port", "5173")}/?audio=synthetic&bpm=124&quality=high#/v/caustics`);
  await page.waitForFunction(() => window.__viz, null, { timeout: 30_000 });
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    window.__gpuDraws.length = 0;
    window.__gpuOn = true;
    window.__frames = 0;
    const tick = () => {
      window.__frames++;
      if (window.__gpuOn) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.waitForTimeout(seconds * 1000);
  await page.evaluate(() => { window.__gpuOn = false; });
  await page.waitForTimeout(500);
  const draws = await page.evaluate(() => window.__gpuDraws);
  const frames = await page.evaluate(() => window.__frames);
  const canvas = await page.evaluate(() => { const c = document.querySelector("canvas"); return `${c.width}x${c.height}`; });
  console.log(`${JSON.stringify(settings)}: canvas ${canvas}, ${(frames / seconds).toFixed(0)} rAF/s`);
  const groups = new Map();
  for (const d of draws) groups.set(d.key, [...(groups.get(d.key) ?? []), d.ms]);
  for (const [key, ms] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
    ms.sort((a, b) => a - b);
    console.log(`  ${key.padEnd(56)} ${String(ms.length).padStart(4)} draws   gpu p50 ${ms[ms.length >> 1].toFixed(2)} ms   p90 ${ms[Math.floor(ms.length * 0.9)].toFixed(2)} ms`);
  }
} finally {
  await browser.close();
}
