// Probes for the output-window fixes (PR #541: the pop-out opens with `noopener`,
// and an OffscreenCanvas worker may isolate the render loop while the opener is
// kept). Each probe runs when its letter is in `--only`:
//   A  POP OUT pressed again while a noopener output is open: second window? reload?
//   B  crash coupling: does crashing the output kill the main window (opener vs noopener)?
//   C  clip recorder: which canvas gets recorded (opener vs noopener)?
//   D  worker renderer in an opener popup (same renderer as the main window):
//      rAF gaps of the worker vs the popup's own main thread, main window janked
//      or idle; and captureStream() on the transferred (placeholder) canvas.
//   E  can a MediaStreamTrack be transferred (structuredClone / MessagePort)?
//
// Run from the repo root, with the app's dev server already up on the port you
// pass (`node node_modules/vite/bin/vite.js --port P --strictPort`):
//
//   node docs/perf/scripts/outputProbes.mjs --port P [--only LETTERS] [--reps N] [--seconds N]
//
// Flag defaults are the `arg(...)` fallbacks at the top of the file. It prints a
// line per probe result (D also prints a summary), and writes all results as JSON
// to `tools/.cache/perf-probes/probes-results.json` (gitignored, created on start;
// probe C's clip files go to the same folder). B runs last because it may take
// the main window down. Needs: Chromium through Playwright with the real GPU
// flags it sets (ANGLE on Metal, GPU rasterization, ignore GPU blocklist) plus
// fake media devices with microphone permission (probe E), so a machine with a
// GPU, and a dev server at https://localhost:PORT (the vite config serves basic
// SSL in dev). Run one measurement at a time: a second GPU job skews the numbers.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const args = process.argv.slice(2);
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const port = arg("--port", "5441");
const only = new Set(arg("--only", "A,B,C,D,E").split(","));
const reps = Number(arg("--reps", "3"));
const seconds = Number(arg("--seconds", "6"));
const OUT_DIR = join(ROOT, "tools/.cache/perf-probes");
mkdirSync(OUT_DIR, { recursive: true });
const origin = `https://localhost:${port}`;
const outputUrl = `${origin}/output.html`;
const report = {};

const browser = await chromium.launch({
  channel: "chromium",
  headless: true,
  args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
    "--enable-gpu",
    "--use-angle=metal",
    "--enable-gpu-rasterization",
    "--ignore-gpu-blocklist",
  ],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1456, height: 902 }, acceptDownloads: true, permissions: ["microphone"] });
let page = await ctx.newPage();
await page.goto(`${origin}/?audio=synthetic&bpm=120#/v/caustics`);
await page.waitForTimeout(8000);
const bcdp = await browser.newBrowserCDPSession();
const renderers = async () => (await bcdp.send("SystemInfo.getProcessInfo")).processInfo.filter((p) => p.type === "renderer").length;
const outBtnText = () => page.evaluate(() => document.getElementById("outBtn")?.textContent ?? "");
const waitOpen = async (want, ms = 8000) => {
  const t0 = Date.now();
  while ((await outBtnText()).includes("OUTPUT") !== want && Date.now() - t0 < ms) await page.waitForTimeout(50);
  return Date.now() - t0;
};

async function openOutput(kind) {
  const popP = ctx.waitForEvent("page", { timeout: 15000 });
  if (kind === "opener") await page.evaluate(() => document.getElementById("outBtn").click());
  else await page.evaluate((u) => void window.open(u, "svl-output", "popup=yes,width=1280,height=720,noopener"), outputUrl);
  const pop = await popP;
  await pop.waitForLoadState("load");
  await waitOpen(true);
  await page.waitForTimeout(3000);
  return pop;
}
async function closeAllPopups() {
  for (const p of ctx.pages()) if (p !== page && !p.isClosed()) await p.close();
  await waitOpen(false, 6000);
  await page.waitForTimeout(500);
}

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
  return { n: ts.length, med: +med.toFixed(1), over25: g.filter((x) => x > 25).length, lost: Math.round((ts[ts.length - 1] - ts[0]) / med) + 1 - ts.length, max: +s[s.length - 1].toFixed(1) };
}
const startJank = () =>
  page.evaluate(() => {
    window.__jank = setInterval(() => {
      const t = performance.now();
      while (performance.now() - t < 30) {
        /* busy */
      }
    }, 100);
  });
const stopJank = () => page.evaluate(() => clearInterval(window.__jank));

