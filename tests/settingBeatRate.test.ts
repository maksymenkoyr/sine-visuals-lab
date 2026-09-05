import { describe, it, expect } from "vitest";
import {
  BEAT_RATES,
  createBeatOverrideGate,
  gridPhase,
  isBeatOverride,
  isBeatRate,
} from "../src/render/settingBeatRate.ts";
import { createBeatClock } from "../src/render/beatClock.ts";
import { BEAT_GRIDS } from "../src/audio/beatGrid.ts";

describe("isBeatRate", () => {
  it("accepts every value in BEAT_RATES", () => {
    for (const r of BEAT_RATES) expect(isBeatRate(r)).toBe(true);
  });

  it("rejects a rate outside the vocabulary", () => {
    expect(isBeatRate(3)).toBe(false);
    expect(isBeatRate(0)).toBe(false);
    expect(isBeatRate(1.5)).toBe(false);
    expect(isBeatRate(-1)).toBe(false);
  });
});

describe("isBeatOverride", () => {
  it("accepts every index into BEAT_GRIDS", () => {
    for (let i = 0; i < BEAT_GRIDS.length; i++) expect(isBeatOverride(i)).toBe(true);
  });

  it("rejects an out-of-range or non-integer index", () => {
    expect(isBeatOverride(-1)).toBe(false);
    expect(isBeatOverride(BEAT_GRIDS.length)).toBe(false);
    expect(isBeatOverride(1.5)).toBe(false);
  });
});

describe("gridPhase", () => {
  it("matches BeatClock.barPhase bit for bit at rate 4", () => {
    const clock = createBeatClock();
    // A held tempo, several ticks — spans multiple bars.
    for (let i = 0; i < 400; i++) {
      clock.advance(1 / 60, 120, i % 30 === 0);
      expect(gridPhase(clock.beats, 4)).toBe(clock.barPhase);
    }
  });

  it("matches BeatClock.beatPhase bit for bit at rate 1", () => {
    const clock = createBeatClock();
    for (let i = 0; i < 200; i++) {
      clock.advance(1 / 60, 95, i % 22 === 0);
      expect(gridPhase(clock.beats, 1)).toBe(clock.beatPhase);
    }
  });

  it("cycles twice as fast at rate 0.5", () => {
    expect(gridPhase(1, 0.5)).toBeCloseTo(0, 10);
    expect(gridPhase(0.75, 0.5)).toBeCloseTo(0.5, 10);
    expect(gridPhase(0.25, 0.5)).toBeCloseTo(0.5, 10);
  });

  it("wraps to [0,1) for a large beat count", () => {
    const phase = gridPhase(37.25, 2);
    expect(phase).toBeGreaterThanOrEqual(0);
    expect(phase).toBeLessThan(1);
    expect(phase).toBeCloseTo(0.625, 10); // 37.25/2 = 18.625 -> fractional .625
  });
});

