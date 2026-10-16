// Scene-switch freeze profiler: what one hash switch costs, frame by frame.
// Built for the 2026-10-16 revisit freeze (#552, docs/scenes/physarum2.md,
// Measurements): its CPU profile is what showed the Start ink fill's
// generator closure running several times slower on every mount after the
// first.
//
//   seq            the 2026-10-15 resource map's switch order (Caustics, then
//                  Physarum 2, Sky, Chladni, Ferrofluid, back, revisits, the
//                  gallery), then each revisit again from Sky; a fresh page
//                  per round, the longest frame gap per switch
//   prof <to>      visit the --warm scenes (default <to>, so it's a revisit;
//                  "" for a first visit), sit on --from, switch to <to> and
//                  print the long frames; --gl adds the time inside every
//                  WebGL call by name, --cpu a sourcemapped CPU profile of
//                  the first --win ms (self time, and inclusive time for
//                  src/ functions)
//
// Run it against a production build with sourcemaps (function names and
// lines come from the .map files beside each chunk):
//   node node_modules/vite/bin/vite.js build --sourcemap --outDir <dist>
//   node node_modules/vite/bin/vite.js preview --outDir <dist> --port 5481 --strictPort
//   node switchprof.mjs --port 5481 --dist <dist> seq [--rounds 3]
//   node switchprof.mjs --port 5481 --dist <dist> prof physarum2 [--from sky]
//     [--warm a,b] [--gl] [--cpu] [--win 1500] [--ms 3000] [--out f.cpuprofile]
// --track <48 kHz mono s16 wav> feeds real music through the fake
// microphone (the audio analysis then runs as for a visitor); without it the
// page runs ?audio=synthetic. The user's own Chrome sharing the GPU makes
// single runs noisy: repeat, and interleave the two builds' runs.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
const NM = new URL("../../../../../node_modules/", import.meta.url);
const { chromium } = await import(new URL("playwright/index.mjs", NM));
const { TraceMap, originalPositionFor } = await import(new URL("@jridgewell/trace-mapping/dist/trace-mapping.mjs", NM));

const args = process.argv.slice(2);
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const has = (k) => args.includes(k);
const port = arg("--port", "5481");
const DIST = arg("--dist", null);
const track = arg("--track", null);
const origin = `https://localhost:${port}`;

const maps = new Map();
function mapFor(url) {
  if (maps.has(url)) return maps.get(url);
  let m = null;
  const p = DIST && url.startsWith(origin) ? `${DIST}${new URL(url).pathname}.map` : null;
  if (p && existsSync(p)) m = new TraceMap(readFileSync(p, "utf8"));
  maps.set(url, m);
  return m;
}
function nameOf(cf) {
  if (!cf.url) return cf.functionName || "(native)";
  const m = mapFor(cf.url);
  if (!m) return `${cf.functionName || "(anon)"} @${cf.url.split("/").pop()}`;
  const o = originalPositionFor(m, { line: cf.lineNumber + 1, column: Math.max(0, cf.columnNumber) });
  if (!o.source) return `${cf.functionName || "(anon)"} (unmapped)`;
  let s = o.source.replace(/^(\.\.\/)+/, "");
  if (s.includes("node_modules/")) s = `nm/${s.split("node_modules/").pop().split("/")[0]}`;
  else if (s.includes("/src/")) s = `src/${s.split("/src/").pop()}`;
  return `${o.name || cf.functionName || "(anon)"} ${s}:${o.line}`;
}

/** Page side: each rAF callback's start and length while recording, and
 *  (with --gl) the time inside every WebGL2 call by name. */
function initScript() {
  const P = (window.__sw = { rec: false, frames: [], gl: {}, t0: 0 });
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) =>
    raf((t) => {
      const a = performance.now();
      try {
        cb(t);
      } finally {
        if (P.rec) P.frames.push([a - P.t0, performance.now() - a]);
      }
    });
  if (!window.__swGl) return;
  const proto = WebGL2RenderingContext.prototype;
  for (const name of Object.getOwnPropertyNames(proto)) {
    const d = Object.getOwnPropertyDescriptor(proto, name);
    if (!d || typeof d.value !== "function" || name === "constructor") continue;
    const f = d.value;
    proto[name] = function (...a) {
      if (!P.rec) return f.apply(this, a);
      const t = performance.now();
      try {
        return f.apply(this, a);
      } finally {
        const dt = performance.now() - t;
        const e = (P.gl[name] ??= { n: 0, ms: 0, max: 0 });
        e.n++;
        e.ms += dt;
        if (dt > e.max) e.max = dt;
      }
    };
  }
}

const browser = await chromium.launch({
  channel: "chromium",
  headless: true,
  args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    ...(track ? [`--use-file-for-fake-audio-capture=${track}`] : []),
    "--autoplay-policy=no-user-gesture-required",
    "--enable-gpu",
    "--use-angle=metal",
    "--enable-gpu-rasterization",
    "--ignore-gpu-blocklist",
  ],
});

async function openApp(hash, gl) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1456, height: 902 }, deviceScaleFactor: 2, permissions: ["microphone"] });
  if (gl) await ctx.addInitScript(() => (window.__swGl = true));
  await ctx.addInitScript(initScript);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("pageerror", String(e.message).split("\n")[0]));
  await page.goto(`${origin}/${track ? "" : "?audio=synthetic&bpm=124"}${hash}`, { waitUntil: "load" });
  await page.waitForTimeout(1500);
  if (track) await page.mouse.click(1000, 600); // a gesture, so the mic starts
  await page.waitForTimeout(3500);
  return { ctx, page };
}

