// The generic gate's Smoothness formulas (src/render/gateFormulas.ts):
// at Smoothness 0 every one is the exact window; above it, each softens
// the way its label says.
import { describe, expect, it } from "vitest";
import { GATE_FORMULAS, gateFormulaOut, stepGateFormula, type GateFormulaState } from "../src/render/gateFormulas.ts";

// Min 0.5, Max 1 on a peak of 1.
function state(): GateFormulaState {
  return { peak: 1, line: 0.5, top: 1, open: false, y: Number.NaN, x: Number.NaN };
}

describe("gate formulas", () => {
  it("at Smoothness 0 every formula is the exact window", () => {
    for (const { id } of GATE_FORMULAS) {
      for (const v of [0, 0.4, 0.75, 1]) {
        const g = state();
        stepGateFormula(id, g, v, 0, 1 / 60);
        const exact = v < 0.5 ? 0 : (v - 0.5) / 0.5;
        expect(gateFormulaOut(id, g, v, 0), `${id} at ${v}`).toBeCloseTo(exact, 6);
      }
    }
  });

  it("inside: silence reads 0 and the peak reads full at any Smoothness", () => {
    for (const s of [0.25, 0.5, 1]) {
      expect(gateFormulaOut("inside", state(), 0, s)).toBe(0);
      expect(gateFormulaOut("inside", state(), 1, s)).toBe(1);
    }
  });

  it("past: the old formula reads the peak under full once Smoothness widens past it", () => {
    expect(gateFormulaOut("past", state(), 1, 0.5)).toBeLessThan(1);
  });

  it("sticky: stays open while the reading dips under Min, closes once it drops further", () => {
    const g = state();
    const s = 0.5; // closes at line * (1 - s) = 0.25
    stepGateFormula("sticky", g, 0.6, s, 1 / 60);
    expect(g.open).toBe(true);
    stepGateFormula("sticky", g, 0.4, s, 1 / 60);
    expect(g.open).toBe(true);
    expect(gateFormulaOut("sticky", g, 0.4, s)).toBeGreaterThan(0);
    stepGateFormula("sticky", g, 0.2, s, 1 / 60);
    expect(g.open).toBe(false);
    expect(gateFormulaOut("sticky", g, 0.2, s)).toBe(0);
  });

  it("riseFall: jumps up within a few frames, falls back slowly", () => {
    const g = state();
    stepGateFormula("riseFall", g, 0, 1, 1 / 60);
    for (let i = 0; i < 6; i++) stepGateFormula("riseFall", g, 1, 1, 1 / 60);
    expect(gateFormulaOut("riseFall", g, 1, 1)).toBeGreaterThan(0.9);
    for (let i = 0; i < 6; i++) stepGateFormula("riseFall", g, 0, 1, 1 / 60);
    expect(gateFormulaOut("riseFall", g, 0, 1)).toBeGreaterThan(0.8);
  });

  it("glide: eases both ways", () => {
    const g = state();
    stepGateFormula("glide", g, 0, 1, 1 / 60);
    stepGateFormula("glide", g, 1, 1, 1 / 60);
    const up = gateFormulaOut("glide", g, 1, 1);
    expect(up).toBeGreaterThan(0);
    expect(up).toBeLessThan(0.1);
  });

  it("smoothFirst: a one-frame spike barely reaches the window", () => {
    const g = state();
    stepGateFormula("smoothFirst", g, 0.3, 1, 1 / 60);
    stepGateFormula("smoothFirst", g, 1, 1, 1 / 60);
    expect(gateFormulaOut("smoothFirst", g, 1, 1)).toBe(0);
  });
});
