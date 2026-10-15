// Does main-thread work in the main window drop frames in the pop-out output?
// (PR #541: the pop-out opens with `noopener`.) Opens the app on Caustics with
// synthetic audio, opens the output either the way the app does (#outBtn ->
// outputBridge.open(), window.open with an opener) or with `noopener`, and
// records the OUTPUT window's rAF timestamps in-page while the main window is
// either janked or idle (`--mode jank`: a busy loop of `--busy` ms every
// `--every` ms when janked), has its panel open at the Master card's Picture
// block vs closed (`--mode panel`), or changes its own preview scene through a
// fixed list during the window (`--mode switch`). Conditions are interleaved per
// rep in a rotated order.
//
// Run from the repo root, with the app's dev server already up on the port you
// pass (`node node_modules/vite/bin/vite.js --port P --strictPort`):
//
//   node docs/perf/scripts/outputIsolation.mjs --port P --mode jank|panel|switch
//        [--reps N] [--seconds N] [--warm MS] [--dsf N] [--busy MS] [--every MS]
//        [--out file.json]
//
// Flag defaults are the `arg(...)` fallbacks at the top of the file. It prints a
// line per rep and condition (RENDER = the output's frames that drew, rAF = every
// output callback), then a SUMMARY per condition, and writes the full results and
// screenshot checks as JSON to `--out`, by default
// `tools/.cache/perf-probes/<mode>-results.json` (gitignored, created on start).
// Summarize several result files with outputAggregate.mjs.
// Needs: Chromium through Playwright with the real GPU flags it sets (ANGLE on
// Metal, GPU rasterization, ignore GPU blocklist, fake media devices), so a
// machine with a GPU, and a dev server reachable at https://localhost:PORT (the
// vite config serves basic SSL in dev). Run one measurement at a time: a second
// GPU job on the same machine skews the numbers.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const args = process.argv.slice(2);
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const port = arg("--port", "5441");
const mode = arg("--mode", "jank");
const reps = Number(arg("--reps", "4"));
const seconds = Number(arg("--seconds", "8"));
const warmMs = Number(arg("--warm", "4000"));
const dsf = Number(arg("--dsf", "1"));
const busyMs = Number(arg("--busy", "30"));
const everyMs = Number(arg("--every", "100"));
const OUT_DIR = join(ROOT, "tools/.cache/perf-probes");
mkdirSync(OUT_DIR, { recursive: true });
const out = arg("--out", `${OUT_DIR}/${mode}-results.json`);
const origin = `https://localhost:${port}`;

const browser = await chromium.launch({
  channel: "chromium",
  headless: true,
  args: [
    "--use-fake-device-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
    "--enable-gpu",
    "--use-angle=metal",
    "--enable-gpu-rasterization",
    "--ignore-gpu-blocklist",
  ],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1456, height: 902 }, deviceScaleFactor: dsf });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`main: ${e.message}`));
await page.goto(`${origin}/?audio=synthetic&bpm=120#/v/caustics`);
await page.waitForTimeout(8000);
const bcdp = await browser.newBrowserCDPSession();

const renderers = async () => {
  const { processInfo } = await bcdp.send("SystemInfo.getProcessInfo");
  return processInfo.filter((p) => p.type === "renderer").length;
};
const outBtnText = () => page.evaluate(() => document.getElementById("outBtn")?.textContent ?? "");

const recorder = (ms) =>
  new Promise((res) => {
    const ts = [];
    let t0;
    const f = (t) => {
      ts.push(t);
      if (t0 === undefined) t0 = t;
      if (t - t0 < ms) requestAnimationFrame(f);
      else res(ts);
    };
    requestAnimationFrame(f);
  });

function stats(ts) {
  const g = [];
  for (let i = 1; i < ts.length; i++) g.push(ts[i] - ts[i - 1]);
  const s = [...g].sort((a, b) => a - b);
  const med = s[Math.floor(s.length / 2)];
  return {
    frames: ts.length,
    medianMs: +med.toFixed(2),
    over25: g.filter((x) => x > 25).length,
    missed60: g.reduce((a, x) => a + (x > 25 ? Math.max(0, Math.round(x / 16.667) - 1) : 0), 0),
    over50: g.filter((x) => x > 50).length,
    p99: +s[Math.floor(0.99 * s.length)].toFixed(1),
    maxMs: +s[s.length - 1].toFixed(1),
    // vsync frames dropped at the window's own rate (median interval)
    lost: Math.round((ts[ts.length - 1] - ts[0]) / med) + 1 - ts.length,
  };
}

