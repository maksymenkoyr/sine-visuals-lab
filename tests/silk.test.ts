import { describe, it, expect } from "vitest";
import {
  advanceSilk,
  createSilkState,
  swellAmplitude,
  tailDecayStep,
  stepsToZero,
  fillEchoFlows,
  hash01,
  ECHO_MAX,
  ECHO_FLOW_STRIDE,
  UNLOCKED_BAR_BEATS,
  MIN_BARS_BETWEEN,
  REGIME_TRAVEL_SEC,
  type SilkInputs,
  type SilkOpts,
} from "../src/render/scenes/silk/driver.ts";
import { NOISE_PERIOD } from "../src/render/noiseHash.ts";

// Silk's sequencer is the whole sync story (see driver.ts's header): a
// wandering camera-like zoom, a morph clock, a bar/phrase swell and a
// slowly-travelling regime — nothing here is discrete except the bar/drop
// triggers of those smooth envelopes. These tests pin the 8-bit decay
// math (the "trails freeze above zero" bug this scene works around), the
// envelope shapes, and — above all — that nothing the driver outputs ever
// jumps like a cut.

const OPTS: SilkOpts = {
  strands: 3,
  density: 0.45,
  hole: 0.3,
  foldOpt: 0,
  flow: 1,
  zoom: 0.41,
  hold: 8,
  push: 0.6,
  size: 1,
};

function quiet(dtSec: number): SilkInputs {
  return { dtSec, onset: false, dropOnset: false, barPhase: 0, tempoLock: 0, low: 0, mid: 0, level: 0 };
}

describe("hash01", () => {
  it("is deterministic and stays in [0, 1)", () => {
    for (let k = 0; k < 20; k++) {
      const v = hash01(5, k);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(hash01(5, k)).toBe(v);
    }
  });
});

describe("swellAmplitude", () => {
  it("is bigger on a phrase bar than an ordinary one", () => {
    expect(swellAmplitude(0.6, true)).toBeGreaterThan(swellAmplitude(0.6, false));
    expect(swellAmplitude(0.6, false)).toBeCloseTo(0.6, 6);
  });

  it("never goes negative", () => {
    expect(swellAmplitude(-1, false)).toBe(0);
  });
});

describe("tailDecayStep / stepsToZero — the 8-bit floor", () => {
  it("without a floor, a step near the freeze point gives back the same 8-bit code", () => {
    // decay 0.86 (the scene's own default `echo`), sqrt(0.86) ~= 0.927 —
    // a code of 10/255 decays to 9.28/255, which *rounds back to* 9 or 10
    // depending on exact code, but somewhere below ~14/255 rounding wins
    // outright: prove at least one such fixed point exists with no floor.
    let frozen = -1;
    for (let code = 1; code <= 40; code++) {
      const next = Math.round((code / 255) * Math.sqrt(0.86) * 255);
      if (next === code) {
        frozen = code;
        break;
      }
    }
    expect(frozen).toBeGreaterThan(0);
  });

  it("with the floor, every starting code reaches exactly 0 in a bounded number of steps", () => {
    for (const decay of [0.7, 0.8, 0.86, 0.9, 0.95]) {
      for (const code of [1, 5, 10, 40, 128, 255]) {
        const steps = stepsToZero(code, decay, 1 / 255);
        expect(steps, `decay=${decay} code=${code}`).toBeLessThan(255);
      }
    }
  });

  it("without a floor (floor=0), a small code never reaches 0", () => {
    expect(stepsToZero(1, 0.9, 0, 500)).toBe(Infinity);
  });

  it("tailDecayStep never goes negative", () => {
    expect(tailDecayStep(0.001, 0.9, 1 / 255)).toBe(0);
  });
});

describe("fillEchoFlows", () => {
  it("every value stays within the noise lattice's period", () => {
    const out = new Float32Array(ECHO_MAX * ECHO_FLOW_STRIDE);
    fillEchoFlows(1234.5, 0.03, ECHO_MAX, out);
    for (const v of out) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(NOISE_PERIOD);
    }
  });

  it("is deterministic for the same morph/step", () => {
    const a = new Float32Array(ECHO_MAX * ECHO_FLOW_STRIDE);
    const b = new Float32Array(ECHO_MAX * ECHO_FLOW_STRIDE);
    fillEchoFlows(87.2, 0.02, ECHO_MAX, a);
    fillEchoFlows(87.2, 0.02, ECHO_MAX, b);
    expect([...a]).toEqual([...b]);
  });

  it("only fills the requested echo count, leaving the rest untouched", () => {
    const out = new Float32Array(ECHO_MAX * ECHO_FLOW_STRIDE).fill(-1);
    fillEchoFlows(10, 0.01, 3, out);
    for (let i = 3 * ECHO_FLOW_STRIDE; i < out.length; i++) expect(out[i]).toBe(-1);
  });
});

