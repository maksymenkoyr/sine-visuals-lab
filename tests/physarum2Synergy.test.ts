import { describe, it, expect } from "vitest";
import {
  HARMONIES,
  createSynergyTracker,
  nearestHarmony,
  paletteStains,
  shuffledStains,
  shuffleOrder,
  stainForHue,
  unitTurn,
  wrapTurn,
} from "../src/render/scenes/physarum2Synergy.ts";

const deg = (d: number): number => d / 360;
const BASE = [0, 40, 172, 262].map(deg);

/** Sorted pairwise hue distances — invariant under rotating the whole set and
 *  under which strain sits at which place. */
const distances = (xs: number[]): number[] =>
  xs.flatMap((x, i) => xs.slice(i + 1).map((y) => Math.abs(wrapTurn(x - y)))).sort((a, b) => a - b);

describe("wrapTurn", () => {
  it("returns the shortest signed distance in [-0.5, 0.5): half a turn comes out negative", () => {
    expect(wrapTurn(0.75)).toBeCloseTo(-0.25, 9);
    expect(wrapTurn(-0.75)).toBeCloseTo(0.25, 9);
    expect(wrapTurn(0.5)).toBe(-0.5);
    expect(wrapTurn(-0.5)).toBe(-0.5);
  });
});

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

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function rnd(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("colour actions (Shuffle / New palette)", () => {
  it("stainForHue lands on the hue, inside the Stain slider's range", () => {
    for (const [hue, base] of [[0.9, 0.1], [0.1, 0.9], [0.3, 0.3], [0.55, 0.0]] as const) {
      const s = stainForHue(hue, base);
      expect(s).toBeGreaterThanOrEqual(-0.5);
      expect(s).toBeLessThan(0.5);
      expect(Math.abs(wrapTurn(base + s - hue))).toBeLessThan(1e-9);
    }
  });

  it("shuffleOrder is always a permutation that moves something", () => {
    const rnd = mulberry32(5);
    for (let n = 0; n < 200; n++) {
      const order = shuffleOrder(4, rnd);
      expect([...order].sort()).toEqual([0, 1, 2, 3]);
      expect(order.some((v, i) => v !== i)).toBe(true);
    }
    expect(shuffleOrder(1, rnd)).toEqual([0]);
  });

  it("shuffledStains gives strain k the hue strain order[k] showed", () => {
    const shown = [0.05, 0.3, 0.55, 0.8];
    const order = [2, 0, 3, 1];
    const stains = shuffledStains(shown, BASE, order);
    for (let k = 0; k < 4; k++) expect(Math.abs(wrapTurn(BASE[k]! + stains[k]! - shown[order[k]!]!))).toBeLessThan(1e-9);
  });

  it("paletteStains always lands the four hues exactly on a harmony", () => {
    const rnd = mulberry32(9);
    for (let n = 0; n < 50; n++) {
      const stains = paletteStains(BASE, rnd);
      const hues = stains.map((s, k) => BASE[k]! + s);
      for (const s of stains) {
        expect(s).toBeGreaterThanOrEqual(-0.5);
        expect(s).toBeLessThan(0.5);
      }
      expect(nearestHarmony(hues, -1).cost).toBeLessThan(1e-12);
    }
  });

  it("New palette can deal every harmony", () => {
    const rnd = mulberry32(10);
    const seen = new Set<string>();
    for (let n = 0; n < 300; n++) seen.add(nearestHarmony(paletteStains(BASE, rnd).map((s, k) => BASE[k]! + s), -1).name);
    // Analogous and Square etc. are distinct shapes; a fit can only name one
    // that is really there, so every harmony should show up.
    expect(seen.size).toBe(HARMONIES.length);
  });
});