async function setPanel(open) {
  const isOpen = await page.evaluate(() => document.getElementById("menuBtn")?.getAttribute("aria-pressed") === "true");
  if (isOpen !== open) await page.evaluate(() => document.getElementById("menuBtn")?.click());
  if (open) {
    await page.waitForTimeout(1500);
    const found = await page.evaluate(() => {
      // The Master card's title carries a keyboard-block badge, so match by
      // "includes"; the Picture heading is a leaf whose text is exactly that.
      const head = [...document.querySelectorAll(".vc-card *")].find(
        (e) => e.childElementCount === 0 && e.textContent?.trim() === "Picture" && e.closest(".vc-card")?.querySelector(".vc-card-head")?.textContent?.includes("Master"),
      );
      if (!head) return "no picture heading";
      head.scrollIntoView({ block: "center" });
      const r = head.getBoundingClientRect();
      return `picture@y${Math.round(r.y)}`;
    });
    await page.waitForTimeout(1000);
    return found;
  }
  await page.waitForTimeout(800);
  return "closed";
}

async function openOutput(kind) {
  const before = await renderers();
  const popP = ctx.waitForEvent("page", { timeout: 15000 });
  if (kind === "opener") await page.evaluate(() => document.getElementById("outBtn").click());
  else
    await page.evaluate((u) => {
      window.open(u, "svl-output", "popup=yes,width=1280,height=720,noopener");
    }, `${origin}/output.html`);
  const pop = await popP;
  pop.on("pageerror", (e) => errors.push(`output(${kind}): ${e.message}`));
  await pop.waitForLoadState("load");
  const t0 = Date.now();
  while (!(await outBtnText()).includes("OUTPUT") && Date.now() - t0 < 10000) await page.waitForTimeout(100);
  const seenMs = Date.now() - t0;
  await page.waitForTimeout(warmMs);
  const after = await renderers();
  const info = await pop.evaluate(() => ({
    hasOpener: window.opener !== null,
    w: innerWidth,
    h: innerHeight,
    cw: document.getElementById("gl")?.width,
    ch: document.getElementById("gl")?.height,
  }));
  return { pop, renderersBefore: before, renderersAfter: after, seenMs, info };
}

async function closeOutput(pop) {
  const t0 = Date.now();
  await pop.close();
  while ((await outBtnText()).includes("OUTPUT") && Date.now() - t0 < 6000) await page.waitForTimeout(50);
  const closedMs = Date.now() - t0;
  await page.waitForTimeout(1000);
  return closedMs;
}

async function measure(pop, jank) {
  if (jank)
    await page.evaluate(
      ([busy, every]) => {
        window.__jankN = 0;
        window.__jank = setInterval(() => {
          const t = performance.now();
          while (performance.now() - t < busy) {
            /* busy */
          }
          window.__jankN++;
        }, every);
      },
      [busyMs, everyMs],
    );
  const pic0 = await page.evaluate(() => {
    try {
      return window.__viz?.picture?.().samples ?? null;
    } catch {
      return null;
    }
  });
  // In the output page: note the rAF timestamp of every callback that drew
  // (the output renders at its own cap, framePace.ts's RENDER_FPS_CAP, on a
  // faster rAF), so misses are
  // counted on frames the output actually rendered. Installed after load (a
  // context init script misses the opener popup: its Window is reused from the
  // initial about:blank); the output looks both up per call, so it takes hold
  // from the next frame.
  await pop.evaluate(() => {
    const w = window;
    if (!w.__rt) {
      w.__rt = { on: false, ts: [] };
      let drew = false;
      const P = WebGL2RenderingContext.prototype;
      for (const n of ["drawArrays", "drawElements", "drawArraysInstanced", "drawElementsInstanced", "blitFramebuffer"]) {
        const o = P[n];
        P[n] = function (...a) {
          drew = true;
          return o.apply(this, a);
        };
      }
      const raf = w.requestAnimationFrame.bind(w);
      w.requestAnimationFrame = (cb) =>
        raf((t) => {
          drew = false;
          cb(t);
          if (drew && w.__rt.on) w.__rt.ts.push(t);
        });
    }
    w.__rt.ts = [];
    w.__rt.on = true;
  });
  // --mode switch: the main window changes its own (preview) scene four times
  // during the window — the output keeps its program, so only the main
  // window's scene init (shader compile/link, allocations) is in play.
  if (mode === "switch")
    await page.evaluate((ms) => {
      const ids = ["storm", "fluid", "physarum2", "caustics"];
      ids.forEach((id, i) => setTimeout(() => (location.hash = `#/v/${id}`), 800 + (i * (ms - 1600)) / (ids.length - 1)));
    }, seconds * 1000);
  const mainP = page.evaluate(recorder, seconds * 1000);
  const popTs = await pop.evaluate(recorder, seconds * 1000);
  const renderTs = await pop.evaluate(() => {
    if (!window.__rt) return null;
    window.__rt.on = false;
    return window.__rt.ts;
  });
  const mainTs = await mainP;
  const pic1 = await page.evaluate(() => {
    try {
      return window.__viz?.picture?.().samples ?? null;
    } catch {
      return null;
    }
  });
  const jankN = jank ? await page.evaluate(() => (clearInterval(window.__jank), window.__jankN)) : 0;
  return {
    out: stats(popTs),
    render: renderTs && renderTs.length > 2 ? stats(renderTs) : null,
    main: stats(mainTs),
    jankN,
    pictureSamples: pic0 === null || pic1 === null ? null : pic1 - pic0,
  };
}

