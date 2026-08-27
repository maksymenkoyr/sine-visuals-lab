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

  it("fires a one-shot onset edge only on the tick a group's level newly crosses its threshold", () => {
    const energy = createBandEnergy();
    const quiet = bandsWith([]);
    for (let i = 0; i < 60; i++) energy.advance(DT, quiet);

    const loud = bandsWith([0, 1, 2, 3]);
    let onsets = 0;
    for (let i = 0; i < 5; i++) {
      energy.advance(DT, loud);
      if (energy.lowOnset) onsets++;
    }
    expect(onsets).toBe(1);
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
});
