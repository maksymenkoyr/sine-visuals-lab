import { describe, it, expect } from "vitest";
import { advanceCrystal, createCrystalState, flareEnvelope } from "../src/render/scenes/crystal.ts";

// The flare is the scene's whole sync story (see crystal.ts's header): a
// flicker-in ramp, a hold, a release, then a blackout dip. These pin the
// shape's order and that flicker only removes frames from the ramp, never
// adds brightness or touches the hold.
describe("flareEnvelope", () => {
  it("ramps to 1 by the end of the attack, holds, releases, then dips", () => {
    const hold = 0.5;
    expect(flareEnvelope(0, hold, 0, 1).flare).toBe(0);
    expect(flareEnvelope(0.3, hold, 0, 1).flare).toBe(1);
    expect(flareEnvelope(0.3 + hold * 0.5, hold, 0, 1).flare).toBe(1);
    const late = flareEnvelope(0.3 + hold + 1.2, hold, 0, 1).flare;
    expect(late).toBeLessThan(0.05);
    // The dip peaks after the release has mostly run out, and is gone later.
    let best = 0;
    let bestT = 0;
    for (let t = 0; t < 4; t += 0.01) {
      const { dip } = flareEnvelope(t, hold, 0, 1);
      if (dip > best) {
        best = dip;
        bestT = t;
      }
    }
    expect(best).toBeGreaterThan(0.8);
    expect(bestT).toBeGreaterThan(0.3 + hold + 0.3);
    expect(flareEnvelope(bestT, hold, 0, 1).flare).toBeLessThan(0.2);
    expect(flareEnvelope(bestT + 2, hold, 0, 1).dip).toBeLessThan(0.01);
  });

  it("flicker only ever lowers the ramp, and never touches the hold", () => {
    for (let t = 0; t < 1; t += 0.007) {
      const smooth = flareEnvelope(t, 0.4, 0, 7).flare;
      const stutter = flareEnvelope(t, 0.4, 1, 7).flare;
      expect(stutter).toBeLessThanOrEqual(smooth + 1e-9);
      if (t >= 0.3 && t <= 0.7) expect(stutter).toBe(1);
    }
    // Some frame on the way up actually drops out.
    let dropped = false;
    for (let t = 0.03; t < 0.28; t += 0.01) {
      if (flareEnvelope(t, 0.4, 1, 7).flare < flareEnvelope(t, 0.4, 0, 7).flare * 0.5) dropped = true;
    }
    expect(dropped).toBe(true);
  });

  it("is silent before it fires", () => {
    expect(flareEnvelope(Infinity, 0.5, 0.5, 1)).toEqual({ flare: 0, dip: 0 });
    expect(flareEnvelope(-1, 0.5, 0.5, 1)).toEqual({ flare: 0, dip: 0 });
  });
});

describe("advanceCrystal", () => {
  const DT = 1 / 60;
  const opts = { pulse: 0.6, flareAmt: 1, hold: 0.5, flicker: 0, drift: 0.3 };
  const quiet = { dtSec: DT, onset: false, dropOnset: false, barPhase: 0, tempoLock: 1, low: 0 };

  function runBars(st: ReturnType<typeof createCrystalState>, seconds: number, barSec: number, tempoLock = 1) {
    const flares: number[] = [];
    let t = 0;
    while (t < seconds) {
      const barPhase = (t % barSec) / barSec;
      const out = advanceCrystal(st, { ...quiet, barPhase, tempoLock }, opts);
      flares.push(out.flare);
      t += DT;
    }
    return flares;
  }

  it("fires a flare on each bar wrap while the tempo is locked, not before", () => {
    const st = createCrystalState();
    const flares = runBars(st, 4.2, 2.0);
    const firstBright = flares.findIndex((f) => f >= 0.99);
    expect(firstBright).toBeGreaterThan(0);
    // The first wrap is at t = 2 s; the ramp reaches 1 at 2.3 s.
    expect(firstBright * DT).toBeGreaterThan(2.0);
    expect(firstBright * DT).toBeLessThan(2.5);
    expect(Math.max(...flares.slice(0, Math.floor(1.9 / DT)))).toBe(0);
  });

  it("never fires without a lock unless an onset follows a quiet stretch", () => {
    const st = createCrystalState();
    const flares = runBars(st, 6, 2.0, 0);
    expect(Math.max(...flares)).toBe(0);
    const out = advanceCrystal(st, { ...quiet, tempoLock: 0, onset: true }, opts);
    expect(out.flare).toBe(0); // the ramp starts from zero on the firing tick
    expect(st.flareAge).toBe(0);
  });

  it("fires on a drop onset edge with a longer hold, and Flare = 0 disables it", () => {
    const st = createCrystalState();
    advanceCrystal(st, { ...quiet, dropOnset: true }, opts);
    expect(st.flareAge).toBe(0);
    expect(st.flareHold).toBeGreaterThan(opts.hold);
    const off = createCrystalState();
    advanceCrystal(off, { ...quiet, dropOnset: true }, { ...opts, flareAmt: 0 });
    expect(off.flareAge).toBe(Infinity);
  });

  it("swells from zero on a beat and peaks at ~1", () => {
    const st = createCrystalState();
    const env: number[] = [];
    let onset = true;
    const dt = 1 / 120;
    for (let t = 0; t < 1; t += dt) {
      env.push(advanceCrystal(st, { ...quiet, dtSec: dt, onset }, { ...opts, pulse: 1 }).swell);
      onset = false;
    }
    expect(env[0]).toBeLessThan(0.5);
    const peak = Math.max(...env);
    expect(peak).toBeGreaterThan(0.95);
    expect(peak).toBeLessThanOrEqual(1.0001);
    expect(env[env.length - 1]).toBeLessThan(0.05);
  });
});