const conds =
  mode === "switch"
    ? [
        { kind: "opener", jank: false, panel: false, sw: true },
        { kind: "noopener", jank: false, panel: false, sw: true },
      ]
    : mode === "jank"
    ? [
        { kind: "opener", jank: false, panel: false },
        { kind: "opener", jank: true, panel: false },
        { kind: "noopener", jank: false, panel: false },
        { kind: "noopener", jank: true, panel: false },
      ]
    : [
        { kind: "opener", jank: false, panel: false },
        { kind: "opener", jank: false, panel: true },
        { kind: "noopener", jank: false, panel: false },
        { kind: "noopener", jank: false, panel: true },
      ];
const label = (c) => `${c.kind}/${c.sw ? "main switches scene x4" : mode === "jank" ? (c.jank ? "jank" : "idle") : c.panel ? "panel@Picture" : "panel closed"}`;

const results = [];
const shots = [];
for (let r = 0; r < reps; r++) {
  const order = conds.slice(r % conds.length).concat(conds.slice(0, r % conds.length));
  for (const c of order) {
    const panelState = mode === "panel" ? await setPanel(c.panel) : "closed";
    const o = await openOutput(c.kind);
    const m = await measure(o.pop, c.jank);
    const png = await o.pop.screenshot();
    shots.push({ label: label(c), rep: r, b64: png.toString("base64") });
    const closedMs = await closeOutput(o.pop);
    const row = { rep: r, cond: label(c), panelState, ...m, renderers: `${o.renderersBefore}->${o.renderersAfter}`, seenMs: o.seenMs, closedMs, info: o.info };
    results.push(row);
    console.log(
      `${label(c).padEnd(26)} rep${r} RENDER: n ${m.render?.frames} med ${m.render?.medianMs} >25ms ${m.render?.over25} missed60 ${m.render?.missed60} >50ms ${m.render?.over50} max ${m.render?.maxMs} | rAF: n ${m.out.frames} med ${m.out.medianMs}ms >25ms ${m.out.over25} lost ${m.out.lost} max ${m.out.maxMs} | main med ${m.main.medianMs} >25 ${m.main.over25} | jank ${m.jankN} pic ${m.pictureSamples} | rend ${row.renderers} opener=${o.info.hasOpener} seen ${o.seenMs}ms closed ${closedMs}ms ${panelState}`,
    );
  }
}
if (mode === "panel") await setPanel(false);

// Non-blank check of every output screenshot, decoded in a scratch page.
const scratch = await ctx.newPage();
await scratch.goto("about:blank");
for (const s of shots) {
  s.pix = await scratch.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext("2d");
    g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
    let sum = 0;
    let lit = 0;
    for (let i = 0; i < d.length; i += 4) {
      const y = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      sum += y;
      if (y > 16) lit++;
    }
    const n = d.length / 4;
    return { w: bmp.width, h: bmp.height, meanLuma: +(sum / n).toFixed(1), litFrac: +(lit / n).toFixed(3) };
  }, s.b64);
}
for (const s of shots) console.log(`shot ${s.label} rep${s.rep}: ${s.pix.w}x${s.pix.h} meanLuma ${s.pix.meanLuma} lit ${s.pix.litFrac}`);

// Summary per condition.
console.log("\nSUMMARY (output window, per condition; per-rep in brackets)");
for (const c of conds) {
  const rows = results.filter((x) => x.cond === label(c));
  const f = (k) => rows.map((x) => x.out[k]);
  const fr = (k) => rows.map((x) => x.render?.[k] ?? NaN);
  const mean = (a) => (a.reduce((p, q) => p + q, 0) / a.length).toFixed(1);
  console.log(
    `${label(c).padEnd(26)} RENDER >25ms mean ${mean(fr("over25"))} [${fr("over25").join(",")}]  missed60 mean ${mean(fr("missed60"))} [${fr("missed60").join(",")}]  >50ms [${fr("over50").join(",")}]  max [${fr("maxMs").join(",")}]  n [${fr("frames").join(",")}]`,
  );
  console.log(
    `${"".padEnd(26)} rAF    >25ms mean ${mean(f("over25"))} [${f("over25").join(",")}]  missed60 mean ${mean(f("missed60"))} [${f("missed60").join(",")}]  >50ms [${f("over50").join(",")}]  lost@native mean ${mean(f("lost"))} [${f("lost").join(",")}]  max [${f("maxMs").join(",")}]  med ${f("medianMs").join(",")}`,
  );
}
if (errors.length) console.log("\nERRORS:\n" + [...new Set(errors)].slice(0, 20).join("\n"));
writeFileSync(out, JSON.stringify({ mode, reps, seconds, warmMs, dsf, busyMs, everyMs, results, shots: shots.map(({ b64, ...rest }) => rest), errors }, null, 2));
console.log(`\nwrote ${out}`);
await browser.close();
