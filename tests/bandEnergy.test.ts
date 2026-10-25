import { describe, it, expect } from "vitest";
import { createBandEnergy, GROUP_TUNING } from "../src/render/bandEnergy.ts";
import { NUM_BANDS, type EngineReading, type FeatureFrame } from "../src/audio/types.ts";
import { BAND_SPLIT } from "../src/audio/bandSplit.ts";
import { UNIT_TAILS, type HitShape } from "../src/audio/hitStrength.ts";
import { engineReading } from "./engineReading.ts";

const DT = 1 / 60;

function frame(engine: Partial<EngineReading> | null, bands?: Float32Array): FeatureFrame {
  return {
    time: 0,
    bands: bands ?? new Float32Array(NUM_BANDS),
    energy: 0,
    level: 0.5,
    hats: 0,
    lead: 0,
    onset: false,
    pulseOnset: false,
    bpm: 0,
    onsetPhase: 0,
    engine: engine === null ? null : engineReading(engine),
  };
}

const QUIET = frame({});

describe("band energy", () => {
  it("levels are the engine's own at Smoothing's default and above", () => {
    const energy = createBandEnergy();
    energy.advance(DT, frame({ low: 0.7, mid: 0.4, high: 0.1 }));
    expect(energy.low).toBe(0.7);
    expect(energy.mid).toBe(0.4);
    expect(energy.high).toBe(0.1);
    energy.advance(DT, frame({ low: 0.2 }), Infinity);
    expect(energy.low).toBe(0.2);
  });

  it("below Smoothing's default the level eases to the same destination", () => {
    const slow = createBandEnergy();
    const fast = createBandEnergy();
    for (let i = 0; i < 10; i++) {
      slow.advance(DT, frame({ low: 0.8 }), 0.25);
      fast.advance(DT, frame({ low: 0.8 }), 1);
    }
    expect(slow.low).toBeLessThan(fast.low);
    expect(slow.low).toBeGreaterThan(0);
    for (let i = 0; i < 600; i++) slow.advance(DT, frame({ low: 0.8 }), 0.25);
    expect(slow.low).toBeCloseTo(0.8, 3);
  });

  it("below Smoothing's default a level rises faster than it falls", () => {
    const energy = createBandEnergy();
    for (let i = 0; i < 10; i++) energy.advance(DT, frame({ low: 1 }), 0.5);
    const risen = energy.low;
    for (let i = 0; i < 10; i++) energy.advance(DT, QUIET, 0.5);
    expect(risen - energy.low).toBeLessThan(risen);
  });

  it("a null reading eases levels out and fires nothing", () => {
    const energy = createBandEnergy();
    energy.advance(DT, frame({ low: 0.9, mid: 0.9, high: 0.9 }));
    energy.advance(DT, frame(null));
    expect(energy.low).toBeGreaterThan(0);
    expect(energy.low).toBeLessThan(0.9);
    for (let i = 0; i < 300; i++) {
      energy.advance(DT, frame(null));
      expect(energy.lowOnset || energy.midOnset || energy.highOnset).toBe(false);
    }
    expect(energy.low).toBeLessThan(0.01);
  });

  it("kick, snare and hat hits fire the Bass, Mid and Treble lanes", () => {
    const energy = createBandEnergy();
    energy.advance(DT, frame({ kick: 2 }));
    expect([energy.lowOnset, energy.midOnset, energy.highOnset]).toEqual([true, false, false]);
    energy.advance(DT, frame({ snare: 1.5 }));
    expect([energy.lowOnset, energy.midOnset, energy.highOnset]).toEqual([false, true, false]);
    energy.advance(DT, frame({ hat: 1.2 }));
    expect([energy.lowOnset, energy.midOnset, energy.highOnset]).toEqual([false, false, true]);
    energy.advance(DT, QUIET);
    expect([energy.lowOnset, energy.midOnset, energy.highOnset]).toEqual([false, false, false]);
  });

  it("the silence gate passes a hit only while strength × dimmer is over 1", () => {
    const energy = createBandEnergy();
    energy.advance(DT, frame({ kick: 2 }), 1, 0);
    expect(energy.lowOnset).toBe(false);
    expect(energy.lowDiag.gated).toBe(true);
    energy.advance(DT, frame({ kick: 2 }), 1, 0.6);
    expect(energy.lowOnset).toBe(true);
    expect(energy.lowDiag.gated).toBe(false);
    energy.advance(DT, frame({ kick: 1.5 }), 1, 0.6);
    expect(energy.lowOnset).toBe(false);
    expect(energy.lowDiag.gated).toBe(true);
  });

  it("dimmer = 1 gives the same onsets as omitting it", () => {
    const a = createBandEnergy();
    const b = createBandEnergy();
    for (const k of [0, 1.01, 3, 0, 2]) {
      a.advance(DT, frame({ kick: k }));
      b.advance(DT, frame({ kick: k }), 1, 1);
      expect(b.lowOnset).toBe(a.lowOnset);
    }
  });

  it("diag ratio is the hit's strength, else the surge on its own lane", () => {
    const energy = createBandEnergy();
    energy.advance(DT, frame({ kick: 2.5, surge: 2.7, surgeKind: "kick" }));
    expect(energy.lowDiag.ratio).toBe(2.5);
    energy.advance(DT, frame({ surge: 0.8, surgeKind: "hat" }));
    expect(energy.highDiag.ratio).toBe(0.8);
    expect(energy.lowDiag.ratio).toBe(0);
    expect(energy.midDiag.ratio).toBe(0);
  });

  it("blocked marks the surge's lane only", () => {
    const energy = createBandEnergy();
    energy.advance(DT, frame({ surge: 1.4, surgeKind: "snare", blocked: true }));
    expect(energy.midDiag.blocked).toBe(true);
    expect(energy.lowDiag.blocked).toBe(false);
    expect(energy.highDiag.blocked).toBe(false);
  });

  it("each lane counts its own time since its last onset", () => {
    const energy = createBandEnergy();
    energy.advance(DT, frame({ kick: 2 }));
    energy.advance(DT, frame({ hat: 2 }));
    energy.advance(DT, QUIET);
    expect(energy.lowDiag.sinceOnsetSec).toBeCloseTo(2 * DT, 9);
    expect(energy.highDiag.sinceOnsetSec).toBeCloseTo(DT, 9);
    expect(energy.midDiag.sinceOnsetSec).toBe(Infinity);
  });

  it("with no shape an onset's pulse snaps to 1, then falls at the lane's own rate", () => {
    const energy = createBandEnergy();
    energy.advance(DT, frame({ kick: 2 }));
    expect(energy.lowPulse).toBe(1);
    energy.advance(DT, QUIET);
    expect(energy.lowPulse).toBeCloseTo(Math.exp(-DT * GROUP_TUNING.low.pulseDecayRate), 9);
    for (let i = 0; i < 60; i++) energy.advance(DT, QUIET);
    expect(energy.lowPulse).toBeLessThan(0.1);
  });

  it("with a shape at amount 1, a stronger hit yields a taller pulse", () => {
    const shape: HitShape = { amount: 1, knee: 1, loudness: 0, floor: 0, tail: UNIT_TAILS };
    const weak = createBandEnergy();
    const strong = createBandEnergy();
    weak.advance(DT, frame({ kick: 1.2 }), 1, 1, shape);
    strong.advance(DT, frame({ kick: 3 }), 1, 1, shape);
    expect(weak.lowOnset && strong.lowOnset).toBe(true);
    expect(strong.lowPulse).toBeGreaterThan(weak.lowPulse);
    expect(strong.lowPulse).toBeLessThanOrEqual(1);
    expect(strong.lowHit.strength).toBe(strong.lowPulse);
  });

  it("loudness is the mean of the lane's own bands, which the band split picks", () => {
    const shape: HitShape = { amount: 1, knee: 1, loudness: 1, floor: 0, tail: UNIT_TAILS };
    const above = new Float32Array(NUM_BANDS);
    above.fill(0.9, BAND_SPLIT.lowMid, BAND_SPLIT.midHigh);
    const outside = createBandEnergy();
    outside.advance(DT, frame({ kick: 2 }, above), 1, 1, shape);
    expect(outside.lowHit.loudness).toBe(0);
    const inside = new Float32Array(NUM_BANDS);
    inside.fill(0.9, 0, BAND_SPLIT.lowMid / 2);
    const half = createBandEnergy();
    half.advance(DT, frame({ kick: 2 }, inside), 1, 1, shape);
    expect(half.lowHit.loudness).toBeCloseTo(0.45, 5);
  });

  it("a longer Low tail keeps the low pulse up longer; a shorter one drops it sooner", () => {
    const pulseAfterTenTicks = (low: number, mid = 1): number => {
      const shape: HitShape = { amount: 0, knee: 1, loudness: 0, floor: 0, tail: { ...UNIT_TAILS, low, mid } };
      const energy = createBandEnergy();
      energy.advance(DT, frame({ kick: 2 }), 1, 1, shape);
      for (let i = 0; i < 10; i++) energy.advance(DT, QUIET, 1, 1, shape);
      return energy.lowPulse;
    };
    const plain = pulseAfterTenTicks(1);
    expect(pulseAfterTenTicks(2)).toBeGreaterThan(plain);
    expect(pulseAfterTenTicks(0.5)).toBeLessThan(plain);
    expect(pulseAfterTenTicks(1, 4)).toBe(plain);
  });

  it("a floor above a hit's stand-out yields pulse 0 while onset is still true", () => {
    const shape: HitShape = { amount: 1, knee: 1, loudness: 0, floor: 0.9, tail: UNIT_TAILS };
    const energy = createBandEnergy();
    energy.advance(DT, frame({ kick: 1.1 }), 1, 1, shape);
    expect(energy.lowOnset).toBe(true);
    expect(energy.lowPulse).toBe(0);
  });

  it("stays finite on a zero, NaN or negative step with Smoothing Off", () => {
    for (const bad of [0, Number.NaN, -1]) {
      const energy = createBandEnergy();
      for (let i = 0; i < 5; i++) {
        energy.advance(bad, frame({ low: 0.5, mid: 0.5, high: 0.5, kick: 2, snare: 2, hat: 2 }), Infinity);
        energy.advance(bad, frame(null), Infinity);
        for (const v of [energy.low, energy.mid, energy.high, energy.lowPulse, energy.midPulse, energy.highPulse]) {
          expect(Number.isFinite(v)).toBe(true);
        }
      }
    }
  });
});

