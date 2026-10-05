// The 3D and 4D figures Echoes can draw instead of a flat outline: regular
// solids and regular 4D polytopes as wireframes, turned and projected to 2D
// line segments here in JS every frame, then drawn by glsl.ts's step pass
// into the same echo loop as the flat shapes (index.ts uploads the segments
// as a one-row float texture).
//
// Each figure is its vertex list, scaled to a unit circumradius, and its
// edges: every pair of vertices at the smallest distance apart — true for all
// of these regular figures, so no edge list is written by hand.
//
// Turning: a 3D solid turns in the xz plane (about the vertical axis) and
// tumbles in the yz plane at an unrelated rate, so it never repeats a pose
// soon. A 4D figure also turns in the xw and zw planes — rotations through
// the fourth axis, which is what makes a tesseract's inner cube swell and
// swap places with the outer one. Every rate is a fixed multiple of one turn
// phase (the Spin setting's), so Spin speeds the whole motion up or down.
//
// Projection: 4D to 3D, then 3D to 2D, each a perspective divide from a
// viewer at a fixed distance along the dropped axis; the near side of the
// figure draws bigger, which is the depth cue a wireframe has.

export interface Solid {
  readonly dim: 3 | 4;
  /** Unit circumradius; length-4 vectors (w = 0 for a 3D solid). */
  readonly verts: readonly (readonly number[])[];
  readonly edges: readonly (readonly [number, number])[];
}

const PHI = (1 + Math.sqrt(5)) / 2;

function signs(base: readonly number[]): number[][] {
  let out: number[][] = [[]];
  for (const x of base) {
    out = out.flatMap((v) => (x === 0 ? [[...v, 0]] : [[...v, x], [...v, -x]]));
  }
  return out;
}

function cyclic3(v: readonly number[]): number[][] {
  return [
    [v[0], v[1], v[2]],
    [v[1], v[2], v[0]],
    [v[2], v[0], v[1]],
  ];
}

/** Every vector with two of its four coordinates ±1 and the rest 0. */
function twoOfFour(): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      for (const si of [1, -1]) {
        for (const sj of [1, -1]) {
          const v = [0, 0, 0, 0];
          v[i] = si;
          v[j] = sj;
          out.push(v);
        }
      }
    }
  }
  return out;
}

function axes(dim: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < dim; i++) {
    for (const s of [1, -1]) {
      const v = new Array(dim).fill(0);
      v[i] = s;
      out.push(v);
    }
  }
  return out;
}

function build(dim: 3 | 4, raw: number[][]): Solid {
  const verts = raw.map((v) => {
    const v4 = [v[0], v[1], v[2], v[3] ?? 0];
    const n = Math.hypot(...v4);
    return v4.map((x) => x / n);
  });
  const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2], a[3] - b[3]);
  let min = Infinity;
  for (let i = 0; i < verts.length; i++) {
    for (let j = i + 1; j < verts.length; j++) min = Math.min(min, dist(verts[i], verts[j]));
  }
  const edges: [number, number][] = [];
  for (let i = 0; i < verts.length; i++) {
    for (let j = i + 1; j < verts.length; j++) {
      if (dist(verts[i], verts[j]) < min * 1.001) edges.push([i, j]);
    }
  }
  return { dim, verts, edges };
}

export const SOLIDS = {
  tetrahedron: build(3, [
    [1, 1, 1],
    [1, -1, -1],
    [-1, 1, -1],
    [-1, -1, 1],
  ]),
  cube: build(3, signs([1, 1, 1])),
  octahedron: build(3, axes(3)),
  icosahedron: build(3, signs([0, 1, PHI]).flatMap(cyclic3)),
  tesseract: build(4, signs([1, 1, 1, 1])),
  cell16: build(4, axes(4)),
  cell24: build(4, twoOfFour()),
} as const satisfies Record<string, Solid>;

export type SolidId = keyof typeof SOLIDS;

