import { describe, expect, it } from "vitest";
import { buildTrail, MAX_SOLID_EDGES, SEGMENT_FLOATS, SOLIDS, type SolidId, type TrailParams } from "../src/render/scenes/echoes/solids.ts";

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
const IDS = Object.keys(COUNTS) as SolidId[];

function params(over: Partial<TrailParams> = {}): TrailParams {
  return {
    echoes: 8,
    step: 0.12,
    freq: 1.2,
    time: 0.7,
    yaw: 0,
    radius: 0.35,
    phaseAt: () => 0.9,
    radiusAt: () => 0.35,
    ...over,
  };
}

/** Echo k's segments from a trail buffer, as [x1, y1, x2, y2, m1, m2, fade]. */
function echo(out: Float32Array, edges: number, k: number): number[][] {
  const rows: number[][] = [];
  for (let e = 0; e < edges; e++) {
    const o = (k * edges + e) * SEGMENT_FLOATS;
    rows.push(Array.from(out.subarray(o, o + 7)));
  }
  return rows;
}

function extentOf(rows: number[][]): number {
  return Math.max(...rows.flatMap((r) => [Math.hypot(r[0], r[1]), Math.hypot(r[2], r[3])]));
}

/** An echo's own size: its farthest end from its own centroid (the flow
 *  also carries a whole echo sideways, so distance from the screen centre
 *  says nothing about how big it is). */
function spreadOf(rows: number[][]): number {
  const pts = rows.flatMap((r) => [
    [r[0], r[1]],
    [r[2], r[3]],
  ]);
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return Math.max(...pts.map((p) => Math.hypot(p[0] - cx, p[1] - cy)));
}

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

  it("writes every edge of every echo, finite, and stops at the buffer's end", () => {
    for (const id of IDS) {
      const edges = SOLIDS[id].edges.length;
      const out = new Float32Array(edges * 8 * SEGMENT_FLOATS).fill(NaN);
      expect(buildTrail(SOLIDS[id], params(), out)).toBe(edges * 8);
      for (const x of out) expect(Number.isFinite(x)).toBe(true);
      const short = new Float32Array(edges * 3 * SEGMENT_FLOATS);
      expect(buildTrail(SOLIDS[id], params(), short)).toBe(edges * 3);
    }
  });

  it("draws the figure itself about as big as the radius asked for", () => {
    for (const id of IDS) {
      const edges = SOLIDS[id].edges.length;
      const out = new Float32Array(edges * SEGMENT_FLOATS);
      for (const phase of [0, 1.3, 17.9, 1234.5]) {
        buildTrail(SOLIDS[id], params({ echoes: 1, phaseAt: () => phase }), out);
        const extent = extentOf(echo(out, edges, 0));
        expect(extent).toBeGreaterThan(0.35 * 0.8);
        expect(extent).toBeLessThan(0.35 * 1.2);
      }
    }
  });

  it("with no flow and a still figure, every echo sits on the figure", () => {
    const edges = SOLIDS.cube.edges.length;
    const out = new Float32Array(edges * 8 * SEGMENT_FLOATS);
    buildTrail(SOLIDS.cube, params({ step: 0 }), out);
    const first = echo(out, edges, 0).map((r) => r.slice(0, 6));
    for (let k = 1; k < 8; k++) {
      echo(out, edges, k).forEach((r, e) => r.slice(0, 6).forEach((x, i) => expect(x).toBeCloseTo(first[e][i], 9)));
    }
  });

  it("pushes the trail away into depth (3D) or through the fourth axis (4D): far echoes are smaller and less magnified", () => {
    // freq 0: the flow is the same at every vertex, so it carries each echo
    // without bending it — what's left is the recession itself (bending,
    // which can stretch an echo, is the flow's job, not this test's).
    for (const id of IDS) {
      const edges = SOLIDS[id].edges.length;
      const out = new Float32Array(edges * 12 * SEGMENT_FLOATS);
      buildTrail(SOLIDS[id], params({ echoes: 12, step: 0.15, freq: 0 }), out);
      const near = echo(out, edges, 0);
      const far = echo(out, edges, 11);
      const meanMag = (rows: number[][]) => rows.reduce((s, r) => s + r[4] + r[5], 0) / (2 * rows.length);
      expect(meanMag(far), id).toBeLessThan(meanMag(near) * 0.85);
      expect(spreadOf(far), id).toBeLessThan(spreadOf(near));
      expect(far[0][6], id).toBeLessThan(near[0][6]);
    }
  });

  it("turns with the phase", () => {
    const edges = SOLIDS.tesseract.edges.length;
    const a = new Float32Array(edges * SEGMENT_FLOATS);
    const b = new Float32Array(edges * SEGMENT_FLOATS);
    buildTrail(SOLIDS.tesseract, params({ echoes: 1, phaseAt: () => 0 }), a);
    buildTrail(SOLIDS.tesseract, params({ echoes: 1, phaseAt: () => 0.5 }), b);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });
});
