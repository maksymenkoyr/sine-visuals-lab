#!/usr/bin/env node
// Performance snapshot: one command that measures everything the app costs
// on this machine, saves it as a dated JSON in docs/perf/, and compares it
// with the snapshot before — the baseline every long-term performance
// decision is judged against (docs/performance.md says what each number
// means and how far to trust it).
//
//   npm run perf                    snapshot HEAD, save, compare with the last one
//   npm run perf -- --ref <commit>  snapshot an older commit (backfilling history)
//   npm run perf -- --quick         released scenes only, shorter windows (no save)
//   npm run perf -- --only gpu,app  run some sections (load, gpu, app)
//   npm run perf -- --scenes a,b    only these scenes (no save)
//   npm run perf -- compare [a.json] [b.json]   default: the two newest in docs/perf/
//
// What it measures, in sections:
//  - load: a production build's weight (every file, raw and gzip) and what a
//    fresh visit to each page in LOAD_PAGES actually fetches, plus the time
//    to its first WebGL draw on a local server (parse, compile, boot — no
//    network).
//  - gpu: each scene's own GPU time per frame on tools/gpu-bench's isolated
//    page, at each size in GPU_SIZES (see tools/gpu-bench.mjs's header for
//    why its numbers read higher than in the app).
//  - app: the production build in a window the size of APP_VIEWPORT, tour of
//    the gallery and then every scene by hash change, panel closed and then
//    open. Per scene: the longest freeze while switching to it (shader
//    compiles) and while switching to it again on a second panel-closed tour
//    (programs come from the pool then, so what's left is the mount's own
//    work), then the steady draw rate and frame-gap spread, how busy the
//    main thread is (Chrome's own task counters, so the panel, audio
//    analysis and layout all count), the GPU time of everything drawn
//    (panel closed only — the panel's own GPU readout uses the same timer
//    queries, and two can't nest), and the JS heap. Last, the heap after a
//    forced GC before and after the whole tour, as a leak check.
//
// It always measures a `git archive` copy of a commit, never the working
// tree: so a snapshot names exactly the code it measured, an old commit can
// be measured the same way, and the gitignored paid scenes checkout can never
// be in it (nothing about a paid scene may land in this public repo —
// src/render/scenes/privateScenes.ts). The copy gets this checkout's
// tools/perf/ and tools/gpu-bench/ pages, so old commits are measured by
// today's instruments; a section an old commit can't run is recorded as an
// error and the rest go on.
//
// Headless Chromium drives the real GPU (Metal on a Mac), not SwiftShader.
// Other GPU work on the machine — the user's own Chrome above all — skews
// the numbers, so the snapshot records whether Chrome was running and the
// load average, and compare warns when the two snapshots differ there.
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync, cpSync } from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SNAPSHOT_DIR = join(ROOT, "docs/perf");
const SCHEMA = 1;

/** Pages a visitor opens directly; each is loaded once in a fresh profile. */
const LOAD_PAGES = [
  { name: "gallery", path: "/" },
  { name: "scene", path: "/?audio=synthetic&bpm=124#/v/caustics" },
  { name: "tv", path: "/tv.html" },
];
/** How long after the load event a visit keeps counting what it fetches —
 *  long enough for the pinned assets (src/pinnedAssets.ts) fetched after load. */
const LOAD_SETTLE_MS = 6000;
/** The isolated bench's canvas sizes: a 1080p output and a 14" MacBook's
 *  Retina canvas. */
const GPU_SIZES = [
  [1920, 1080],
  [3024, 1890],
];
const GPU_FRAMES = 60;
/** A 14" MacBook's default window in CSS px, at its devicePixelRatio. */
const APP_VIEWPORT = { width: 1512, height: 945, dpr: 2 };
const FULL = { switchMs: 1500, settleMs: 1000, measureMs: 3000, panelSettleMs: 1500, galleryMs: 4000 };
const QUICK = { switchMs: 1200, settleMs: 500, measureMs: 2000, panelSettleMs: 800, galleryMs: 2000 };
/** A drawn frame counts as a hitch when the gap before it is this many times
 *  the median gap — one missed refresh at the render cap or worse. */
