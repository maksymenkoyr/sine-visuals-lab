// Portal's turn-taking and envelopes (src/render/scenes/portal/rotation.ts's
// header): the kick counter hands each kick to the next look, and each look
// falls exponentially from the size of the kick that started it.

import { describe, it, expect } from "vitest";
import {
  FALL_QUARTER_SEC,
  LOOKS,
  advanceLooks,
  blastFlicker,
  createLookState,
  lookAge,
  lookLevel,
} from "../src/render/scenes/portal/rotation.ts";

describe("Portal turn-taking", () => {
  it("lists the three looks in their turn order", () => {
    expect([...LOOKS]).toEqual(["flood", "blast", "accent"]);
  });

  function sequence(turns: number, frames: number): string[] {
    const state = createLookState();
    const out: string[] = [];
    for (let i = 0; i < frames; i++) {
      const look = advanceLooks(state, true, 1, i * 0.5, turns);
      if (look) out.push(look);
    }
    return out;
  }

  it("hands each kick to the next of three looks", () => {
    expect(sequence(3, 6)).toEqual(["flood", "blast", "accent", "flood", "blast", "accent"]);
  });

  it("takes two looks in turn with turns=2", () => {
    expect(sequence(2, 4)).toEqual(["flood", "blast", "flood", "blast"]);
  });

  it("stays on the flood with turns=1", () => {
    expect(sequence(1, 4)).toEqual(["flood", "flood", "flood", "flood"]);
  });

  it("clamps turns to one look below the range and to every look above it", () => {
    expect(sequence(0, 3)).toEqual(["flood", "flood", "flood"]);
    expect(sequence(7, 6)).toEqual(["flood", "blast", "accent", "flood", "blast", "accent"]);
  });

  it("returns null and leaves the count alone on a frame without a kick", () => {
    const state = createLookState();
    expect(advanceLooks(state, false, 1, 0, 3)).toBeNull();
    expect(state.count).toBe(0);
    expect(advanceLooks(state, true, 1, 0, 3)).toBe("flood");
    expect(advanceLooks(state, false, 1, 0.1, 3)).toBeNull();
    expect(state.count).toBe(1);
  });

  it("records each look's kick size and seed", () => {
    const state = createLookState();
    advanceLooks(state, true, 0.8, 1, 3);
    advanceLooks(state, true, 0.4, 2, 3);
    expect(state.size.blast).toBe(0.4);
    expect(state.seed.blast).toBe(1);
    expect(state.start.blast).toBe(2);
  });
});

describe("Portal look envelopes", () => {
  it("is zero before a look has started", () => {
    const state = createLookState();
    expect(lookLevel(state, "flood", 5, 1)).toBe(0);
    expect(lookAge(state, "flood", 5)).toBe(Infinity);
  });

  it("starts at the kick's size", () => {
    const state = createLookState();
    advanceLooks(state, true, 0.9, 2, 1);
    expect(lookLevel(state, "flood", 2, 1)).toBeCloseTo(0.9, 10);
    expect(lookAge(state, "flood", 2.5)).toBeCloseTo(0.5, 10);
  });

  it("falls to a quarter of its height after the quarter time", () => {
    const state = createLookState();
    advanceLooks(state, true, 1, 0, 1);
    expect(lookLevel(state, "flood", FALL_QUARTER_SEC, 1)).toBeCloseTo(0.25, 6);
  });

  it("falls faster at a smaller Afterglow", () => {
    const state = createLookState();
    advanceLooks(state, true, 1, 0, 1);
    expect(lookLevel(state, "flood", (FALL_QUARTER_SEC * 0.5), 0.5)).toBeCloseTo(0.25, 6);
  });
});

describe("Portal blast flicker", () => {
  it("is full once the flicker has run its span", () => {
    expect(blastFlicker(1)).toBe(1);
  });

  it("stays between its floor and full during the span", () => {
    for (let age = 0; age <= 0.44; age += 0.01) {
      const f = blastFlicker(age);
      expect(f).toBeGreaterThanOrEqual(0.55);
      expect(f).toBeLessThanOrEqual(1);
    }
  });
});
