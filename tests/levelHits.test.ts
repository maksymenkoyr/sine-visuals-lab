import { describe, expect, it } from "vitest";
import { createLevelHits, LEVEL_HIT_MIN, LEVEL_HIT_REARM } from "../src/render/levelHits.ts";

/** The picker's answer for each tick of `levels`. */
function run(levels: (number | null)[]): (number | null)[] {
  const hits = createLevelHits();
  return levels.map((v) => hits.update(v));
}

describe("levelHits", () => {
  it("reports a peak once, on the tick the level turns down", () => {
    expect(run([0, 0.4, 0.8, 0.5, 0.2, 0])).toEqual([null, null, null, 0.8, null, null]);
  });

  it("leaves out a bump that never reaches LEVEL_HIT_MIN", () => {
    const low = LEVEL_HIT_MIN * 0.9;
    expect(run([0, low, 0]).every((h) => h === null)).toBe(true);
  });

  it("counts the ripples on one hit's fall once, then the next hit", () => {
    const peak = 0.8;
    const above = peak * LEVEL_HIT_REARM + 0.05;
    const below = peak * LEVEL_HIT_REARM - 0.05;
    const out = run([0, peak, above, above + 0.02, above - 0.02, below, 0.7, 0.3]);
    expect(out.filter((h) => h !== null)).toEqual([peak, 0.7]);
  });

  it("holds through a flat top and fires where it falls", () => {
    expect(run([0, 0.6, 0.6, 0.6, 0.3])).toEqual([null, null, null, null, 0.6]);
  });

  it("starts over after a tick with no reading", () => {
    expect(run([0, 0.9, null, 0.5, 0.2]).filter((h) => h !== null)).toEqual([0.5]);
  });
});