const HITCH_FACTOR = 1.5;
const CHROME_FLAGS = [
  "--enable-gpu",
  "--use-angle=metal",
  "--enable-gpu-rasterization",
  "--ignore-gpu-blocklist",
  "--use-fake-device-for-media-stream",
  "--autoplay-policy=no-user-gesture-required",
];

/** Metric rules for compare: which way is worse, and the smallest change
 *  (absolute and relative) worth reporting given run-to-run noise. Declared
 *  above the dispatch below, which runs compare before the rest of the
 *  module is evaluated. */
const RULES = {
  gz: { worse: "up", abs: 2048, rel: 0.02, fmt: kb },
  ms: { worse: "up", abs: 1, rel: 0.15, fmt: (v) => `${v} ms` },
  freeze: { worse: "up", abs: 50, rel: 0.3, fmt: (v) => `${v} ms` },
  share: { worse: "up", abs: 0.05, rel: 0.2, fmt: (v) => `${Math.round(v * 100)}%` },
  fps: { worse: "down", abs: 3, rel: 0.05, fmt: (v) => `${v} fps` },
  hitch: { worse: "up", abs: 10, rel: 0.5, fmt: (v) => `${v}/min` },
  heap: { worse: "up", abs: 5, rel: 0.2, fmt: (v) => `${v} MB` },
};

const args = process.argv.slice(2);
const get = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const has = (k) => args.includes(`--${k}`);

const nodeModules = findNodeModules();
const { chromium } = await import(join(nodeModules, "playwright/index.mjs"));

if (args[0] === "compare") {
  compareCommand(args.slice(1).filter((a) => !a.startsWith("--")));
} else {
  await runCommand();
}

// ---------------------------------------------------------------- run

async function runCommand() {
  const ref = get("ref", "HEAD");
  const quick = has("quick");
  const timing = quick ? QUICK : FULL;
  const sections = new Set((get("only", "load,gpu,app")).split(","));
  const onlyScenes = get("scenes", null)?.split(",") ?? null;
  const save = !has("no-save") && !quick && !onlyScenes;

  const sha = git("rev-parse", `${ref}^{commit}`);
  const copy = prepareCopy(sha);
  const snap = {
    schema: SCHEMA,
    takenAt: new Date().toISOString(),
    commit: { sha, subject: git("log", "-1", "--format=%s", sha), date: git("log", "-1", "--format=%cI", sha) },
    machine: machineInfo(),
    settings: { quick, timing, gpuSizes: GPU_SIZES, gpuFrames: GPU_FRAMES, viewport: APP_VIEWPORT },
    errors: {},
  };
  console.log(`perf snapshot of ${sha.slice(0, 8)} "${snap.commit.subject}"`);
  if (snap.machine.chromeRunning) console.log("  note: Google Chrome is running — GPU numbers will read high and noisy");

  const browser = await chromium.launch({ channel: "chromium", args: CHROME_FLAGS });
  snap.machine.browser = browser.version();
  const servers = [];
  try {
    const dev = await startVite(copy, ["--strictPort"], "dev");
    servers.push(dev);
    let scenes = await listScenes(browser, dev.url);
    if (onlyScenes) scenes = scenes.filter((s) => onlyScenes.includes(s.id));
    if (quick) scenes = scenes.filter((s) => s.stage === "released" || s.stage === null);
    snap.scenes = scenes;
    console.log(`  ${scenes.length} scenes`);

    if (sections.has("gpu")) await section(snap, "gpu", () => gpuSection(browser, dev.url, scenes, snap));
    dev.stop();

    if (sections.has("load") || sections.has("app")) {
      const dist = join(copy, ".perf-dist");
      await section(snap, "build", async () => {
        const t0 = Date.now();
        await runVite(copy, ["build", "--outDir", dist, "--emptyOutDir"]);
        snap.buildSeconds = +((Date.now() - t0) / 1000).toFixed(1);
      });
      if (!snap.errors.build) {
        const prev = await startVite(copy, ["preview", "--outDir", dist, "--strictPort"], "preview");
        servers.push(prev);
        if (sections.has("load")) await section(snap, "load", () => loadSection(browser, prev.url, dist, snap));
        if (sections.has("app")) await section(snap, "app", () => appSection(browser, prev.url, scenes, timing, snap));
      }
    }
  } finally {
    for (const s of servers) s.stop();
    await browser.close();
  }

  printSummary(snap);
  if (get("out", null)) writeFileSync(get("out"), `${JSON.stringify(snap, null, 1)}\n`);
  if (save) {
    mkdirSync(SNAPSHOT_DIR, { recursive: true });
    const file = join(SNAPSHOT_DIR, `${snap.takenAt.slice(0, 10)}-${sha.slice(0, 8)}.json`);
    const before = latestSnapshots(1)[0];
    writeFileSync(file, `${JSON.stringify(snap, null, 1)}\n`);
    console.log(`\nsaved ${relative(ROOT, file)}`);
    if (before) compare(JSON.parse(readFileSync(before, "utf8")), snap, relative(ROOT, before), relative(ROOT, file));
  }
}