// ---------------- A: a second POP OUT while a noopener output is open ----------------
if (only.has("A")) {
  const p1 = await openOutput("noopener");
  await p1.evaluate(() => (window.__mark = "first"));
  const pagesBefore = ctx.pages().length;
  const r = {};
  // A1: the app's own open() — its `win` is null (no handle), so it calls window.open(url, "svl-output", features).
  let newP = ctx.waitForEvent("page", { timeout: 4000 }).catch(() => null);
  await page.evaluate(() => document.getElementById("outBtn").click());
  let np = await newP;
  await page.waitForTimeout(1500);
  r.appOpenAgain = { newWindow: !!np, newUrl: np?.url() ?? null, firstStillMarked: await p1.evaluate(() => window.__mark ?? null).catch((e) => `err ${e.message}`), pages: `${pagesBefore}->${ctx.pages().length}` };
  if (np) await np.close();
  await page.waitForTimeout(500);
  // A2: a noopener open() again with the same name.
  newP = ctx.waitForEvent("page", { timeout: 4000 }).catch(() => null);
  const ret = await page.evaluate((u) => String(window.open(u, "svl-output", "popup=yes,width=1280,height=720,noopener")), outputUrl);
  np = await newP;
  await page.waitForTimeout(1500);
  r.noopenerOpenAgain = { returned: ret, newWindow: !!np, firstStillMarked: await p1.evaluate(() => window.__mark ?? null).catch((e) => `err ${e.message}`), pages: `${pagesBefore}->${ctx.pages().length}` };
  if (np) await np.close();
  // A3: can the output raise itself? window.focus() from a BroadcastChannel-style task (no user activation).
  r.selfFocus = await p1.evaluate(
    () =>
      new Promise((res) => {
        const before = document.hasFocus();
        setTimeout(() => {
          window.focus();
          setTimeout(() => res({ hasFocusBefore: before, hasFocusAfter: document.hasFocus(), userActivation: navigator.userActivation?.isActive ?? null }), 200);
        }, 0);
      }),
  );
  // A4: the window's name, as the name lookup would see it.
  r.popupName = await p1.evaluate(() => window.name);
  report.A = r;
  console.log("A", JSON.stringify(r));
  await closeAllPopups();
}

// ---------------- C: which canvas does the clip recorder take? ----------------
if (only.has("C")) {
  report.C = {};
  for (const kind of ["opener", "noopener"]) {
    const pop = await openOutput(kind);
    const sizes = {
      main: await page.evaluate(() => {
        const c = document.getElementById("gl");
        return `${c.width}x${c.height}`;
      }),
      output: await pop.evaluate(() => {
        const c = document.getElementById("gl");
        return `${c.width}x${c.height}`;
      }),
    };
    const dlP = page.waitForEvent("download", { timeout: 15000 }).catch(() => null);
    await page.evaluate(() => document.getElementById("recBtn").click());
    await page.waitForTimeout(2500);
    await page.evaluate(() => document.getElementById("recBtn").click());
    const dl = await dlP;
    let clip = null;
    if (dl) {
      const path = `${OUT_DIR}/clip-${kind}.${dl.suggestedFilename().split(".").pop()}`;
      await dl.saveAs(path);
      const b64 = readFileSync(path).toString("base64");
      const scratch = await ctx.newPage();
      await scratch.goto("about:blank");
      clip = await scratch.evaluate(async (b) => {
        const bytes = Uint8Array.from(atob(b), (ch) => ch.charCodeAt(0));
        const v = document.createElement("video");
        v.muted = true;
        v.src = URL.createObjectURL(new Blob([bytes]));
        await new Promise((res, rej) => {
          v.onloadeddata = res;
          v.onerror = () => rej(new Error("video error"));
        });
        return { bytes: bytes.length, w: v.videoWidth, h: v.videoHeight };
      }, b64);
      await scratch.close();
      clip.file = path;
    }
    report.C[kind] = { sizes, clip, hud: await page.evaluate(() => document.getElementById("hud")?.textContent?.slice(0, 80) ?? null) };
    console.log("C", kind, JSON.stringify(report.C[kind]));
    await closeAllPopups();
  }
}

