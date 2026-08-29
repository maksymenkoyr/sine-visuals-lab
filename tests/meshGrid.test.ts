import { describe, it, expect } from "vitest";
import {
  buildGridIndices,
  buildGridPositions,
  buildGridTriangles,
  createSpectrumHistory,
  gridSizeForQuality,
  historyRowFor,
} from "../src/render/scenes/meshGrid.ts";

describe("meshGrid grid geometry", () => {
  it("sizes the grid from the detail proxy, largest first", () => {
    expect(gridSizeForQuality(1.0)).toBe(220); // high
    expect(gridSizeForQuality(0.7)).toBe(160); // mid
    expect(gridSizeForQuality(0.4)).toBe(100); // low
    expect(gridSizeForQuality(0.25)).toBe(72); // floor
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

  it("indexes only horizontal + vertical edges without diagonals", () => {
    const n = 4;
    const indices = buildGridIndices(n, false);
    const expectedSegments = n * (n - 1) * 2; // horizontal + vertical
    expect(indices.length).toBe(expectedSegments * 2);
  });

  it("adds one diagonal per cell when withDiagonals is true", () => {
    const n = 4;
    const withoutDiag = buildGridIndices(n, false);
    const withDiag = buildGridIndices(n, true);
    const diagSegments = (n - 1) * (n - 1);
    expect(withDiag.length).toBe(withoutDiag.length + diagSegments * 2);
  });

  it("every line index is within [0, n*n) and no segment joins a vertex to itself", () => {
    const n = 6;
    const indices = buildGridIndices(n, true);
    for (let i = 0; i < indices.length; i += 2) {
      const a = indices[i];
      const b = indices[i + 1];
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(n * n);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(n * n);
      expect(a).not.toBe(b);
    }
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

  it("historyRowFor(newestRow, h, 0) is always the newest row, regardless of h", () => {
    expect(historyRowFor(42, 1, 0, 120)).toBeCloseTo(42);
    expect(historyRowFor(42, 0.5, 0, 120)).toBeCloseTo(42);
  });

  it("historyRowFor reaches back proportionally to h*flow*frames and wraps into [0, frames)", () => {
    const frames = 120;
    expect(historyRowFor(50, 1, 1, frames)).toBeCloseTo(50 - frames + frames); // 50 - 120 wraps
    expect(historyRowFor(50, 1, 1, frames)).toBeCloseTo((50 - frames + frames) % frames);
    // A small, unambiguous case: newestRow=10, back=4 -> row=6, no wrap needed.
    expect(historyRowFor(10, 0.5, 0.4, 20)).toBeCloseTo(6);
    // Wrap case: newestRow=2, back=5 -> -3 -> wraps to frames-3.
    expect(historyRowFor(2, 1, 0.5, 10)).toBeCloseTo(7);
  });
});