async function section(snap, name, fn) {
  const t0 = Date.now();
  process.stdout.write(`  ${name}…`);
  try {
    await fn();
    console.log(` ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  } catch (e) {
    snap.errors[name] = String(e?.message ?? e).split("\n")[0];
    console.log(` failed: ${snap.errors[name]}`);
  }
}

// ---------------------------------------------------------------- sections

async function listScenes(browser, url) {
  const page = await browser.newPage({ ignoreHTTPSErrors: true });
  try {
    await page.goto(`${url}tools/perf/scenes.html`);
    await page.waitForFunction(() => window.__scenes, null, { timeout: 120_000 });
    return await page.evaluate(() => window.__scenes);
  } finally {
    await page.close();
  }
}

async function gpuSection(browser, url, scenes, snap) {
  const page = await browser.newPage({ ignoreHTTPSErrors: true });
  snap.gpu = { scenes: {} };
  try {
    for (const [w, h] of GPU_SIZES) {
      const size = `${w}x${h}`;
      for (const s of scenes) {
        const q = new URLSearchParams({ scenes: s.id, w: String(w), h: String(h), frames: String(GPU_FRAMES) });
        const entry = (snap.gpu.scenes[s.id] ??= {});
        try {
          await page.goto(`${url}tools/gpu-bench/index.html?${q}`);
          await page.waitForFunction(() => window.__bench, null, { timeout: 60_000 });
          const r = await page.evaluate(() => window.__bench);
          if (r.error) throw new Error(r.error.split("\n")[0]);
          snap.gpu.renderer ??= r.renderer;
          snap.gpu.timerQuery ??= r.timerQuery;
          entry[size] = r.results[0].gpuMs;
        } catch (e) {
          entry[size] = null;
          (snap.gpu.errors ??= {})[s.id] = String(e?.message ?? e).split("\n")[0];
        }
      }
    }
  } finally {
    await page.close();
  }
}

async function loadSection(browser, url, dist, snap) {
  const files = walk(dist).map((f) => {
    const buf = readFileSync(f);
    return { path: relative(dist, f), raw: buf.length, gz: gzipSync(buf, { level: 9 }).length };
  });
  const byPath = new Map(files.map((f) => [f.path, f]));
  const kindOf = (p) => {
    const ext = p.split(".").pop().toLowerCase();
    if (ext === "js" || ext === "mjs") return "js";
    if (ext === "css") return "css";
    if (["woff", "woff2", "ttf", "otf"].includes(ext)) return "font";
    if (["mp4", "webm", "bin", "png", "jpg", "jpeg", "webp", "svg", "gif", "wav", "mp3"].includes(ext)) return "media";
    if (ext === "html") return "html";
    return "other";
  };
  const totals = (list) => {
    const t = {};
    for (const f of list) {
      const k = (t[kindOf(f.path)] ??= { raw: 0, gz: 0, files: 0 });
      k.raw += f.raw;
      k.gz += f.gz;
      k.files++;
    }
    t.all = list.reduce((a, f) => ({ raw: a.raw + f.raw, gz: a.gz + f.gz, files: a.files + 1 }), { raw: 0, gz: 0, files: 0 });
    return t;
  };
  const js = files.filter((f) => kindOf(f.path) === "js").sort((a, b) => b.gz - a.gz);
  snap.load = {
    build: totals(files),
    largestJs: js.slice(0, 8).map((f) => ({ file: f.path.replace(/-[\w-]{8}\.js$/, ".js"), raw: f.raw, gz: f.gz })),
    pages: {},
  };

  for (const p of LOAD_PAGES) {
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: APP_VIEWPORT.width, height: APP_VIEWPORT.height }, deviceScaleFactor: APP_VIEWPORT.dpr });
    await context.addInitScript(perfInit);
    const page = await context.newPage();
    const fetched = new Set();
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (u.origin === new URL(url).origin) fetched.add(decodeURIComponent(u.pathname.replace(/^\//, "")) || "index.html");
    });
    await page.goto(`${url}${p.path.replace(/^\//, "")}`, { waitUntil: "load" });
    await page.waitForTimeout(LOAD_SETTLE_MS);
    const nav = await page.evaluate(() => {
      const n = performance.getEntriesByType("navigation")[0];
      return { domContentLoadedMs: Math.round(n.domContentLoadedEventEnd), loadMs: Math.round(n.loadEventEnd), firstDrawMs: window.__perf.firstDraw === null ? null : Math.round(window.__perf.firstDraw) };
    });
    const list = [...fetched].map((f) => byPath.get(f) ?? byPath.get(join(f, "index.html"))).filter(Boolean);
    snap.load.pages[p.name] = { ...nav, fetched: totals(list) };
    await context.close();
  }
}

async function appSection(browser, url, scenes, timing, snap) {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: APP_VIEWPORT.width, height: APP_VIEWPORT.height }, deviceScaleFactor: APP_VIEWPORT.dpr });
  await context.addInitScript(perfInit);
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e.message).split("\n")[0]));
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable", { timeDomain: "timeTicks" });
  const app = (snap.app = { scenes: {} });

  await page.goto(`${url}?audio=synthetic&bpm=124#/`, { waitUntil: "load" });
  await page.waitForTimeout(3000);
  app.heapAfterGcStartMb = await heapAfterGc(cdp);
  app.gallery = await measure(page, cdp, timing.galleryMs, true);

  // Panel closed.
  for (const s of scenes) {
    const switched = await switchTo(page, s.id, timing.switchMs);
    await page.waitForTimeout(timing.settleMs);
    const steady = await measure(page, cdp, timing.measureMs, true);
    app.scenes[s.id] = { switch: switched, closed: steady };
    // The largest canvas is the scene's: its buffer size is what the
    // render quality (auto-detected in a production build) resolved to.
    app.canvas ??= await page.evaluate(() => {
      const c = [...document.querySelectorAll("canvas")].sort((a, b) => b.width * b.height - a.width * a.height)[0];
      return c ? `${c.width}x${c.height}` : null;
    });
  }
  app.heapAfterGcEndMb = await heapAfterGc(cdp);

  // Panel closed, every scene again: a revisit (src/render/programCache.ts).
  // After the heap reading, so that stays comparable with older snapshots.
  for (const s of scenes) app.scenes[s.id].revisit = await switchTo(page, s.id, timing.switchMs);

  // Panel open: one click on the scene menu button, and it stays open across
  // scene switches.
  await page.evaluate(() => document.querySelector("#menuBtn")?.click());
  await page.waitForTimeout(1500);
  app.panelOpened = await page.evaluate(() => document.querySelector("#menuBtn")?.getAttribute("aria-pressed") === "true");
  for (const s of scenes) {
    await switchTo(page, s.id, timing.switchMs);
    await page.waitForTimeout(timing.panelSettleMs);
    app.scenes[s.id].open = await measure(page, cdp, timing.measureMs, false);
  }
  app.pageErrors = [...new Set(pageErrors)].slice(0, 20);
  await context.close();
}

