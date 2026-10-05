// The 3D and 4D figures Echoes can draw instead of a flat outline, and the
// trail of echoes they leave *in their own space*: a flat shape's echoes
// are pushed across the screen by glsl.ts's feedback loop, but a figure's
// echoes are copies of the figure itself, pushed back into depth (3D) or
// along the fourth axis (4D) and bent by a smooth flow of the same number of
// dimensions, then seen in perspective. That is what lets the depth show: a
// 3D trail recedes, shrinks and fades into the distance; a 4D trail shrinks
// inward through the fourth dimension, each echo nesting inside the last the
// way a tesseract's inner cube sits inside its outer one.
//
// Figures: each is its vertex list, scaled to a unit circumradius, and its
// edges — every pair of vertices at the smallest distance apart, true for
// all of these regular figures, so no edge list is written by hand.
//
// Turning: a figure turns in the xz plane (about the vertical axis) and
// tumbles in the yz plane at an unrelated rate; a 4D figure also turns in
// the xw and zw planes, through the fourth axis. Every rate is a fixed
// multiple of one turn phase (the Spin setting's), and the camera swings
// side to side on the same phase (orbitYaw) so the trail is seen from
// changing angles — parallax is the other half of seeing depth.
//
// The trail (buildTrail): echo 0 is the figure now; echo k is the figure as
// it was k frames ago (its turn and its size, from index.ts's history, so a
// Kick pop ripples down the trail as it does on a flat shape), displaced by
// k steps of the flow — each step taken from where the previous echo's
// vertex sat. Projection is 4D to 3D, then 3D to 2D, each a perspective
// divide; every vertex also reports its magnification, which the segment
// shader turns into line width and fog.

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

/** The most edges any figure has. */
export const MAX_SOLID_EDGES = Math.max(...Object.values(SOLIDS).map((s) => s.edges.length));
/** Floats per trail segment in buildTrail's output: x1, y1, x2, y2 (screen,
 *  half-heights), m1, m2 (each end's magnification, 1 at the figure's
 *  centre depth), fade (1 for the figure now, falling down the trail), 0. */
export const SEGMENT_FLOATS = 8;

// Viewer distances (in circumradii) and the scales that keep a projected
// figure about as wide as a flat shape of the same Size before
// TYPICAL_EXTENT's correction.
const VIEW_3D = 4;
const SCALE_3D = 0.8;
const VIEW_4D = 3;
const SCALE_4D = 0.75;
/** How close to a viewer a displaced vertex may get, in circumradii — the
 *  flow can bend an echo forward, and a perspective divide near zero would
 *  throw it across the screen. */
const NEAR_LIMIT = 0.6;
// Each plane's rate as a multiple of the turn phase, and a starting offset
// for the tumble so phase 0 isn't a flat face-on view.
const TUMBLE_RATE = 0.62;
const TUMBLE_OFFSET = 0.5;
const XW_RATE = 0.8;
const ZW_RATE = 0.53;
// The camera's side-to-side swing: its reach in radians and its rate as a
// multiple of the turn phase. A swing, not a full orbit — a full turn would
// bring the trail toward the viewer and through the camera.
const ORBIT_SWING = 0.8;
const ORBIT_RATE = 0.7;
/** How far the flow bends an echo sideways relative to the steady push
 *  back into depth / the fourth axis — and, along the push axis and along
 *  z (the final 3D view's depth, for a 4D figure too), the share of the
 *  bend kept: at full strength the flow could cancel the push or carry an
 *  echo toward the camera, so the trail stopped reading as receding. */
const BEND = 0.9;
const PUSH_AXIS_BEND = 0.35;

/** The camera's yaw for a turn phase — see the header. */
export function orbitYaw(phase: number): number {
  return ORBIT_SWING * Math.sin(ORBIT_RATE * phase);
}

function rotate(v: Float64Array, i: number, j: number, angle: number): void {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const a = v[i];
  const b = v[j];
  v[i] = c * a - s * b;
  v[j] = s * a + c * b;
}

