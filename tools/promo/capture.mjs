#!/usr/bin/env node
// Records the real app reacting to a track: a 60 fps H.264 clip with the
// track muxed under it, for promo videos.
//
//   node tools/promo/capture.mjs <track.wav> --scene <id> --out clip.mp4
//        [--size 1080x1920] [--from 0] [--seconds N] [--settings '{"key":v}']
//        [--chrome none|panel|all] [--lag-ms 83] [--quality high] [--port 5173]
//        [--zoom 1] [--keys m,...] [--keep-frames DIR] [--retries 3] [--max-gap-ms 40]
//        [--actions file.mjs] [--time mic|wall] [--from auto] [--wav-start 52]
//        [--folds '{"column:meters":true}'] [--jpeg-quality 92] [--show-toasts] [--grant-mic] [--settle-ms 1200]
//        [--base URL] [--look CODE] [--print-plan]
//
// --base URL: the site to film (default the local `vite preview` on --port);
// --look CODE: a Looks-card share code, loaded through the app's own ?look=.
// After the encode a sidecar <out>.json is written (songAtClip0, lagMs, fps,
// maxGapMs, size, scene, base, look) so a later step can read where in the
// song the clip starts without measuring it again. --print-plan prints the
// URL, size, launch flags and feed and exits without launching anything.
//
// Take mode: the recorder of the release/hook/explainer takes (promo.mjs
// record runs it).
//
//   node tools/promo/capture.mjs --take NAME --work DIR [--print-plan]
//
// It reads tools/promo/takes.json (its `defaults`, then the entry NAME, then
// the entry of the same name in DIR/takes.json) and DIR/record.json (written
// by promo.mjs record: bpm, P, base, look, mic, slots). The launch is
// Metal Chromium, the throttling flags for a second page, fake audio
// from the wav only for a `song` feed; the screencast writes
// DIR/takes/<cast>/f%05d.jpg + frames.json {meta, frames}.
// Per size, up to `tries` attempts; an attempt passes when the first cast, in
// the gate window, reaches SMOOTH_FPS with at most SMOOTH_SLOW of its gaps
// slow (smooth()). The first pass ends the take; when none
// passes the last completed attempt stays. A shot that throws counts as a
// failed attempt; when every attempt threw the take prints `TAKE <name>
// FAILED <message>` and exits 3.
//
// The shot contract: entry.shot names a module in tools/promo/shots/ whose
// default export is `async (ctx) => ({ casts, gate })`. ctx has name, entry,
// rec, P (ms per beat), view {width, height, dsf}, browser, context, page,
// startCast(page, castName), saveTrack(page, castName) and lagMs (this file's
// REACTION_LAG_MS, only for a song feed). The shot returns casts {castName:
// meta} (capture stops every cast it started, with that meta) and gate {t0
// (epoch s), beats}. BPM and BASE are put in the environment before the shot
// module is imported, because shots/lib/app.mjs reads them at import.
//
// UI shots (--actions): a module whose default export is `async (ctx) => {}`
// is run as a timeline while recording. ctx has `page`, `W`/`H`/`zoom`/`keys`
// (the options), `t()` (seconds on the clip's clock), `mark(name)` (printed
// at the end, with its time), `snap(path)` (a PNG of the page right now),
// `press(key)`, `wait(ms)`, and — all in frame pixels (what the video shows),
// whatever --zoom is — `tap(target)`, `drag(from, to, ms)` and
// `cursor.moveTo(x, y, ms)` / `cursor.place(x, y)`. A target is a CSS
// selector or Playwright selector string ("text=Mic"), a [x, y] pair or {x, y}.
// tap/drag move an eased, slightly curved cursor to it first, so the overlay
// (below) and real hover states both follow; mousedown/up are real events.
//
// --time picks the clip's clock. `mic` (default without --actions): 0 is the
// instant the mic starts — the scene shots. `wall` (default with --actions):
// 0 is the moment the actions start, with the page already loaded and the
// screencast running, so a shot can begin on the gallery and enable the mic
// part-way; the wav is then laid into the clip at the moment getUserMedia
// resolved (silence before it; none at all if the actions never enable the
// mic). In `mic` mode with --actions the tool taps the page centre to start
// the mic as before, then runs the actions from there.
//
// --wav-start S: the track is the microphone, so it can't seek — instead a
// copy of it from S seconds on is cut (in the temp dir) and used as the mic.
//
// Promo chrome. The visible cursor: the screencast shows no OS pointer, so an
// init script draws one (a white touch dot with a soft ring and a ripple on
// every press, pointer-events none, top z-index). Dev-only labels: capture a
// production build — tools/promo/build-clean.mjs, served by `vite preview` —
// not `npm run dev`. The "Press ? for shortcuts" toast, every other
// .vc-toast and the #hud status line are hidden (--show-toasts keeps them), the fake mic's
// "Fake Default Audio Input" name is rewritten to "Microphone" in
// enumerateDevices (one entry) and on the audio tracks, and getDisplayMedia is
// stubbed (silent audio) so a "Screen" tap works with no picker and no load. The phone/TV pairing UI is never
// part of the app's own gallery/scene/panel path used here; if a shot ever
// shows it, that is a bug in the shot.
//
// The track is the microphone: Chromium's --use-file-for-fake-audio-capture
// plays the wav from the instant the app's getUserMedia resolves, which an
// init script stamps (tools/ref-browser.mjs explains the trick; the wav must
// be 48 kHz mono s16 — make-test-wav.mjs and `ffmpeg -ar 48000 -ac 1` give
// that). So the scene hears exactly the audio that ends up in the clip.
//
// Capture: CDP Page.startScreencast — the compositor's own frames, DOM and
// canvas together (so the panel shows), full-size JPEG at ~60 fps on the
// Metal GPU. Canvas captureStream + MediaRecorder and getDisplayMedia tab
// capture were both tried and lost: the first stutters (~50 fps, 160 ms
// holes) and is canvas-only, the second ran at 20 fps. Each screencast frame
// carries a wall-clock timestamp; that, minus the epoch time of the mic
// stamp, is the frame's time in the track. The clip is then rebuilt at a
// constant 60 fps by taking, for each output frame, the captured
// frame nearest its track time — a dropped frame becomes a repeated one, never
// a shift. (Nearest, not "newest at or before": the compositor's frame
// stamps jitter by several ms around the 60 Hz grid, and at-or-before turns
// every late stamp into a repeated picture plus a skipped one, ~20% of the
// clip, though every captured frame is a new picture.)
//
// --lag-ms: the app hears a sound a little after it plays (analyser window,
// onset detection), so its reaction lands that late. Each output frame at
// track time t shows the captured frame at t + lag, pulling the picture
// back onto the sound. measure-sync.mjs measures it from the click in
// make-test-wav.mjs's track.
//
// --from / --seconds pick the window of the track that ends up in the clip;
// everything before --from still plays (the analyser needs its warm-up).
import { mkdirSync, rmSync, writeFileSync, readFileSync, linkSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import { ffmpeg } from "./ffmpeg.mjs";
import { chromeInitScript, cursorInitScript, makeCtx } from "./ui.mjs";
import { sceneLook } from "./shots/lib/sceneLook.mjs";

const args = process.argv.slice(2);
const wavArg = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
// The app hears a sound a little after it plays (analyser window, onset
// detection), so its reaction lands that late. 83 ms: measured 2026-10-03 with
// measure-sync.mjs on caustics, both sizes, repeatable. Clip mode shifts by it
// (--lag-ms overrides); take mode records it into song-feed scene takes.
const REACTION_LAG_MS = 83;

// ---- take mode -------------------------------------------------------------
// INIT stamps __S when the app reads ?bpm= (right before its synthetic clock starts), so beat k is
// __S + k*P; MIC_STAMP stamps it when getUserMedia resolves (the fake mic starts playing).
const INIT = () => {
  const g = URLSearchParams.prototype.get;
  URLSearchParams.prototype.get = function (k) {
    const v = g.call(this, k);
    if (k === "bpm") window.__S = performance.now();
    return v;
  };
};
const MIC_STAMP = () => {
  const md = navigator.mediaDevices;
  const orig = md.getUserMedia.bind(md);
  md.getUserMedia = async (c) => {
    const s = await orig(c);
    if (c && c.audio && !window.__S) window.__S = performance.now();
    return s;
  };
};
// The smoothness gate: gaps over SLOW_GAP_MS count as slow.
const SMOOTH_FPS = 50, SMOOTH_SLOW = 0.12, SLOW_GAP_MS = 34, CAST_QUALITY = 90, CAST_STOP_MS = 200;
function smooth(frames, t0, beats, P) {
  const w = frames.filter((f) => f.t >= t0 && f.t <= t0 + beats * P / 1000);
  if (w.length < 3) return { fps: 0, slow: 1 };
  const gaps = []; for (let i = 1; i < w.length; i++) gaps.push((w[i].t - w[i - 1].t) * 1000);
  return { fps: (w.length - 1) / (w.at(-1).t - w[0].t), slow: gaps.filter((g) => g > SLOW_GAP_MS).length / gaps.length, max: Math.max(...gaps) };
}
// Start a screencast into the frames dir `dir`, given whole.
async function startCast(page, dir, { quality = CAST_QUALITY } = {}) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  let n = 0;
  cdp.on("Page.screencastFrame", (ev) => {
    const i = n++;
    const file = `f${String(i).padStart(5, "0")}.jpg`;
    frames.push({ file, t: ev.metadata.timestamp });
    writeFileSync(join(dir, file), Buffer.from(ev.data, "base64"));
    cdp.send("Page.screencastFrameAck", { sessionId: ev.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality, everyNthFrame: 1, maxWidth: (page.viewportSize() || { width: 1920 }).width, maxHeight: (page.viewportSize() || { height: 1080 }).height });
  return {
    async stop(meta) {
      await cdp.send("Page.stopScreencast").catch(() => {});
      await new Promise((r) => setTimeout(r, CAST_STOP_MS));
      writeFileSync(join(dir, "frames.json"), JSON.stringify({ meta, frames }));
      return frames;
    },
  };
}
// The take launch flags (Metal Chromium, fake media devices); a song feed adds the wav as the fake microphone.
const takeLaunchArgs = (wav) => [
  "--enable-gpu", "--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist",
  "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
  "--autoplay-policy=no-user-gesture-required",
  // a second page (the room's TV, the pop-out) would otherwise be throttled to ~10 fps as a background window
  "--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows",
  ...(wav ? [`--use-file-for-fake-audio-capture=${wav}%noloop`] : []),
];

const readJson = (f) => JSON.parse(readFileSync(f, "utf8"));
// The page URL a scene take opens, as shots/lib/app.mjs open() builds it; the
// scene and look rule is shots/lib/sceneLook.mjs, the one shots/take-scene.mjs
// opens the page with.
function takeUrl(entry, rec) {
  const { scene, query } = sceneLook(entry, rec);
  if (entry.feed === "song") return `${rec.base}/?${query.replace(/^&/, "")}#/v/${scene}`;
  return `${rec.base}/?audio=synthetic&bpm=${rec.bpm}${query}#/v/${scene}`;
}

async function takeMode(name) {
  const workArg = opt("--work", null);
  if (!workArg) { console.error("usage: node tools/promo/capture.mjs --take NAME --work DIR [--print-plan]"); return 2; }
  const work = resolve(workArg);
  const tableFile = new URL("./takes.json", import.meta.url).pathname;
  const table = existsSync(tableFile) ? readJson(tableFile) : { takes: {} };
  const local = existsSync(join(work, "takes.json")) ? readJson(join(work, "takes.json")) : { takes: {} };
  const base = table.takes?.[name];
  const over = local.takes?.[name];
  if (!base && !over) { console.error(`no take "${name}" in takes.json`); return 2; }
  const entry = { ...table.defaults, ...local.defaults, ...base, ...over };
  const rec = readJson(join(work, "record.json"));
  const feed = entry.feed;
  const wav = feed === "song" ? rec.mic?.wav : null;
  const sizes = entry.sizes;

  if (args.includes("--print-plan")) {
    console.log(`take ${name}: shot ${entry.shot}, feed ${feed}, tries ${entry.tries}`);
    console.log(`url ${takeUrl(entry, rec)}`);
    console.log(`sizes ${sizes.map(([w, h]) => `${w}x${h}`).join(", ")} (dsf 1)`);
    console.log(`launch ${JSON.stringify({ channel: "chromium", headless: true, args: takeLaunchArgs(wav) })}`);
    console.log(`init script ${feed === "song" ? "MIC_STAMP" : "INIT"}, permissions microphone, lagMs ${feed === "song" ? REACTION_LAG_MS : "none"}`);
    return 0;
  }

  process.env.BPM = String(rec.bpm);
  process.env.BASE = rec.base;
  const shot = (await import(pathToFileURL(resolve(new URL("./shots/", import.meta.url).pathname, entry.shot)).href)).default;

  let completed = 0, final = "FAILED", lastErr = "";
  sizes: for (let i = 0; i < sizes.length; i++) {
    const [width, height] = sizes[i];
    for (let a = 0; a < entry.tries; a++) {
      const tag = `TAKE ${name} size${i} try${a}`;
      let browser;
      const started = [];
      try {
        browser = await chromium.launch({ channel: "chromium", headless: true, args: takeLaunchArgs(wav) });
        const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, ignoreHTTPSErrors: true, permissions: ["microphone"] });
        await context.addInitScript(feed === "song" ? MIC_STAMP : INIT);
        const page = await context.newPage();
        page.on("pageerror", (e) => console.log(name, "pageerror", e.message));
        const ctx = {
          name, entry, rec, P: rec.P, view: { width, height, dsf: 1 }, browser, context, page,
          startCast: async (pg, castName) => {
            const cast = await startCast(pg, join(work, "takes", castName));
            started.push({ castName, cast });
            return cast;
          },
          saveTrack: async (pg, castName) => writeFileSync(join(work, "takes", castName, "track.json"), JSON.stringify(await pg.evaluate(() => window.__trk || []))),
          lagMs: feed === "song" ? REACTION_LAG_MS : undefined,
        };
        const res = await shot(ctx);
        const allFrames = [];
        for (const { castName, cast } of started) allFrames.push(await cast.stop(res.casts?.[castName] ?? {}));
        completed++;
        const st = smooth(allFrames[0] || [], res.gate.t0, res.gate.beats, rec.P);
        const ok = st.fps >= SMOOTH_FPS && st.slow <= SMOOTH_SLOW;
        console.log(`${tag} fps ${st.fps.toFixed(1)} slow ${(st.slow * 100).toFixed(0)}% maxgap ${Math.round(st.max || 0)}ms ${ok ? "OK" : "SLOW"}`);
        final = ok ? "OK" : "SLOW";
        if (ok) break sizes;
      } catch (e) {
        lastErr = (e && e.message) || String(e);
        console.log(`${tag} ERROR ${lastErr}`);
        if (started.length) { completed = 0; final = "FAILED"; }   // its startCast wiped the earlier attempt's frames
      } finally {
        await browser?.close().catch(() => {});
      }
    }
  }
  if (final === "SLOW") console.log(`${name} kept best-effort take`);
  console.log(`TAKE ${name} ${completed ? final : `FAILED ${lastErr}`}`);
  return completed ? 0 : 3;
}
const takeName = opt("--take", null);
if (takeName) process.exit(await takeMode(takeName));