describe("advanceSilk", () => {
  it("is deterministic: two identical runs give identical output", () => {
    const run = () => {
      const st = createSilkState();
      let last;
      for (let i = 0; i < 300; i++) {
        const onset = i % 15 === 0;
        last = advanceSilk(st, { ...quiet(1 / 60), onset, mid: 0.4, low: 0.3, level: 0.5 }, OPTS);
      }
      return last;
    };
    expect(run()).toEqual(run());
  });

  it("never divides by zero / produces NaN over a long quiet run", () => {
    const st = createSilkState();
    for (let i = 0; i < 2000; i++) {
      const out = advanceSilk(st, quiet(1 / 60), OPTS);
      for (const v of Object.values(out)) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("hole stays within its clamped range", () => {
    const st = createSilkState();
    for (let i = 0; i < 1000; i++) {
      const onset = i % 7 === 0;
      const dropOnset = i % 240 === 0;
      const out = advanceSilk(st, { ...quiet(1 / 60), onset, dropOnset, mid: 0.6, low: 0.5, level: 0.6 }, OPTS);
      expect(out.hole).toBeGreaterThanOrEqual(0);
      expect(out.hole).toBeLessThanOrEqual(0.9);
    }
  });

  it("does not change regime before MIN_BARS_BETWEEN, even on a drop", () => {
    const st = createSilkState();
    // Fire a bar (via the unlocked fallback: every UNLOCKED_BAR_BEATS-th
    // onset) AND a drop on every single one of them — the fastest possible
    // trigger rate. regimeIdx should still advance at most once per
    // MIN_BARS_BETWEEN bars, never every bar.
    let barsSinceLastAdvance = 0;
    let prevIdx = st.regimeIdx;
    for (let bar = 1; bar <= MIN_BARS_BETWEEN * 4; bar++) {
      for (let b = 0; b < UNLOCKED_BAR_BEATS; b++) {
        // One onset per beat (UNLOCKED_BAR_BEATS of them make one "bar"
        // under the unlocked fallback — see driver.ts's barLike); the drop
        // edge lands on the bar's last beat so it fires exactly once per bar.
        const dropOnset = b === UNLOCKED_BAR_BEATS - 1;
        advanceSilk(st, { ...quiet(0.05), onset: true, dropOnset, mid: 0.3, low: 0.3, level: 0.4 }, OPTS);
      }
      barsSinceLastAdvance++;
      if (st.regimeIdx !== prevIdx) {
        expect(barsSinceLastAdvance).toBeGreaterThanOrEqual(MIN_BARS_BETWEEN);
        barsSinceLastAdvance = 0;
        prevIdx = st.regimeIdx;
      }
    }
    // With a drop firing on literally every bar, it must have changed
    // regime at least once — otherwise this test would trivially pass.
    expect(st.regimeIdx).toBeGreaterThan(0);
  });

  it("changes regime at `hold` bars even with no drop at all", () => {
    const st = createSilkState();
    const opts: SilkOpts = { ...OPTS, hold: 5 };
    for (let bar = 1; bar <= 5; bar++) {
      for (let b = 0; b < UNLOCKED_BAR_BEATS; b++) {
        advanceSilk(st, { ...quiet(0.05), onset: true, mid: 0.3, low: 0.3, level: 0.4 }, opts);
      }
    }
    expect(st.regimeIdx).toBeGreaterThanOrEqual(1);
  });

  it("no eased output jumps more than a travel-sized step in one frame, even at a large dt", () => {
    const st = createSilkState();
    let prev = advanceSilk(st, quiet(1 / 60), OPTS);
    const bigDt = 0.33; // a stalled/backgrounded tab resuming
    // Generous bound: smootherstep's steepest slope is 1.875/REGIME_TRAVEL_SEC;
    // allow a wide margin (6x) so this pins "no cut", not an exact figure.
    const maxSlope = 1.875 / REGIME_TRAVEL_SEC;
    for (let i = 0; i < 200; i++) {
      const onset = i % 3 === 0;
      const dropOnset = i % 37 === 0;
      const input: SilkInputs = { dtSec: bigDt, onset, dropOnset, barPhase: (i % 4) / 4, tempoLock: 0, low: 0.4, mid: 0.5, level: 0.5 };
      const out = advanceSilk(st, input, OPTS);
      const holeRange = 0.6 * 1.7; // opts.hole max * the widest holeMul span
      expect(Math.abs(out.hole - prev.hole)).toBeLessThanOrEqual(holeRange * maxSlope * bigDt * 6 + 1e-6);
      expect(Math.abs(out.foldMix - prev.foldMix)).toBeLessThanOrEqual(1 * maxSlope * bigDt * 6 + 1e-6);
      prev = out;
    }
  });

  it("brightness (brightS) never jumps on an onset — no hit flash", () => {
    const st = createSilkState();
    const before = advanceSilk(st, { ...quiet(1 / 60), mid: 0.2, low: 0.2, level: 0.2 }, OPTS);
    const withOnset = advanceSilk(st, { ...quiet(1 / 60), onset: true, mid: 0.2, low: 0.2, level: 0.2 }, OPTS);
    // Same mid, same dt, an onset fires: brightS should barely move — it
    // only ever tracks midS, which itself didn't move this tick.
    expect(Math.abs(withOnset.brightS - before.brightS)).toBeLessThan(0.01);
  });
});