/** The figure's vertex `src` turned to `phase`, scaled by `scale`, into `v`. */
function pose(solid: Solid, src: readonly number[], phase: number, scale: number, v: Float64Array): void {
  v[0] = src[0];
  v[1] = src[1];
  v[2] = src[2];
  v[3] = src[3];
  rotate(v, 0, 2, phase);
  rotate(v, 1, 2, TUMBLE_RATE * phase + TUMBLE_OFFSET);
  if (solid.dim === 4) {
    rotate(v, 0, 3, XW_RATE * phase);
    rotate(v, 2, 3, ZW_RATE * phase);
  }
  for (let i = 0; i < 4; i++) v[i] *= scale;
}

/** Projects a posed (and possibly displaced) vertex: writes screen x, y (in
 *  units of `screenScale`) and the magnification into `out`. */
function project(dim: 3 | 4, v: Float64Array, yaw: number, screenScale: number, out: Float64Array): void {
  let x = v[0];
  let y = v[1];
  let z = v[2];
  let m = 1;
  if (dim === 4) {
    const s4 = VIEW_4D / (VIEW_4D - Math.min(v[3], VIEW_4D - NEAR_LIMIT));
    x *= s4 * SCALE_4D;
    y *= s4 * SCALE_4D;
    z *= s4 * SCALE_4D;
    m = s4;
  }
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const xr = c * x + s * z;
  const zr = -s * x + c * z;
  const s3 = VIEW_3D / (VIEW_3D - Math.min(zr, VIEW_3D - NEAR_LIMIT));
  out[0] = xr * s3 * SCALE_3D * screenScale;
  out[1] = y * s3 * SCALE_3D * screenScale;
  out[2] = m * s3;
}

/** How far, on average over a sweep of turns, a figure's farthest vertex
 *  lands from the centre at unit screen scale and no camera swing —
 *  measured once per figure, so buildTrail can divide it out and every
 *  figure draws about as big as a flat shape of the same Size. Fixed per
 *  figure rather than re-measured every frame, so a turning figure keeps its
 *  true changes of size. */
const TYPICAL_EXTENT = new Map<Solid, number>();
const EXTENT_SWEEP = 64;

function typicalExtent(solid: Solid): number {
  let cached = TYPICAL_EXTENT.get(solid);
  if (cached === undefined) {
    const v = new Float64Array(4);
    const p = new Float64Array(3);
    let sum = 0;
    for (let i = 0; i < EXTENT_SWEEP; i++) {
      const phase = (i * 2 * Math.PI * 7) / EXTENT_SWEEP;
      let extent = 0;
      for (const src of solid.verts) {
        pose(solid, src, phase, 1, v);
        project(solid.dim, v, 0, 1, p);
        extent = Math.max(extent, Math.hypot(p[0], p[1]));
      }
      sum += extent;
    }
    cached = sum / EXTENT_SWEEP;
    TYPICAL_EXTENT.set(solid, cached);
  }
  return cached;
}

// A smooth vector field in up to four dimensions: per output component, a
// few plane waves with fixed directions, phases and speeds (drawn once from
// a seeded generator, so every run and every device sees the same field),
// summed. Cheap enough to evaluate per vertex per echo in JS, and smooth at
// every scale, which is all the trail needs from it.
const WAVES_PER_COMPONENT = 3;
interface Wave {
  k: [number, number, number, number];
  phase: number;
  speed: number;
}
const FIELD: Wave[][] = (() => {
  let seed = 0x9e3779b9;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return [0, 1, 2, 3].map(() =>
    Array.from({ length: WAVES_PER_COMPONENT }, () => {
      const k: [number, number, number, number] = [rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1];
      const len = Math.hypot(...k) || 1;
      const mag = 0.7 + 0.6 * rand();
      for (let i = 0; i < 4; i++) k[i] = (k[i] / len) * mag;
      return { k, phase: rand() * 2 * Math.PI, speed: 0.5 + rand() };
    }),
  );
})();
const FIELD_GAIN = 1.4 / WAVES_PER_COMPONENT;

