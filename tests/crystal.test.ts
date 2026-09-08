import { describe, it, expect } from "vitest";
import {
  advanceCrystal,
  createCrystalState,
  layerEnvelope,
  hash01,
  ZOOM_MID,
  ZOOM_AMP,
  type CrystalInputs,
  type CrystalOpts,
} from "../src/render/scenes/crystal.ts";

// The sequencer is the scene's whole sync story (see crystal.ts's header):
// a wandering camera, a morph clock and light layers that fade up and
// down — nothing discrete anywhere except the beat/bar/drop triggers of
// those smooth envelopes. These tests pin the envelope's shape and, above
// all, that nothing the driver outputs ever jumps like a cut.
describe("hash01", () => {
  it("is deterministic and stays in [0, 1)", () => {
    for (let k = 0; k < 20; k++) {
      const v = hash01(3, k);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(hash01(3, k)).toBe(v);
    }
  });
});

describe("layerEnvelope", () => {
  it("ramps to 1 by the end of the attack, holds, then releases", () => {
    expect(layerEnvelope(0, 0.12, 0.5, 0.3)).toBe(0);
    expect(layerEnvelope(0.12, 0.12, 0.5, 0.3)).toBe(1);
    expect(layerEnvelope(0.4, 0.12, 0.5, 0.3)).toBe(1);
    expect(layerEnvelope(0.12 + 0.5 + 1.2, 0.12, 0.5, 0.3)).toBeLessThan(0.05);
  });

  it("is silent before it fires", () => {
    expect(layerEnvelope(Infinity, 0.12, 0.5, 0.3)).toBe(0);
    expect(layerEnvelope(-1, 0.12, 0.5, 0.3)).toBe(0);
  });
});