const scene = opt("--scene", null);
const outArg = opt("--out", null);
if (!wavArg || (!scene && !args.includes("--actions")) || !outArg) {
  console.error("usage: node tools/promo/capture.mjs <track.wav> --scene <id> --out clip.mp4 [options]");
  process.exit(2);
}
const wavOrig = resolve(wavArg);
const out = resolve(outArg);
const [W, H] = opt("--size", "1080x1920").split("x").map(Number);
// --zoom Z: CSS zoom on the page — the panel and chrome come out Z times
// bigger; the scene renders at 1/Z resolution behind them, softer. For panel
// shots on a phone-sized frame, where the panel at 1× covers the picture in
// small print. (A device scale factor would be simpler but the screencast
// ignores it and delivers CSS pixels.)
const zoom = +opt("--zoom", "1");
const keys = (opt("--keys", "") || "").split(",").filter(Boolean);
const port = opt("--port", "5173");
const quality = opt("--quality", "high");
const settings = opt("--settings", null);
const actionsFile = opt("--actions", null);
const timeBase = opt("--time", actionsFile ? "wall" : "mic");
const chrome = opt("--chrome", timeBase === "mic" && !actionsFile ? "none" : "all");
const showToasts = args.includes("--show-toasts");
// --folds '{"column:meters":true,"bands":true}': panel fold state (src/ui/panelFolds.ts)
// from the first frame — a card or the whole left column already folded when
// the panel opens, instead of a key press that shows a frame of the other layout.
const folds = opt("--folds", null);
const wavStart = +opt("--wav-start", "0");
// The mic's permission, granted up front in `mic` mode (the page then starts
// it by itself). In `wall` mode it stays at "prompt" by default, so the scene
// opens on demo audio with the start prompt showing — --grant-mic overrides.
const grantMic = timeBase === "mic" || args.includes("--grant-mic");
const settleMs = +opt("--settle-ms", "1200");
const lagMs = +opt("--lag-ms", String(REACTION_LAG_MS));
const baseUrl = opt("--base", `https://localhost:${port}`);
const look = opt("--look", null);
const pageUrl = `${baseUrl}/?quality=${quality}${look ? `&look=${look}` : ""}${scene ? `#/v/${scene}` : ""}`;
// --from auto: the window starts where the actions call ctx.startAt() (so a
// shot can do its setup — open the scene, enable the mic — off the record).
const fromAuto = opt("--from", "0") === "auto";
const fromOpt = fromAuto ? 0 : +opt("--from", "0");
const FPS = 60;

