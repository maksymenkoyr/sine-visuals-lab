import { describe, it, expect } from "vitest";
import {
  KNOB_PX,
  applyEdit,
  arcPath,
  arrowStep,
  formatValue,
  fromUnit,
  hueRailGradient,
  knobDelta,
  quantize,
  randomValue,
  toUnit,
  valuesMatch,
  wheelPoint,
} from "../src/ui/widgets/consoleMath.ts";

const unit = { min: 0, max: 1, step: 0.02 };
const deg = { min: 5, max: 120, step: 1 };

describe("quantize", () => {
  it("clamps into the range and snaps to the step, without float noise", () => {
    expect(quantize(1.4, unit)).toBe(1);
    expect(quantize(-3, unit)).toBe(0);
    expect(quantize(0.31, unit)).toBe(0.32);
    expect(quantize(0.296, unit)).toBe(0.3);
    expect(quantize(0.3000000004, unit)).toBe(0.3);
    expect(quantize(22.4, deg)).toBe(22);
  });

  it("snaps to a fifth of a step when fine", () => {
    expect(quantize(0.305, unit, true)).toBeCloseTo(0.304, 9);
  });

  it("counts steps from min, not from zero", () => {
    expect(quantize(6.4, deg)).toBe(6);
    expect(quantize(119.6, deg)).toBe(120);
  });
});

describe("toUnit / fromUnit", () => {
  it("round-trip across a range that doesn't start at zero", () => {
    for (const v of [5, 22, 60, 120]) expect(fromUnit(toUnit(v, deg), deg)).toBeCloseTo(v, 9);
  });
  it("clamp outside 0..1", () => {
    expect(toUnit(500, deg)).toBe(1);
    expect(fromUnit(-1, deg)).toBe(5);
  });
});

describe("knobDelta", () => {
  it("right and up both turn a knob up; left and down turn it down", () => {
    expect(knobDelta(14, 0, unit, false)).toBeGreaterThan(0);
    expect(knobDelta(0, -14, unit, false)).toBeGreaterThan(0);
    expect(knobDelta(-14, 0, unit, false)).toBeLessThan(0);
    expect(knobDelta(0, 14, unit, false)).toBeLessThan(0);
  });
  it("KNOB_PX of travel sweeps the whole range; Shift is a fifth of it", () => {
    expect(knobDelta(KNOB_PX, 0, deg, false)).toBeCloseTo(115, 9);
    expect(knobDelta(KNOB_PX, 0, deg, true)).toBeCloseTo(23, 9);
  });
});

describe("arrowStep", () => {
  it("is 1% of the range (10% with Shift) but never smaller than the spec's step", () => {
    expect(arrowStep(deg, false)).toBeCloseTo(1.15, 9);
    expect(arrowStep(deg, true)).toBeCloseTo(11.5, 9);
    expect(arrowStep({ min: 0, max: 1, step: 0.05 }, false)).toBe(0.05);
  });
});

describe("applyEdit", () => {
  it("sets one strain and leaves the rest", () => {
    expect(applyEdit([0.2, 0.4, 0.6, 0.8], 1, 0.5, unit, false)).toEqual([0.2, 0.5, 0.6, 0.8]);
  });
  it("linked moves every strain by the same amount, each clamped to its own range", () => {
    expect(applyEdit([0.2, 0.4, 0.6, 0.9], 0, 0.3, unit, true)).toEqual([0.3, 0.5, 0.7, 1]);
  });
});

describe("formatValue", () => {
  it("shows degrees, signed turns as degrees, and plain numbers", () => {
    expect(formatValue(22.4, "degrees", deg)).toBe("22°");
    expect(formatValue(0.25, "turns", { min: -0.5, max: 0.5, step: 0.01 })).toBe("+90°");
    expect(formatValue(-0.5, "turns", { min: -0.5, max: 0.5, step: 0.01 })).toBe("-180°");
    expect(formatValue(0.6, "plain", unit)).toBe("0.60");
    expect(formatValue(7, "plain", { min: 0, max: 10, step: 1 })).toBe("7");
  });
});

describe("hueRailGradient / wheelPoint / arcPath", () => {
  it("the rail's centre stop is the strain's own hue", () => {
    const g = hueRailGradient(0.5, 90, 58, 5);
    expect(g).toContain("hsl(180 90% 58%)");
    expect(g.startsWith("linear-gradient(90deg")).toBe(true);
  });
  it("hue 0 is the top of the wheel and hue 0.25 the right", () => {
    const [x0, y0] = wheelPoint(0, 10);
    expect(x0).toBeCloseTo(0, 9);
    expect(y0).toBeCloseTo(-10, 9);
    const [x1, y1] = wheelPoint(0.25, 10);
    expect(x1).toBeCloseTo(10, 9);
    expect(y1).toBeCloseTo(0, 9);
  });
  it("an arc past half a turn takes the large-arc flag", () => {
    expect(arcPath(17, 17, 13, 0, Math.PI * 1.5)).toContain(" 0 1 1 ");
    expect(arcPath(17, 17, 13, 0, Math.PI / 2)).toContain(" 0 0 1 ");
  });
});

describe("randomValue / valuesMatch (the console's Random and preset pills)", () => {
  const spec = { min: 5, max: 120, step: 1 };
  it("rolls inside the range, on the step, reaching both ends", () => {
    expect(randomValue(spec, () => 0)).toBe(5);
    expect(randomValue(spec, () => 0.9999999)).toBe(120);
    let x = 0.123;
    for (let n = 0; n < 100; n++) {
      x = (x * 9301 + 0.49297) % 1;
      const v = randomValue(spec, () => x);
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThanOrEqual(120);
      expect(Number.isInteger(v)).toBe(true);
    }
  });
  it("matches within half a step, and only at the same length", () => {
    const s = { min: 0, max: 1, step: 0.02 };
    expect(valuesMatch([0.46, 0.2], [0.4516, 0.2], s)).toBe(true);
    expect(valuesMatch([0.48, 0.2], [0.4516, 0.2], s)).toBe(false);
    expect(valuesMatch([0.46], [0.46, 0.2], s)).toBe(false);
  });
});