// ---------------- D: worker renderer in an opener popup ----------------
if (only.has("D")) {
  const before = await renderers();
  const popP = ctx.waitForEvent("page");
  await page.evaluate(() => void window.open("", "probe", "popup=yes,width=1280,height=720"));
  const probe = await popP;
  await probe.waitForTimeout(500);
  const after = await renderers();
  const setup = await probe.evaluate(() => {
    document.body.style.margin = "0";
    document.body.style.background = "#000";
    const c = document.createElement("canvas");
    c.id = "wc";
    c.width = 1280;
    c.height = 720;
    c.style.cssText = "display:block;width:100vw;height:100vh";
    document.body.appendChild(c);
    // The worker: WebGL2 on the OffscreenCanvas, its own rAF loop drawing a
    // full-screen triangle with a moving pattern, timestamps on request.
    const src = `
      let gl, prog, uT, rec = null, t0 = 0;
      const vs = "#version 300 es\\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0,1);}";
      const fs = "#version 300 es\\nprecision highp float;uniform float t;out vec4 o;void main(){vec2 u=gl_FragCoord.xy/vec2(1280.0,720.0);float a=0.0;for(int i=0;i<24;i++){a+=sin(u.x*float(i)*7.0+t*float(i%5+1))*cos(u.y*float(i)*5.0-t);}o=vec4(0.5+0.5*sin(a+t),0.5+0.5*cos(a*1.3),0.5+0.5*sin(t*0.7+u.x*6.0),1);}";
      function sh(type, s){const x=gl.createShader(type);gl.shaderSource(x,s);gl.compileShader(x);if(!gl.getShaderParameter(x,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(x));return x;}
      function frame(t){
        requestAnimationFrame(frame);
        gl.viewport(0,0,1280,720);
        gl.useProgram(prog); gl.uniform1f(uT, t/1000); gl.drawArrays(gl.TRIANGLES,0,3);
        if (rec) { rec.push(t); if (t - t0 > rec.ms) { postMessage({ ts: rec }); rec = null; } }
      }
      onmessage = (e) => {
        if (e.data.canvas) {
          gl = e.data.canvas.getContext("webgl2");
          prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(prog);
          uT = gl.getUniformLocation(prog, "t");
          requestAnimationFrame(frame);
          postMessage({ ready: typeof requestAnimationFrame });
        } else if (e.data.rec) { rec = []; rec.ms = e.data.rec; t0 = performance.now(); }
      };`;
    const w = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
    window.__w = w;
    const off = c.transferControlToOffscreen();
    return new Promise((res) => {
      w.onmessage = (e) => res(e.data);
      w.postMessage({ canvas: off }, [off]);
    });
  });
  await probe.waitForTimeout(1500);
  const workerRec = (ms) =>
    probe.evaluate(
      (m) =>
        new Promise((res) => {
          window.__w.onmessage = (e) => e.data.ts && res(Array.from(e.data.ts));
          window.__w.postMessage({ rec: m });
        }),
      ms,
    );
  const rows = [];
  for (let r = 0; r < reps; r++) {
    for (const jank of r % 2 === 0 ? [false, true] : [true, false]) {
      if (jank) await startJank();
      const [wts, pts] = await Promise.all([workerRec(seconds * 1000), probe.evaluate(recorder, seconds * 1000)]);
      if (jank) await stopJank();
      const row = { rep: r, jank, worker: stats(wts), popupMain: stats(pts) };
      rows.push(row);
      console.log("D", JSON.stringify(row));
      await page.waitForTimeout(500);
    }
  }
  // Clip path with a worker renderer: captureStream() on the placeholder canvas,
  // called from the MAIN window through the popup's Window handle (as clipRecorder does).
  const cap = await page.evaluate(async () => {
    const w = window.open("", "probe"); // same name: returns the existing popup (same group)
    const c = w.document.getElementById("wc");
    try {
      const s = c.captureStream(30);
      const chunks = [];
      const mr = new MediaRecorder(s);
      mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      const done = new Promise((r) => (mr.onstop = r));
      mr.start(500);
      await new Promise((r) => setTimeout(r, 2500));
      mr.stop();
      await done;
      const blob = new Blob(chunks, { type: mr.mimeType });
      const v = document.createElement("video");
      v.muted = true;
      v.src = URL.createObjectURL(blob);
      await new Promise((r, j) => {
        v.onloadeddata = r;
        v.onerror = () => j(new Error("decode"));
      });
      const k = document.createElement("canvas");
      k.width = 64;
      k.height = 36;
      const g = k.getContext("2d");
      g.drawImage(v, 0, 0, 64, 36);
      const d = g.getImageData(0, 0, 64, 36).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += (d[i] + d[i + 1] + d[i + 2]) / 3;
      return { ok: true, mime: mr.mimeType, bytes: blob.size, w: v.videoWidth, h: v.videoHeight, meanLevel: +(sum / (d.length / 4)).toFixed(1), track: s.getVideoTracks()[0]?.readyState };
    } catch (e) {
      return { ok: false, err: `${e.name}: ${e.message}` };
    }
  });
  report.D = { renderers: `${before}->${after}`, setup, rows, captureStreamOnPlaceholder: cap };
  console.log("D renderers", `${before}->${after}`, "setup", JSON.stringify(setup));
  console.log("D captureStream", JSON.stringify(cap));
  const agg = (k, jank) => {
    const rs = rows.filter((x) => x.jank === jank).map((x) => x[k]);
    return `>25ms [${rs.map((s) => s.over25).join(",")}] lost [${rs.map((s) => s.lost).join(",")}] max [${rs.map((s) => s.max).join(",")}] med ${rs[0]?.med}`;
  };
  for (const jank of [false, true]) {
    console.log(`D summary ${jank ? "jank" : "idle"}: worker ${agg("worker", jank)} | popup main thread ${agg("popupMain", jank)}`);
  }
  await probe.close();
  await page.waitForTimeout(500);
}

