import { describe, it, expect } from "vitest";
import {
  linearScale,
  logScale,
  autoLinearScale,
  layoutTicks,
  nearestTick,
  snap,
  pointerSpeed,
  nextPrecisionLevel,
  precisionValue,
  lens,
  dragStep,
  MIN_GAP_PX,
  HOLD_MS,
  SLOW_PX_S,
  FAST_PX_S,
  LEASH_PX,
  type PlacedTick,
} from "../src/ui/sliderScale.ts";

// The old createControlRow formulas (deviceMenu.ts, before this file existed)
// — logScale must reproduce these bit-for-bit on a 0..100 slider position.
function oldPosToValue(pos: number, min: number, max: number, zeroAtMin: boolean): number {
  if (zeroAtMin && pos <= 0) return 0;
  const loPos = zeroAtMin ? 1 : 0;
  const t = (pos - loPos) / (100 - loPos);
  return min * Math.pow(max / min, t);
}
function oldValueToPos(value: number, min: number, max: number, zeroAtMin: boolean): number {
  if (zeroAtMin && value <= 0) return 0;
  const loPos = zeroAtMin ? 1 : 0;
  const t = Math.log(value / min) / Math.log(max / min);
  return loPos + t * (100 - loPos);
}

describe("logScale", () => {
  it("toPos/toVal round-trip a value", () => {
    const scale = logScale({ min: 0.1, max: 10 });
    for (const v of [0.1, 0.3, 1, 3, 7, 10]) {
      const p = scale.toPos(v);
      expect(scale.toVal(p)).toBeCloseTo(v, 6);
    }
  });

  it("matches the old posToValue/valueToPos formulas exactly, with and without zeroAtMin", () => {
    for (const zeroAtMin of [false, true]) {
      const min = 0.1;
      const max = 10;
      const scale = logScale({ min, max, zeroAtMin });
      for (const value of [min, 0.3, 1, 3, max]) {
        const oldPos = oldValueToPos(value, min, max, zeroAtMin);
        expect(scale.toPos(value)).toBeCloseTo(oldPos / 100, 9);
      }
      for (const pos of [zeroAtMin ? 1 : 0, 5, 50, 99, 100]) {
        const oldValue = oldPosToValue(pos, min, max, zeroAtMin);
        expect(scale.toVal(pos / 100)).toBeCloseTo(oldValue, 6);
      }
    }
  });

  it("zeroAtMin carves out an exact Off stop below the curve", () => {
    const scale = logScale({ min: 0.1, max: 10, zeroAtMin: true });
    expect(scale.min).toBe(0);
    expect(scale.fillFrom).toBe(0);
    expect(scale.toVal(0)).toBe(0);
    // Half the carved-out gap (position < 0.5/100) is still 0.
    expect(scale.toVal(0.004)).toBe(0);
    // The rest of the gap (0.5/100..1/100) rounds up to the real minimum.
    expect(scale.toVal(0.007)).toBe(0.1);
    expect(scale.toVal(0.01)).toBeCloseTo(0.1, 6);
    const zeroTick = scale.ticks.find((t) => t.v === 0);
    expect(zeroTick?.detent).toBe(true);
  });

  it("carries requested detents as level-2 detent ticks", () => {
    const scale = logScale({ min: 0.1, max: 10, detents: [1] });
    const tick = scale.ticks.find((t) => t.v === 1);
    expect(tick?.detent).toBe(true);
    expect(tick?.level).toBe(2);
  });
});

describe("linearScale", () => {
  it("round-trips value <-> position", () => {
    const scale = linearScale({ min: 0, max: 2, fine: 0.02, mid: 0.1, major: 0.5, detents: [1] });
    for (const v of [0, 0.5, 1, 1.7, 2]) {
      expect(scale.toVal(scale.toPos(v))).toBeCloseTo(v, 9);
    }
  });

  it("marks both ends level 2 and keeps a requested detent even off-grid", () => {
    const scale = linearScale({ min: 0, max: 1, fine: 0.1, mid: 0.25, major: 0.5, detents: [0.55] });
    expect(scale.ticks[0]?.level).toBe(2);
    expect(scale.ticks[scale.ticks.length - 1]?.level).toBe(2);
    const detent = scale.ticks.find((t) => Math.abs(t.v - 0.55) < 1e-9);
    expect(detent?.detent).toBe(true);
  });
});

