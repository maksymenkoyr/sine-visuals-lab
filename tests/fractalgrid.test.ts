import { describe, it, expect } from "vitest";
import {
  DIVE_TARGETS,
  EASE_EFOLDS,
  EASE_FLOOR,
  FOLD_SPAN,
  HOLD_SEC,
  MAX_DEPTH,
  MAX_STEP_SEC,
  createDiveState,
  diveIterations,
  diveSpeedShare,
  foldPosition,
  stepDive,
  targetDepth,
  type DiveInputs,
  type DiveState,
} from "../src/render/scenes/fractalgrid/motion.ts";
import { ddAdd, ddMul, referenceOrbit } from "../src/render/scenes/fractalgrid/deep.ts";

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

/** A double as an exact rational n / 2^1100, for checking double-double sums. */
function exact(x: number): bigint {
  const SCALE = 1100;
  if (x === 0) return BigInt(0);
  const [mant, exp] = (() => {
    let e = 0;
    let m = Math.abs(x);
    while (m !== Math.floor(m)) {
      m *= 2;
      e--;
    }
    return [m, e];
  })();
  const v = BigInt(mant) * BigInt(2) ** BigInt(SCALE + exp);
  return x < 0 ? -v : v;
}

describe("fractalgrid double-double", () => {
  it("multiplies and adds exactly to double-double precision", () => {
    const one = { hi: 1 + 2 ** -30, lo: 0 };
    const sq = ddMul(one, one);
    expect(sq.hi).toBe(1 + 2 ** -29);
    expect(sq.lo).toBe(2 ** -60);
    const a = { hi: 0.1, lo: 0 };
    const b = { hi: 0.7, lo: 0 };
    const prod = ddMul(a, b);
    const SCALE = BigInt(2) ** BigInt(1100);
    expect(exact(prod.hi) + exact(prod.lo)).toBe((exact(0.1) * exact(0.7)) / SCALE);
    const sum = ddAdd(a, b);
    expect(exact(sum.hi) + exact(sum.lo)).toBe(exact(0.1) + exact(0.7));
  });
});

describe("fractalgrid reference orbit", () => {
  it("stays at 0 for c = 0 and stops one point past an escape", () => {
    const zero = referenceOrbit({ reHi: 0, reLo: 0, imHi: 0, imLo: 0, itersPerEfold: 1, depth: 1 }, 64);
    expect(zero.length).toBe(64);
    expect(Array.from(zero.points).every((v) => v === 0)).toBe(true);
    // c = 1: 0, 1, 2, 5, 26, 677 — 677² passes the escape radius.
    const one = referenceOrbit({ reHi: 1, reLo: 0, imHi: 0, imLo: 0, itersPerEfold: 1, depth: 1 }, 64);
    expect(Array.from(one.points.filter((_, i) => i % 2 === 0))).toEqual([0, 1, 2, 5, 26, 677]);
    expect(one.length).toBe(5);
  });
});

describe("fractalgrid dive targets", () => {
  it("are spiral centres: their orbits stay bounded", () => {
    for (const t of DIVE_TARGETS) {
      expect(referenceOrbit(t, 50).length, `(${t.reHi}, ${t.imHi})`).toBe(50);
    }
  });

  it("store each coordinate as a true double-double pair", () => {
    for (const t of DIVE_TARGETS) {
      for (const [hi, lo] of [
        [t.reHi, t.reLo],
        [t.imHi, t.imLo],
      ]) {
        expect(hi + lo).toBe(hi);
        expect(Math.abs(lo)).toBeLessThanOrEqual(Math.abs(hi) * 2 ** -52);
      }
    }
  });

  it("keeps every dive within MAX_DEPTH", () => {
    for (let i = 0; i < DIVE_TARGETS.length; i++) {
      expect(targetDepth(i, 1)).toBeLessThanOrEqual(MAX_DEPTH);
      expect(targetDepth(i, 100)).toBe(MAX_DEPTH);
    }
  });
});

describe("fractalgrid dive", () => {
  it("only ever goes in, then holds, then cuts back to the whole set on the next target", () => {
    let s = createDiveState();
    let prev = s.depth;
    const bottom = targetDepth(0, 1);
    while (s.hold === 0) {
      s = stepDive(s, QUIET);
      expect(s.depth).toBeGreaterThanOrEqual(prev);
      prev = s.depth;
    }
    expect(s.depth).toBe(bottom);
    expect(s.targetIndex).toBe(0);
    s = run(s, HOLD_SEC - 0.1);
    expect(s.depth).toBe(bottom);
    while (s.hold > 0) s = stepDive(s, QUIET);
    expect(s.depth).toBe(0);
    expect(s.targetIndex).toBe(1);
  });

  it("moves at rate between the eased ends", () => {
    const s = stepDive({ ...createDiveState(), depth: 10 }, { ...QUIET, rate: 2 });
    expect(s.depth - 10).toBeCloseTo(2 * DT, 12);
    expect(diveSpeedShare(0, 40)).toBe(EASE_FLOOR);
    expect(diveSpeedShare(EASE_EFOLDS, 40)).toBe(1);
    expect(diveSpeedShare(40, 40)).toBe(EASE_FLOOR);
  });

  it("holds still at rate 0 and clamps a long frame gap", () => {
    expect(run({ ...createDiveState(), depth: 5 }, 2, { rate: 0 }).depth).toBe(5);
    const start = { ...createDiveState(), depth: 5 };
    const jumped = stepDive(start, { ...QUIET, dt: 30 });
    const capped = stepDive(start, { ...QUIET, dt: MAX_STEP_SEC });
    expect(jumped.depth).toBeCloseTo(capped.depth, 12);
    expect(stepDive(start, { ...QUIET, dt: -1 }).depth).toBe(5);
  });

  it("gives deeper views more iterations", () => {
    const shallow = diveIterations(160, createDiveState(), 2);
    const deep = diveIterations(160, { ...createDiveState(), depth: 30 }, 2);
    expect(shallow).toBe(160);
    expect(deep).toBeGreaterThan(160 + 30);
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