describe("createBeatOverrideGate", () => {
  const HALF_BAR_INDEX = BEAT_GRIDS.findIndex((g) => g.beats === 2); // "1/2"
  const BAR_INDEX = BEAT_GRIDS.findIndex((g) => g.beats === 4); // "1 bar"
  const HITS_INDEX = BEAT_GRIDS.findIndex((g) => g.beats === null); // "Hits"

  it("at Scene (null), passes the scene's own onset/pulse through bit for bit", () => {
    const gate = createBeatOverrideGate();
    // Even where beats/tempoLock would otherwise fire this setting's own
    // grid, override === null must short-circuit straight to the given
    // scene values, untouched.
    const r1 = gate.advance({
      dtSec: 1 / 60,
      beats: 4,
      tempoLock: 1,
      rawOnset: false,
      override: null,
      sceneOnset: true,
      scenePulse: 0.73,
    });
    expect(r1).toEqual({ onset: true, pulse: 0.73 });

    const r2 = gate.advance({
      dtSec: 1 / 60,
      beats: 4.1,
      tempoLock: 1,
      rawOnset: false,
      override: null,
      sceneOnset: false,
      scenePulse: 0.5,
    });
    expect(r2).toEqual({ onset: false, pulse: 0.5 });
  });

  it("away from Scene, fires on its own grid regardless of the scene's onset", () => {
    const gate = createBeatOverrideGate();
    // A locked tempo, override pinned to "1 bar" (4 beats) — sceneOnset is
    // always false here, proving the fired edge comes from the override's
    // own grid, not from the scene's.
    let firedCount = 0;
    for (let i = 0; i <= 160; i++) {
      const beats = i * 0.05; // 0..8
      const { onset } = gate.advance({
        dtSec: 0.05,
        beats,
        tempoLock: 1,
        rawOnset: false,
        override: BAR_INDEX,
        sceneOnset: false,
        scenePulse: 0,
      });
      if (onset) firedCount++;
    }
    expect(firedCount).toBe(2); // beats 4 and 8
  });

  it("a faster override fires more often than a slower one over the same span", () => {
    const half = createBeatOverrideGate();
    const bar = createBeatOverrideGate();
    let halfCount = 0;
    let barCount = 0;
    for (let i = 0; i <= 160; i++) {
      const beats = i * 0.05;
      const input = { dtSec: 0.05, beats, tempoLock: 1, rawOnset: false, sceneOnset: false, scenePulse: 0 };
      if (half.advance({ ...input, override: HALF_BAR_INDEX }).onset) halfCount++;
      if (bar.advance({ ...input, override: BAR_INDEX }).onset) barCount++;
    }
    expect(halfCount).toBeGreaterThan(barCount);
  });

  it("falls back to rawOnset while the tempo tracker isn't locked yet", () => {
    const gate = createBeatOverrideGate();
    // tempoLock below GRID_LOCK_ON (0.35 in gridPulse.ts) — the override's
    // own grid can't be trusted yet, so a real onset should still land.
    const { onset } = gate.advance({
      dtSec: 1 / 60,
      beats: 4,
      tempoLock: 0.1,
      rawOnset: true,
      override: BAR_INDEX,
      sceneOnset: false,
      scenePulse: 0,
    });
    expect(onset).toBe(true);
  });

  it("Hits override always reads rawOnset directly, at any tempoLock", () => {
    const gate = createBeatOverrideGate();
    const r1 = gate.advance({
      dtSec: 1 / 60,
      beats: 4,
      tempoLock: 1,
      rawOnset: true,
      override: HITS_INDEX,
      sceneOnset: false,
      scenePulse: 0,
    });
    expect(r1.onset).toBe(true);
    const r2 = gate.advance({
      dtSec: 1 / 60,
      beats: 4.01,
      tempoLock: 1,
      rawOnset: false,
      override: HITS_INDEX,
      sceneOnset: false,
      scenePulse: 0,
    });
    expect(r2.onset).toBe(false);
  });

  it("pulse jumps to 1 on its own onset and decays otherwise, once overridden", () => {
    const gate = createBeatOverrideGate();
    // The very first call to a fresh grid only arms it at whatever index
    // it already sits in — no fire for the boundary already passed (see
    // gridPulse.ts's own "arm silently on entry" comment) — so this primes
    // the gate at beats 3.9 before the real crossing into 4.0 below.
    gate.advance({
      dtSec: 1 / 60,
      beats: 3.9,
      tempoLock: 1,
      rawOnset: false,
      override: BAR_INDEX,
      sceneOnset: false,
      scenePulse: 0,
    });
    const fired = gate.advance({
      dtSec: 1 / 60,
      beats: 4,
      tempoLock: 1,
      rawOnset: false,
      override: BAR_INDEX,
      sceneOnset: false,
      scenePulse: 0,
    });
    expect(fired.onset).toBe(true);
    expect(fired.pulse).toBe(1);
    const later = gate.advance({
      dtSec: 0.5,
      beats: 4.1,
      tempoLock: 1,
      rawOnset: false,
      override: BAR_INDEX,
      sceneOnset: false,
      scenePulse: 0,
    });
    expect(later.onset).toBe(false);
    expect(later.pulse).toBeGreaterThan(0);
    expect(later.pulse).toBeLessThan(1);
  });
});
