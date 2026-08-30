import { describe, it, expect } from "vitest";
import {
  DOUBLE_TIME_RATIO,
  HALF_TIME_RATIO,
  clipCycleBars,
  clipPhaseAt,
  createBarCounter,
} from "../src/render/scenes/dancers/player.ts";
import type { ClipMeta } from "../src/render/scenes/dancers/clipFormat.ts";

const clip = (beats: number, nativeBpm: number): ClipMeta => ({
  name: "c", family: "test", beats, nativeBpm, frames: beats * 16, energy: 0.5, bigness: 0.5, mirrorOf: -1, source: "",
});

describe("dancers clip clock", () => {
  it("spans the clip's own bars near its native tempo, and goes half/double-time past the ratios", () => {
    const c = clip(8, 120);
    expect(clipCycleBars(c, 120)).toBe(2);
    expect(clipCycleBars(c, 120 * HALF_TIME_RATIO * 0.99)).toBe(2);
    expect(clipCycleBars(c, 120 * HALF_TIME_RATIO * 1.01)).toBe(4);
    expect(clipCycleBars(c, 120 * DOUBLE_TIME_RATIO * 1.01)).toBe(2);
    expect(clipCycleBars(c, 120 * DOUBLE_TIME_RATIO * 0.99)).toBe(1);
    // No tempo yet: the clip's own bars, so it still plays once the bar clock moves.
    expect(clipCycleBars(c, 0)).toBe(2);
  });

  it("is a pure function of bars elapsed — the same bar always lands on the same clip phase", () => {
    const c = clip(8, 120);
    expect(clipPhaseAt(c, 120, 0)).toBe(0);
    expect(clipPhaseAt(c, 120, 1)).toBeCloseTo(0.5, 9);
    expect(clipPhaseAt(c, 120, 2)).toBe(0);
    expect(clipPhaseAt(c, 120, 2.25)).toBeCloseTo(0.125, 9);
    // Half-time: two bars of music per clip bar.
    expect(clipPhaseAt(c, 180, 2)).toBeCloseTo(0.5, 9);
  });

  it("never steps backwards across a bar wrap, however coarse the frames", () => {
    const c = clip(4, 124);
    const bars = createBarCounter();
    let prev = -1;
    let wraps = 0;
    for (let i = 0; i < 400; i++) {
      const barPhase = (i * 0.037) % 1;
      const phase = clipPhaseAt(c, 124, bars.advance(barPhase));
      if (phase < prev) wraps++;
      prev = phase;
    }
    // A 1-bar clip wraps exactly when the bar does: ~14 wraps in 400 × 0.037 bars.
    expect(wraps).toBe(Math.floor(400 * 0.037));
  });

  it("counts bars from the bar phase's wraps", () => {
    const bars = createBarCounter();
    expect(bars.advance(0.2)).toBeCloseTo(0.2);
    expect(bars.advance(0.9)).toBeCloseTo(0.9);
    expect(bars.advance(0.1)).toBeCloseTo(1.1);
    expect(bars.advance(0.05)).toBeCloseTo(2.05);
  });
});