/** Switches by hash; every frame's [start ms, gap before it, callback ms]. */
async function switchTo(page, hash, ms = 3000) {
  await page.evaluate((h) => {
    const P = window.__sw;
    P.frames = [];
    P.gl = {};
    P.rec = true;
    P.t0 = performance.now();
    location.hash = h;
  }, hash);
  await page.waitForTimeout(ms);
  return page.evaluate(() => {
    const P = window.__sw;
    P.rec = false;
    const f = P.frames;
    return { gaps: f.map((x, i) => [x[0], i ? x[0] - f[i - 1][0] : x[0], x[1]]), gl: P.gl };
  });
}
const maxGap = (r) => Math.round(Math.max(0, ...r.gaps.map((g) => g[1])));

if (args.includes("seq")) {
  const rounds = Number(arg("--rounds", "3"));
  const all = [];
  for (let k = 0; k < rounds; k++) {
    const { ctx, page } = await openApp("#/v/caustics");
    const out = {};
    for (const s of ["physarum2", "sky", "chladni", "ferrofluid"]) out[`first ${s}`] = maxGap(await switchTo(page, `#/v/${s}`));
    out["back to caustics"] = maxGap(await switchTo(page, "#/v/caustics"));
    for (const s of ["physarum2", "sky", "chladni"]) out[`revisit ${s}`] = maxGap(await switchTo(page, `#/v/${s}`));
    out["to gallery"] = maxGap(await switchTo(page, "#/"));
    out["gallery to caustics"] = maxGap(await switchTo(page, "#/v/caustics"));
    out["to sky"] = maxGap(await switchTo(page, "#/v/sky"));
    out["caustics from sky"] = maxGap(await switchTo(page, "#/v/caustics"));
    out["to sky again"] = maxGap(await switchTo(page, "#/v/sky"));
    out["physarum2 from sky"] = maxGap(await switchTo(page, "#/v/physarum2"));
    await ctx.close();
    all.push(out);
  }
  for (const key of Object.keys(all[0])) console.log(key.padEnd(22), all.map((o) => String(o[key]).padStart(5)).join(" "));
} else if (args.includes("prof")) {
  const to = args[args.indexOf("prof") + 1];
  const from = arg("--from", "sky");
  const warm = arg("--warm", to).split(",").filter(Boolean);
  const { ctx, page } = await openApp(`#/v/${from}`, has("--gl"));
  for (const w of warm) {
    await switchTo(page, `#/v/${w}`, 2500);
    await switchTo(page, `#/v/${from}`, 2500);
  }
  const cdp = await ctx.newCDPSession(page);
  if (has("--cpu")) {
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
    await cdp.send("Profiler.start");
  }
  const r = await switchTo(page, `#/v/${to}`, Number(arg("--ms", "3000")));
  console.log(`${from} -> ${to} (warm: ${warm.join(",") || "none"}) longest gap ${maxGap(r)} ms`);
  console.log("frames after a gap over 20 ms: [at ms, gap ms, callback ms]");
  for (const g of r.gaps) if (g[1] > 20) console.log("  ", g.map((x) => x.toFixed(1)).join("  "));
  console.log(`frames ${r.gaps.length}, callbacks ${r.gaps.reduce((a, g) => a + g[2], 0).toFixed(0)} ms in all`);
  if (has("--gl")) {
    console.log("WebGL calls (name, count, total ms, longest ms):");
    for (const [k, v] of Object.entries(r.gl).sort((a, b) => b[1].ms - a[1].ms).slice(0, 25)) {
      console.log("  ", k.padEnd(28), String(v.n).padStart(6), v.ms.toFixed(1).padStart(8), v.max.toFixed(1).padStart(8));
    }
  }
  if (has("--cpu")) {
    const { profile } = await cdp.send("Profiler.stop");
    if (has("--out")) writeFileSync(arg("--out"), JSON.stringify(profile));
    const byId = new Map(profile.nodes.map((n) => [n.id, n]));
    const parent = new Map();
    for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
    const names = new Map();
    const nm = (id) => {
      if (!names.has(id)) names.set(id, nameOf(byId.get(id).callFrame));
      return names.get(id);
    };
    const win = Number(arg("--win", "1500"));
    const self = new Map();
    const incl = new Map();
    let t = profile.startTime;
    let busy = 0;
    profile.samples.forEach((id, i) => {
      t += profile.timeDeltas[i];
      const ms = (profile.timeDeltas[i + 1] ?? 0) / 1000;
      if ((t - profile.startTime) / 1000 > win || nm(id) === "(idle)") return;
      busy += ms;
      self.set(nm(id), (self.get(nm(id)) ?? 0) + ms);
      const seen = new Set();
      for (let cur = id; cur !== undefined; cur = parent.get(cur)) {
        const k = nm(cur);
        if (seen.has(k)) continue;
        seen.add(k);
        incl.set(k, (incl.get(k) ?? 0) + ms);
      }
    });
    console.log(`main thread busy in the first ${win} ms: ${busy.toFixed(0)} ms`);
    console.log("self time:");
    for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log("  ", v.toFixed(1).padStart(7), k);
    console.log("inclusive, src/ only:");
    for (const [k, v] of [...incl].filter(([k]) => k.includes("src/")).sort((a, b) => b[1] - a[1]).slice(0, 40)) console.log("  ", v.toFixed(1).padStart(7), k);
  }
  await ctx.close();
}
await browser.close();
