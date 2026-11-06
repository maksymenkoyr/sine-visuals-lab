import { describe, expect, it } from "vitest";
import { buildTrail, MAX_TRAIL_SEGMENTS, SEGMENT_FLOATS, SOLIDS, type SolidId, type TrailParams, trailEchoes } from "../src/render/scenes/echoes/solids.ts";

// Vertex and edge counts of the figures, by their standard counts —
// the edges are derived (nearest pairs), so this is what checks them.
const COUNTS: Record<SolidId, [verts: number, edges: number]> = {
  tetrahedron: [4, 6],
  cube: [8, 12],
  octahedron: [6, 12],
  icosahedron: [12, 30],
  dodecahedron: [20, 30],
  cuboctahedron: [12, 24],
  tesseract: [16, 32],
  cell5: [5, 10],
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

  it("multiplies its echoes along one more direction per dimension: every edge of every copy, finite, stopping at the buffer's end", () => {
    for (const id of IDS) {
      const s = SOLIDS[id];
      const edges = s.edges.length;
      const copies = 3 ** (s.dim - 1);
      const out = new Float32Array(edges * copies * SEGMENT_FLOATS).fill(NaN);
      expect(buildTrail(s, params({ echoes: 3 }), out), id).toBe(edges * copies);
      for (const x of out) expect(Number.isFinite(x)).toBe(true);
      const short = new Float32Array(edges * 2 * SEGMENT_FLOATS);
      expect(buildTrail(s, params({ echoes: 3 }), short), id).toBe(edges * 2);
    }
  });

  it("never asks for more copies than the segment budget holds, at any Echoes setting", () => {
    for (const id of IDS) {
      const s = SOLIDS[id];
      for (const setting of [2, 10, 40]) {
        const along = trailEchoes(s, setting);
        expect(along, id).toBeGreaterThanOrEqual(2);
        expect(s.edges.length * along ** (s.dim - 1), id).toBeLessThanOrEqual(MAX_TRAIL_SEGMENTS);
      }
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

  it("with no flow and a still figure, every copy sits on the figure", () => {
    const edges = SOLIDS.cube.edges.length;
    const copies = 4 ** 2;
    const out = new Float32Array(edges * copies * SEGMENT_FLOATS);
    buildTrail(SOLIDS.cube, params({ echoes: 4, step: 0 }), out);
    const first = echo(out, edges, 0).map((r) => r.slice(0, 6));
    for (let k = 1; k < copies; k++) {
      echo(out, edges, k).forEach((r, e) => r.slice(0, 6).forEach((x, i) => expect(x).toBeCloseTo(first[e][i], 9)));
    }
  });

  // freq 0: the flow is the same at every vertex, so it carries a copy without
  // bending it, and what's left is each direction's own move.
  const STILL_FLOW = { step: 0.15, freq: 0, time: 0 };

  /** The copy `along` steps down one direction from the figure now (0 is
   *  across the screen, then depth, then the fourth axis). */
  function copyAlong(out: Float32Array, edges: number, echoes: number, direction: number, along: number): number[][] {
    return echo(out, edges, along * echoes ** direction);
  }

  const centreOf = (rows: number[][]) => {
    const pts = rows.flatMap((r) => [
      [r[0], r[1]],
      [r[2], r[3]],
    ]);
    return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
  };
  const meanMag = (rows: number[][]) => rows.reduce((s, r) => s + r[4] + r[5], 0) / (2 * rows.length);

  it("the last direction carries copies away, into depth (3D) or through the fourth axis (4D): far copies are smaller and less magnified", () => {
    for (const id of IDS) {
      const s = SOLIDS[id];
      const echoes = 6;
      const edges = s.edges.length;
      const out = new Float32Array(edges * echoes ** (s.dim - 1) * SEGMENT_FLOATS);
      buildTrail(s, params({ echoes, ...STILL_FLOW }), out);
      const last = s.dim - 2;
      const near = copyAlong(out, edges, echoes, last, 0);
      const far = copyAlong(out, edges, echoes, last, echoes - 1);
      expect(meanMag(far), id).toBeLessThan(meanMag(near) * 0.9);
      expect(spreadOf(far), id).toBeLessThan(spreadOf(near));
      expect(far[0][6], id).toBeLessThan(near[0][6]);
    }
  });

  it("the first direction carries copies across the screen at the figure's own depth, and centres the row on the frame", () => {
    for (const id of IDS) {
      const s = SOLIDS[id];
      const echoes = 5;
      const edges = s.edges.length;
      const out = new Float32Array(edges * echoes ** (s.dim - 1) * SEGMENT_FLOATS);
      // The camera swung: before the swing, the row would turn toward the viewer
      // and its nearest copies would fill the frame.
      buildTrail(s, params({ echoes, ...STILL_FLOW, yaw: 0.8 }), out);
      const start = copyAlong(out, edges, echoes, 0, 0);
      const end = copyAlong(out, edges, echoes, 0, echoes - 1);
      const [ax, ay] = centreOf(start);
      const [bx, by] = centreOf(end);
      expect(Math.hypot(bx - ax, by - ay), id).toBeGreaterThan(0.05);
      // Equal and opposite offsets from the frame's centre, give or take the
      // figure's own off-centre projection.
      const [mx, my] = centreOf(copyAlong(out, edges, echoes, 0, (echoes - 1) / 2));
      expect(Math.hypot((ax + bx) / 2 - mx, (ay + by) / 2 - my), id).toBeLessThan(0.02);
      const growth = meanMag(end) / meanMag(start);
      expect(growth, id).toBeGreaterThan(0.87);
      expect(growth, id).toBeLessThan(1.15);
    }
  });

  it("a copy's brightness is the product of its fade along each direction", () => {
    const s = SOLIDS.cube;
    const echoes = 4;
    const edges = s.edges.length;
    const out = new Float32Array(edges * echoes ** 2 * SEGMENT_FLOATS);
    buildTrail(s, params({ echoes }), out);
    expect(echo(out, edges, 0)[0][6]).toBeCloseTo(1, 6);
    expect(echo(out, edges, 1)[0][6]).toBeCloseTo(0.75, 6);
    expect(echo(out, edges, 4)[0][6]).toBeCloseTo(0.75, 6);
    expect(echo(out, edges, 5)[0][6]).toBeCloseTo(0.75 * 0.75, 6);
  });

  it("a size pop ripples through the copies: a copy k steps from the figure now is the figure k frames ago", () => {
    const s = SOLIDS.cube;
    const echoes = 3;
    const edges = s.edges.length;
    const out = new Float32Array(edges * echoes ** 2 * SEGMENT_FLOATS);
    const radiusAt = (k: number) => (k === 0 ? 0.5 : 0.35);
    buildTrail(s, params({ echoes, step: 0, radius: 0.5, radiusAt }), out);
    const now = spreadOf(echo(out, edges, 0));
    expect(spreadOf(echo(out, edges, 1))).toBeCloseTo(now * (0.35 / 0.5), 1);
    expect(spreadOf(echo(out, edges, 3))).toBeCloseTo(now * (0.35 / 0.5), 1);
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
