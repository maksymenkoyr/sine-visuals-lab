import { describe, it, expect } from "vitest";
import {
  advanceSilk,
  createSilkState,
  swellAmplitude,
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
// triggers of those smooth envelopes. These tests pin the
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

  it("web fields (Round 3) stay within their regime-picked ranges", () => {
    const st = createSilkState();
    for (let i = 0; i < 1000; i++) {
      const onset = i % 7 === 0;
      const dropOnset = i % 240 === 0;
      const out = advanceSilk(st, { ...quiet(1 / 60), onset, dropOnset, mid: 0.6, low: 0.5, level: 0.6 }, OPTS);
      expect(out.webShape).toBeGreaterThanOrEqual(0);
      expect(out.webShape).toBeLessThanOrEqual(1);
      // pickRegime draws webR from [0.35, 0.85) then advanceSilk scales by
      // opts.size (1 here) — a lerp of two in-range values stays in range,
      // so this should never need the driver's wider [0.05, 1.3] safety clamp.
      expect(out.webR).toBeGreaterThanOrEqual(0.35 * OPTS.size);
      expect(out.webR).toBeLessThanOrEqual(0.85 * OPTS.size);
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
      // Round 3's web fields travel the same way (lerp/lerpAngle eased by
      // the same smootherstep) — pin the same "no cut" bound on them.
      const webRRange = 0.5 * OPTS.size; // pickRegime's [0.35, 0.85) span
      expect(Math.abs(out.webR - prev.webR)).toBeLessThanOrEqual(webRRange * maxSlope * bigDt * 6 + 1e-6);
      expect(Math.abs(out.webShape - prev.webShape)).toBeLessThanOrEqual(1 * maxSlope * bigDt * 6 + 1e-6);
      // webTilt is an angle: a plain difference would falsely flag a "jump"
      // right when it wraps through 0/2π during an otherwise-smooth travel
      // (see driver.ts's lerpAngle), so this compares the shortest-way delta.
      let tiltDelta = (out.webTilt - prev.webTilt) % (Math.PI * 2);
      if (tiltDelta > Math.PI) tiltDelta -= Math.PI * 2;
      else if (tiltDelta < -Math.PI) tiltDelta += Math.PI * 2;
      expect(Math.abs(tiltDelta)).toBeLessThanOrEqual(Math.PI * maxSlope * bigDt * 6 + 1e-6);
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

  it("a Fold pin takes effect without waiting for a regime change", () => {
    const st = createSilkState();
    // No beats, no drops: the regime can never change on its own here.
    for (let i = 0; i < 30; i++) advanceSilk(st, quiet(1 / 60), OPTS);
    const idx = st.regimeIdx;
    for (const [foldOpt, want] of [[2, 1], [1, 0], [2, 1]] as const) {
      const opts = { ...OPTS, foldOpt };
      let prev = advanceSilk(st, quiet(1 / 60), opts).foldMix;
      const dir = Math.sign(want - prev);
      const steps = Math.ceil(((REGIME_TRAVEL_SEC * 2 + 0.1) * 60));
      for (let i = 0; i < steps; i++) {
        const fm = advanceSilk(st, quiet(1 / 60), opts).foldMix;
        // Glides (no jump bigger than a smootherstep step) and never reverses.
        expect(Math.abs(fm - prev)).toBeLessThan(0.1);
        expect((fm - prev) * dir).toBeGreaterThanOrEqual(-1e-9);
        prev = fm;
      }
      expect(prev).toBeCloseTo(want, 6);
    }
    expect(st.regimeIdx).toBe(idx);
  });
});