// The launch flags of one clip take; `wavPath` is the mic.
const clipLaunchArgs = (wavPath) => [
  "--use-fake-device-for-media-stream",
  "--use-fake-ui-for-media-stream",
  `--use-file-for-fake-audio-capture=${wavPath}%noloop`,
  "--autoplay-policy=no-user-gesture-required",
  "--enable-gpu", "--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist",
];
if (args.includes("--print-plan")) {
  console.log(`url ${pageUrl}`);
  console.log(`size ${W}x${H}, zoom ${zoom}, ${FPS} fps, ${timeBase} clock, lag ${lagMs} ms, chrome ${chrome}`);
  console.log(`launch ${JSON.stringify({ channel: "chromium", args: clipLaunchArgs(wavStart > 0 ? `<${wavStart}s cut of ${wavOrig}>` : wavOrig) })}`);
  console.log(`feed the track as the microphone${wavStart > 0 ? ` from ${wavStart} s` : ""}, scene ${scene || "none"}, look ${look || "none"}`);
  process.exit(0);
}

// Track length from the wav header (s16 mono/stereo, any rate).
// --wav-start: cut the copy the mic and the clip's audio both use.
let wav = wavOrig;
if (wavStart > 0) {
  wav = join(tmpdir(), `promo-mic-${process.pid}.wav`);
  ffmpeg(["-ss", String(wavStart), "-i", wavOrig, "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", "-fflags", "+bitexact", "-map_metadata", "-1", wav]);
}
const hdr = readFileSync(wav);
const dataAt = hdr.indexOf("data") + 8;
const trackSec = hdr.readUInt32LE(dataAt - 4) / hdr.readUInt32LE(28);
const seconds = +opt("--seconds", String(trackSec - fromOpt));

