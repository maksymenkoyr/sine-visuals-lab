// A/B harness for the panel's main-thread cost (PR #538: the panel draws on the
// scene's frames). It runs the measurement in
// docs/scenes/physarum2/scripts/perf/panelprof.mjs on several dev servers in
// turn, round after round, so before/after share the machine's load.
//
// Run from the repo root, one dev server per label, each on its own port:
//
//   node docs/perf/scripts/panelAB.mjs --ports P1,P2 --labels before,after
//        [--rounds N] [--scene ID] [--quality Q] [--blur on|off] [--power on|off]
//        [--card NAME] [--seconds N] [--mic] [--closed] [--trace]
//
// Flag defaults are the `arg(...)` fallbacks at the top of the file. Options:
// --power on (energy saving: the scene renders at RENDER_FPS_CAP_FLOOR while rAF
// runs faster, as on a high-refresh display at the normal cap), --mic (the fake
// capture device instead of ?audio=synthetic, so readLocalCapture runs), --trace
// (a Chrome trace's style/layout/paint totals, one trace file per port written to
// `tools/.cache/perf-probes/trace-<port>.json`, gitignored; created on start),
// --card NAME (scrolls the card whose heading starts with NAME into view),
// --closed (measures with the panel closed).
// Prints one line per port per round, then MEDIANS per label: fps, busy %,
// stall % (time in buffer readbacks), self-time % per file, and with --trace the
// trace totals. Results go to the terminal only.
// Needs: Chromium through Playwright with the real GPU flags it sets (ANGLE on
// Metal, GPU rasterization, ignore GPU blocklist, fake media devices), so a
// machine with a GPU, and dev servers at https://localhost:PORT (the vite config
// serves basic SSL in dev). Run one measurement at a time: a second GPU job on
// the same machine skews the numbers.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const OUT_DIR = join(ROOT, "tools/.cache/perf-probes");
mkdirSync(OUT_DIR, { recursive: true });
const args = process.argv.slice(2);
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const ports = arg("--ports", "5461,5462").split(",");
const labels = arg("--labels", "before,after").split(",");
const rounds = Number(arg("--rounds", "3"));
const scene = arg("--scene", "physarum2");
const quality = arg("--quality", "high");
const blur = arg("--blur", "on");
const power = arg("--power", "off");
const card = arg("--card", null);
const seconds = Number(arg("--seconds", "6"));
const mic = args.includes("--mic");
const closed = args.includes("--closed");
const trace = args.includes("--trace");
const FILES = ["deviceMenu.ts", "audioMeters.ts", "leashGauge.ts", "columnStore.ts", "spectrumStrip.ts", "controlsKit.ts", "cableLayer.ts", "lufsAnalyser.ts", "lufs.ts", "inputHealth.ts", "inputHealthTap.ts", "waveform.ts", "itemBoxes.ts", "strainConsole.ts", "pairPads.ts", "causticsSparkle.ts", "heat.ts", "app.ts"];
const NATIVE = ["getFloatTimeDomainData", "getBufferSubData", "stroke", "fillRect", "clearRect", "lineTo", "fillText", "drawImage", "putImageData", "setProperty", "setAttribute", "(garbage collector)", "(program)"];

const browser = await chromium.launch({
  channel: "chromium",
  headless: true,
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--enable-gpu", "--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist"],
});