describe("autoLinearScale grid nesting", () => {
  const cases: { min: number; max: number; step?: number; defaultValue: number }[] = [
    { min: 0, max: 1, defaultValue: 0.5 },
    { min: 0, max: 2, defaultValue: 1 },
    { min: 0.1, max: 4, defaultValue: 1 },
    { min: 1, max: 64, step: 1, defaultValue: 32 },
    { min: 0, max: 360, defaultValue: 0 },
  ];

  it("nests mid on the fine grid and major on the mid grid", () => {
    for (const c of cases) {
      const scale = autoLinearScale(c);
      const fineTicks = scale.ticks.filter((t) => t.level === 0 || t.level === 1 || t.level === 2);
      // Every mid/major tick's value must land on a fine-grid point, and
      // every major tick on a mid-grid point — i.e. the grids nest.
      const fineStep = fineTicks.length > 1 ? fineTicks[1].v - fineTicks[0].v : 1;
      for (const t of scale.ticks) {
        const kFine = (t.v - scale.min) / fineStep;
        expect(Math.abs(kFine - Math.round(kFine))).toBeLessThan(1e-3);
      }
    }
  });

  it("a declared step of 1 or more makes the scale discrete with fine === mid === step", () => {
    const scale = autoLinearScale({ min: 1, max: 64, step: 1, defaultValue: 32 });
    expect(scale.discrete).toBe(true);
    const diffs = new Set<number>();
    for (let i = 1; i < scale.ticks.length; i++) {
      diffs.add(+(scale.ticks[i].v - scale.ticks[i - 1].v).toFixed(6));
    }
    expect(diffs.size).toBe(1);
    expect([...diffs][0]).toBeCloseTo(1, 6);
  });

  it("a sub-1 step stays continuous and never coarsens the ~1% fine grid", () => {
    for (const step of [0.001, 0.05]) {
      const scale = autoLinearScale({ min: 0, max: 1, step, defaultValue: 0.5 });
      expect(scale.discrete).toBe(false);
      expect(scale.ticks.filter((t) => t.v > 0 && t.v < 0.05).length).toBe(4); // 0.01..0.04
    }
  });

  it("keeps defaultValue as a detent even off the fine grid", () => {
    const scale = autoLinearScale({ min: 0, max: 360, defaultValue: 0 });
    const detent = scale.ticks.find((t) => t.detent);
    expect(detent?.v).toBe(0);
  });
});

describe("layoutTicks thinning", () => {
  it("keeps every detent and respects MIN_GAP_PX for the level it thins", () => {
    // A very narrow track with a fine grid far denser than it can show.
    const scale = linearScale({ min: 0, max: 1, fine: 0.001, mid: 0.1, major: 0.5, detents: [0.5] });
    const placed = layoutTicks(scale, 0, 40);
    const detent = placed.find((t) => t.detent);
    expect(detent).toBeDefined();
    for (let i = 1; i < placed.length; i++) {
      const a = placed[i - 1];
      const b = placed[i];
      const minGap = Math.min(MIN_GAP_PX[a.level], MIN_GAP_PX[b.level]);
      if (!a.detent && !b.detent) expect(b.x - a.x).toBeGreaterThanOrEqual(minGap - 1e-6);
    }
  });

  it("stays sorted by track position", () => {
    const scale = logScale({ min: 0.1, max: 10, zeroAtMin: true, detents: [1] });
    const placed = layoutTicks(scale, 8, 300);
    for (let i = 1; i < placed.length; i++) expect(placed[i].x).toBeGreaterThanOrEqual(placed[i - 1].x);
  });
});

// A small helper scale for the snap/precision tests below: ticks at every
// integer 0..10, majors every 5, one detent at 5.
function testTicks(): PlacedTick[] {
  const scale = linearScale({ min: 0, max: 10, fine: 1, mid: 1, major: 5, detents: [5] });
  return layoutTicks(scale, 0, 200); // 20px per unit
}

describe("snap", () => {
  it("a detent wins within reach even against a closer plain tick's own reach boundary", () => {
    const ticks = testTicks();
    const detent = ticks.find((t) => t.detent)!;
    // Just inside the detent's own pull, but not the exact tick position.
    const x = detent.x + 10;
    const result = snap(x, ticks, null, false, false);
    expect(result?.detent).toBe(true);
  });

  it("a latched tick holds past its own reach up to HOLD_ON, per snap's own doc comment", () => {
    // min=0,max=20 with a major every 5 keeps v=5 a level-2 tick that's
    // neither an end nor the detent (v=10) — unambiguously "a mid/major tick".
    const scale = linearScale({ min: 0, max: 20, fine: 1, mid: 2, major: 5, detents: [10] });
    const ticks = layoutTicks(scale, 0, 400); // 20px per unit
    const major = ticks.find((t) => t.v === 5)!;
    expect(major.level).toBe(2);
    expect(major.detent).toBeUndefined();
    // pull(major) = MAGNETISM * TICK_PULL_PX * LEVEL_PULL[2] = 1.1 * 4 * 2.2 = 9.68;
    // HOLD_ON extends that to 14.52 px — land just inside that, past the plain
    // 9.68 px reach a fresh (non-latched) snap at this same x would need.
    const nearBoundary = major.x + 12;
    expect(snap(nearBoundary, ticks, null, false, false)).not.toBe(major);
    const held = snap(nearBoundary, ticks, major, false, false);
    expect(held).toBe(major);
  });

  it("discrete ignores bypass and always returns the nearest tick", () => {
    const ticks = testTicks();
    const between = ticks[3].x + (ticks[4].x - ticks[3].x) / 2 + 1;
    const result = snap(between, ticks, null, true, true);
    expect(result).toBe(nearestTick(between, ticks));
  });

  it("bypass on a continuous row returns null (a free position)", () => {
    const ticks = testTicks();
    const between = ticks[3].x + (ticks[4].x - ticks[3].x) / 2;
    expect(snap(between, ticks, null, false, true)).toBeNull();
  });
});