/** Switches scene by hash and returns the longest frame gap and the long
 *  tasks while the new scene comes up. */
async function switchTo(page, id, ms) {
  await page.evaluate((sceneId) => {
    const P = window.__perf;
    P.gaps = [];
    P.long = [];
    P.recording = true;
    location.hash = `#/v/${sceneId}`;
  }, id);
  await page.waitForTimeout(ms);
  return page.evaluate(() => {
    const P = window.__perf;
    P.recording = false;
    return { maxGapMs: round(Math.max(0, ...P.gaps)), longTaskMs: round(P.long.reduce((a, b) => a + b, 0)) };
    function round(x) {
      return Math.round(x);
    }
  });
}

async function measure(page, cdp, ms, gpu) {
  await page.evaluate((g) => {
    const P = window.__perf;
    P.gaps = [];
    P.drawGaps = [];
    P.long = [];
    P.gpu = [];
    P.recording = true;
    P.gpuOn = g;
    P.t0 = performance.now();
  }, gpu);
  const m0 = await cdpMetrics(cdp);
  await page.waitForTimeout(ms);
  const m1 = await cdpMetrics(cdp);
  const r = await page.evaluate(() => {
    const P = window.__perf;
    P.recording = false;
    P.gpuOn = false;
    return { wall: performance.now() - P.t0, gaps: P.gaps, drawGaps: P.drawGaps, long: P.long };
  });
  let gpuMs = null;
  if (gpu) {
    await page.waitForTimeout(300); // queries resolve a frame or two late
    gpuMs = await page.evaluate(() => window.__perf.gpu);
  }
  const secs = r.wall / 1000;
  const wallS = m1.Timestamp - m0.Timestamp;
  const share = (k) => +((m1[k] - m0[k]) / wallS).toFixed(3);
  const sorted = [...r.drawGaps].sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1] ?? null;
  const pct = (p) => (sorted.length ? +sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))].toFixed(1) : null);
  return {
    fps: +(r.drawGaps.length / secs).toFixed(1),
    rafHz: +(r.gaps.length / secs).toFixed(1),
    gapP50Ms: median === null ? null : +median.toFixed(1),
    gapP95Ms: pct(0.95),
    gapMaxMs: sorted.length ? +sorted[sorted.length - 1].toFixed(1) : null,
    hitchesPerMin: median === null ? null : +((sorted.filter((g) => g > HITCH_FACTOR * median).length / secs) * 60).toFixed(1),
    longTaskMs: Math.round(r.long.reduce((a, b) => a + b, 0)),
    main: share("TaskDuration"),
    script: share("ScriptDuration"),
    layoutStyle: +((m1.LayoutDuration - m0.LayoutDuration + m1.RecalcStyleDuration - m0.RecalcStyleDuration) / wallS).toFixed(3),
    // The busiest context's sum: one context's queries never overlap, but two
    // contexts' do (the gallery draws on the page canvas and on its shared
    // preview context), and adding those would count shared GPU time twice.
    gpuMsPerSec: gpuMs && gpuMs.length ? +(Math.max(...gpuMs.reduce((acc, [i, v]) => ((acc[i] = (acc[i] ?? 0) + v), acc), []).filter(Number.isFinite)) / secs).toFixed(1) : null,
    heapMb: +(m1.JSHeapUsedSize / 1048576).toFixed(1),
  };
}

