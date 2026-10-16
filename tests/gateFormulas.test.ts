// Smoothness's formulas (src/render/gateWindow.ts GATE_FORMULAS, read by
// windowReading and stepped by advanceGateTracker): at Smoothness 0 every one
// is the exact window; above it, each softens the way its label says.
import { describe, expect, it } from "vitest";
import { advanceGateTracker, createGateTracker, GATE_FORMULAS, windowReading, type GateFormula, type GateTrackerState } from "../src/render/gateWindow.ts";

const DT = 1 / 60;

// A tracker that has learned a peak of 1 and sits at a resting level of 0.
function learned(): GateTrackerState {
  return { ...createGateTracker(), init: true, floor: 0, peak: 1 };
}

// One tick at reading `v`, with Min 0.5 and Max 1; returns what the setting gets.
function step(tr: GateTrackerState, v: number, f: GateFormula, s: number): number {
  advanceGateTracker(tr, DT, v, 0.5, 1, f, s);
  return windowReading(tr, v, s, f);
}

describe("gate formulas", () => {
  it("at Smoothness 0 every formula is the exact window", () => {
    for (const { id } of GATE_FORMULAS) {
      for (const v of [0, 0.4, 0.75, 1]) {
        const tr = learned();
        const out = step(tr, v, id, 0);
        const exact = v < tr.line ? 0 : (tr.peak * Math.min(1, (v - tr.line) / (tr.top - tr.line)));
        expect(out, `${id} at ${v}`).toBeCloseTo(exact, 6);
      }
    }
  });

  it("inside (the default): silence reads 0 and the peak reads full at any Smoothness", () => {
    for (const s of [0.25, 0.5, 1]) {
      expect(step(learned(), 0, "inside", s)).toBe(0);
      const tr = learned();
      advanceGateTracker(tr, DT, 1, 0.5, 1);
      expect(windowReading(tr, tr.peak, s)).toBeCloseTo(tr.peak, 6);
    }
  });

  it("past: the old formula reads a new high under full once Smoothness widens past it", () => {
    const tr = learned();
    expect(step(tr, 1, "past", 0.5)).toBeLessThan(tr.peak);
  });

  it("sticky: stays open while the reading dips under Min, closes once it drops further", () => {
    const tr = learned();
    const s = 0.5; // closes halfway down to 0
    step(tr, 0.6, "sticky", s);
    expect(tr.open).toBe(true);
    expect(step(tr, 0.4, "sticky", s)).toBeGreaterThan(0);
    expect(tr.open).toBe(true);
    expect(step(tr, 0.2, "sticky", s)).toBe(0);
    expect(tr.open).toBe(false);
  });

  it("riseFall: jumps up within a few frames, falls back slowly", () => {
    const tr = learned();
    step(tr, 0, "riseFall", 1);
    let out = 0;
    for (let i = 0; i < 6; i++) out = step(tr, 1, "riseFall", 1);
    expect(out).toBeGreaterThan(0.9);
    for (let i = 0; i < 6; i++) out = step(tr, 0, "riseFall", 1);
    expect(out).toBeGreaterThan(0.8);
  });

  it("glide: eases up instead of jumping", () => {
    const tr = learned();
    step(tr, 0, "glide", 1);
    const up = step(tr, 1, "glide", 1);
    expect(up).toBeGreaterThan(0);
    expect(up).toBeLessThan(0.1);
  });

  it("smoothFirst: a one-frame spike barely reaches the window", () => {
    const tr = learned();
    step(tr, 0.3, "smoothFirst", 1);
    expect(step(tr, 1, "smoothFirst", 1)).toBe(0);
  });
});
