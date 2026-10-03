#!/usr/bin/env node
// Records the real app reacting to a track: a 60 fps H.264 clip with the
// track muxed under it, for promo videos.
//
//   node tools/promo/capture.mjs <track.wav> --scene <id> --out clip.mp4
//        [--size 1080x1920] [--from 0] [--seconds N] [--settings '{"key":v}']
//        [--chrome none|panel|all] [--lag-ms 83] [--quality high] [--port 5173]
//        [--zoom 1] [--keys m,...] [--keep-frames DIR] [--retries 3] [--max-gap-ms 40]
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
// constant 60 fps by taking, for each output frame, the newest captured
// frame at or before its track time — a dropped frame becomes a repeated
// one, never a shift.
//
// --lag-ms: the app hears a sound a little after it plays (analyser window,
// onset detection), so its reaction lands that late. Each output frame at
// track time t shows the captured frame at t + lag, pulling the picture
// back onto the sound. measure-sync.mjs measures it from the click in
// make-test-wav.mjs's track.
//
// --from / --seconds pick the window of the track that ends up in the clip;
// everything before --from still plays (the analyser needs its warm-up).
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright";
import { ffmpeg } from "./ffmpeg.mjs";

const args = process.argv.slice(2);
const wavArg = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const scene = opt("--scene", null);
const outArg = opt("--out", null);
if (!wavArg || !scene || !outArg) {
  console.error("usage: node tools/promo/capture.mjs <track.wav> --scene <id> --out clip.mp4 [options]");
  process.exit(2);
}
const wav = resolve(wavArg);
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
const chrome = opt("--chrome", "none");
// 83 ms: measured 2026-10-03 with measure-sync.mjs on caustics, both sizes, repeatable.
const lagMs = +opt("--lag-ms", "83");
const fromSec = +opt("--from", "0");
const FPS = 60;

// Track length from the wav header (s16 mono/stereo, any rate).
const hdr = readFileSync(wav);
const dataAt = hdr.indexOf("data") + 8;
const trackSec = hdr.readUInt32LE(dataAt - 4) / hdr.readUInt32LE(28);
const seconds = +opt("--seconds", String(trackSec - fromSec));
const untilSec = fromSec + seconds;

const keepDir = opt("--keep-frames", null);
const retries = +opt("--retries", "3");
const maxGapMs = +opt("--max-gap-ms", "40");