async function cdpMetrics(cdp) {
  const { metrics } = await cdp.send("Performance.getMetrics");
  return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
}

async function heapAfterGc(cdp) {
  await cdp.send("HeapProfiler.collectGarbage");
  const m = await cdpMetrics(cdp);
  return +(m.JSHeapUsedSize / 1048576).toFixed(1);
}

/** Runs in the page before its own scripts: frame timing, long tasks, the
 *  first WebGL draw, and (while gpuOn) a timer query around every rAF
 *  callback on every WebGL2 context. */
function perfInit() {
  const P = (window.__perf = { gaps: [], drawGaps: [], long: [], gpu: [], recording: false, gpuOn: false, firstDraw: null, drew: false, lastDraw: 0 });
  const raf = window.requestAnimationFrame.bind(window);
  // Registered before the page's own callbacks, so in each frame it runs
  // first and sees whether the previous frame drew anything.
  let last = 0;
  const loop = (t) => {
    if (P.recording && last) P.gaps.push(t - last);
    last = t;
    if (P.drew) {
      if (P.recording && P.lastDraw) P.drawGaps.push(t - P.lastDraw);
      P.lastDraw = t;
      P.drew = false;
    }
    raf(loop);
  };
  raf(loop);
  try {
    new PerformanceObserver((l) => {
      if (P.recording) for (const e of l.getEntries()) P.long.push(e.duration);
    }).observe({ type: "longtask" });
  } catch {}
  const contexts = [];
  // The gallery's previews draw on one shared OffscreenCanvas context
  // (render/previewRenderer.ts), so both kinds of canvas are hooked.
  for (const C of [HTMLCanvasElement, globalThis.OffscreenCanvas]) if (C) hookGetContext(C.prototype);
  function hookGetContext(proto) {
  const getContext = proto.getContext;
  proto.getContext = function (type, opts) {
    const gl = getContext.call(this, type, opts);
    if (type !== "webgl2" || !gl || gl.__perf) return gl;
    gl.__perf = { ext: gl.getExtension("EXT_disjoint_timer_query_webgl2"), pending: [], active: null };
    contexts.push(gl);
    for (const name of ["drawArrays", "drawElements", "drawArraysInstanced", "drawElementsInstanced"]) {
      const draw = gl[name];
      gl[name] = function (...a) {
        if (P.firstDraw === null) P.firstDraw = performance.now();
        P.drew = true;
        return draw.apply(this, a);
      };
    }
    return gl;
  };
  }
  window.requestAnimationFrame = (cb) =>
    raf((t) => {
      if (!P.gpuOn) return cb(t);
      const open = [];
      for (const gl of contexts) {
        const g = gl.__perf;
        if (!g.ext || g.active || gl.isContextLost()) continue;
        g.active = gl.createQuery();
        gl.beginQuery(g.ext.TIME_ELAPSED_EXT, g.active);
        open.push(gl);
      }
      try {
        cb(t);
      } finally {
        for (const gl of open) {
          const g = gl.__perf;
          gl.endQuery(g.ext.TIME_ELAPSED_EXT);
          g.pending.push(g.active);
          g.active = null;
        }
      }
    });
  setInterval(() => {
    contexts.forEach((gl, i) => {
      const g = gl.__perf;
      while (g.pending.length && gl.getQueryParameter(g.pending[0], gl.QUERY_RESULT_AVAILABLE)) {
        const q = g.pending.shift();
        if (!gl.getParameter(g.ext.GPU_DISJOINT_EXT)) P.gpu.push([i, gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6]);
        gl.deleteQuery(q);
      }
    });
  }, 100);
}

