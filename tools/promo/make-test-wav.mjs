#!/usr/bin/env node
// A synthetic test track for the promo capture pipeline (capture.mjs):
// 1 s of silence, then a sharp full-scale click at exactly SYNC_SEC — the
// sync mark capture.mjs finds in the recorded picture — then a kick-heavy
// four-on-the-floor loop with off-beat hats and a bass line, so a scene has
// something to react to. Written as 48 kHz mono s16, the format Chromium's
// --use-file-for-fake-audio-capture reads (see tools/ref-browser.mjs).
//
//   node tools/promo/make-test-wav.mjs out.wav [--seconds 12] [--bpm 128]
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith("--"));
if (!out) {
  console.error("usage: node tools/promo/make-test-wav.mjs out.wav [--seconds N] [--bpm N]");
  process.exit(2);
}
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? +args[i + 1] : d;
};
const seconds = opt("--seconds", 12);
const bpm = opt("--bpm", 128);
export const SYNC_SEC = 1;

const sr = 48000;
const n = Math.round(seconds * sr);
const buf = new Float32Array(n);
const beat = 60 / bpm;

// The sync click: 10 ms of full-scale square burst — loud, broadband,
// unmistakable to the onset detector.
for (let i = 0; i < 0.01 * sr; i++) buf[Math.round(SYNC_SEC * sr) + i] = (i >> 4) % 2 ? 0.95 : -0.95;

// The groove starts one beat after the click, so the click stands alone.
const start = SYNC_SEC + beat;
let seed = 1;
const noise = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
for (let k = 0; start + k * beat < seconds; k++) {
  const t0 = start + k * beat;
  const i0 = Math.round(t0 * sr);
  // Kick: pitch sweep 150 → 45 Hz, 250 ms decay.
  let ph = 0;
  for (let i = 0; i < 0.3 * sr && i0 + i < n; i++) {
    const t = i / sr;
    ph += (2 * Math.PI * (45 + 105 * Math.exp(-t * 30))) / sr;
    buf[i0 + i] += 0.9 * Math.sin(ph) * Math.exp(-t * 9);
  }
  // Off-beat hat: 40 ms of decaying noise.
  const h0 = Math.round((t0 + beat / 2) * sr);
  for (let i = 0; i < 0.04 * sr && h0 + i < n; i++) buf[h0 + i] += 0.25 * noise() * Math.exp(-(i / sr) * 90);
  // Bass: a saw on the off-beat, root changing every bar.
  const f = [55, 55, 65.4, 49][Math.floor(k / 4) % 4];
  for (let i = 0; i < (beat / 2) * sr && h0 + i < n; i++) {
    const t = i / sr;
    buf[h0 + i] += 0.25 * (((t * f) % 1) * 2 - 1) * Math.exp(-t * 6);
  }
}

const pcm = Buffer.alloc(44 + n * 2);
pcm.write("RIFF", 0);
pcm.writeUInt32LE(36 + n * 2, 4);
pcm.write("WAVEfmt ", 8);
pcm.writeUInt32LE(16, 16);
pcm.writeUInt16LE(1, 20);
pcm.writeUInt16LE(1, 22);
pcm.writeUInt32LE(sr, 24);
pcm.writeUInt32LE(sr * 2, 28);
pcm.writeUInt16LE(2, 32);
pcm.writeUInt16LE(16, 34);
pcm.write("data", 36);
pcm.writeUInt32LE(n * 2, 40);
for (let i = 0; i < n; i++) pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, buf[i])) * 32767), 44 + i * 2);
writeFileSync(out, pcm);
console.log(`${out}: ${seconds}s, ${bpm} bpm, sync click at ${SYNC_SEC}s`);
