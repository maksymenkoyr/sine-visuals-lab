import { describe, it, expect, beforeEach } from "vitest";
import { createBandEnergy } from "../src/render/bandEnergy.ts";
import { NUM_BANDS } from "../src/audio/types.ts";
import { setBandSplit, resetBandSplit } from "../src/audio/bandSplit.ts";

const DT = 1 / 60;

// bandSplit is a single global value (see bandSplit.test.ts), so every test
// resets it first — the four tests below rely on today's default split
// (lowMid=6, midHigh=16) being in effect, proving that split reproduces the
// old hardcoded LOW/MID/HIGH_BANDS behavior exactly.
beforeEach(() => {
  resetBandSplit();
});

function bandsWith(hot: number[], value = 0.9, floor = 0.02): Float32Array {
  const bands = new Float32Array(NUM_BANDS).fill(floor);
  for (const i of hot) bands[i] = value;
  return bands;
}

// A moving bassline (a held note whose level steps every two 120bpm beats,
// never dipping to silence) with a kick riding on top every beat. This is
// exactly the case that broke the old level-vs-baseline trigger: the bed
// alone was often loud enough to leave nothing below the threshold for a
// kick to rise above. Written as a function of tSec, not the frame index,
// so the same fixture can be sampled at any frame rate — see the
// frame-rate-parity test below.
const KICK_PERIOD_SEC = 0.5; // 120bpm
function kickOverBedBands(tSec: number): Float32Array {
  const bands = new Float32Array(NUM_BANDS).fill(0.02);
  const bedIndex = Math.floor(tSec / 1);
  const bed = 0.55 + 0.35 * (((bedIndex * 7919) % 10) / 10); // steps every 2 beats, never silent
  const beatPos = (tSec / KICK_PERIOD_SEC) % 1;
  const kick = 0.35 * (1 - Math.exp(-beatPos / 0.02)) * Math.exp(-beatPos / 0.09); // fast attack, decaying body
  const value = Math.min(1, bed + kick);
  for (const i of [0, 1, 2, 3]) bands[i] = value;
  return bands;
}

/** Number of kickOverBedBands beats landing in (afterSec, totalSec). */
function expectedKicks(afterSec: number, totalSec: number): number {
  let n = 0;
  for (let k = 0; k * KICK_PERIOD_SEC < totalSec; k++) {
    if (k * KICK_PERIOD_SEC > afterSec) n++;
  }
  return n;
}

function countLowOnsets(fps: number, seconds: number, afterSec: number): number {
  const dt = 1 / fps;
  const energy = createBandEnergy();
  let onsets = 0;
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    const t = i * dt;
    energy.advance(dt, kickOverBedBands(t));
    if (energy.lowOnset && t > afterSec) onsets++;
  }
  return onsets;
}