describe("precision", () => {
  it("pointerSpeed needs at least 2 samples in the window", () => {
    expect(pointerSpeed([], 1000)).toBe(0);
    expect(pointerSpeed([{ t: 1000, x: 0 }], 1000)).toBe(0);
  });

  it("nextPrecisionLevel rises after holding still past each HOLD_MS threshold", () => {
    let level: 0 | 1 | 2 = 0;
    let slowMs = 0;
    const dt = 50;
    const slowSpeed = SLOW_PX_S - 1;
    let elapsed = 0;
    while (elapsed < HOLD_MS[2] + dt) {
      const result = nextPrecisionLevel(level, slowSpeed, slowMs, dt);
      level = result.level;
      slowMs = result.slowMs;
      elapsed += dt;
    }
    expect(level).toBe(2);
  });

  it("a fast move drops the level straight back to 0", () => {
    const result = nextPrecisionLevel(2, FAST_PX_S + 1, HOLD_MS[2] + 100, 16);
    expect(result.level).toBe(0);
    expect(result.slowMs).toBe(0);
  });

  it("never decreases from a merely medium-speed move", () => {
    const result = nextPrecisionLevel(2, (SLOW_PX_S + FAST_PX_S) / 2, 0, 16);
    expect(result.level).toBe(2);
  });
});

describe("precisionValue", () => {
  it("quantizes to sub equal steps between the bracketing ticks", () => {
    const ticks = testTicks();
    const a = ticks[3];
    const b = ticks[4];
    const mid = (a.x + b.x) / 2;
    expect(precisionValue(mid, ticks, 2)).toBeCloseTo((a.v + b.v) / 2, 6);
    expect(precisionValue(a.x, ticks, 10)).toBeCloseTo(a.v, 6);
    expect(precisionValue(b.x - 0.001, ticks, 10)).toBeCloseTo(b.v, 1);
  });
});

describe("lens", () => {
  it("is the identity at mag 1", () => {
    for (const x of [0, 40, 100, -50]) {
      const result = lens(x, 50, 1);
      expect(result.x).toBeCloseTo(x, 9);
      expect(result.fade).toBe(1);
    }
  });

  it("is continuous across the core boundary", () => {
    const mag = 5;
    const center = 100;
    const core = 60 / mag; // LENS_CORE_PX / mag
    const justInside = lens(center + core - 0.001, center, mag);
    const justOutside = lens(center + core + 0.001, center, mag);
    expect(justInside.x).toBeCloseTo(justOutside.x, 1);
  });

  it("is continuous across the edge boundary (fades back to the plain scale)", () => {
    const mag = 5;
    const center = 100;
    const justInside = lens(center + 96 - 0.001, center, mag); // LENS_EDGE_PX
    const justOutside = lens(center + 96 + 0.001, center, mag);
    expect(justInside.x).toBeCloseTo(justOutside.x, 0);
    expect(justOutside.fade).toBe(1);
  });
});

describe("dragStep", () => {
  it("never leashes the thumb further than LEASH_PX from the pointer, in precision", () => {
    let pos = { u: 0, grabOffset: 0 };
    let fx = 0;
    for (let i = 0; i < 50; i++) {
      fx += 3; // the pointer keeps moving; the thumb only follows at 1/sub
      pos = dragStep(pos, fx, 3, 10, 0, 1000, 0);
      expect(Math.abs(pos.u - fx)).toBeLessThanOrEqual(LEASH_PX + 1e-6);
    }
  });

  it("at sub 1 (normal speed) the thumb tracks the pointer directly with no offset", () => {
    let pos = { u: 10, grabOffset: 0 };
    pos = dragStep(pos, 20, 10, 1, 0, 1000, 0);
    expect(pos.u).toBeCloseTo(20, 6);
    expect(pos.grabOffset).toBeCloseTo(0, 6);
  });

  it("clamps to the track bounds", () => {
    const pos = dragStep({ u: 0, grabOffset: 0 }, -50, -10, 1, 0, 100, 0);
    expect(pos.u).toBe(0);
  });
});