async function once(port) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1456, height: 902 }, deviceScaleFactor: 2, permissions: mic ? ["microphone"] : [] });
  await ctx.addInitScript(([b, p]) => {
    localStorage.setItem("vibe.panelBlur", b === "on" ? "1" : "0");
    localStorage.setItem("vibe.powerMode", p);
  }, [blur, power]);
  await ctx.addInitScript(() => {
    const stats = { n: 0, ms: 0 };
    window.__rb = stats;
    const orig = WebGL2RenderingContext.prototype.getBufferSubData;
    WebGL2RenderingContext.prototype.getBufferSubData = function (...a) {
      const t = performance.now();
      const r = orig.apply(this, a);
      if (window.__rbOn) { stats.n++; stats.ms += performance.now() - t; }
      return r;
    };
  });
  const page = await ctx.newPage();
  const q = mic ? `?quality=${quality}` : `?audio=synthetic&bpm=124&quality=${quality}`;
  await page.goto(`https://localhost:${port}/${q}#/v/${scene}`);
  await page.waitForTimeout(1500);
  if (mic) await page.mouse.click(700, 450);
  await page.waitForTimeout(6000);
  if (!closed) {
    await page.evaluate(() => document.querySelector("#menuBtn")?.click());
    await page.waitForTimeout(2500);
    if (card) {
      await page.evaluate((name) => {
        const el = [...document.querySelectorAll(".vc-card")].find((e) => e.querySelector(".vc-card-head")?.textContent?.trim().startsWith(name));
        el?.scrollIntoView({ block: "start" });
      }, card);
      await page.waitForTimeout(1500);
    }
  }
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 250 });
  await page.evaluate(() => { window.__rb.n = 0; window.__rb.ms = 0; window.__rbOn = true; });
  await cdp.send("Profiler.start");
  const gaps = await page.evaluate((ms) => new Promise((res) => {
    const out = []; let last = performance.now(); const t0 = last;
    const f = (t) => { out.push(t - last); last = t; if (t - t0 < ms) requestAnimationFrame(f); else res(out); };
    requestAnimationFrame(f);
  }), seconds * 1000);
  const { profile } = await cdp.send("Profiler.stop");
  const rb = await page.evaluate(() => { window.__rbOn = false; return { ...window.__rb }; });
  const wall = seconds * 1000;
  const self = new Map();
  profile.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0)));
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const byFile = new Map();
  for (const [id, us] of self) {
    const cf = byId.get(id).callFrame;
    const file = cf.url ? cf.url.split("/").pop().split("?")[0] : cf.functionName;
    byFile.set(file, (byFile.get(file) ?? 0) + us / 1000);
  }
  const pct = (ms) => (ms / wall) * 100;
  const idle = byFile.get("(idle)") ?? 0;
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const r = { fps: 1000 / mean, busy: 100 - pct(idle), stall: pct(rb.ms), rbN: rb.n, files: {} };
  for (const f of [...FILES, ...NATIVE]) r.files[f] = pct(byFile.get(f) ?? 0);
  if (trace) {
    const path = join(OUT_DIR, `trace-${port}.json`);
    await browser.startTracing(page, { path, categories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "toplevel", "blink"] });
    await page.waitForTimeout(4000);
    const buf = await browser.stopTracing();
    const events = JSON.parse(buf.toString()).traceEvents;
    const main = new Set(events.filter((e) => e.name === "thread_name" && e.args?.name === "CrRendererMain").map((e) => `${e.pid}:${e.tid}`));
    const by = new Map(); let t0 = Infinity, t1 = -Infinity;
    for (const e of events) {
      if (e.ph !== "X" || !main.has(`${e.pid}:${e.tid}`)) continue;
      t0 = Math.min(t0, e.ts); t1 = Math.max(t1, e.ts + (e.dur ?? 0));
      const k = e.name; const c = by.get(k) ?? { ms: 0, n: 0 }; c.ms += (e.dur ?? 0) / 1000; c.n++; by.set(k, c);
    }
    const tw = (t1 - t0) / 1000;
    r.trace = {};
    for (const k of ["RunTask", "FireAnimationFrame", "FunctionCall", "UpdateLayoutTree", "Layout", "Blink.ForcedStyleAndLayout", "PrePaint", "Paint", "Layerize", "Commit", "UpdateLayer", "HitTest", "ParseHTML"]) {
      const c = by.get(k); r.trace[k] = c ? { pct: (c.ms / tw) * 100, n: c.n } : { pct: 0, n: 0 };
    }
  }
  await ctx.close();
  return r;
}

const all = labels.map(() => []);
for (let round = 0; round < rounds; round++) {
  for (let i = 0; i < ports.length; i++) {
    const r = await once(ports[i]);
    all[i].push(r);
    const tr = r.trace ? ` | layout ${r.trace.Layout.pct.toFixed(1)}% (${r.trace.Layout.n}) style ${r.trace.UpdateLayoutTree.pct.toFixed(1)}% forced ${r.trace["Blink.ForcedStyleAndLayout"].pct.toFixed(1)}% (${r.trace["Blink.ForcedStyleAndLayout"].n}) paint ${r.trace.Paint.pct.toFixed(1)}% rAF ${r.trace.FireAnimationFrame.pct.toFixed(1)}% task ${r.trace.RunTask.pct.toFixed(1)}%` : "";
    console.log(`round ${round + 1} ${labels[i].padEnd(7)} fps ${r.fps.toFixed(0).padStart(3)} | busy ${r.busy.toFixed(1).padStart(5)}% | stall ${r.stall.toFixed(1).padStart(5)}% (${r.rbN}) | menu ${r.files["deviceMenu.ts"].toFixed(2)} meters ${r.files["audioMeters.ts"].toFixed(2)} leash ${r.files["leashGauge.ts"].toFixed(2)} program ${r.files["(program)"].toFixed(1)}${tr}`);
  }
}
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
console.log(`\nMEDIANS over ${rounds} rounds — scene ${scene} quality ${quality} blur ${blur} power ${power}${card ? " card " + card : ""}${mic ? " mic" : ""}${closed ? " CLOSED" : ""}`);
for (let i = 0; i < labels.length; i++) {
  const rs = all[i];
  const line = [`fps ${med(rs.map((r) => r.fps)).toFixed(0)}`, `busy ${med(rs.map((r) => r.busy)).toFixed(1)}%`, `busy-minus-stall ${med(rs.map((r) => r.busy - r.stall)).toFixed(1)}%`, `stall ${med(rs.map((r) => r.stall)).toFixed(1)}%`];
  console.log(`${labels[i].padEnd(7)} ${line.join(" | ")}`);
  const fl = [...FILES, ...NATIVE].map((f) => [f, med(rs.map((r) => r.files[f]))]).filter(([, v]) => v >= 0.05).map(([f, v]) => `${f} ${v.toFixed(2)}`);
  console.log(`        self %: ${fl.join(", ")}`);
  if (rs[0].trace) {
    const tl = Object.keys(rs[0].trace).map((k) => `${k} ${med(rs.map((r) => r.trace[k].pct)).toFixed(1)}%/${med(rs.map((r) => r.trace[k].n))}`);
    console.log(`        trace: ${tl.join(", ")}`);
  }
}
await browser.close();