function field(dim: 3 | 4, p: Float64Array, freq: number, time: number, out: Float64Array): void {
  for (let c = 0; c < 4; c++) {
    if (c === 3 && dim === 3) {
      out[c] = 0;
      continue;
    }
    let sum = 0;
    for (const w of FIELD[c]) {
      const dot = w.k[0] * p[0] + w.k[1] * p[1] + w.k[2] * p[2] + (dim === 4 ? w.k[3] * p[3] : 0);
      sum += Math.sin(freq * dot + w.phase + w.speed * time);
    }
    out[c] = sum * FIELD_GAIN;
  }
}

export interface TrailParams {
  /** How many copies, the figure now included. */
  echoes: number;
  /** How far each echo moves from the one before, in circumradii. */
  step: number;
  /** The flow's spatial frequency, in waves per circumradius. */
  freq: number;
  /** The flow's own time (Drift). */
  time: number;
  /** The camera's yaw (orbitYaw). */
  yaw: number;
  /** The figure's size now, in half-heights. */
  radius: number;
  /** Echo k's turn phase and size: k = 0 is now, k frames ago after that. */
  phaseAt(k: number): number;
  radiusAt(k: number): number;
}

/** Writes the whole trail — every edge of every echo, nearest echo first —
 *  as SEGMENT_FLOATS-float segments into `out`, and returns how many it
 *  wrote (never more than fit). */
export function buildTrail(solid: Solid, p: TrailParams, out: Float32Array): number {
  const n = solid.verts.length;
  const dim = solid.dim;
  const screenScale = p.radius / typicalExtent(solid);
  const disp = new Float64Array(n * 4);
  const v = new Float64Array(4);
  const q = new Float64Array(4);
  const f = new Float64Array(4);
  const proj = new Float64Array(n * 3);
  const pr = new Float64Array(3);
  const maxSegments = Math.floor(out.length / SEGMENT_FLOATS);
  const pushAxis = dim === 4 ? 3 : 2;
  let count = 0;
  for (let k = 0; k < p.echoes; k++) {
    const rel = p.radius > 0 ? p.radiusAt(k) / p.radius : 1;
    const phase = p.phaseAt(k);
    for (let i = 0; i < n; i++) {
      pose(solid, solid.verts[i], phase, rel, v);
      if (k > 0) {
        for (let c = 0; c < 4; c++) q[c] = v[c] + disp[i * 4 + c];
        field(dim, q, p.freq, p.time, f);
        f[pushAxis] *= PUSH_AXIS_BEND;
        if (pushAxis !== 2) f[2] *= PUSH_AXIS_BEND;
        for (let c = 0; c < 4; c++) disp[i * 4 + c] += p.step * BEND * f[c];
        disp[i * 4 + pushAxis] -= p.step;
      }
      for (let c = 0; c < 4; c++) v[c] += disp[i * 4 + c];
      project(dim, v, p.yaw, screenScale, pr);
      proj[i * 3] = pr[0];
      proj[i * 3 + 1] = pr[1];
      proj[i * 3 + 2] = pr[2];
    }
    const fade = 1 - k / Math.max(p.echoes, 1);
    for (const [a, b] of solid.edges) {
      if (count >= maxSegments) return count;
      const o = count * SEGMENT_FLOATS;
      out[o] = proj[a * 3];
      out[o + 1] = proj[a * 3 + 1];
      out[o + 2] = proj[b * 3];
      out[o + 3] = proj[b * 3 + 1];
      out[o + 4] = proj[a * 3 + 2];
      out[o + 5] = proj[b * 3 + 2];
      out[o + 6] = fade;
      out[o + 7] = 0;
      count++;
    }
  }
  return count;
}