// ---------------------------------------------------------------- summary + compare

function printSummary(snap) {
  const errs = Object.entries(snap.errors);
  if (errs.length) console.log(`\nerrors: ${errs.map(([k, v]) => `${k}: ${v}`).join("; ")}`);
  if (snap.load) {
    console.log("\nload (gzip kB)");
    const b = snap.load.build;
    console.log(`  build total ${kb(b.all.gz)}  js ${kb(b.js?.gz)}  media ${kb(b.media?.gz)}  font ${kb(b.font?.gz)}`);
    for (const [name, p] of Object.entries(snap.load.pages)) {
      console.log(`  ${name.padEnd(8)} fetches ${kb(p.fetched.all?.gz)} (js ${kb(p.fetched.js?.gz)}, media ${kb(p.fetched.media?.gz)})  first draw ${p.firstDrawMs ?? "--"} ms`);
    }
  }
  const rows = (snap.scenes ?? []).map((s) => ({ id: s.id, stage: s.stage, gpu: snap.gpu?.scenes[s.id], app: snap.app?.scenes[s.id] }));
  const top = (label, val, fmt, n = 8) => {
    const r = rows.filter((x) => val(x) != null).sort((a, b) => val(b) - val(a)).slice(0, n);
    if (r.length) console.log(`\n${label}\n${r.map((x) => `  ${x.id.padEnd(14)} ${fmt(val(x))}${x.stage && x.stage !== "released" ? `  (${x.stage})` : ""}`).join("\n")}`);
  };
  const retina = GPU_SIZES.map(([w, h]) => `${w}x${h}`).at(-1);
  top(`gpu ms/frame at ${retina}, isolated`, (x) => x.gpu?.[retina], (v) => `${v} ms`);
  top("main thread busy, panel closed", (x) => x.app?.closed?.main, (v) => `${Math.round(v * 100)}%`);
  top("main thread busy, panel open", (x) => x.app?.open?.main, (v) => `${Math.round(v * 100)}%`);
  top("hitches per minute, panel closed", (x) => x.app?.closed?.hitchesPerMin, (v) => `${v}`);
  top("scene switch freeze", (x) => x.app?.switch?.maxGapMs, (v) => `${v} ms`);
  top("scene revisit freeze", (x) => x.app?.revisit?.maxGapMs, (v) => `${v} ms`);
  if (snap.app) {
    const g = snap.app.gallery;
    console.log(`\ngallery  ${g.fps} fps, main ${Math.round(g.main * 100)}%, gpu ${g.gpuMsPerSec ?? "--"} ms/s, ${g.hitchesPerMin} hitches/min`);
    console.log(`heap after GC: ${snap.app.heapAfterGcStartMb} MB before the tour, ${snap.app.heapAfterGcEndMb} MB after`);
    if (!snap.app.panelOpened) console.log("warning: the panel did not report open — the panel-open numbers may be panel-closed");
  }
}