// One take: launch, play the track as the mic, screencast until the window
// is covered. Returns the frames with their track times.
async function take(dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch({
    channel: "chromium",
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      `--use-file-for-fake-audio-capture=${wav}%noloop`,
      "--autoplay-policy=no-user-gesture-required",
      "--enable-gpu", "--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist",
    ],
  });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: W, height: H }, permissions: ["microphone"] });
  await ctx.addInitScript(() => {
    const md = navigator.mediaDevices;
    const orig = md.getUserMedia.bind(md);
    md.getUserMedia = async (c) => {
      const s = await orig(c);
      if (c && c.audio && !window.__micT0) window.__micT0 = performance.now();
      return s;
    };
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message.slice(0, 300)));
  await page.goto(`https://localhost:${port}/?quality=${quality}#/v/${scene}`, { waitUntil: "load" });
  await page.waitForTimeout(800);
  if (zoom !== 1) await page.addStyleTag({ content: `html { zoom: ${zoom}; }` });
  // applyTuningParams (src/tuning/bus.ts) ignores settings without the scene id.
  const apply = () => settings && page.evaluate(({ s, scene }) => window.__viz?.setParams({ scene, autoPin: true, settings: JSON.parse(s) }), { s: settings, scene });
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
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: W, maxHeight: H, everyNthFrame: 1 });

  await page.mouse.click(W / 2, H / 2);
  await page.waitForFunction(() => window.__micT0 > 0, null, { timeout: 8000 });
  // Off the canvas centre, so no hover tooltip lands in the shot.
  await page.mouse.move(W / zoom - 2, 2);
  const micEpochMs = await page.evaluate(() => performance.timeOrigin + window.__micT0);
  if (!(await page.evaluate(() => location.hash)).includes(scene)) console.log(`WARNING: not on scene ${scene}`);
  await apply();
  if (chrome === "none") await page.addStyleTag({ content: "body > :not(canvas) { visibility: hidden !important; }" });
  else if (chrome === "panel") await page.evaluate(() => document.getElementById("menuBtn")?.click());
  // The panel's own shortcuts (`?` lists them): "m" hides the left column —
  // the way to fit the panel on a narrow (vertical or zoomed) frame.
  for (const k of keys) await page.keyboard.press(k);

  const probes = [];
  const probeTimer = setInterval(() => {
    page.evaluate(() => { const p = window.__viz?.probe?.(); return p && { fps: p.fps, gov: p.govLevel, scale: p.renderScale, q: p.quality }; }).then((p) => p && probes.push(p)).catch(() => {});
  }, 1000);
  const capUntil = untilSec + Math.max(0, lagMs) / 1000 + 0.1;
  await page.waitForFunction((t) => performance.now() - window.__micT0 >= t * 1000, capUntil, { timeout: (capUntil + 10) * 1000, polling: 100 });
  clearInterval(probeTimer);
  await cdp.send("Page.stopScreencast");
  await browser.close();

  const times = frames.map((f) => (f.ts - micEpochMs) / 1000);
  const inWin = times.filter((t) => t >= fromSec && t <= untilSec);
  const gaps = inWin.slice(1).map((t, i) => t - inWin[i]);
  return {
    frames, times, probes,
    fps: (inWin.length - 1) / (inWin.at(-1) - inWin[0]),
    maxGap: Math.max(...gaps) * 1000,
    longGaps: gaps.filter((g) => g > 0.025).length,
    fresh: frames.filter((f, i) => times[i] >= fromSec && times[i] <= untilSec && !f.same).length / seconds,
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
  console.log(`take ${n + 1}: ${t.fps.toFixed(1)} fps, longest gap ${t.maxGap.toFixed(0)} ms, gaps >25 ms: ${t.longGaps}, new pictures ${t.fresh.toFixed(1)}/s`);
  if (!best || t.maxGap < best.maxGap) {
    if (bestDir && bestDir !== dir && !keepDir) rmSync(bestDir, { recursive: true, force: true });
    best = t;
    bestDir = dir;
  } else if (!keepDir) rmSync(dir, { recursive: true, force: true });
  if (t.maxGap <= maxGapMs) break;
}
const { frames, times, probes } = best;
const framesDir = bestDir;

// Rebuild at a constant 60 fps on the track's clock.
const lines = [];
let j = 0;
for (let k = 0; k < Math.round(seconds * FPS); k++) {
  const t = fromSec + k / FPS + lagMs / 1000;
  while (j + 1 < times.length && times[j + 1] <= t + 1e-4) j++;
  lines.push(`file '${frames[j].file}'`, `duration ${1 / FPS}`);
}
lines.push(lines.at(-2));
const list = join(framesDir, "list.txt");
writeFileSync(list, lines.join("\n") + "\n");
ffmpeg([
  "-f", "concat", "-safe", "0", "-i", list,
  "-ss", String(fromSec), "-t", String(seconds), "-i", wav,
  "-map", "0:v", "-map", "1:a",
  // The screencast's JPEGs are full-range BT.601; convert to the limited-range
  // BT.709 every player and Instagram expect, or blacks lift and colours shift.
  "-vf", `fps=${FPS},scale=in_range=pc:out_range=tv:in_color_matrix=bt601:out_color_matrix=bt709,format=yuv420p`,
  "-c:v", "libx264", "-preset", "slow", "-crf", "14", "-profile:v", "high",
  "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
  "-c:a", "aac", "-b:a", "320k", "-ar", "48000", "-ac", "2",
  "-movflags", "+faststart", "-t", String(seconds), out,
]);
if (!keepDir) rmSync(framesDir, { recursive: true, force: true });
console.log(`${out}: ${scene} ${W}x${H}, track ${fromSec}–${untilSec.toFixed(2)}s, lag ${lagMs} ms`);
console.log(`kept: ${best.fps.toFixed(1)} fps, longest gap ${best.maxGap.toFixed(0)} ms${best.maxGap > maxGapMs ? "  (WARNING: no take under --max-gap-ms — is something else using the GPU?)" : ""}`);
const ps = probes.slice(1);
if (ps.length) console.log(`app: render fps ${Math.min(...ps.map((p) => p.fps)).toFixed(0)}–${Math.max(...ps.map((p) => p.fps)).toFixed(0)}, quality ${ps.at(-1).q}, governor ${[...new Set(ps.map((p) => p.gov))].join("→")}, render scale ${[...new Set(ps.map((p) => p.scale?.toFixed(2)))].join("→")}`);
