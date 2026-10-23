import { describe, expect, it } from "vitest";
import { createStemSplitter, STEM_SETTLE_SEC, type StemRanges } from "../audio-subsystem/src/stemSplit.ts";
import { driveSettingFromChoice } from "../src/render/drives.ts";
import { setDriveSetting } from "../src/render/driveStore.ts";
import type { SceneSetting } from "../src/render/sceneSettings.ts";
import { createStemGate, wiresReadStems } from "../src/render/stemReaders.ts";
import { MAX_HZ_CAP, bandEdgesHz } from "../audio-subsystem/src/bandScale.ts";
import { LOW_MID_DEFAULT, MID_HIGH_DEFAULT } from "../audio-subsystem/src/bandSplit.ts";
import { NUM_BANDS } from "../audio-subsystem/src/types.ts";
import { readBinsDb } from "./tempoEval/bands.ts";
import { SR } from "./tempoEval/synth.ts";

// Synthetic sound through the offline analyser copy (tempoEval/bands.ts),
// read the way app.ts reads a live capture: one analyser read per frame.

const BIN_COUNT = 1024;
const BIN_HZ = SR / 2 / BIN_COUNT;
const EDGES = bandEdgesHz(Math.min(MAX_HZ_CAP, SR / 2 - BIN_HZ));
const RANGES: StemRanges = {
  lead: { lo: EDGES[LOW_MID_DEFAULT]!, hi: EDGES[MID_HIGH_DEFAULT]! },
  hats: { lo: EDGES[MID_HIGH_DEFAULT]!, hi: EDGES[NUM_BANDS]! },
};

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296 - 0.5;
  };
}

/** A held 440 Hz tone while `toneUntilSec`, plus a 20 ms noise click every
 *  quarter second (a hi-hat stand-in) the whole way, over a steady hiss of
 *  amplitude `room` (a room's reverb and noise). */
function song(seconds: number, toneUntilSec: number, clicks: boolean, room = 0): Float32Array {
  const out = new Float32Array(Math.round(seconds * SR));
  const noise = rng(7);
  const clickLen = Math.round(0.02 * SR);
  const every = Math.round(0.25 * SR);
  for (let i = 0; i < out.length; i++) {
    let x = i < toneUntilSec * SR ? 0.3 * Math.sin((2 * Math.PI * 440 * i) / SR) : 0;
    if (clicks && i % every < clickLen) x += 0.6 * noise();
    out[i] = x + room * noise();
  }
  return out;
}

/** The splitter's readings at `fps`, one row per frame: [tSec, hats, lead]. */
function run(mono: Float32Array, fps: number): [number, number, number][] {
  const split = createStemSplitter(BIN_COUNT, BIN_HZ);
  const rows: [number, number, number][] = [];
  const frames = Math.floor((mono.length / SR) * fps);
  for (let k = 0; k < frames; k++) {
    const t = k / fps;
    const s = split.update(readBinsDb(mono, t, SR), t, RANGES);
    rows.push([t, s.hats, s.lead]);
  }
  return rows;
}

function between(rows: [number, number, number][], from: number, to: number, col: 1 | 2): number[] {
  return rows.filter(([t]) => t >= from && t < to).map((r) => r[col]);
}

const max = (xs: number[]) => Math.max(...xs);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe("stemSplit", () => {
  it("reads a held tone as Lead and leaves Hats at 0", () => {
    const rows = run(song(3, 3, false), 60);
    expect(Math.min(...between(rows, 1, 3, 2))).toBeGreaterThan(0.8);
    expect(max(between(rows, 1, 3, 1))).toBeLessThan(0.05);
  });

  it("reads noise clicks as Hats and leaves Lead low", () => {
    const rows = run(song(3, 0, true), 60);
    expect(max(between(rows, 1, 3, 1))).toBeGreaterThan(0.8);
    expect(max(between(rows, 1, 3, 2))).toBeLessThan(0.3);
  });

  it("keeps Lead low through a drum break after the melody stops", () => {
    const rows = run(song(8, 3, true, 0.003), 60);
    expect(mean(between(rows, 1, 3, 2))).toBeGreaterThan(0.6);
    // Seconds into the break: the steady hiss is a held sound, so it lands
    // in Lead. Lead is measured against all the mid-range sound, which the
    // clicks keep up, so that leftover never fills it.
    expect(max(between(rows, 5, 8, 2))).toBeLessThan(0.3);
    expect(max(between(rows, 5, 8, 1))).toBeGreaterThan(0.8);
  });

  it("reads silence as 0", () => {
    const rows = run(new Float32Array(SR * 2), 60);
    expect(max(rows.map((r) => r[1]))).toBe(0);
    expect(max(rows.map((r) => r[2]))).toBe(0);
  });

  it("reads the same at 60 and 120 frames a second", () => {
    const mono = song(4, 2.5, true);
    const a = run(mono, 60);
    const b = run(mono, 120);
    for (const [from, to] of [
      [1, 2.5],
      [3, 4],
    ]) {
      expect(Math.abs(mean(between(a, from!, to!, 1)) - mean(between(b, from!, to!, 1)))).toBeLessThan(0.1);
      expect(Math.abs(mean(between(a, from!, to!, 2)) - mean(between(b, from!, to!, 2)))).toBeLessThan(0.1);
    }
  });

  it("reads after a reset exactly as a fresh splitter does", () => {
    const mono = song(4, 2.5, true, 0.003);
    const used = createStemSplitter(BIN_COUNT, BIN_HZ);
    const fresh = createStemSplitter(BIN_COUNT, BIN_HZ);
    for (let k = 0; k < 60; k++) used.update(readBinsDb(mono, k / 60, SR), k / 60, RANGES);
    used.reset();
    for (let k = 120; k < 240; k++) {
      const t = k / 60;
      const bins = readBinsDb(mono, t, SR);
      expect({ ...used.update(bins, t, RANGES) }).toEqual({ ...fresh.update(bins, t, RANGES) });
    }
  });
});

describe("stemSplit behind its gate (src/render/stemReaders.ts)", () => {
  const LEVEL: SceneSetting = { key: "level", label: "Level", min: 0, max: 1, step: 0.05, default: 0.5, drive: { default: "anim.energy" } };

  it("isn't called while nothing reads it, and reads as if it never stopped once a wire is added", () => {
    const mono = song(5, 5, true, 0.003);
    const wiredAt = 2;
    const always = createStemSplitter(BIN_COUNT, BIN_HZ);
    const split = createStemSplitter(BIN_COUNT, BIN_HZ);
    let updates = 0;
    const gate = createStemGate({
      update: (...args) => {
        updates++;
        return split.update(...args);
      },
      reset: () => split.reset(),
    });
    const rows: [number, number, number][] = [];
    for (let k = 0; k < 5 * 60; k++) {
      const t = k / 60;
      if (k === wiredAt * 60) setDriveSetting("gated-scene", LEVEL, driveSettingFromChoice("anim.hats"));
      const bins = readBinsDb(mono, t, SR);
      const want = always.update(bins, t, RANGES);
      const got = gate.update(wiresReadStems("gated-scene", [LEVEL]), bins, t, RANGES) ?? { hats: 0, lead: 0 };
      if (t < wiredAt) expect(updates).toBe(0);
      rows.push([t, got.hats - want.hats, got.lead - want.lead]);
    }
    const settled = wiredAt + STEM_SETTLE_SEC;
    for (const col of [1, 2] as const) expect(max(between(rows, settled, 5, col).map(Math.abs))).toBeLessThan(0.02);
  });
});