describe("level rises on Bass and Treble", () => {
  /** A second of steady levels with music on, so the rise threshold settles. */
  function settled(level: Partial<EngineReading> = {}): ReturnType<typeof createBandEnergy> {
    const energy = createBandEnergy();
    for (let i = 0; i < 60; i++) energy.advance(DT, frame({ music: true, confidence: 0.6, low: 0.2, mid: 0.2, high: 0.2, ...level }));
    return energy;
  }

  it("a jump in the engine's high level fires Treble with no hat named", () => {
    const energy = settled();
    energy.advance(DT, frame({ music: true, confidence: 0.6, low: 0.2, mid: 0.2, high: 0.8, snare: 2 }));
    expect([energy.lowOnset, energy.midOnset, energy.highOnset]).toEqual([false, true, true]);
  });

  it("a jump in the low level fires Bass; one in the mids never fires Mid", () => {
    const energy = settled();
    energy.advance(DT, frame({ music: true, confidence: 0.6, low: 0.8, mid: 0.8, high: 0.2 }));
    expect([energy.lowOnset, energy.midOnset, energy.highOnset]).toEqual([true, false, false]);
  });

  it("without music a jump fires nothing", () => {
    const energy = settled({ music: false });
    energy.advance(DT, frame({ low: 0.8, mid: 0.8, high: 0.8 }));
    expect(energy.lowOnset || energy.midOnset || energy.highOnset).toBe(false);
    expect(energy.highDiag.gated).toBe(false);
  });

  it("a rise and the engine's hit just after it count as one", () => {
    const energy = settled();
    energy.advance(DT, frame({ music: true, confidence: 0.6, low: 0.2, mid: 0.2, high: 0.8 }));
    expect(energy.highOnset).toBe(true);
    energy.advance(DT, frame({ music: true, confidence: 0.6, low: 0.2, mid: 0.2, high: 0.8, hat: 2 }));
    expect(energy.highOnset).toBe(false);
    for (let i = 0; i < 6; i++) energy.advance(DT, frame({ music: true, confidence: 0.6, low: 0.2, mid: 0.2, high: 0.8 }));
    energy.advance(DT, frame({ music: true, confidence: 0.6, low: 0.2, mid: 0.2, high: 0.8, hat: 2 }));
    expect(energy.highOnset).toBe(true);
  });

  it("engine hits close together still each fire", () => {
    const energy = settled();
    energy.advance(DT, frame({ music: true, confidence: 0.6, low: 0.2, mid: 0.2, high: 0.2, kick: 2 }));
    energy.advance(DT, frame({ music: true, confidence: 0.6, low: 0.2, mid: 0.2, high: 0.2, kick: 2 }));
    expect(energy.lowOnset).toBe(true);
  });

  it("the silence gate shuts a rise like any hit", () => {
    const energy = settled();
    energy.advance(DT, frame({ music: true, confidence: 0.6, low: 0.2, mid: 0.2, high: 0.8 }), 1, 0);
    expect(energy.highOnset).toBe(false);
    expect(energy.highDiag.gated).toBe(true);
  });

  it("music held on a faint pulse fires no rises", () => {
    const energy = settled({ confidence: 0.25 });
    energy.advance(DT, frame({ music: true, confidence: 0.25, low: 0.8, mid: 0.2, high: 0.8 }));
    expect(energy.lowOnset || energy.highOnset).toBe(false);
  });
});
