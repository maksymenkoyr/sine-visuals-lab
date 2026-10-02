import { describe, it, expect } from "vitest";
import {
  buildGridPositions,
  buildGridTriangles,
  rowsToPush,
  createSpectrumHistory,
  gridDimsForQuality,
  historyRowFor,
  mirroredBinFor,
} from "../src/render/scenes/meshGrid.ts";

describe("meshGrid grid geometry", () => {
  it("never grows the grid as the detail proxy drops", () => {
    const qualities = [1.0, 0.7, 0.4, 0.25]; // high, mid, low, floor
    for (let i = 1; i < qualities.length; i++) {
      const better = gridDimsForQuality(qualities[i - 1]);
      const worse = gridDimsForQuality(qualities[i]);
      expect(worse.cols).toBeLessThanOrEqual(better.cols);
      expect(worse.rows).toBeLessThanOrEqual(better.rows);
    }
    const floor = gridDimsForQuality(0);
    expect(floor.cols).toBeGreaterThan(1);
    expect(floor.rows).toBeGreaterThan(1);
  });

  it("builds n*n positions in [-1,1], corners included", () => {
    const n = 5;
    const positions = buildGridPositions(n);
    expect(positions.length).toBe(n * n * 2);
    expect(positions[0]).toBeCloseTo(-1);
    expect(positions[1]).toBeCloseTo(-1);
    const lastIdx = (n * n - 1) * 2;
    expect(positions[lastIdx]).toBeCloseTo(1);
    expect(positions[lastIdx + 1]).toBeCloseTo(1);
  });

  it("lays a non-square grid out row-major with x across the columns", () => {
    const cols = 4;
    const rows = 3;
    const positions = buildGridPositions(cols, rows);
    expect(positions.length).toBe(cols * rows * 2);
    // Second vertex is one column over on the first row: x moves, y doesn't.
    expect(positions[2]).toBeCloseTo(-1 + 2 / (cols - 1));
    expect(positions[3]).toBeCloseTo(-1);
    // First vertex of the second row: x back to the start, y one row up.
    const secondRow = cols * 2;
    expect(positions[secondRow]).toBeCloseTo(-1);
    expect(positions[secondRow + 1]).toBeCloseTo(-1 + 2 / (rows - 1));
  });

  it("builds two triangles per cell, all indices in range and non-degenerate", () => {
    const n = 3; // 2x2 cells
    const tris = buildGridTriangles(n);
    const cells = (n - 1) * (n - 1);
    expect(tris.length).toBe(cells * 2 * 3);
    for (let i = 0; i < tris.length; i += 3) {
      const [a, b, c] = [tris[i], tris[i + 1], tris[i + 2]];
      expect(a).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThan(n * n);
      expect(new Set([a, b, c]).size).toBe(3); // no degenerate triangle
    }
  });

  it("triangulates a non-square grid with every index inside cols*rows", () => {
    const cols = 5;
    const rows = 3;
    const tris = buildGridTriangles(cols, rows);
    expect(tris.length).toBe((cols - 1) * (rows - 1) * 2 * 3);
    for (const idx of tris) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(cols * rows);
    }
  });

  it("keeps the row-major, two-triangles-per-cell winding and handles degenerate sizes", () => {
    const cols = 5;
    const rows = 3;
    const tris = buildGridTriangles(cols, rows);
    expect(Array.from(tris.slice(0, 6))).toEqual([0, 1, 5, 1, 6, 5]);
    // Reference built with the plain push loop the typed-array fill replaced.
    const ref: number[] = [];
    for (let row = 0; row < rows - 1; row++) {
      for (let col = 0; col < cols - 1; col++) {
        const a = row * cols + col;
        ref.push(a, a + 1, a + cols, a + 1, a + cols + 1, a + cols);
      }
    }
    expect(Array.from(tris)).toEqual(ref);
    expect(buildGridTriangles(1, 4).length).toBe(0);
    expect(buildGridTriangles(4, 1).length).toBe(0);
  });
});

describe("meshGrid spectrum mapping", () => {
  it("folds the spectrum about the center: bass at x=0, top bin at both edges", () => {
    const bands = 24;
    expect(mirroredBinFor(0, bands)).toBe(0);
    expect(mirroredBinFor(1, bands)).toBe(bands - 1);
    expect(mirroredBinFor(-1, bands)).toBe(bands - 1);
    expect(mirroredBinFor(0.5, bands)).toBeCloseTo(mirroredBinFor(-0.5, bands));
    expect(mirroredBinFor(0.5, bands)).toBeCloseTo((bands - 1) / 2);
  });

  it("never reads past the top bin for x outside [-1, 1]", () => {
    expect(mirroredBinFor(1.5, 24)).toBe(23);
  });
});

