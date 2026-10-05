import { describe, it, expect } from "vitest";
import {
  DIVE_TARGETS,
  FOLD_SPAN,
  MAX_DEPTH,
  MAX_STEP_SEC,
  cardioidRoot,
  createDiveState,
  diveLogZoom,
  foldPosition,
  stepDive,
  targetDepth,
  twoBulbRoot,
  type DiveInputs,
  type DiveState,
} from "../src/render/scenes/fractalgrid/motion.ts";

const DT = 1 / 60;

const QUIET: DiveInputs = {
  dt: DT,
  rate: 1,
  depthScale: 1,
  stepCells: 0,
  foldSteps: 0,
  dropFired: false,
  invertHoldSec: 8,
};

function run(state: DiveState, seconds: number, inputs: Partial<DiveInputs> = {}): DiveState {
  let s = state;
  for (let t = 0; t < seconds; t += DT) s = stepDive(s, { ...QUIET, ...inputs });
  return s;
}

describe("fractalgrid dive targets", () => {
  it("names the familiar roots", () => {
    expect(cardioidRoot(0, 1, 1).x).toBeCloseTo(0.25, 12);
    expect(cardioidRoot(0, 1, 1).y).toBeCloseTo(0, 12);
    expect(cardioidRoot(1, 2, 1).x).toBeCloseTo(-0.75, 12);
    expect(twoBulbRoot(1, 2, 1).x).toBeCloseTo(-1.25, 12);
  });

  it("puts every target on a bulb's root, where the cycle's multiplier has size 1", () => {
    for (const t of DIVE_TARGETS) {
      // Main cardioid: the fixed point's multiplier is 1 − √(1 − 4c).
      const ax = 1 - 4 * t.x;
      const ay = -4 * t.y;
      const r = Math.hypot(ax, ay);
      const sqrtRe = Math.sqrt((r + ax) / 2);
      const sqrtIm = Math.sign(ay) * Math.sqrt((r - ax) / 2);
      const cardioid = Math.hypot(1 - sqrtRe, -sqrtIm);
      // Period-2 bulb: the 2-cycle's multiplier is 4(c + 1).
      const twoBulb = 4 * Math.hypot(t.x + 1, t.y);
      const onRoot = Math.abs(cardioid - 1) < 1e-9 || Math.abs(twoBulb - 1) < 1e-9;
      expect(onRoot, `(${t.x}, ${t.y})`).toBe(true);
    }
  });

  it("keeps every target's depth within what 32-bit floats can draw", () => {
    for (let i = 0; i < DIVE_TARGETS.length; i++) {
      expect(targetDepth(i, 1)).toBeLessThanOrEqual(MAX_DEPTH);
      expect(targetDepth(i, 100)).toBe(MAX_DEPTH);
    }
  });
});

describe("fractalgrid dive", () => {
  it("starts at the whole set and goes target depth deep halfway through", () => {
    const depth = targetDepth(0, 1);
    expect(diveLogZoom(0, depth)).toBeCloseTo(0, 12);
    expect(diveLogZoom(0.5, depth)).toBeCloseTo(-depth, 12);
    expect(diveLogZoom(1, depth)).toBeCloseTo(0, 12);
  });

  it("makes rate the average zoom speed in e-folds per second", () => {
    const rate = 1.3;
    let s = createDiveState();
    let travelled = 0;
    let seconds = 0;
    let prev = diveLogZoom(s.phase, targetDepth(s.targetIndex, 1));
    while (s.targetIndex === 0) {
      s = stepDive(s, { ...QUIET, rate });
      const z = diveLogZoom(s.phase, targetDepth(0, 1));
      if (s.targetIndex === 0) travelled += Math.abs(z - prev);
      prev = z;
      seconds += DT;
    }
    expect(travelled / seconds).toBeCloseTo(rate, 1);
  });

  it("moves on to the next target when a dive ends back at the whole set", () => {
    const fullDive = (2 * targetDepth(0, 1)) / QUIET.rate;
    const s = run(createDiveState(), fullDive + 0.1);
    expect(s.targetIndex).toBe(1);
    expect(s.phase).toBeLessThan(0.05);
  });

  it("holds still at rate 0 and clamps a long frame gap", () => {
    expect(run(createDiveState(), 2, { rate: 0 }).phase).toBe(0);
    const jumped = stepDive(createDiveState(), { ...QUIET, dt: 30 });
    const capped = stepDive(createDiveState(), { ...QUIET, dt: MAX_STEP_SEC });
    expect(jumped.phase).toBeCloseTo(capped.phase, 12);
    expect(stepDive(createDiveState(), { ...QUIET, dt: -1 }).phase).toBe(0);
  });
});

describe("fractalgrid grid step", () => {
  it("eases to the stepped offset and keeps it within one cell", () => {
    let s = stepDive(createDiveState(), { ...QUIET, stepCells: 0.25 });
    expect(s.grid).toBeGreaterThan(0);
    expect(s.grid).toBeLessThan(0.25);
    s = run(s, 1);
    expect(s.grid).toBeCloseTo(0.25, 4);
    for (let i = 0; i < 9; i++) s = run(stepDive(s, { ...QUIET, stepCells: 0.4 }), 0.5);
    expect(s.grid).toBeGreaterThanOrEqual(0);
    expect(s.grid).toBeLessThan(1);
    expect(s.grid).toBeCloseTo((0.25 + 9 * 0.4) % 1, 2);
  });
});

describe("fractalgrid fold", () => {
  it("ping-pongs without a jump", () => {
    expect(foldPosition(0)).toBe(0);
    expect(foldPosition(FOLD_SPAN)).toBe(FOLD_SPAN);
    expect(foldPosition(FOLD_SPAN + 3)).toBe(FOLD_SPAN - 3);
    expect(foldPosition(2 * FOLD_SPAN)).toBe(0);
    for (let x = 0; x < 4 * FOLD_SPAN; x += 0.01) {
      expect(Math.abs(foldPosition(x + 0.01) - foldPosition(x))).toBeLessThan(0.0101);
    }
  });

  it("stays bounded over many folds and keeps its place on the ping-pong", () => {
    let s = createDiveState();
    let total = 0;
    for (let i = 0; i < 100; i++) {
      s = run(stepDive(s, { ...QUIET, foldSteps: 1 }), 2);
      total += 1;
    }
    expect(s.fold).toBeGreaterThanOrEqual(0);
    expect(s.fold).toBeLessThan(2 * FOLD_SPAN);
    expect(foldPosition(s.fold)).toBeCloseTo(foldPosition(total), 2);
  });
});

describe("fractalgrid drop inversion", () => {
  it("inverts while held, then eases back", () => {
    let s = stepDive(createDiveState(), { ...QUIET, dropFired: true, invertHoldSec: 2 });
    s = run(s, 1);
    expect(s.invert).toBeGreaterThan(0.99);
    s = run(s, 2);
    expect(s.invert).toBeLessThan(0.01);
  });
});
