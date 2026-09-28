import { describe, it, expect } from "vitest";
import {
  createCoilState,
  stepCoil,
  rollShape,
  createRng,
  coilPaletteRGB,
  L_BIG,
  L_SMALL,
  RESET_DURATION_SEC,
  type CoilInputs,
} from "../src/render/scenes/coil/coilMotion.ts";

const DT = 1 / 60;

const QUIET: CoilInputs = {
  dt: DT,
  flowRatePerSec: 0.5,
  pushFired: false,
  pushJump: 0,
  breatheFired: false,
  breatheDrop: Math.log(2.5),
  newShapeFired: false,
  spinRateDegPerSec: 10,
};

describe("coil motion — flow", () => {
  it("F advances at the given rate every step", () => {
    let state = createCoilState(1);
    const f0 = state.F;
    for (let i = 0; i < 60; i++) state = stepCoil(state, QUIET);
    // 60 steps at 1/60s and rate 0.5 e-folds/s == 0.5 e-folds.
    expect(state.F - f0).toBeCloseTo(0.5, 2);
  });

  it("a push jumps F by pushJump on the firing frame only", () => {
    let state = createCoilState(2);
    const before = state.F;
    state = stepCoil(state, { ...QUIET, pushFired: true, pushJump: 0.3 });
    expect(state.F - before).toBeGreaterThanOrEqual(0.3);
    const afterPush = state.F;
    state = stepCoil(state, QUIET);
    // No further jump on the next (non-firing) frame — only the steady rate.
    expect(state.F - afterPush).toBeCloseTo(QUIET.flowRatePerSec * DT, 5);
  });

  it("spin accumulates continuously, including during a reset", () => {
    let state = createCoilState(3);
    state = stepCoil(state, { ...QUIET, newShapeFired: true });
    expect(state.resetting).toBe(true);
    const spinBefore = state.spinDeg;
    state = stepCoil(state, QUIET);
    expect(state.spinDeg).toBeCloseTo(spinBefore + QUIET.spinRateDegPerSec * DT, 5);
  });
});

describe("coil motion — reset", () => {
  it("lands at L_SMALL in about RESET_DURATION_SEC and stays uninterruptible", () => {
    let state = createCoilState(4);
    // Let L climb for a while so the reset has real distance to cover.
    for (let i = 0; i < 240; i++) state = stepCoil(state, QUIET);
    expect(state.L).toBeGreaterThan(L_SMALL + 0.2);

    state = stepCoil(state, { ...QUIET, newShapeFired: true });
    expect(state.resetting).toBe(true);
    const shapeAtStart = state.shape;

    const steps = Math.round(RESET_DURATION_SEC / DT);
    for (let i = 0; i < steps - 1; i++) {
      // A second new-shape edge and a breathe edge both arrive mid-reset —
      // neither should do anything (uninterruptible morph, breathe ignored).
      state = stepCoil(state, { ...QUIET, newShapeFired: true, breatheFired: true });
    }
    expect(state.resetting).toBe(true);
    expect(state.shape).not.toBe(shapeAtStart); // still actively morphing

    // Finish the window.
    for (let i = 0; i < 30; i++) {
      state = stepCoil(state, QUIET);
      if (!state.resetting) break;
    }
    expect(state.resetting).toBe(false);
    expect(state.L).toBeCloseTo(L_SMALL, 5);
  });

  it("a breathe edge is ignored while a reset is running", () => {
    let state = createCoilState(5);
    for (let i = 0; i < 120; i++) state = stepCoil(state, QUIET);
    state = stepCoil(state, { ...QUIET, newShapeFired: true });
    const targetAtStart = state.Ltarget;
    state = stepCoil(state, { ...QUIET, breatheFired: true });
    expect(state.Ltarget).toBe(targetAtStart);
  });

  it("breathe drops Ltarget when not resetting", () => {
    let state = createCoilState(6);
    for (let i = 0; i < 60; i++) state = stepCoil(state, QUIET);
    const before = state.Ltarget;
    state = stepCoil(state, { ...QUIET, breatheFired: true });
    expect(state.Ltarget).toBeCloseTo(before - QUIET.breatheDrop, 5);
  });

  it("Ltarget never exceeds L_BIG", () => {
    let state = createCoilState(7);
    for (let i = 0; i < 2000; i++) state = stepCoil(state, QUIET);
    expect(state.Ltarget).toBeLessThanOrEqual(L_BIG + 1e-9);
  });

  it("the morph never jumps: max per-frame L delta stays small through the whole reset", () => {
    let state = createCoilState(8);
    for (let i = 0; i < 300; i++) state = stepCoil(state, QUIET);
    state = stepCoil(state, { ...QUIET, newShapeFired: true });
    let maxDelta = 0;
    let prevL = state.L;
    let prevVerm = state.shape.verm;
    let maxVermDelta = 0;
    const steps = Math.round(RESET_DURATION_SEC / DT) + 5;
    for (let i = 0; i < steps; i++) {
      state = stepCoil(state, QUIET);
      maxDelta = Math.max(maxDelta, Math.abs(state.L - prevL));
      maxVermDelta = Math.max(maxVermDelta, Math.abs(state.shape.verm - prevVerm));
      prevL = state.L;
      prevVerm = state.shape.verm;
      if (!state.resetting) break;
    }
    // A jump bug would move the whole ~2 e-fold span (or the whole verm
    // range) in a single frame; a smooth morph at 60fps over ~0.8s moves a
    // small fraction of that per step.
    expect(maxDelta).toBeLessThan(0.3);
    expect(maxVermDelta).toBeLessThan(0.2);
  });
});

