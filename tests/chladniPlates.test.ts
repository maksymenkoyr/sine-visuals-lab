import { describe, it, expect } from "vitest";
import {
  ATLAS_SIDE,
  CLAMPED,
  DECAGON,
  HEXAGON,
  K_FUNDAMENTAL,
  K_TOP,
  MODE_TABLE,
  PLATE_FIGURES,
  PLATE_RATIO_MIN,
  PLATE_SHAPES,
  ROUND,
  ROUND_POISSON,
  SQUARE,
  TRIANGLE,
  bakePlate,
  besselI,
  besselJOrders,
  plateArea,
  plateFieldAt,
  plateGauge,
  plateModeTable,
  plateRatio,
  plateOutline,
  respawnPoint,
  roundModes,
  roundRadial,
  sampleBake,
  spreadPick,
  type PlateBake,
} from "../src/render/scenes/chladniPlates.ts";
import { DECAGON_MODES, HEXAGON_MODES, TRIANGLE_MODES } from "../src/render/scenes/chladniPlateModes.ts";
import { modeFrequencyHz, FUNDAMENTAL_HZ_SMALL } from "../src/render/scenes/chladni.ts";

const BAKED = [ROUND, HEXAGON, TRIANGLE, DECAGON, CLAMPED];
const MEMBRANES = [HEXAGON, TRIANGLE, DECAGON];

/** A seeded uniform stream, so a failure reproduces. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Points inside `shape`, at least `margin` (in gauge units) from its rim. */
function insidePoints(shape: number, count: number, margin = 0.02, seed = 7): [number, number][] {
  const o = plateOutline(shape);
  const r = rng(seed);
  const out: [number, number][] = [];
  while (out.length < count) {
    const x = r() * 2 - 1;
    const y = r() * 2 - 1;
    if (plateGauge(o, x, y) < 1 - margin) out.push([x, y]);
  }
  return out;
}

const bakes = new Map<number, PlateBake>();
function baked(shape: number): PlateBake {
  let b = bakes.get(shape);
  if (!b) {
    b = bakePlate(shape);
    bakes.set(shape, b);
  }
  return b;
}

describe("plate tables", () => {
  it("the square's table is the one the scene always had", () => {
    expect(plateModeTable(SQUARE)).toBe(MODE_TABLE);
    for (const m of MODE_TABLE) {
      expect(m.ratio).toBe((m.n * m.n + m.m * m.m) / 5);
      expect(m.cells).toBe(m.m);
      expect(m.layer).toBe(-1);
    }
    expect(modeFrequencyHz(MODE_TABLE[0], 0)).toBe(FUNDAMENTAL_HZ_SMALL);
  });

  it.each(BAKED.map((s) => [PLATE_SHAPES[s], s]))("%s: sorted by frequency, as many figures as the square, over the square's range", (_, shape) => {
    const t = plateModeTable(shape);
    const squareTop = MODE_TABLE[MODE_TABLE.length - 1].ratio;
    for (let i = 1; i < t.length; i++) expect(t[i].ratio).toBeGreaterThanOrEqual(t[i - 1].ratio);
    expect(t.length).toBe(PLATE_FIGURES);
    // On the square's scale: starts near its (1, 2) at ratio 1, and reaches
    // about as fine a figure as its top pair, never past it.
    expect(t[0].ratio).toBeGreaterThanOrEqual(PLATE_RATIO_MIN);
    expect(t[0].ratio).toBeLessThan(1.4);
    expect(t[t.length - 1].ratio).toBeGreaterThan(0.9 * squareTop);
    expect(t[t.length - 1].ratio).toBeLessThanOrEqual(squareTop * (1 + 1e-9));
    // Spread over the range: no gap wider than a fifth of it.
    for (let i = 1; i < t.length; i++) expect(t[i].ratio - t[i - 1].ratio).toBeLessThan(squareTop / 5);
    t.forEach((m, i) => {
      expect(m.layer).toBe(i);
      expect(m.cells).toBeGreaterThanOrEqual(1);
      expect(m.desc.length).toBeGreaterThan(0);
    });
  });
});