const keepDir = opt("--keep-frames", null);
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
const retries = +opt("--retries", "3");
const maxGapMs = +opt("--max-gap-ms", "40");
// Screencast JPEG quality: at 2880x1620 the encode, not the page, can be what
// limits the frame rate; a lower quality is faster.
const jpegQuality = +opt("--jpeg-quality", "92");

// One take: launch, play the track as the mic, screencast until the window
// is covered. Returns the frames with their track times.
async function take(dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch({
    channel: "chromium",
    args: clipLaunchArgs(wav),
  });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: W, height: H }, permissions: grantMic ? ["microphone"] : [] });
  await ctx.addInitScript(() => {
    const md = navigator.mediaDevices;
    const orig = md.getUserMedia.bind(md);
    md.getUserMedia = async (c) => {
      const s = await orig(c);
      if (c && c.audio && !window.__micT0) window.__micT0 = performance.now();
      return s;
    };
  });
  await ctx.addInitScript(chromeInitScript({ hideToasts: !showToasts, folds: folds ? JSON.parse(folds) : null }));
  await ctx.addInitScript(cursorInitScript());
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message.slice(0, 300)));
  await page.goto(pageUrl, { waitUntil: "load" });
  await page.waitForTimeout(timeBase === "wall" ? settleMs : 800);
  if (zoom !== 1) await page.addStyleTag({ content: `html { zoom: ${zoom}; }` });
  // applyTuningParams (src/tuning/bus.ts) ignores settings without the scene id.
  const apply = () => settings && scene && page.evaluate(({ s, scene }) => window.__viz?.setParams({ scene, autoPin: true, settings: JSON.parse(s) }), { s: settings, scene });
  await apply();

  // Screencast from before the mic starts, so nothing at the track's start is missed.
  const frames = [];
  const cdp = await ctx.newCDPSession(page);
  let prevData = "";
  cdp.on("Page.screencastFrame", (f) => {
    const same = f.data === prevData;
    prevData = f.data;
    const file = join(dir, `${String(frames.length).padStart(6, "0")}.jpg`);
    writeFileSync(file, Buffer.from(f.data, "base64"));
    frames.push({ file, ts: f.metadata.timestamp * 1000, same });
    cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: jpegQuality, maxWidth: W, maxHeight: H, everyNthFrame: 1 });

  let baseEpochMs, micEpochMs = null, ui = null;
  let marks = [];
  const loadActions = async () => (await import(pathToFileURL(resolve(actionsFile)).href)).default;
  if (timeBase === "mic") {
    await page.mouse.click(W / 2, H / 2);
    await page.waitForFunction(() => window.__micT0 > 0, null, { timeout: 8000 });
    // Off the canvas centre, so no hover tooltip lands in the shot.
    await page.mouse.move(W / zoom - 2, 2);
    micEpochMs = await page.evaluate(() => performance.timeOrigin + window.__micT0);
    baseEpochMs = micEpochMs;
    if (scene && !(await page.evaluate(() => location.hash)).includes(scene)) console.log(`WARNING: not on scene ${scene}`);
    await apply();
    if (chrome === "none") await page.addStyleTag({ content: "body > :not(canvas) { visibility: hidden !important; }" });
    else if (chrome === "panel") await page.evaluate(() => document.getElementById("menuBtn")?.click());
    // The panel's own shortcuts (`?` lists them): "m" hides the left column —
    // the way to fit the panel on a narrow (vertical or zoomed) frame.
    if (!actionsFile) for (const k of keys) await page.keyboard.press(k);
  } else {
    baseEpochMs = Date.now();
    await apply();
    if (chrome === "none") await page.addStyleTag({ content: "body > :not(canvas) { visibility: hidden !important; }" });
  }
  const clock = () => (Date.now() - baseEpochMs) / 1000;
  const actionsDone = actionsFile
    ? (async () => {
        const fn = await loadActions();
        ui = makeCtx({ page, W, H, zoom, keys, clock });
        marks = ui.marks; // the same array, filled as the actions run
        await fn(ui);
      })()
    : Promise.resolve();

  const probes = [];
  const probeTimer = setInterval(() => {
    page.evaluate(() => { const p = window.__viz?.probe?.(); return p && { fps: p.fps, gov: p.govLevel, scale: p.renderScale, q: p.quality }; }).then((p) => p && probes.push(p)).catch(() => {});
  }, 1000);
  const lagS = Math.max(0, lagMs) / 1000;
  const winFrom = () => (fromAuto ? ui?.fromAt ?? null : fromOpt);
  const actionsErr = actionsDone.then(() => null, (e) => e);
  let finished = false;
  actionsErr.then(() => { finished = true; });
  for (;;) {
    const f = winFrom();
    if (f != null && clock() >= f + seconds + lagS + 0.1) break;
    if (finished) break;
    await sleepMs(50);
  }
  const err = await actionsErr;
  // A failed actions module (or --from auto with no ctx.startAt()) makes no clip: the caller prints it and stops.
  const fatal = err ? `ACTIONS ERROR ${err.stack || err.message}` : fromAuto && winFrom() == null ? "--from auto but the actions never called ctx.startAt()" : null;
  if (fatal) {
    clearInterval(probeTimer);
    await browser.close();
    return { fatal };
  }
  const from = winFrom() ?? 0, until = from + seconds;
  const capUntil = until + lagS + 0.1;
  if (clock() < capUntil) await sleepMs((capUntil - clock()) * 1000);
  if (timeBase === "wall") micEpochMs = await page.evaluate(() => (window.__micT0 > 0 ? performance.timeOrigin + window.__micT0 : null));
  if (clock() > capUntil + 2) console.log(`WARNING: actions ran ${(clock() - capUntil).toFixed(1)} s past the clip's end`);
  clearInterval(probeTimer);
  await cdp.send("Page.stopScreencast");
  await browser.close();

  const times = frames.map((f) => (f.ts - baseEpochMs) / 1000);
  const micAt = micEpochMs == null ? null : (micEpochMs - baseEpochMs) / 1000; // mic start on the clip's clock
  const inWin = times.filter((t) => t >= from && t <= until);
  const gaps = inWin.slice(1).map((t, i) => t - inWin[i]);
  return {
    frames, times, probes, micAt, from, marks: marks.slice(),
    fps: (inWin.length - 1) / (inWin.at(-1) - inWin[0]),
    maxGap: Math.max(...gaps) * 1000,
    longGaps: gaps.filter((g) => g > 0.025).length,
    fresh: frames.filter((f, i) => times[i] >= from && times[i] <= until && !f.same).length / seconds,
  };
}

