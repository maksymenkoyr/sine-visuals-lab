// Seeded test signals for the audio engine (src/audio/engine/): drum-like hits
// on a grid, noise, and a driver that feeds the engine the way the browser
// does (128-sample quanta) while reading frames at a given frame rate, with
// the beat clock following the reading the way src/render/animClock.ts does.

import { BeatClock, type ClockFrame } from "../../src/audio/engine/clock.ts";
import { AudioEngine } from "../../src/audio/engine/engine.ts";
import { Biquad } from "../../src/audio/engine/filters.ts";
import type { EngineReading } from "../../src/audio/types.ts";

export const SR = 48000;

export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function silence(seconds: number): Float32Array {
  return new Float32Array(Math.round(seconds * SR));
}

export function noise(seconds: number, rms: number, seed = 1): Float32Array {
  const r = rng(seed);
  const x = new Float32Array(Math.round(seconds * SR));
  for (let i = 0; i < x.length; i++) x[i] = (r() * 2 - 1) * rms * Math.sqrt(3);
  return x;
}

/** A sine kick sweeping down from 150 Hz, with a short click. */
export function addKick(x: Float32Array, at: number, gain = 0.8, seed = 1): void {
  const r = rng(seed);
  let ph = 0;
  const start = Math.round(at * SR);
  for (let i = 0; i < 0.3 * SR && start + i < x.length; i++) {
    const t = i / SR;
    ph += (2 * Math.PI * (45 + 105 * Math.exp(-t / 0.03))) / SR;
    const click = i < 0.002 * SR ? 0.3 * (r() * 2 - 1) : 0;
    x[start + i] += gain * (Math.sin(ph) * Math.exp(-t / 0.12) + click);
  }
}

/** A hat: noise high-passed twice at 7 kHz, 20 ms decay. */
export function addHat(x: Float32Array, at: number, gain = 0.3, seed = 2): void {
  const r = rng(seed);
  const start = Math.round(at * SR);
  const hp = [new Biquad("highpass", 7000, SR), new Biquad("highpass", 7000, SR)];
  for (let i = 0; i < 0.08 * SR && start + i < x.length; i++) {
    const n = hp[1].step(hp[0].step(r() * 2 - 1));
    x[start + i] += gain * n * Math.exp(-i / SR / 0.02);
  }
}

/** Kicks on every beat and hats on the off-beats, from `from` to `to` seconds. */
export function groove(seconds: number, bpm: number, from = 0, to = seconds): Float32Array {
  const x = new Float32Array(Math.round(seconds * SR));
  const beat = 60 / bpm;
  for (let t = from, k = 0; t < to; t += beat, k++) {
    addKick(x, t, 0.8, k + 1);
    addHat(x, t + beat / 2, 0.25, k + 7);
  }
  return x;
}

export function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export interface Frame {
  t: number;
  r: EngineReading;
  bpm: number;
  c: ClockFrame;
}

export interface Run {
  frames: Frame[];
  /** Times of the clock's beat flags. */
  beats: number[];
  hits: { t: number; kind: string }[];
}

/** Feeds `x` in 128-sample quanta and reads a frame every 1/fps seconds, copying each one. */
export function drive(x: Float32Array, fps = 60): Run {
  const e = new AudioEngine(SR);
  const clock = new BeatClock();
  const run: Run = { frames: [], beats: [], hits: [] };
  let pushed = 0;
  const n = Math.floor((x.length / SR) * fps);
  for (let k = 1; k <= n; k++) {
    const t = k / fps;
    while (pushed + 128 <= t * SR) {
      e.push(x.subarray(pushed, pushed + 128), pushed / SR);
      pushed += 128;
    }
    const r = e.read(1 / fps);
    clock.follow({ ...r, bpm: e.bpm }, t);
    const c = clock.tick(t, 1 / fps);
    run.frames.push({ t, r: { ...r }, bpm: e.bpm, c: { ...c } });
    if (c.beat) run.beats.push(t);
    if (r.kick > 0) run.hits.push({ t, kind: "kick" });
    if (r.snare > 0) run.hits.push({ t, kind: "snare" });
    if (r.hat > 0) run.hits.push({ t, kind: "hat" });
  }
  return run;
}

/** Readings with `from <= t < to`. */
export function between(run: Run, from: number, to: number): EngineReading[] {
  return run.frames.filter((x) => x.t >= from && x.t < to).map((x) => x.r);
}