// ---------------- E: MediaStreamTrack transfer ----------------
if (only.has("E")) {
  report.E = await page.evaluate(async () => {
    const out = {};
    const canvasTrack = () => {
      const c = document.createElement("canvas");
      c.width = 16;
      c.height = 16;
      c.getContext("2d").fillRect(0, 0, 1, 1);
      return c.captureStream(1).getVideoTracks()[0];
    };
    for (const [name, make] of [
      ["canvasTrack", async () => canvasTrack()],
      ["micTrack", async () => (await navigator.mediaDevices.getUserMedia({ audio: true })).getAudioTracks()[0]],
    ]) {
      try {
        const t = await make();
        try {
          structuredClone(t, { transfer: [t] });
          out[`${name}.structuredClone`] = "ok";
        } catch (e) {
          out[`${name}.structuredClone`] = `${e.name}: ${e.message}`.slice(0, 120);
        }
        const t2 = await make();
        try {
          const ch = new MessageChannel();
          ch.port1.postMessage(t2, [t2]);
          out[`${name}.MessagePort`] = "ok";
        } catch (e) {
          out[`${name}.MessagePort`] = `${e.name}: ${e.message}`.slice(0, 120);
        }
        try {
          new BroadcastChannel("probe-e").postMessage(await make());
          out[`${name}.BroadcastChannel`] = "ok";
        } catch (e) {
          out[`${name}.BroadcastChannel`] = `${e.name}: ${e.message}`.slice(0, 120);
        }
      } catch (e) {
        out[name] = `could not make: ${e.name}: ${e.message}`.slice(0, 120);
      }
    }
    return out;
  });
  console.log("E", JSON.stringify(report.E));
}

// ---------------- B: crash coupling (last: it may take the main window down) ----------------
if (only.has("B")) {
  report.B = {};
  for (const kind of ["noopener", "opener"]) {
    if (page.isClosed()) {
      page = await ctx.newPage();
      await page.goto(`${origin}/?audio=synthetic&bpm=120#/v/caustics`);
      await page.waitForTimeout(8000);
    }
    let mainCrashed = false;
    page.once("crash", () => (mainCrashed = true));
    const pop = await openOutput(kind);
    const s = await ctx.newCDPSession(pop);
    const t0 = Date.now();
    s.send("Page.crash").catch(() => undefined);
    await page.waitForTimeout(500);
    let mainAlive;
    try {
      mainAlive = await Promise.race([page.evaluate(() => 1).then(() => true), new Promise((r) => setTimeout(() => r(false), 3000))]);
    } catch {
      mainAlive = false;
    }
    let detectMs = null;
    if (mainAlive) {
      while ((await outBtnText()).includes("OUTPUT") && Date.now() - t0 < 8000) await page.waitForTimeout(50);
      detectMs = Date.now() - t0;
    }
    report.B[kind] = { mainCrashed, mainAlive, closedDetectedMs: detectMs };
    console.log("B", kind, JSON.stringify(report.B[kind]));
    for (const p of ctx.pages()) if (p !== page && !p.isClosed()) await p.close().catch(() => undefined);
    if (!mainAlive) {
      await page.close().catch(() => undefined);
      page = await ctx.newPage();
      await page.goto(`${origin}/?audio=synthetic&bpm=120#/v/caustics`);
      await page.waitForTimeout(6000);
    }
  }
}

writeFileSync(`${OUT_DIR}/probes-results.json`, JSON.stringify(report, null, 2));
console.log(`wrote ${OUT_DIR}/probes-results.json`);
await browser.close();