// The capture is real time, so another GPU-heavy process (a second
// headless browser, a game) shows up as dropped frames: retry a take whose
// longest hole exceeds --max-gap-ms, keep the best.
let best = null;
let bestDir = null;
for (let n = 0; n <= retries; n++) {
  const dir = keepDir && n === 0 ? resolve(keepDir) : join(tmpdir(), `promo-frames-${process.pid}-${n}`);
  const t = await take(dir);
  if (t.fatal) {   // a broken shot fails the same way every time: no retries, and no clip unless an earlier take passed
    console.error(t.fatal);
    if (!(keepDir && dir === resolve(keepDir))) rmSync(dir, { recursive: true, force: true });
    if (best) { console.error("keeping the best earlier take"); break; }
    if (wav !== wavOrig) rmSync(wav, { force: true });
    process.exit(1);
  }
  console.log(`take ${n + 1}: ${t.fps.toFixed(1)} fps, longest gap ${t.maxGap.toFixed(0)} ms, gaps >25 ms: ${t.longGaps}, new pictures ${t.fresh.toFixed(1)}/s`);
  if (!best || t.maxGap < best.maxGap) {
    if (bestDir && bestDir !== dir && !keepDir) rmSync(bestDir, { recursive: true, force: true });
    best = t;
    bestDir = dir;
  } else if (!keepDir) rmSync(dir, { recursive: true, force: true });
  if (t.maxGap <= maxGapMs) break;
}
const { frames, times, probes, micAt, from: fromSec } = best;
const untilSec = fromSec + seconds;
const framesDir = bestDir;

