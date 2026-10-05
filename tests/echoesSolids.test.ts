import { describe, expect, it } from "vitest";
import { MAX_SOLID_EDGES, projectSolid, SOLIDS, type SolidId } from "../src/render/scenes/echoes/solids.ts";

// Vertex and edge counts of the regular figures, by their standard counts —
// the edges are derived (nearest pairs), so this is what checks them.
const COUNTS: Record<SolidId, [verts: number, edges: number]> = {
  tetrahedron: [4, 6],
  cube: [8, 12],
  octahedron: [6, 12],
  icosahedron: [12, 30],
  tesseract: [16, 32],
  cell16: [8, 24],
  cell24: [24, 96],
};

describe("echoes solids", () => {
  for (const [id, [nv, ne]] of Object.entries(COUNTS) as [SolidId, [number, number]][]) {
    it(`${id}: ${nv} vertices on the unit sphere, ${ne} equal edges`, () => {
      const s = SOLIDS[id];
      expect(s.verts.length).toBe(nv);
      expect(s.edges.length).toBe(ne);
      for (const v of s.verts) expect(Math.hypot(...v)).toBeCloseTo(1, 9);
      const len = ([a, b]: readonly [number, number]) => Math.hypot(...s.verts[a].map((x, k) => x - s.verts[b][k]));
      const first = len(s.edges[0]);
      for (const e of s.edges) expect(len(e)).toBeCloseTo(first, 9);
      if (s.dim === 3) for (const v of s.verts) expect(v[3]).toBe(0);
    });
  }

  it("MAX_SOLID_EDGES is the largest edge count", () => {
    expect(MAX_SOLID_EDGES).toBe(Math.max(...Object.values(COUNTS).map(([, e]) => e)));
  });

  it("projects every edge, within the reported extent, about the size asked for", () => {
    const out = new Float32Array(MAX_SOLID_EDGES * 4);
    const radius = 0.35;
    for (const id of Object.keys(SOLIDS) as SolidId[]) {
      for (const phase of [0, 1.3, 17.9, 1234.5]) {
        out.fill(NaN);
        const { count, extent } = projectSolid(SOLIDS[id], phase, radius, out);
        expect(count).toBe(SOLIDS[id].edges.length);
        for (let i = 0; i < count * 4; i += 2) {
          expect(Number.isFinite(out[i])).toBe(true);
          expect(Math.hypot(out[i], out[i + 1])).toBeLessThanOrEqual(extent + 1e-6);
        }
        expect(extent).toBeGreaterThan(radius * 0.8);
        expect(extent).toBeLessThan(radius * 1.2);
      }
    }
  });

  it("turns with the phase", () => {
    const a = new Float32Array(MAX_SOLID_EDGES * 4);
    const b = new Float32Array(MAX_SOLID_EDGES * 4);
    projectSolid(SOLIDS.tesseract, 0, 1, a);
    projectSolid(SOLIDS.tesseract, 0.5, 1, b);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });
});