describe("coil motion — rolled shape ranges", () => {
  it("every rolled field stays within the rolled ranges over many rolls", () => {
    const rng = createRng(42);
    for (let i = 0; i < 500; i++) {
      const s = rollShape(rng);
      expect(s.verm).toBeGreaterThanOrEqual(0);
      expect(s.verm).toBeLessThanOrEqual(0.55);
      expect(s.lobeA).toBeGreaterThanOrEqual(0.5);
      expect(s.lobeA).toBeLessThanOrEqual(1);
      expect(s.lobeB).toBeGreaterThanOrEqual(0.25);
      expect(s.lobeB).toBeLessThanOrEqual(0.7);
      expect(s.wobble).toBeGreaterThanOrEqual(-0.3);
      expect(s.wobble).toBeLessThanOrEqual(0.3);
      expect(s.twist).toBeGreaterThanOrEqual(-2.2);
      expect(s.twist).toBeLessThanOrEqual(2.2);
      expect(s.baseAngle).toBeGreaterThanOrEqual(0);
      expect(s.baseAngle).toBeLessThan(Math.PI * 2);
      expect([0, 1]).toContain(s.armsBlend);
    }
  });

  it("is deterministic for a fixed seed", () => {
    const a = rollShape(createRng(99));
    const b = rollShape(createRng(99));
    expect(a).toEqual(b);
  });
});

describe("coil palette ramp", () => {
  it("has a sharp red edge at phase 0", () => {
    const red = coilPaletteRGB(0);
    expect(red[0]).toBeGreaterThan(0.6); // red channel dominant
    expect(red[1]).toBeLessThan(0.3);
    // Just before wrap (phase -> 1) it should be near white, not red —
    // i.e. the edge at 0 is sharp (a discontinuity), not a gradient peak.
    const justBefore = coilPaletteRGB(0.999);
    expect(justBefore[0]).toBeGreaterThan(0.85);
    expect(justBefore[1]).toBeGreaterThan(0.85);
    expect(justBefore[2]).toBeGreaterThan(0.85);
  });

  it("has a sharp blue edge at phase 0.5", () => {
    const blue = coilPaletteRGB(0.5);
    expect(blue[2]).toBeGreaterThan(0.6); // blue channel dominant
    expect(blue[0]).toBeLessThan(0.5);
    const justBefore = coilPaletteRGB(0.499);
    expect(justBefore[0]).toBeGreaterThan(0.85);
    expect(justBefore[1]).toBeGreaterThan(0.85);
    expect(justBefore[2]).toBeGreaterThan(0.85);
  });

  it("wraps", () => {
    expect(coilPaletteRGB(1)).toEqual(coilPaletteRGB(0));
    expect(coilPaletteRGB(1.5)).toEqual(coilPaletteRGB(0.5));
  });
});