// Rebuild at a constant 60 fps on the track's clock: one hard link per output
// frame, read as an image sequence at exactly FPS. (A concat list of single
// JPEGs was used before and is wrong: the JPEG demuxer stamps each image on a
// 25 fps clock, so the output held only ~25 distinct pictures a second.)
const seqDir = join(framesDir, "seq");
mkdirSync(seqDir, { recursive: true });
// By stamp, not arrival: a stamp is not always monotonic, and a walk that
// stops at the first farther neighbour would stick on one frame.
const order = times.map((_, i) => i).filter((i) => Number.isFinite(times[i])).sort((a, b) => times[a] - times[b]);
let p = 0;
for (let k = 0; k < Math.round(seconds * FPS); k++) {
  const t = fromSec + k / FPS + lagMs / 1000;
  while (p + 1 < order.length && Math.abs(times[order[p + 1]] - t) < Math.abs(times[order[p]] - t)) p++;
  linkSync(frames[order[p]].file, join(seqDir, `${String(k).padStart(6, "0")}.jpg`));
}
// Audio: the wav is the mic, so it sits in the clip where the mic started
// (the clock's 0 in mic mode; wherever the actions enabled it in wall mode,
// silence before, none at all if they never did).
const audioIn = timeBase === "mic" ? ["-ss", String(fromSec), "-i", wav]
  : micAt == null ? ["-f", "lavfi", "-t", String(seconds), "-i", "anullsrc=r=48000:cl=mono"]
  : micAt >= fromSec ? ["-i", wav] : ["-ss", String(fromSec - micAt), "-i", wav];