describe("band energy", () => {
  it("a bass-only signal raises low level and leaves high level flat", () => {
    const energy = createBandEnergy();
    const bassBands = [0, 1, 2, 3];
    for (let i = 0; i < 120; i++) energy.advance(DT, bandsWith(bassBands));
    expect(energy.low).toBeGreaterThan(0.3);
    expect(energy.high).toBeLessThan(0.05);
  });

  it("a treble-only signal raises high level and leaves low level flat", () => {
    const energy = createBandEnergy();
    const trebleBands = [18, 19, 20, 21];
    for (let i = 0; i < 120; i++) energy.advance(DT, bandsWith(trebleBands));
    expect(energy.high).toBeGreaterThan(0.3);
    expect(energy.low).toBeLessThan(0.05);
  });

  it("fires once on the jump to loud, then stays silent while it sustains", () => {
    const energy = createBandEnergy();
    const quiet = bandsWith([]);
    for (let i = 0; i < 60; i++) energy.advance(DT, quiet);

    // A constant loud level has zero rate-of-rise after the first tick, so
    // it must not re-fire just for holding — that's the level-crossing
    // behavior the old trigger had, and the bug this file fixes: a level
    // that never dips can never re-arm a level-vs-baseline trigger, but a
    // sustained level correctly reads as "no new rise" for a flux trigger.
    const loud = bandsWith([0, 1, 2, 3]);
    let onsets = 0;
    for (let i = 0; i < 5; i++) {
      energy.advance(DT, loud);
      if (energy.lowOnset) onsets++;
    }
    expect(onsets).toBe(1);
  });

  it("never fires on the very first advance, however loud", () => {
    // prevRaw starts null specifically so a fresh instance can't read its
    // own construction as an onset.
    const energy = createBandEnergy();
    const loud = bandsWith([0, 1, 2, 3]);
    energy.advance(DT, loud);
    expect(energy.lowOnset).toBe(false);
    energy.advance(DT, loud);
    expect(energy.lowOnset).toBe(false);
  });

  it("pulse decays toward 0 with no further onsets", () => {
    const energy = createBandEnergy();
    for (let i = 0; i < 30; i++) energy.advance(DT, bandsWith([]));
    energy.advance(DT, bandsWith([0, 1, 2, 3]));
    expect(energy.lowPulse).toBeCloseTo(1, 1);
    for (let i = 0; i < 60; i++) energy.advance(DT, bandsWith([]));
    expect(energy.lowPulse).toBeLessThan(0.1);
  });

  it("rateScale slows the approach to a new level without changing the steady-state destination", () => {
    const bass = bandsWith([0, 1, 2, 3]);

    const slow = createBandEnergy();
    const fast = createBandEnergy();
    for (let i = 0; i < 10; i++) {
      slow.advance(DT, bass, 0.25);
      fast.advance(DT, bass, 1);
    }
    // Same input, fewer ticks in: the slower rateScale hasn't caught up yet.
    expect(slow.low).toBeLessThan(fast.low);

    // Both keep converging toward the same steady state given enough ticks.
    for (let i = 0; i < 600; i++) {
      slow.advance(DT, bass, 0.25);
      fast.advance(DT, bass, 1);
    }
    expect(slow.low).toBeCloseTo(fast.low, 2);
  });

  it("raising the Kick top crossover moves previously-mid bands into low", () => {
    // Bands 6-9 sit in the default mid range [6,16) — confirm that baseline first.
    const midBands = [6, 7, 8, 9];
    const before = createBandEnergy();
    for (let i = 0; i < 120; i++) before.advance(DT, bandsWith(midBands));
    expect(before.mid).toBeGreaterThan(0.3);
    expect(before.low).toBeLessThan(0.05);

    // Push the Kick top slider up past band 9: everything below index 10 is
    // now "low" — this is exactly what dragging the config panel slider does.
    setBandSplit({ lowMid: 10 });
    const after = createBandEnergy();
    for (let i = 0; i < 120; i++) after.advance(DT, bandsWith(midBands));
    expect(after.low).toBeGreaterThan(0.3);
    expect(after.mid).toBeLessThan(0.05);
  });

  it("fires on nearly every kick even over a loud, moving bassline (regression)", () => {
    // The bug this file fixes: a level-vs-adaptive-baseline trigger goes
    // structurally dead once the baseline climbs high enough that
    // baseline*mult+margin exceeds 1 — the ceiling every band is clamped to
    // in features.ts. A moving, never-silent bed drives exactly that. This
    // fixture reproduced 4-9 detected kicks out of 34-40 (a ~75-90% miss
    // rate) against the old trigger; the flux trigger should catch nearly
    // all of them regardless of the bed underneath.
    const seconds = 20;
    const afterSec = 2.5; // let the flux baseline settle past startup first
    const onsets = countLowOnsets(60, seconds, afterSec);
    const kicks = expectedKicks(afterSec, seconds);
    expect(onsets).toBeGreaterThanOrEqual(Math.round(kicks * 0.9));
    expect(onsets).toBeLessThanOrEqual(kicks + 2);
  });

  it("stays silent on signals with no real bass transient", () => {
    const energy = createBandEnergy();
    let onsets = 0;
    for (let i = 0; i < 600; i++) {
      const t = i * DT;
      // A steady sub-bass drone: loud, but never rising.
      const bands = bandsWith([0, 1, 2, 3], 0.5 + 0.001 * Math.sin(t)); // negligible drift, not a real rise
      energy.advance(DT, bands);
      if (t > 1 && energy.lowOnset) onsets++;
    }
    expect(onsets).toBe(0);
  });

  it("the refractory blocks re-firing faster than a group's minimum spacing", () => {
    // A square wave toggling well faster than the low group's refractory
    // (0.1s): every rising edge is a legitimate loud jump, but only some of
    // them are far enough apart to count.
    const periodSec = 0.03;
    const energy = createBandEnergy();
    let onsets = 0;
    let wasHigh = false;
    let kicks = 0;
    const seconds = 5;
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      const t = i * DT;
      const high = (t % periodSec) < periodSec / 2;
      if (high && !wasHigh && t > 1) kicks++;
      wasHigh = high;
      energy.advance(DT, bandsWith([0, 1, 2, 3], high ? 0.9 : 0.02));
      if (energy.lowOnset && t > 1) onsets++;
    }
    expect(onsets).toBeGreaterThan(0);
    expect(onsets).toBeLessThan(kicks);
  });

  it("does not block a slower re-trigger once the refractory has elapsed", () => {
    // Same shape as the refractory test above but spaced well past the low
    // group's 0.1s minimum — every beat should still get its own onset.
    const periodSec = 0.5;
    const energy = createBandEnergy();
    let onsets = 0;
    let wasHigh = false;
    let kicks = 0;
    const seconds = 5;
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      const t = i * DT;
      const high = (t % periodSec) < periodSec / 2;
      if (high && !wasHigh && t > 1) kicks++;
      wasHigh = high;
      energy.advance(DT, bandsWith([0, 1, 2, 3], high ? 0.9 : 0.02));
      if (energy.lowOnset && t > 1) onsets++;
    }
    expect(onsets).toBe(kicks);
  });

  it("detects roughly the same number of kicks whether sampled at 60Hz or 120Hz", () => {
    // Guards specifically against a frame-*count* refractory (which would
    // let a 120Hz clock double-fire relative to 60Hz) and against an
    // un-normalized per-frame rise (which would make the trigger twice as
    // strict at 120Hz) — both were live risks with this trigger shape.
    const seconds = 20;
    const afterSec = 2.5;
    const at60 = countLowOnsets(60, seconds, afterSec);
    const at120 = countLowOnsets(120, seconds, afterSec);
    expect(Math.abs(at60 - at120)).toBeLessThanOrEqual(2);
  });

  it("stays finite and keeps firing onsets with Smoothing at its Off stop (rateScale = Infinity)", () => {
    // The flux baseline and refractory must not be scaled by rateScale: at
    // the Smoothing row's Off stop rateScale is Infinity, and scaling the
    // baseline by it would snap fluxBaseline to equal every rise, making
    // the trigger permanently unreachable — this is the same dead-detector
    // bug this file exists to fix, reappearing under a different setting.
    const dt = 1 / 60;
    const energy = createBandEnergy();
    let onsets = 0;
    for (let i = 0; i < Math.round(20 / dt); i++) {
      const t = i * dt;
      energy.advance(dt, kickOverBedBands(t), Infinity);
      expect(Number.isFinite(energy.low)).toBe(true);
      expect(Number.isFinite(energy.lowPulse)).toBe(true);
      if (energy.lowOnset && t > 2.5) onsets++;
    }
    const kicks = expectedKicks(2.5, 20);
    expect(onsets).toBeGreaterThanOrEqual(Math.round(kicks * 0.9));
  });
});