function compareCommand(files) {
  const [a, b] = files.length >= 2 ? files : latestSnapshots(2).reverse();
  if (!a || !b) throw new Error("need two snapshots in docs/perf/ (or pass two files)");
  compare(JSON.parse(readFileSync(a, "utf8")), JSON.parse(readFileSync(b, "utf8")), relative(ROOT, a), relative(ROOT, b));
}

function flatten(s) {
  const out = [];
  const add = (key, rule, v) => v != null && out.push({ key, rule, v });
  if (s.load) {
    add("load build total", "gz", s.load.build.all?.gz);
    add("load build js", "gz", s.load.build.js?.gz);
    for (const [n, p] of Object.entries(s.load.pages)) {
      add(`load ${n} fetched`, "gz", p.fetched.all?.gz);
      add(`load ${n} first draw`, "freeze", p.firstDrawMs);
    }
  }
  for (const [id, sizes] of Object.entries(s.gpu?.scenes ?? {})) for (const [size, v] of Object.entries(sizes)) add(`gpu ${id} ${size}`, "ms", v);
  if (s.app) {
    const steady = (k, m) => {
      add(`${k} fps`, "fps", m.fps);
      add(`${k} main`, "share", m.main);
      add(`${k} hitches`, "hitch", m.hitchesPerMin);
      add(`${k} gpu ms/s`, "ms", m.gpuMsPerSec);
    };
    steady("app gallery", s.app.gallery);
    for (const [id, a] of Object.entries(s.app.scenes)) {
      add(`app ${id} switch freeze`, "freeze", a.switch?.maxGapMs);
      add(`app ${id} revisit freeze`, "freeze", a.revisit?.maxGapMs);
      if (a.closed) steady(`app ${id} closed`, a.closed);
      if (a.open) steady(`app ${id} open`, a.open);
    }
    add("app heap after tour", "heap", s.app.heapAfterGcEndMb);
  }
  return out;
}

function compare(a, b, nameA, nameB) {
  console.log(`\ncompare ${nameA} (${a.commit.sha.slice(0, 8)}) → ${nameB} (${b.commit.sha.slice(0, 8)})`);
  if (a.machine.model !== b.machine.model) console.log(`  warning: different machines (${a.machine.model} vs ${b.machine.model}) — not comparable`);
  if (a.machine.chromeRunning !== b.machine.chromeRunning) console.log("  warning: Chrome was running for one run only — GPU and fps differences may be that");
  if (a.settings.quick !== b.settings.quick) console.log("  warning: one run is --quick");
  const before = new Map(flatten(a).map((m) => [m.key, m]));
  const worse = [];
  const better = [];
  let compared = 0;
  for (const m of flatten(b)) {
    const p = before.get(m.key);
    if (!p) continue;
    compared++;
    const r = RULES[m.rule];
    const d = m.v - p.v;
    if (Math.abs(d) < r.abs || Math.abs(d) < r.rel * Math.abs(p.v)) continue;
    const isWorse = (d > 0) === (r.worse === "up");
    (isWorse ? worse : better).push({ ...m, p, d, size: Math.abs(d) / Math.max(Math.abs(p.v), 1e-9), r });
  }
  const show = (label, list) => {
    if (!list.length) return;
    console.log(`  ${label}:`);
    for (const x of list.sort((q, w) => w.size - q.size).slice(0, 25)) console.log(`    ${x.key.padEnd(40)} ${x.r.fmt(x.p.v)} → ${x.r.fmt(x.v)}`);
    if (list.length > 25) console.log(`    … and ${list.length - 25} more`);
  };
  console.log(`  ${compared} metrics compared: ${worse.length} worse, ${better.length} better, the rest within noise`);
  show("worse", worse);
  show("better", better);
}