const delayMs = timeBase === "wall" && micAt != null && micAt > fromSec ? Math.round((micAt - fromSec) * 1000) : 0;
ffmpeg([
  "-framerate", String(FPS), "-i", join(seqDir, "%06d.jpg"),
  ...audioIn,
  ...(delayMs ? ["-af", `adelay=${delayMs}:all=1,apad`] : []),
  "-map", "0:v", "-map", "1:a",
  // The screencast's JPEGs are full-range BT.601; convert to the limited-range
  // BT.709 every player and Instagram expect, or blacks lift and colours shift.
  "-vf", `scale=in_range=pc:out_range=tv:in_color_matrix=bt601:out_color_matrix=bt709,format=yuv420p`,
  "-c:v", "libx264", "-preset", "slow", "-crf", "14", "-profile:v", "high",
  "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
  "-c:a", "aac", "-b:a", "320k", "-ar", "48000", "-ac", "2",
  "-movflags", "+faststart", "-t", String(seconds), out,
]);
// The sidecar: where in the song the clip's first frame is (the mic's start is
// the clock's 0 in `mic` mode, wherever the actions enabled it in `wall` mode).
writeFileSync(`${out}.json`, JSON.stringify({
  songAtClip0: wavStart + fromSec - (micAt ?? 0), lagMs, fps: FPS, maxGapMs: best.maxGap, size: [W, H], scene, base: baseUrl, look,
}));
if (!keepDir) rmSync(framesDir, { recursive: true, force: true });
if (wav !== wavOrig) rmSync(wav, { force: true });
console.log(`${out}: ${scene || "gallery"} ${W}x${H}, ${timeBase} clock ${fromSec}–${untilSec.toFixed(2)}s, lag ${lagMs} ms${micAt != null && timeBase === "wall" ? `, mic on at ${(micAt - fromSec).toFixed(2)} s into the clip` : ""}`);
if (micAt != null) console.log(`the song (${wavOrig.split("/").pop()}) is at ${(wavStart + fromSec - micAt).toFixed(2)} s at clip t=0`);
if (best.marks.length) console.log("marks (seconds into the clip, before the lag shift):\n" + best.marks.map((m) => `  ${(m.t - fromSec).toFixed(2)} s  ${m.name}${m.t < fromSec ? " (before the clip)" : ""}`).join("\n"));
console.log(`kept: ${best.fps.toFixed(1)} fps, longest gap ${best.maxGap.toFixed(0)} ms${best.maxGap > maxGapMs ? "  (WARNING: no take under --max-gap-ms — is something else using the GPU?)" : ""}`);
const ps = probes.slice(1);
if (ps.length) console.log(`app: render fps ${Math.min(...ps.map((p) => p.fps)).toFixed(0)}–${Math.max(...ps.map((p) => p.fps)).toFixed(0)}, quality ${ps.at(-1).q}, governor ${[...new Set(ps.map((p) => p.gov))].join("→")}, render scale ${[...new Set(ps.map((p) => p.scale?.toFixed(2)))].join("→")}`);