describe("the square's scale", () => {
  it("is the square's own (1, 2) and top pair", () => {
    expect(plateRatio(K_FUNDAMENTAL)).toBeCloseTo(1, 12);
    expect(plateRatio(K_TOP)).toBeCloseTo(MODE_TABLE[MODE_TABLE.length - 1].ratio, 9);
  });

  it.each([
    ["hexagon", HEXAGON_MODES],
    ["decagon", DECAGON_MODES],
    ["triangle", TRIANGLE_MODES],
  ] as const)("the generated %s table is written on it (the tool and this file agree)", (_, rows) => {
    for (const r of rows) {
      expect(r.ratio).toBeCloseTo(plateRatio(r.k), 6);
      expect(r.k).toBeLessThanOrEqual(K_TOP * (1 + 1e-9));
    }
  });

  it("spreads a pick evenly and keeps both ends", () => {
    const rows = Array.from({ length: 101 }, (_, i) => i);
    expect(spreadPick(rows, 11)).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    expect(spreadPick(rows.slice(0, 5), 11)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("Bessel functions", () => {
  const J: [number, number, number][] = [
    [0, 1.0, 0.7651976865579666],
    [1, 2.5, 0.4970941024642741],
    [5, 10.0, -0.2340615281867936],
    [20, 5.0, 2.7703300521289436e-11],
    [79, 2.0, 1.1039087214395633e-117],
    [0, 18.5, 0.07716482142255444],
    [3, 18.5, 0.14605433860651237],
    [40, 18.5, 6.361798491117236e-11],
  ];
  it.each(J)("J_%i(%f) to relative 1e-9", (nu, x, want) => {
    const out = new Float64Array(nu + 1);
    besselJOrders(nu, x, out);
    expect(Math.abs(out[nu] / want - 1)).toBeLessThan(1e-9);
  });
  it.each([
    [0, 1.0, 1.2660658777520084],
    [2, 5.0, 17.505614966624236],
    [10, 14.0, 3725.226388984976],
  ])("I_%i(%f) to relative 1e-12", (n, x, want) => {
    expect(Math.abs(besselI(n, x) / want - 1)).toBeLessThan(1e-12);
  });
});

describe("round plate", () => {
  it("every mode meets the free edge: no bending moment, no shear at r = 1", () => {
    const nu = ROUND_POISSON;
    // Derivatives by finite differences of W itself, independent of the
    // closed-form ones the solver used.
    for (const m of roundModes()) {
      // A step that keeps (k h)^2 small at every k.
      const h = Math.min(2e-3, 0.03 / m.k);
      const w = (r: number) => roundRadial(m, r).w;
      const at = [-2, -1, 0, 1, 2].map((s) => w(1 + s * h));
      const w0 = at[2];
      const w1 = (at[3] - at[1]) / (2 * h);
      const w2 = (at[3] - 2 * at[2] + at[1]) / (h * h);
      const w3 = (at[4] - 2 * at[3] + 2 * at[1] - at[0]) / (2 * h * h * h);
      const nn = m.n * m.n;
      // r = 1: laplacian W = W'' + W' - n^2 W, and its r-derivative.
      const lapDr = w3 + w2 - w1 - nn * w1 + 2 * nn * w0;
      const moment = w2 + nu * (w1 - nn * w0);
      const shear = lapDr - (1 - nu) * nn * (w1 - w0);
      let peak = 0;
      for (let r = 0; r <= 1; r += 0.01) peak = Math.max(peak, Math.abs(w(r)));
      // The stencils' own error is about (k h)^2, under 1e-3 here; a wrong
      // root leaves O(0.1).
      expect(Math.abs(moment) / (m.k ** 2 * peak)).toBeLessThan(1e-3);
      expect(Math.abs(shear) / (m.k ** 3 * peak)).toBeLessThan(1e-3);
    }
  });

  it("skips the rigid moves and starts on the two-diameter figure", () => {
    const first = roundModes()[0];
    expect(first.n).toBe(2);
    expect(first.k).toBeGreaterThan(2);
  });
});

describe("membrane plates", () => {
  it.each(MEMBRANES.map((s) => [PLATE_SHAPES[s], s]))("%s: no slope across the edges", (_, shape) => {
    const o = plateOutline(shape);
    const count = plateModeTable(shape).length;
    const half = Math.PI / o.sides;
    const R = o.apothem / Math.cos(half);
    const inside = insidePoints(shape, 400);
    for (let k = 0; k < count; k++) {
      let gIn = 0;
      for (const [x, y] of inside) {
        const v = plateFieldAt(shape, x, y);
        gIn += v[3 * k + 1] ** 2 + v[3 * k + 2] ** 2;
      }
      gIn = Math.sqrt(gIn / inside.length);
      let edge = 0;
      let n = 0;
      for (let e = 0; e < o.sides; e++) {
        const t = o.turn + 2 * half * e;
        const nx = Math.sin(t);
        const ny = Math.cos(t);
        const ax = o.cx + R * Math.sin(t - half);
        const ay = o.cy + R * Math.cos(t - half);
        const bx = o.cx + R * Math.sin(t + half);
        const by = o.cy + R * Math.cos(t + half);
        for (let s = 0.5; s < 60; s++) {
          const x = ax + ((bx - ax) * s) / 60;
          const y = ay + ((by - ay) * s) / 60;
          const v = plateFieldAt(shape, x, y);
          edge += (v[3 * k + 1] * nx + v[3 * k + 2] * ny) ** 2;
          n++;
        }
      }
      const residual = Math.sqrt(edge / n) / gIn;
      expect(residual).toBeLessThan(shape === TRIANGLE ? 1e-8 : 0.03);
    }
  });
});

describe("baked atlases", () => {
  it.each(BAKED.map((s) => [PLATE_SHAPES[s], s]))("%s: every mode peaks at |f| = 2 inside its shape", (_, shape) => {
    const b = baked(shape);
    const o = plateOutline(shape);
    expect(b.layers).toBe(plateModeTable(shape).length);
    for (let k = 0; k < b.layers; k++) {
      let peak = 0;
      for (let j = 0; j < b.side; j++) {
        for (let i = 0; i < b.side; i++) {
          const x = -1 + (2 * (i + 0.5)) / b.side;
          const y = -1 + (2 * (j + 0.5)) / b.side;
          if (plateGauge(o, x, y) <= 1) peak = Math.max(peak, Math.abs(b.data[(k * b.side * b.side + j * b.side + i) * 4]));
        }
      }
      expect(peak).toBeCloseTo(2, 5);
    }
  });

  it.each(BAKED.map((s) => [PLATE_SHAPES[s], s]))("%s: the gradient matches finite differences of f", (_, shape) => {
    const h = 1e-4;
    for (const [x, y] of insidePoints(shape, 60, 0.05, 3)) {
      const v = plateFieldAt(shape, x, y);
      const px = plateFieldAt(shape, x + h, y);
      const mx = plateFieldAt(shape, x - h, y);
      const py = plateFieldAt(shape, x, y + h);
      const my = plateFieldAt(shape, x, y - h);
      for (let k = 0; k < v.length / 3; k++) {
        const scale = Math.hypot(v[3 * k + 1], v[3 * k + 2]) + 1;
        expect(Math.abs((px[3 * k] - mx[3 * k]) / (2 * h) - v[3 * k + 1]) / scale).toBeLessThan(2e-3);
        expect(Math.abs((py[3 * k] - my[3 * k]) / (2 * h) - v[3 * k + 2]) / scale).toBeLessThan(2e-3);
      }
    }
  });

  it.each(BAKED.map((s) => [PLATE_SHAPES[s], s]))("%s: the filtered atlas puts every line within a fraction of a pixel", (_, shape) => {
    // A nodal line moves by (filter error in f) / |grad f|. In pixels on a
    // 1080-tall screen, where the plate's half-width is 0.46 x 1080 px.
    // Near a crossing of two lines the slope vanishes and the shift with it
    // is meaningless, so the 99th percentile is what's held.
    const b = baked(shape);
    const pxPerUnit = 0.46 * 1080;
    const shifts: number[] = [];
    for (const [x, y] of insidePoints(shape, 3000, 0.01, 11)) {
      const raw = plateFieldAt(shape, x, y);
      for (let k = 0; k < b.layers; k++) {
        const f = raw[3 * k] * b.scales[k];
        const g = Math.hypot(raw[3 * k + 1], raw[3 * k + 2]) * b.scales[k];
        if (Math.abs(f) > 0.15) continue; // near a line, where it matters
        shifts.push((Math.abs(sampleBake(b, k, x, y)[0] - f) / Math.max(g, 1e-6)) * pxPerUnit);
      }
    }
    shifts.sort((p, q) => p - q);
    expect(shifts[Math.floor(0.99 * (shifts.length - 1))]).toBeLessThan(0.35);
  });

  it("baking a shape stays short", () => {
    for (const shape of BAKED) {
      const t0 = performance.now();
      bakePlate(shape);
      const ms = performance.now() - t0;
      // Generous for a loaded CI box; the scene's own number is in the record.
      expect(ms).toBeLessThan(600);
    }
  });

  it.each(BAKED.map((s) => [PLATE_SHAPES[s], s]))("%s: every figure is even about the vertical, so any blend is mirror-symmetric", (_, shape) => {
    const r = rng(17);
    for (let t = 0; t < 40; t++) {
      const x = r() * 1.6 - 0.8;
      const y = r() * 1.6 - 0.8;
      const a = plateFieldAt(shape, x, y);
      const b = plateFieldAt(shape, -x, y);
      for (let k = 0; k < a.length / 3; k++) {
        const scale = Math.abs(a[3 * k]) + Math.hypot(a[3 * k + 1], a[3 * k + 2]) + 1e-9;
        expect(Math.abs(a[3 * k] - b[3 * k]) / scale).toBeLessThan(1e-6);
      }
    }
  });

  it("the atlas side is even, so the mirrored half lines up", () => {
    expect(ATLAS_SIDE % 2).toBe(0);
  });
});

describe("outlines", () => {
  it.each(PLATE_SHAPES.map((name, s) => [name, s]))("%s fits [-1,1]^2 and touches it", (_, shape) => {
    const o = plateOutline(shape);
    let maxX = 0;
    let maxY = 0;
    let minY = 0;
    for (let a = 0; a < 2 * Math.PI; a += 0.0005) {
      // Walk out along each direction to the rim.
      let lo = 0;
      let hi = 3;
      for (let it = 0; it < 40; it++) {
        const mid = (lo + hi) / 2;
        if (plateGauge(o, o.cx + mid * Math.sin(a), o.cy + mid * Math.cos(a)) <= 1) lo = mid;
        else hi = mid;
      }
      maxX = Math.max(maxX, Math.abs(o.cx + lo * Math.sin(a)));
      maxY = Math.max(maxY, o.cy + lo * Math.cos(a));
      minY = Math.min(minY, o.cy + lo * Math.cos(a));
    }
    expect(Math.max(maxX, maxY, -minY)).toBeLessThan(1 + 1e-6);
    expect(Math.max(maxX, maxY, -minY)).toBeGreaterThan(0.999);
    // Centred: the bounding box is symmetric top to bottom.
    expect(maxY + minY).toBeCloseTo(0, 3);
  });

  it.each(PLATE_SHAPES.map((name, s) => [name, s]))("%s: respawned sand lands inside, spread evenly", (_, shape) => {
    const o = plateOutline(shape);
    const r = rng(5);
    const n = 40000;
    let inner = 0;
    for (let i = 0; i < n; i++) {
      const [x, y] = respawnPoint(o, r(), r());
      expect(plateGauge(o, x, y)).toBeLessThanOrEqual(1 + 1e-9);
      // The inner half (gauge < 1/sqrt 2) holds half the area.
      if (plateGauge(o, x, y) < Math.SQRT1_2) inner++;
    }
    expect(inner / n).toBeCloseTo(0.5, 1);
  });

  it("areas: the square 4, the circle pi, the others by their polygon", () => {
    expect(plateArea(plateOutline(SQUARE))).toBe(4);
    expect(plateArea(plateOutline(ROUND))).toBeCloseTo(Math.PI, 12);
    expect(plateArea(plateOutline(HEXAGON))).toBeCloseTo((3 * Math.sqrt(3)) / 2, 12);
    expect(plateArea(plateOutline(TRIANGLE))).toBeCloseTo(Math.sqrt(3), 12);
  });
});
