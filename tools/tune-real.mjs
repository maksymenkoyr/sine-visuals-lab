#!/usr/bin/env node
// The real-audio check after a synthetic tuning round (/tune): plays a real
// song, then silence, as the microphone into one scene and reports how much
// the picture moves and how often a hit fires under each. A scene tuned on
// the synthetic click track can look alive there and barely react to music,
// or keep pulsing with nothing playing — the two rows side by side show both.
//
//   node tools/tune-real.mjs <sceneId> --wav <song.wav> [--port P]
//        [--from S] [--seconds S] [--sheet <outPrefix>]
//
// The song is a 48 kHz mono 16-bit WAV, the format Chromium's fake mic reads
// (ref-browser.mjs, whose launcher this reuses). The main checkout keeps a
// few known songs at tools/.cache/tempo-tracks/<slug>/audio.wav — gitignored,
// never commit one. The silence is a WAV of the same format written to a
// temp dir. Each source gets its own browser, since the fake mic is a launch
// flag. Needs the dev server running (`npm run dev`); the scene runs with
// whatever tuning/params.json holds, so set `"autoPin": false` there to see
// Auto move settings the way a user's browser would.
//
// What it reads, in-page, from --from seconds after the mic opens (the
// analyser and beat clock need a moment to settle) for --seconds:
// - change: how much a downscaled copy of the canvas differs from itself
//   SAMPLE_MS earlier, as a percent of full scale — median (the steady
//   drift) and p95 (the pulses). Timed by the clock, not per frame, so a
//   slow headless frame rate doesn't shrink it.
// - hits/min: rising edges of the probe's beat.fired (each detected hit,
//   not just the beat), counted every frame.
// - energy: mean of the probe's bands.energy, to confirm the song arrived.
// Thresholds differ per scene, so nothing passes or fails here: on silence,
// any change should be motion the scene has by design, and no hit should
// fire; on the song, p95 should stand well above silence.
//
// --sheet also writes <outPrefix>-song.png and <outPrefix>-silence.png,
// contact sheets via window.__viz.capture() taken after the measurement so
// they don't stall it — the picture under each, to judge by eye.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchWithMic, openScene } from "./ref-browser.mjs";

const SAMPLE_MS = 100;
const THUMB_W = 64;
const THUMB_H = 36;
const SHEET_FRAMES = 9;
const SHEET_EVERY_MS = 400;

const args = process.argv.slice(2);
const scene = args.find((a, i) => !a.startsWith("--") && (i === 0 || !args[i - 1].startsWith("--")));
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const wav = opt("--wav");
const port = opt("--port", "5173");
const fromSec = Number(opt("--from", "4"));
const seconds = Number(opt("--seconds", "30"));
const sheet = opt("--sheet");
if (!scene || !wav) {
  console.error("usage: node tools/tune-real.mjs <sceneId> --wav <song.wav> [--port P] [--from S] [--seconds S] [--sheet <outPrefix>]");
  process.exit(2);
}

/** Format and length of a WAV, walking its chunks (ffmpeg may put a LIST
 *  chunk before data). */
function wavInfo(path) {
  const b = readFileSync(path);
  if (b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WAVE") throw new Error(`${path} is not a WAV`);
  let fmt = null;
  for (let o = 12; o + 8 <= b.length; ) {
    const id = b.toString("ascii", o, o + 4);
    const size = b.readUInt32LE(o + 4);
    if (id === "fmt ") fmt = { channels: b.readUInt16LE(o + 10), rate: b.readUInt32LE(o + 12), bits: b.readUInt16LE(o + 22) };
    if (id === "data" && fmt) return { ...fmt, seconds: size / (fmt.rate * fmt.channels * (fmt.bits / 8)) };
    o += 8 + size + (size % 2);
  }
  throw new Error(`${path} has no fmt/data chunk`);
}

function silentWav(sec) {
  const rate = 48000;
  const data = Math.ceil(sec * rate) * 2;
  const b = Buffer.alloc(44 + data);
  b.write("RIFF", 0, "ascii");
  b.writeUInt32LE(36 + data, 4);
  b.write("WAVEfmt ", 8, "ascii");
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); // PCM
  b.writeUInt16LE(1, 22); // mono
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36, "ascii");
  b.writeUInt32LE(data, 40);
  const path = join(mkdtempSync(join(tmpdir(), "tune-real-")), "silence.wav");
  writeFileSync(path, b);
  return path;
}