describe("meshGrid spectrum history", () => {
  it("push writes the row it returns and advances the cursor, wrapping at `frames`", () => {
    const bands = 4;
    const frames = 3;
    const history = createSpectrumHistory(bands, frames);
    expect(history.push([1, 2, 3, 4])).toBe(0);
    expect(history.push([5, 6, 7, 8])).toBe(1);
    expect(history.push([9, 10, 11, 12])).toBe(2);
    expect(history.push([13, 14, 15, 16])).toBe(0); // wraps
    expect(Array.from(history.data.slice(0, 4))).toEqual([13, 14, 15, 16]);
    expect(Array.from(history.data.slice(4, 8))).toEqual([5, 6, 7, 8]);
  });

  it("historyRowFor(newestRow, 0, flow) is always the newest row, regardless of flow", () => {
    expect(historyRowFor(7, 0, 1, 120)).toBeCloseTo(7);
    expect(historyRowFor(7, 0, 0, 120)).toBeCloseTo(7);
  });

  it("historyRowFor(newestRow, z, 0) is always the newest row, regardless of z", () => {
    expect(historyRowFor(42, 1, 0, 120)).toBeCloseTo(42);
    expect(historyRowFor(42, 0.5, 0, 120)).toBeCloseTo(42);
  });

  it("historyRowFor reaches back proportionally to z*flow*frames and wraps into [0, frames)", () => {
    const frames = 120;
    expect(historyRowFor(50, 1, 1, frames)).toBeCloseTo(50 - frames + frames); // 50 - 120 wraps
    expect(historyRowFor(50, 1, 1, frames)).toBeCloseTo((50 - frames + frames) % frames);
    // A small, unambiguous case: newestRow=10, back=4 -> row=6, no wrap needed.
    expect(historyRowFor(10, 0.5, 0.4, 20)).toBeCloseTo(6);
    // Wrap case: newestRow=2, back=5 -> -3 -> wraps to frames-3.
    expect(historyRowFor(2, 1, 0.5, 10)).toBeCloseTo(7);
  });
});

describe("meshGrid history rows per second", () => {
  const run = (dts: number[], acc = 0.5) => {
    let total = 0;
    const per: number[] = [];
    for (const dt of dts) {
      const r = rowsToPush(acc, dt, 60, 200);
      acc = r.acc;
      total += r.n;
      per.push(r.n);
    }
    return { total, per };
  };

  it("pushes one row per frame at 60 fps, even with timestamp jitter", () => {
    const steady = run(Array(60).fill(1 / 60));
    expect(steady.total).toBe(60);
    expect(steady.per.every((n) => n === 1)).toBe(true);
    const jitter = run(Array.from({ length: 60 }, (_, i) => (1 + (i % 2 ? 0.2 : -0.2)) / 60));
    expect(jitter.per.every((n) => n === 1)).toBe(true);
  });

  it("covers the same time at 30 fps, and at an uneven gated cadence", () => {
    const half = run(Array(30).fill(1 / 30));
    expect(half.total).toBe(60);
    expect(half.per.every((n) => n === 2)).toBe(true);
    // 75 Hz panel gated to every other tick: 1/37.5 s per render.
    const gated = run(Array(75).fill(1 / 37.5));
    expect(gated.total).toBeGreaterThanOrEqual(119);
    expect(gated.total).toBeLessThanOrEqual(120);
  });

  it("caps a stall at the ring size, pushes nothing for no time, and keeps the carry", () => {
    expect(rowsToPush(0.5, 0.25, 60, 10).n).toBe(10);
    expect(rowsToPush(0.5, 0.25, 60, 200).n).toBe(15);
    expect(rowsToPush(0.5, 0, 60, 200)).toEqual({ n: 0, acc: 0.5 });
    expect(rowsToPush(0.5, -1, 60, 200).n).toBe(0);
    const r = rowsToPush(0.25, 1 / 120, 60, 200); // 0.25 + 0.5 rows: none yet
    expect(r.n).toBe(0);
    expect(r.acc).toBeCloseTo(0.75, 9);
  });
});
