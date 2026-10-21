// Ember's swell and kick lift (src/render/scenes/ember/motion.ts's header):
// the swell follows the measured shape and never jumps, its period is whole
// bars at the held tempo, and a kick's lift arrives over its attack and falls
// back to rest.

import { describe, it, expect } from "vitest";
import { REST_BPM, SWELL_SHAPE, advanceLift, createLiftState, swellAt, swellRate } from "../src/render/scenes/ember/motion.ts";

describe("Ember swell", () => {
  it("passes through every measured step and wraps without a jump", () => {
    SWELL_SHAPE.forEach((v, i) => expect(swellAt(i / SWELL_SHAPE.length)).toBeCloseTo(v, 9));
    expect(swellAt(1 - 1e-9)).toBeCloseTo(swellAt(0), 6);
    expect(swellAt(2.25)).toBeCloseTo(swellAt(0.25), 9);
    let worst = 0;
    for (let i = 0; i < 1000; i++) worst = Math.max(worst, Math.abs(swellAt((i + 1) / 1000) - swellAt(i / 1000)));
    expect(worst).toBeLessThan(0.02);
  });

  it("spans the bars at the held tempo, and the rest tempo with no lock", () => {
    expect(swellRate(4, 140, 1)).toBeCloseTo(140 / 60 / 16, 9);
    expect(swellRate(4, 140, 0)).toBeCloseTo(REST_BPM / 60 / 16, 9);
    expect(swellRate(4, 0, 1)).toBeCloseTo(REST_BPM / 60 / 16, 9);
    expect(swellRate(8, 140, 1)).toBeCloseTo(swellRate(4, 140, 1) / 2, 9);
  });
});

describe("Ember kick lift", () => {
  it("climbs to the kick over the attack, then falls back to rest", () => {
    const s = createLiftState();
    expect(advanceLift(s, 1 / 60, 1)).toBeLessThan(0.5);
    let peak = 0;
    for (let i = 0; i < 30; i++) peak = Math.max(peak, advanceLift(s, 1 / 60, 0));
    expect(peak).toBeGreaterThan(0.6);
    expect(peak).toBeLessThanOrEqual(1);
    for (let i = 0; i < 600; i++) advanceLift(s, 1 / 60, 0);
    expect(s.level).toBeLessThan(1e-3);
  });

  it("stays at rest with no kicks", () => {
    const s = createLiftState();
    for (let i = 0; i < 100; i++) advanceLift(s, 1 / 60, 0);
    expect(s.level).toBe(0);
  });
});