describe("advanceCrystal", () => {
  const DT = 1 / 60;
  const opts: CrystalOpts = { zoom: 0.4, pulse: 0.6, flareAmt: 1, hold: 0.35, drift: 0.3 };
  const quiet: CrystalInputs = {
    dtSec: DT,
    onset: false,
    dropOnset: false,
    barPhase: 0,
    tempoLock: 1,
    low: 0,
    sectionIntensity: 0,
  };

  it("a drop lights the fan, ramping from zero", () => {
    const st = createCrystalState();
    const out = advanceCrystal(st, { ...quiet, dropOnset: true }, opts);
    expect(st.fan.age).toBe(0);
    expect(out.fan).toBe(0);
    let peak = 0;
    for (let t = 0; t < 1; t += DT) peak = Math.max(peak, advanceCrystal(st, quiet, opts).fan);
    expect(peak).toBeGreaterThan(0.95);
  });

  it("lights the blob ring on a bar wrap while locked, ramping from zero", () => {
    const st = createCrystalState();
    advanceCrystal(st, { ...quiet, barPhase: 0.9 }, opts);
    const fire = advanceCrystal(st, { ...quiet, barPhase: 0.05 }, opts);
    expect(st.blobs.age).toBe(0);
    expect(fire.blobs).toBe(0);
    let peak = 0;
    for (let t = 0; t < 1; t += DT) peak = Math.max(peak, advanceCrystal(st, quiet, opts).blobs);
    expect(peak).toBeGreaterThan(0.95);
  });

  it("does not light the blob ring on an unlocked bar wrap, and Flare = 0 lights nothing", () => {
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
      env.push(advanceCrystal(st, { ...quiet, dtSec: dt, onset }, { ...opts, pulse: 1 }).swell);
      onset = false;
    }
    expect(env[0]).toBeLessThan(0.5);
    const peak = Math.max(...env);
    expect(peak).toBeGreaterThan(0.95);
    expect(peak).toBeLessThanOrEqual(1.0001);
    expect(env[env.length - 1]).toBeLessThan(0.05);
  });

  it("keeps the camera's zoom within its travel bounds", () => {
    const st = createCrystalState();
    for (let i = 0; i < 1200; i++) {
      const onset = i % 23 === 0;
      const out = advanceCrystal(st, { ...quiet, onset, sectionIntensity: 0.5 }, opts);
      expect(out.logZoom).toBeGreaterThanOrEqual(ZOOM_MID - ZOOM_AMP - 1e-6);
      expect(out.logZoom).toBeLessThanOrEqual(ZOOM_MID + ZOOM_AMP + 1e-6);
    }
  });

  it("a beat's zoom surge lands the frame after it fires, never the tick it fires on", () => {
    const stA = createCrystalState();
    const stB = createCrystalState();
    for (let i = 0; i < 10; i++) {
      advanceCrystal(stA, quiet, opts);
      advanceCrystal(stB, quiet, opts);
    }
    const outFireTick = advanceCrystal(stA, { ...quiet, onset: true }, opts);
    const outQuietTick = advanceCrystal(stB, quiet, opts);
    // Firing the onset must not change how far the camera travelled this
    // frame — only the *next* frame's travel speeds up.
    expect(outFireTick.logZoom).toBeCloseTo(outQuietTick.logZoom, 9);
    expect(stA.zoomVel).toBeGreaterThan(0);
    const deltaA = Math.abs(advanceCrystal(stA, quiet, opts).logZoom - outFireTick.logZoom);
    const deltaB = Math.abs(advanceCrystal(stB, quiet, opts).logZoom - outQuietTick.logZoom);
    expect(deltaA).toBeGreaterThan(deltaB);
  });

  it("mood alternates which look a beat favours: over 16 s, red and edges each peak near 1 at different times", () => {
    const st = createCrystalState();
    const dt = 1 / 60;
    const lowHold: CrystalOpts = { ...opts, hold: 0.1 };
    let redPeak = 0;
    let redPeakT = -1;
    let edgesPeak = 0;
    let edgesPeakT = -1;
    let nextOnsetT = 0;
    for (let t = 0; t < 16; t += dt) {
      const onset = t >= nextOnsetT;
      if (onset) nextOnsetT += 2.0;
      const out = advanceCrystal(st, { ...quiet, dtSec: dt, onset }, lowHold);
      if (out.red > redPeak) {
        redPeak = out.red;
        redPeakT = t;
      }
      if (out.edges > edgesPeak) {
        edgesPeak = out.edges;
        edgesPeakT = t;
      }
    }
    expect(redPeak).toBeGreaterThan(0.9);
    expect(edgesPeak).toBeGreaterThan(0.9);
    expect(Math.abs(redPeakT - edgesPeakT)).toBeGreaterThan(2);
  });

  it("stays continuous over 12 s: no output ever jumps like a cut, only smooth motion", () => {
    const st = createCrystalState();
    const dt = 1 / 60;
    const totalFrames = Math.round(12 / dt);
    const onsetEvery = Math.round(0.47 / dt);
    let barPhase = 0;
    let onsetCount = 0;
    let prev = advanceCrystal(
      st,
      { dtSec: dt, onset: false, dropOnset: false, barPhase, tempoLock: 1, low: 0.2, sectionIntensity: 0.3 },
      opts,
    );
    for (let i = 1; i < totalFrames; i++) {
      const t = i * dt;
      const onset = i % onsetEvery === 0;
      if (onset) {
        onsetCount++;
        barPhase = onsetCount % 4 === 0 ? 0.02 : barPhase + 0.25;
      }
      const dropOnset = t >= 5 && t < 5 + dt * 3;
      const out = advanceCrystal(st, { dtSec: dt, onset, dropOnset, barPhase, tempoLock: 1, low: 0.2, sectionIntensity: 0.3 }, opts);
      expect(Math.abs(out.blobs - prev.blobs)).toBeLessThan(0.2);
      expect(Math.abs(out.fan - prev.fan)).toBeLessThan(0.2);
      expect(Math.abs(out.red - prev.red)).toBeLessThan(0.2);
      expect(Math.abs(out.edges - prev.edges)).toBeLessThan(0.2);
      expect(Math.abs(out.logZoom - prev.logZoom)).toBeLessThan(0.05);
      expect(Math.abs(out.pan[0] - prev.pan[0])).toBeLessThan(0.02);
      expect(Math.abs(out.pan[1] - prev.pan[1])).toBeLessThan(0.02);
      prev = out;
    }
  });
});