function latestSnapshots(n) {
  if (!existsSync(SNAPSHOT_DIR)) return [];
  return readdirSync(SNAPSHOT_DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}-[0-9a-f]+\.json$/.test(f))
    .map((f) => join(SNAPSHOT_DIR, f))
    .sort((x, y) => JSON.parse(readFileSync(y, "utf8")).takenAt.localeCompare(JSON.parse(readFileSync(x, "utf8")).takenAt))
    .slice(0, n);
}

// ---------------------------------------------------------------- plumbing

function git(...a) {
  return execFileSync("git", a, { cwd: ROOT, encoding: "utf8" }).trim();
}

/** The main checkout's node_modules — a worktree has none of its own. */
function findNodeModules() {
  const own = join(ROOT, "node_modules");
  if (existsSync(join(own, "playwright"))) return own;
  const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: ROOT, encoding: "utf8" }).trim();
  const main = join(dirname(common), "node_modules");
  if (existsSync(join(main, "playwright"))) return main;
  throw new Error("no node_modules with playwright — run npm install in the main checkout");
}

/** A `git archive` copy of the commit in the temp dir (reused across runs),
 *  with node_modules linked and today's measuring pages copied in. */
function prepareCopy(sha) {
  const dir = join(os.tmpdir(), `viz-perf-${sha.slice(0, 12)}`);
  if (!existsSync(join(dir, ".perf-ready"))) {
    mkdirSync(dir, { recursive: true });
    execFileSync("sh", ["-c", `git archive ${sha} | tar -x -C "${dir}"`], { cwd: ROOT });
    writeFileSync(join(dir, ".perf-ready"), sha);
  }
  if (!existsSync(join(dir, "node_modules"))) symlinkSync(nodeModules, join(dir, "node_modules"));
  for (const d of ["tools/perf", "tools/gpu-bench"]) cpSync(join(ROOT, d), join(dir, d), { recursive: true });
  return dir;
}

async function freePort() {
  return new Promise((res) => {
    const s = createServer();
    s.listen(0, () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });
}

async function startVite(cwd, extra, label) {
  const port = await freePort();
  const child = spawn(process.execPath, [join(nodeModules, "vite/bin/vite.js"), ...extra, "--port", String(port)], { cwd, env: { ...process.env, SKIP_PRIVATE_SCENES: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  const url = await new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error(`${label} server did not start:\n${log}`)), 60_000);
    const onData = (d) => {
      log += d;
      // biome-ignore lint/suspicious/noControlCharactersInRegex: strips terminal colour codes
      const m = log.replace(/\x1b\[[0-9;]*m/g, "").match(/(https?:\/\/localhost:\d+\/)/);
      if (m) {
        clearTimeout(timer);
        res(m[1]);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (code) => rej(new Error(`${label} server exited ${code}:\n${log}`)));
  });
  return { url, stop: () => child.kill() };
}

function runVite(cwd, a) {
  return new Promise((res, rej) => {
    const child = spawn(process.execPath, [join(nodeModules, "vite/bin/vite.js"), ...a], { cwd, env: { ...process.env, SKIP_PRIVATE_SCENES: "1" }, stdio: ["ignore", "pipe", "pipe"] });
    let log = "";
    child.stdout.on("data", (d) => (log += d));
    child.stderr.on("data", (d) => (log += d));
    child.on("exit", (code) => (code === 0 ? res() : rej(new Error(`vite ${a[0]} exited ${code}: ${log.slice(-400)}`))));
  });
}

function machineInfo() {
  const sh = (cmd) => {
    try {
      return execFileSync("sh", ["-c", cmd], { encoding: "utf8" }).trim();
    } catch {
      return null;
    }
  };
  return {
    model: sh("sysctl -n hw.model") ?? os.hostname(),
    cpu: sh("sysctl -n machdep.cpu.brand_string") ?? os.cpus()[0]?.model,
    memGb: Math.round(os.totalmem() / 2 ** 30),
    os: `${os.platform()} ${sh("sw_vers -productVersion") ?? os.release()}`,
    chromeRunning: !!sh("pgrep -x 'Google Chrome'"),
    loadAvg1m: +os.loadavg()[0].toFixed(2),
  };
}

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function kb(bytes) {
  return bytes == null ? "--" : `${(bytes / 1024).toFixed(0)} kB`;
}
