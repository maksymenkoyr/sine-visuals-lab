import { describe, expect, it } from "vitest";
import {
  MAP_MARGIN,
  MAP_MIN_GAP,
  blendValues,
  nearestTwo,
  placeLooks,
  type MapItem,
  type MapPoint,
} from "../src/render/lookMap.ts";

const measured = (id: string, busy: number, bright: number): MapItem => ({ id, sceneId: "s", busy, bright });
const unmeasured = (id: string): MapItem => ({ id, sceneId: "s", busy: null, bright: null });

function minGap(points: readonly MapPoint[]): number {
  let m = Infinity;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      m = Math.min(m, Math.hypot(points[i]!.x - points[j]!.x, points[i]!.y - points[j]!.y));
    }
  }
  return m;
}

const byId = (points: readonly MapPoint[], id: string): MapPoint => points.find((p) => p.id === id)!;

describe("placeLooks", () => {
  it("keeps measured pads in order: busier to the right, brighter higher up", () => {
    const pts = placeLooks([measured("calm", 0.1, 0.1), measured("busy", 0.9, 0.2), measured("bright", 0.2, 0.9)]);
    const calm = byId(pts, "calm");
    const busy = byId(pts, "busy");
    const bright = byId(pts, "bright");
    expect(busy.x).toBeGreaterThan(calm.x);
    expect(bright.y).toBeGreaterThan(calm.y);
    expect(bright.y).toBeGreaterThan(busy.y);
    expect(bright.x).toBeLessThan(busy.x);
  });

  it("keeps a spread-out set in order after the nudge", () => {
    const grid: MapItem[] = [];
    for (const busy of [0.1, 0.5, 0.9]) for (const bright of [0.1, 0.5, 0.9]) grid.push(measured(`${busy}-${bright}`, busy, bright));
    const pts = placeLooks(grid);
    for (const [busy, bright] of [[0.1, 0.1], [0.5, 0.1], [0.9, 0.9]] as const) {
      const p = byId(pts, `${busy}-${bright}`);
      const ref = byId(pts, "0.1-0.1");
      if (busy > 0.1) expect(p.x).toBeGreaterThan(ref.x);
      if (bright > 0.1) expect(p.y).toBeGreaterThan(ref.y);
    }
  });

  it("keeps no two places closer than the minimum gap when room allows", () => {
    const stacked = Array.from({ length: 9 }, (_, i) => measured(`p${i}`, 0.5, 0.5));
    const pts = placeLooks(stacked);
    expect(pts).toHaveLength(9);
    expect(minGap(pts)).toBeGreaterThanOrEqual(MAP_MIN_GAP - 1e-6);
  });

  it("keeps every place inside the margin", () => {
    const items = [measured("a", 0, 0), measured("b", 1, 1), measured("c", 1, 0), unmeasured("d"), unmeasured("e")];
    for (const p of placeLooks(items)) {
      expect(p.x).toBeGreaterThanOrEqual(MAP_MARGIN - 1e-9);
      expect(p.x).toBeLessThanOrEqual(1 - MAP_MARGIN + 1e-9);
      expect(p.y).toBeGreaterThanOrEqual(MAP_MARGIN - 1e-9);
      expect(p.y).toBeLessThanOrEqual(1 - MAP_MARGIN + 1e-9);
    }
  });

  it("spreads unmeasured pads apart and keeps their ids in list order", () => {
    const pts = placeLooks([unmeasured("x"), unmeasured("y"), unmeasured("z"), unmeasured("w")]);
    expect(pts.map((p) => p.id)).toEqual(["x", "y", "z", "w"]);
    expect(minGap(pts)).toBeGreaterThan(0.2);
  });

  it("returns nothing for no pads", () => {
    expect(placeLooks([])).toEqual([]);
  });
});

describe("nearestTwo", () => {
  const pts: MapPoint[] = [
    { id: "a", x: 0.2, y: 0.5 },
    { id: "b", x: 0.8, y: 0.5 },
    { id: "c", x: 0.95, y: 0.95 },
  ];

  it("gives share 0 at a place", () => {
    expect(nearestTwo(pts, { x: 0.2, y: 0.5 })).toEqual({ a: "a", b: "b", share: 0 });
  });

  it("gives share 0.5 halfway between the two nearest", () => {
    const r = nearestTwo([pts[0]!, pts[1]!], { x: 0.5, y: 0.5 });
    expect(r?.a).toBe("a");
    expect(r?.b).toBe("b");
    expect(r?.share).toBeCloseTo(0.5, 9);
  });

  it("names the nearest first and the second one's share", () => {
    const r = nearestTwo(pts, { x: 0.3, y: 0.5 });
    expect(r?.a).toBe("a");
    expect(r?.b).toBe("b");
    expect(r?.share).toBeCloseTo(0.1 / 0.6, 9);
  });

  it("has no second place with one pad, and nothing with none", () => {
    expect(nearestTwo([pts[0]!], { x: 0, y: 0 })).toEqual({ a: "a", b: null, share: 0 });
    expect(nearestTwo([], { x: 0, y: 0 })).toBeNull();
  });
});

describe("blendValues", () => {
  const a = { sensitivity: 0.2, glow: 1 };
  const b = { sensitivity: 0.6, hue: 0.4 };

  it("returns a at share 0 and b at share 0.5 for the shared keys", () => {
    expect(blendValues(a, b, 0)).toEqual({ sensitivity: 0.2, glow: 1, hue: 0.4 });
    expect(blendValues(a, b, 0.5)).toEqual({ sensitivity: 0.4, glow: 1, hue: 0.4 });
  });

  it("keeps a key that only one side has at that side's value", () => {
    const out = blendValues({ only: 0.3 }, { other: 0.7 }, 0.5);
    expect(out).toEqual({ only: 0.3, other: 0.7 });
  });

  it("never mutates its inputs", () => {
    const aCopy = JSON.stringify(a);
    const bCopy = JSON.stringify(b);
    blendValues(a, b, 0.3);
    expect(JSON.stringify(a)).toBe(aCopy);
    expect(JSON.stringify(b)).toBe(bCopy);
  });
});
