import { NUM_BANDS } from "../../src/audio/types.ts";
import { MAX_HZ_CAP, bandEdgesHz } from "../../src/audio/bandScale.ts";
import { TempoAnalyzer } from "../../src/audio/tempoAnalyzer.ts";
import { readBandsDb } from "./bands.ts";
import { SR } from "./synth.ts";

/**
 * What a room does to the sound, measured the same way on any audio, so a
 * real recording can be set next to micChain.ts's simulation of one and the
 * clean original: roomStats() reads the same per-band levels the app sees
 * (bands.ts) every FRAME_SEC. And hitGrid() counts the fixed-hop detector's
 * hits on and off a known tempo's beat grid.
 *
 * - levelDb: the loud end of the broadband level (LEVEL_PCT), dBFS.
 * - floorDb: how far the quiet end of the mid band (FLOOR_PCT) sits below
 *   its loud end. Noise, crowd and a long echo tail all raise it toward 0.
 * - fadeDb: how far the mid band falls in FADE_SEC after a hit (the median
 *   over hits). Echo makes a hit fade slower, so this shrinks.
 * - bassDb: the low band (up to LOW_HZ) against the mid band. A small
 *   speaker's missing bass pulls it down.
 */

const FRAME_SEC = 0.01;
const LEVEL_PCT = 0.9;
const FLOOR_PCT = 0.1;
const FADE_SEC = 0.15;
const HIT_RISE_DB = 6; // a hit: the mid band rises this much over HIT_RISE_SEC
const HIT_RISE_SEC = 0.03;
const LOW_HZ = 150;
const MID_HZ: [number, number] = [500, 4000];
const GRID_TOL_SEC = 0.035;

export interface RoomStats {
  levelDb: number;
  floorDb: number;
  fadeDb: number;
  bassDb: number;
}

function pct(values: number[], p: number): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))]!;
}

function bandGroups(): { low: number[]; mid: number[] } {
  const binHz = SR / 2048;
  const edges = bandEdgesHz(Math.min(MAX_HZ_CAP, SR / 2 - binHz));
  const low: number[] = [];
  const mid: number[] = [];
  for (let b = 0; b < NUM_BANDS; b++) {
    if (edges[b + 1]! <= LOW_HZ) low.push(b);
    if (edges[b]! >= MID_HZ[0] && edges[b + 1]! <= MID_HZ[1]) mid.push(b);
  }
  return { low, mid };
}

function groupDb(bands: Float32Array, group: number[]): number {
  let p = 0;
  for (const b of group) p += Number.isFinite(bands[b]!) ? Math.pow(10, bands[b]! / 10) : 0;
  return 10 * Math.log10(p / group.length + 1e-30);
}

export function roomStats(mono: Float32Array): RoomStats {
  const { low, mid } = bandGroups();
  const midDb: number[] = [];
  const lowDb: number[] = [];
  const levelDb: number[] = [];
  const win = Math.round(FRAME_SEC * SR * 5);
  for (let t = 0.05; t < mono.length / SR; t += FRAME_SEC) {
    const bands = readBandsDb(mono, t, SR);
    midDb.push(groupDb(bands, mid));
    lowDb.push(groupDb(bands, low));
    const end = Math.round(t * SR);
    let sq = 0;
    for (let i = Math.max(0, end - win); i < end; i++) sq += mono[i]! * mono[i]!;
    levelDb.push(10 * Math.log10(sq / win + 1e-30));
  }
  const rise = Math.round(HIT_RISE_SEC / FRAME_SEC);
  const fade = Math.round(FADE_SEC / FRAME_SEC);
  const fades: number[] = [];
  for (let i = rise; i + fade < midDb.length; i++) {
    const m = midDb[i]!;
    if (m - midDb[i - rise]! < HIT_RISE_DB || m < midDb[i - 1]! || m < midDb[i + 1]!) continue;
    fades.push(m - midDb[i + fade]!);
  }
  return {
    levelDb: pct(levelDb, LEVEL_PCT),
    floorDb: pct(midDb, FLOOR_PCT) - pct(midDb, LEVEL_PCT),
    fadeDb: fades.length ? pct(fades, 0.5) : NaN,
    bassDb: pct(lowDb.map((l, i) => l - midDb[i]!), 0.5),
  };
}

/** The fixed-hop detector's hits per bar (4 beats of `bpm`) on the beat
 *  grid and off it, the grid's phase fitted to the hits themselves. */
export function hitGrid(mono: Float32Array, bpm: number): { onPerBar: number; offPerBar: number } {
  const an = new TempoAnalyzer(SR);
  const times: number[] = [];
  for (let i = 0; i < mono.length; i += 128) {
    an.push(mono.subarray(i, Math.min(mono.length, i + 128)), i / SR);
    for (const o of an.drainOnsets()) times.push(o.time);
  }
  const period = 60 / bpm;
  const near = (t: number, phase: number) => {
    const d = (((t - phase) % period) + period) % period;
    return Math.min(d, period - d) <= GRID_TOL_SEC;
  };
  let bestPhase = 0;
  let bestOn = -1;
  for (let phase = 0; phase < period; phase += 0.005) {
    const on = times.filter((t) => near(t, phase)).length;
    if (on > bestOn) [bestOn, bestPhase] = [on, phase];
  }
  const bars = mono.length / SR / (period * 4);
  const on = times.filter((t) => near(t, bestPhase)).length;
  return { onPerBar: on / bars, offPerBar: (times.length - on) / bars };
}