const info = wavInfo(wav);
if (info.bits !== 16) {
  console.error(`${wav}: ${info.bits}-bit; Chromium's fake mic needs 16-bit PCM (ffmpeg -i in -ac 1 -ar 48000 -c:a pcm_s16le out.wav)`);
  process.exit(2);
}
if (info.seconds < fromSec + seconds) {
  console.log(`WARNING: ${wav} is ${info.seconds.toFixed(0)} s, shorter than --from + --seconds; the tail measures silence`);
}

async function measure(source, file) {
  const { browser, ctx } = await launchWithMic(file);
  try {
    const page = await openScene(ctx, { port, scene });
    const r = await page.evaluate(
      ({ fromMs, untilMs, sampleMs, w, h }) =>
        new Promise((resolve) => {
          const gl = document.getElementById("gl");
          const thumb = document.createElement("canvas");
          thumb.width = w;
          thumb.height = h;
          const g = thumb.getContext("2d", { willReadFrequently: true });
          const change = [];
          let prev = null;
          let nextSample = fromMs;
          let hits = 0;
          let wasFired = false;
          let energy = 0;
          let frames = 0;
          const tick = () => {
            const t = performance.now() - window.__micT0;
            if (t >= fromMs) {
              const p = window.__viz?.probe();
              if (p) {
                if (p.beat.fired && !wasFired) hits++;
                wasFired = p.beat.fired;
                energy += p.bands.energy;
                frames++;
              }
              if (t >= nextSample) {
                g.drawImage(gl, 0, 0, w, h);
                const px = g.getImageData(0, 0, w, h).data;
                if (prev) {
                  let s = 0;
                  for (let i = 0; i < px.length; i += 4) {
                    s += Math.abs(px[i] - prev[i]) + Math.abs(px[i + 1] - prev[i + 1]) + Math.abs(px[i + 2] - prev[i + 2]);
                  }
                  change.push((s / (w * h * 3 * 255)) * 100);
                }
                prev = px;
                nextSample = t + sampleMs;
              }
            }
            if (t >= untilMs) resolve({ change, hits, energy: energy / Math.max(1, frames), fps: frames / ((t - fromMs) / 1000) });
            else requestAnimationFrame(tick);
          };
          tick();
        }),
      { fromMs: fromSec * 1000, untilMs: (fromSec + seconds) * 1000, sampleMs: SAMPLE_MS, w: THUMB_W, h: THUMB_H },
    );
    if (sheet) {
      const dataUrl = await page.evaluate(
        ([frames, every]) => window.__viz.capture({ frames, intervalMs: every }),
        [SHEET_FRAMES, SHEET_EVERY_MS],
      );
      const out = `${sheet}-${source}.png`;
      writeFileSync(out, Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ""), "base64"));
      console.log("wrote", out);
    }
    const sorted = [...r.change].sort((a, b) => a - b);
    const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
    return { source, median: at(0.5), p95: at(0.95), hitsPerMin: (r.hits / seconds) * 60, energy: r.energy, fps: r.fps };
  } finally {
    await browser.close();
  }
}

const rows = [await measure("song", wav), await measure("silence", silentWav(fromSec + seconds + 5))];
console.log(`\n${scene}: ${seconds} s from ${fromSec} s, change = % of full scale per ${SAMPLE_MS} ms`);
console.log("source    change med  change p95  hits/min  energy  fps");
for (const r of rows) {
  console.log(
    `${r.source.padEnd(9)} ${r.median.toFixed(2).padStart(10)}  ${r.p95.toFixed(2).padStart(10)}  ${r.hitsPerMin.toFixed(0).padStart(8)}  ${r.energy.toFixed(2).padStart(6)}  ${r.fps.toFixed(0).padStart(3)}`,
  );
}
const [song, silence] = rows;
console.log(
  silence.p95 < 0.01
    ? "silence: the picture holds still"
    : `song p95 / silence p95 = ${(song.p95 / silence.p95).toFixed(1)}x`,
);
if (silence.hitsPerMin > 0) console.log(`WARNING: hits fired on silence (${silence.hitsPerMin.toFixed(0)}/min)`);
if (song.energy < 0.01) console.log("WARNING: the song's energy reads ~0 — did the mic start?");
