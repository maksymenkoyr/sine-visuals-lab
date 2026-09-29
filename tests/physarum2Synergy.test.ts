import { describe, it, expect } from "vitest";
import {
  HARMONIES,
  createSynergyTracker,
  nearestHarmony,
  unitTurn,
  wrapTurn,
} from "../src/render/scenes/physarum2Synergy.ts";

const deg = (d: number): number => d / 360;
const BASE = [0, 40, 172, 262].map(deg);

/** Sorted pairwise hue distances — invariant under rotating the whole set and
 *  under which strain sits at which place. */
const distances = (xs: number[]): number[] =>
  xs.flatMap((x, i) => xs.slice(i + 1).map((y) => Math.abs(wrapTurn(x - y)))).sort((a, b) => a - b);

describe("nearestHarmony", () => {
  it("finds an exact square for four hues already 90° apart, at zero cost", () => {
    const fit = nearestHarmony([0, 90, 180, 270].map(deg), -1);
    expect(fit.name).toBe("Square");
    expect(fit.cost).toBeCloseTo(0, 9);
  });

  it("with an anchor, that hue stays exactly where it is", () => {
    const hues = [10, 100, 200, 300].map(deg);
    for (let anchor = 0; anchor < 4; anchor++) {
      const fit = nearestHarmony(hues, anchor);
      expect(unitTurn(fit.target[anchor]!)).toBeCloseTo(unitTurn(hues[anchor]!), 9);
    }
  });

  it("keeps the current harmony unless another fits clearly better", () => {
    const hues = [0, 60, 175, 240].map(deg);
    const first = nearestHarmony(hues, -1);
    expect(nearestHarmony(hues, -1, first.name).name).toBe(first.name);
  });
});

describe("createSynergyTracker", () => {
  it("at synergy 0 returns the stored shifts exactly", () => {
    const tracker = createSynergyTracker(BASE);
    const raw = [0.02, -0.1, 0.3, 0];
    expect(tracker.update(raw, 0).shift).toEqual(raw);
  });

  it("at synergy 1 the four shown hues sit exactly on the chosen harmony", () => {
    const tracker = createSynergyTracker(BASE);
    const { shift, harmony } = tracker.update([0, 0, 0, 0], 1);
    const hues = shift.map((s, k) => unitTurn(BASE[k]! + s));
    const want = distances(HARMONIES[harmony]!.at.map(deg));
    distances(hues).forEach((g, i) => expect(g).toBeCloseTo(want[i]!, 6));
  });

  it("the stain changed last stays where it was put while the others move (anchor)", () => {
    const tracker = createSynergyTracker(BASE);
    tracker.update([0, 0, 0, 0], 1);
    const { shift } = tracker.update([0, 0.1, 0, 0], 1); // only strain 1 changed
    expect(shift[1]).toBeCloseTo(0.1, 9);
  });

  it("several stains changing at once frees the rotation: an exact harmony just rotates", () => {
    const square = [0, 90, 180, 270].map(deg);
    const tracker = createSynergyTracker(square);
    tracker.update([0, 0, 0, 0], 1);
    const { shift } = tracker.update([0.05, 0.05, 0.05, 0.05], 1);
    shift.forEach((v) => expect(v).toBeCloseTo(0.05, 6));
  });
});
