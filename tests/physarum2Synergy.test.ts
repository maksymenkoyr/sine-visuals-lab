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
    const again = nearestHarmony(hues, -1, first);
    expect(again.name).toBe(first.name);
    expect(again.place).toBe(first.place);
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

  it("dragging one stain round the wheel never snaps the other three", () => {
    // A full turn in three seconds at 60 fps (6° a frame). Before the glide,
    // the other hues jumped 30–120° in a single frame whenever another
    // harmony or ordering won.
    const dt = 1 / 60;
    for (const drag of [0, 2]) {
      const tracker = createSynergyTracker(BASE);
      const raw = [0, 0, 0, 0];
      let prev = tracker.update(raw, 1, dt).shift.map((s, k) => BASE[k]! + s);
      let worst = 0;
      for (let f = 1; f <= 180; f++) {
        raw[drag] = deg(2 * f);
        const r = tracker.update(raw, 1, dt);
        const cur = r.shift.map((s, k) => BASE[k]! + s);
        expect(cur[drag]).toBeCloseTo(BASE[drag]! + raw[drag]!, 9); // the dragged stain stays put
        cur.forEach((c, k) => {
          if (k !== drag) worst = Math.max(worst, Math.abs(wrapTurn(c - prev[k]!)) * 360);
        });
        prev = cur;
      }
      expect(worst).toBeLessThan(22);
    }
  });

  it("settles on the fitted pull once the drag stops", () => {
    const tracker = createSynergyTracker(BASE);
    tracker.update([0, 0, 0, 0], 1, 1 / 60);
    const at = (dt?: number) => tracker.update([0, 0.3, 0, 0], 1, dt).shift;
    at(1 / 60);
    let eased = at(1 / 60);
    for (let f = 0; f < 120; f++) eased = at(1 / 60);
    const direct = createSynergyTracker(BASE);
    direct.update([0, 0, 0, 0], 1);
    const want = direct.update([0, 0.3, 0, 0], 1).shift;
    eased.forEach((v, k) => expect(v).toBeCloseTo(want[k]!, 4));
  });
});
