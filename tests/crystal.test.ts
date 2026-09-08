import { describe, it, expect } from "vitest";
import { FRAMINGS, advanceCrystal, createCrystalState, cutEveryBeats, layerEnvelope } from "../src/render/scenes/crystal.ts";

// The sequencer is the scene's whole sync story (see crystal.ts's header):
// light layers strobe in, hold and release; cuts reframe on a beat count
// and on drops with a black gap. These pin the envelope's order, that
// flicker only removes frames from the ramp, and what fires what.
describe("layerEnvelope", () => {
  it("ramps to 1 by the end of the attack, holds, then releases", () => {
    expect(layerEnvelope(0, 0.12, 0.5, 0.3, 0, 1)).toBe(0);
    expect(layerEnvelope(0.12, 0.12, 0.5, 0.3, 0, 1)).toBe(1);
    expect(layerEnvelope(0.4, 0.12, 0.5, 0.3, 0, 1)).toBe(1);
    expect(layerEnvelope(0.12 + 0.5 + 1.2, 0.12, 0.5, 0.3, 0, 1)).toBeLessThan(0.05);
  });

  it("flicker only ever lowers the ramp, never touches the hold, and drops some frame", () => {
    let dropped = false;
    for (let t = 0; t < 0.8; t += 0.005) {
      const smooth = layerEnvelope(t, 0.12, 0.4, 0.3, 0, 7);
      const stutter = layerEnvelope(t, 0.12, 0.4, 0.3, 1, 7);
      expect(stutter).toBeLessThanOrEqual(smooth + 1e-9);
      if (t >= 0.12 && t <= 0.52) expect(stutter).toBe(1);
      if (t < 0.11 && stutter < smooth * 0.5) dropped = true;
    }
    expect(dropped).toBe(true);
  });

  it("is silent before it fires", () => {
    expect(layerEnvelope(Infinity, 0.12, 0.5, 0.3, 0.5, 1)).toBe(0);
    expect(layerEnvelope(-1, 0.12, 0.5, 0.3, 0.5, 1)).toBe(0);
  });
});

describe("cutEveryBeats", () => {
  it("maps the Cuts slider to never / 4 / 2 / 1 beats", () => {
    expect(cutEveryBeats(0)).toBe(0);
    expect(cutEveryBeats(0.2)).toBe(4);
    expect(cutEveryBeats(0.5)).toBe(2);
    expect(cutEveryBeats(1)).toBe(1);
  });
});

describe("advanceCrystal", () => {
  const DT = 1 / 60;
  const opts = { cuts: 0.5, pulse: 0.6, flareAmt: 1, hold: 0.4, flicker: 0, drift: 0.3 };
  const quiet = { dtSec: DT, onset: false, dropOnset: false, barPhase: 0, tempoLock: 1, low: 0 };

  it("cuts to a different framing every second beat with a black gap, and never on the off beat", () => {
    const st = createCrystalState();
    const seen = new Set<number>();
    for (let i = 0; i < 8; i++) {
      const before = st.framing;
      const outOdd = advanceCrystal(st, { ...quiet, onset: true }, opts);
      expect(st.framing).toBe(before);
      expect(outOdd.gap).toBe(0);
      for (let k = 0; k < 20; k++) advanceCrystal(st, quiet, opts);
      const outEven = advanceCrystal(st, { ...quiet, onset: true }, opts);
      expect(st.framing).not.toBe(before);
      expect(st.framing).toBeGreaterThanOrEqual(0);
      expect(st.framing).toBeLessThan(FRAMINGS.length);
      expect(outEven.gap).toBe(1);
      seen.add(st.framing);
      for (let k = 0; k < 20; k++) advanceCrystal(st, quiet, opts);
      expect(advanceCrystal(st, quiet, opts).gap).toBe(0);
    }
    expect(seen.size).toBeGreaterThan(2);
  });

  it("Cuts = 0 never reframes on beats; a drop still cuts and lights the fan", () => {
    const st = createCrystalState();
    for (let i = 0; i < 12; i++) advanceCrystal(st, { ...quiet, onset: true }, { ...opts, cuts: 0 });
    expect(st.framing).toBe(0);
    const out = advanceCrystal(st, { ...quiet, dropOnset: true }, { ...opts, cuts: 0 });
    expect(st.framing).not.toBe(0);
    expect(out.gap).toBe(1);
    expect(st.fan.age).toBe(0);
  });

  it("strobes the blob ring on a bar wrap while locked, ramping from zero", () => {
    const st = createCrystalState();
    advanceCrystal(st, { ...quiet, barPhase: 0.9 }, opts);
    const fire = advanceCrystal(st, { ...quiet, barPhase: 0.05 }, opts);
    expect(st.blobs.age).toBe(0);
    expect(fire.blobs).toBe(0);
    let peak = 0;
    for (let t = 0; t < 1; t += DT) peak = Math.max(peak, advanceCrystal(st, quiet, opts).blobs);
    expect(peak).toBe(1);
  });

  it("does not strobe on a bar wrap without a lock, and Flare = 0 lights nothing", () => {
    const st = createCrystalState();
    advanceCrystal(st, { ...quiet, barPhase: 0.9, tempoLock: 0 }, opts);
    advanceCrystal(st, { ...quiet, barPhase: 0.05, tempoLock: 0 }, opts);
    expect(st.blobs.age).toBe(Infinity);
    const off = createCrystalState();
    advanceCrystal(off, { ...quiet, barPhase: 0.9 }, { ...opts, flareAmt: 0 });
    advanceCrystal(off, { ...quiet, barPhase: 0.05, dropOnset: true }, { ...opts, flareAmt: 0 });
    expect(off.blobs.age).toBe(Infinity);
    expect(off.fan.age).toBe(Infinity);
  });

  it("swells from zero on a beat and peaks at ~1", () => {
    const st = createCrystalState();
    const env: number[] = [];
    let onset = true;
    const dt = 1 / 120;
    for (let t = 0; t < 1; t += dt) {
      env.push(advanceCrystal(st, { ...quiet, dtSec: dt, onset }, { ...opts, cuts: 0, pulse: 1 }).swell);
      onset = false;
    }
    expect(env[0]).toBeLessThan(0.5);
    const peak = Math.max(...env);
    expect(peak).toBeGreaterThan(0.95);
    expect(peak).toBeLessThanOrEqual(1.0001);
    expect(env[env.length - 1]).toBeLessThan(0.05);
  });
});