/** The most edges any figure has — the size of the segment texture. */
export const MAX_SOLID_EDGES = Math.max(...Object.values(SOLIDS).map((s) => s.edges.length));

// Viewer distances (in circumradii) and the scales that keep a projected
// figure about as wide as a flat shape of the same Size.
const VIEW_3D = 4;
const SCALE_3D = 0.8;
const VIEW_4D = 3;
const SCALE_4D = 0.75;
// Each plane's rate as a multiple of the turn phase, and a starting offset
// for the tumble so phase 0 isn't a flat face-on view.
const TUMBLE_RATE = 0.62;
const TUMBLE_OFFSET = 0.5;
const XW_RATE = 0.8;
const ZW_RATE = 0.53;

function rotate(v: number[], i: number, j: number, angle: number): void {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const a = v[i];
  const b = v[j];
  v[i] = c * a - s * b;
  v[j] = s * a + c * b;
}

/** How far, on average over a sweep of turns, a figure's farthest vertex
 *  lands from the centre at radius 1 — measured once per figure, so
 *  projectSolid can divide it out and every figure draws about as big as a
 *  flat shape of the same Size. Fixed per figure rather than re-measured
 *  every frame, so a turning figure keeps its true changes of size (the 4D
 *  ones swelling as they turn inside out). */
const TYPICAL_EXTENT = new Map<Solid, number>();
const EXTENT_SWEEP = 64;

function typicalExtent(solid: Solid): number {
  let cached = TYPICAL_EXTENT.get(solid);
  if (cached === undefined) {
    const scratch = new Float32Array(solid.edges.length * 4);
    let sum = 0;
    for (let i = 0; i < EXTENT_SWEEP; i++) sum += projectRaw(solid, (i * 2 * Math.PI * 7) / EXTENT_SWEEP, 1, scratch).extent;
    cached = sum / EXTENT_SWEEP;
    TYPICAL_EXTENT.set(solid, cached);
  }
  return cached;
}

/** Turns `solid` to `phase` (radians), projects it to the screen at about
 *  `radius` (half-heights) across, and writes one segment per edge into
 *  `out` as x1, y1, x2, y2. Returns the edge count and the largest distance
 *  any vertex lands from the centre (for the shader's cull). */
export function projectSolid(solid: Solid, phase: number, radius: number, out: Float32Array): { count: number; extent: number } {
  return projectRaw(solid, phase, radius / typicalExtent(solid), out);
}

function projectRaw(solid: Solid, phase: number, radius: number, out: Float32Array): { count: number; extent: number } {
  const px: number[] = [];
  const py: number[] = [];
  let extent = 0;
  const v = [0, 0, 0, 0];
  for (const src of solid.verts) {
    v[0] = src[0];
    v[1] = src[1];
    v[2] = src[2];
    v[3] = src[3];
    rotate(v, 0, 2, phase);
    rotate(v, 1, 2, TUMBLE_RATE * phase + TUMBLE_OFFSET);
    if (solid.dim === 4) {
      rotate(v, 0, 3, XW_RATE * phase);
      rotate(v, 2, 3, ZW_RATE * phase);
      const s4 = (SCALE_4D * VIEW_4D) / (VIEW_4D - v[3]);
      v[0] *= s4;
      v[1] *= s4;
      v[2] *= s4;
    }
    const s3 = ((SCALE_3D * VIEW_3D) / (VIEW_3D - v[2])) * radius;
    const x = v[0] * s3;
    const y = v[1] * s3;
    px.push(x);
    py.push(y);
    extent = Math.max(extent, Math.hypot(x, y));
  }
  solid.edges.forEach(([a, b], k) => {
    out[k * 4] = px[a];
    out[k * 4 + 1] = py[a];
    out[k * 4 + 2] = px[b];
    out[k * 4 + 3] = py[b];
  });
  return { count: solid.edges.length, extent };
}
