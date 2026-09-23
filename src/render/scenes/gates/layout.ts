// The Neon Gates tunnel as data: the looks the scheduler morphs between and
// the object list each look is built from. Pure and exported —
// tests/gates.test.ts pins the placement rules; index.ts uploads the morphed
// result as uniform arrays and glsl.ts turns each object into segments.
//
// Every number in LOOKS traces to a "Picture, measured" regime block of the
// reference bundle (tools/.cache/refs/neon-groove/report.md, measured by
// tools/reflook.py): the two hues that carry each regime and their shares,
// the accent, the ground colour and its centre/edge brightness, how many
// lit objects there were and of which shape classes, the share sitting
// exactly on the mirror axes, the stroke width, the glow e-fold, and which
// way the camera flew.
//
// Morphing between two looks (index.ts's advanceGates picks *when*; this
// file supplies *what to draw* while it happens) is a three-step pipeline:
//   1. pairLayouts matches every object in the look being left (`from`) to
//      one in the look being entered (`to`) by nearest position — greedy
//      nearest-neighbour, not index order, so a hexagon slides to whichever
//      frame is actually closest rather than whatever happened to build at
//      the same array slot. A count mismatch is handled by "borrowing": a
//      leftover target is born out of its nearest already-matched source's
//      position (fading in via `presence`), a leftover source dies into its
//      nearest already-matched target's position (fading out) — see
//      MorphPairs' field comments for the exact encoding.
//   2. morphLayout walks those pairs at a progress `e` (0 = fully `from`, 1
//      = fully `to`) and fills the three uniform-shaped output arrays:
//      position interpolates in polar (radius, angle) so an object slides
//      around the tunnel wall rather than through its centre; z wraps the
//      short way around the tunnel; size interpolates from/to zero for a
//      birth/death so it grows or shrinks instead of popping; and an "axis
//      weight" per endpoint (0 exactly on a mirror axis, 1 off it) is
//      carried through so glsl.ts can fade a mirror copy in/out continuously
//      instead of the old hard on/off (an object crossing an axis mid-morph
//      would otherwise flash a duplicate).
//   3. The shape itself morphs too: every shape (prism, frame, rod, panel)
//      is described over the same SEG_MAX=18 slots (two 6-vertex rings plus
//      6 pillars — today's prism topology). ringVertex/shapePresence give
//      each shape's vertex positions and which of the 18 slots are "real"
//      edges for it; a FRAME reuses the 6 hexagon ring slots by mapping two
//      pairs onto the same corner (slots 0,1 -> the same corner, and 3,4 ->
//      another), producing 2 zero-length ring edges and 2 duplicate pillars
//      per ring that segPresence carries at 0 — leaving exactly the frame's
//      real 12 edges (4 top, 4 bottom via the two rings, 4 verticals) once
//      the dupes are filtered. A ROD/PANEL collapses every ring vertex to
//      the axis and gives slot 12's pillar (vertex 0) full presence, the
//      rest 0 — today's single centre segment. morphSegment blends a shape's
//      vertex formula toward another's at the same progress `e`, so a
//      degenerating slot's presence ramps through low values exactly where
//      its geometry is collapsing — that IS the morph, not a separate step.
//      glsl.ts ports this same topology into GLSL (see its header); the
//      `segmentOf`/edge-count tests below are the spec both sides are
//      pinned against.

/** Shape ids, as glsl.ts's morphSegment/segmentOf read them. */
export const SHAPE = { PRISM: 0, FRAME: 1, ROD: 2, PANEL: 3 } as const;
export type ShapeId = (typeof SHAPE)[keyof typeof SHAPE];

/** Segment slots per object: a hex prism's two rings plus its pillars —
 *  every shape (see the header) is described over this same topology. */
export const SEG_MAX = 18;
/** Objects the uniform arrays hold (each appears once per mirror copy). */
export const MAX_OBJ = 48;
/** Length of the wrapping tunnel, in world units; the camera sits at z = 0
 *  and looks down +z. */
export const TUNNEL_LEN = 14;
/** Where the tunnel wall sits, in world units off the axis. */
export const RADIUS_MIN = 0.55;
export const RADIUS_MAX = 2.4;

export type Rgb = readonly [number, number, number];

export interface LookSpec {
  name: string;
  primary: Rgb;
  secondary: Rgb;
  accent: Rgb;
  /** Share of objects drawn in the secondary and the accent colour. */
  secondaryShare: number;
  accentShare: number;
  ground: Rgb;
  /** Edge brightness over centre brightness of the ground. */
  vignette: number;
  /** Objects at Density 0.5 and full detail, before mirror copies. */
  objects: number;
  /** Relative weights of prism, frame, rod, panel. */
  shapes: readonly [number, number, number, number];
  /** Share of objects placed exactly on a mirror axis. */
  onAxis: number;
  /** Cross-section scale of prisms and frames, world units. */
  size: number;
  /** Length of rods along the tunnel, world units. */
  rodLen: number;
  /** Tube half-width, world units. */
  stroke: number;
  /** Bloom weights for the tight and the wide blur level. */
  glowA: number;
  glowB: number;
  /** +1 flies toward the camera (objects grow), -1 away (objects recede). */
  dir: 1 | -1;
  /** Fly-speed multiplier for this look. */
  speed: number;
}

export const LOOKS: readonly LookSpec[] = [
  {
    // Regime 1: a dense orange corridor with blue accents, tight glow, fast.
    name: "corridor",
    primary: [1.0, 0.42, 0.12],
    secondary: [0.2, 0.75, 1.0],
    accent: [0.3, 1.0, 0.5],
    secondaryShare: 0.27,
    accentShare: 0.05,
    ground: [0.012, 0.02, 0.035],
    vignette: 1.0,
    objects: 44,
    shapes: [0.1, 0.2, 0.55, 0.15],
    onAxis: 0.36,
    size: 0.3,
    rodLen: 1.4,
    stroke: 0.018,
    glowA: 0.6,
    glowB: 0.25,
    dir: -1,
    speed: 1.5,
  },
  {
    // Regime 2: azure beams pointed at the vanishing point, small hex prisms.
    name: "beams",
    primary: [0.2, 0.5, 1.0],
    secondary: [0.15, 0.95, 1.0],
    accent: [1.0, 0.3, 0.6],
    secondaryShare: 0.45,
    accentShare: 0.03,
    ground: [0.0, 0.025, 0.04],
    vignette: 1.0,
    objects: 28,
    shapes: [0.3, 0.1, 0.55, 0.05],
    onAxis: 0.22,
    size: 0.35,
    rodLen: 4.0,
    stroke: 0.014,
    glowA: 0.5,
    glowB: 0.7,
    dir: -1,
    speed: 1.0,
  },
  {
    // Regime 3: a few big cyan prisms and tall frames on the axes, thick
    // strokes, a green haze on the ground.
    name: "big gates",
    primary: [0.2, 1.0, 0.95],
    secondary: [0.45, 0.85, 1.0],
    accent: [0.25, 0.6, 1.0],
    secondaryShare: 0.3,
    accentShare: 0.05,
    ground: [0.002, 0.085, 0.055],
    vignette: 0.66,
    objects: 16,
    shapes: [0.45, 0.4, 0.1, 0.05],
    onAxis: 0.61,
    size: 0.5,
    rodLen: 2.0,
    stroke: 0.03,
    glowA: 0.7,
    glowB: 0.5,
    dir: -1,
    speed: 0.7,
  },
  {
    // Regime 4: nested azure prisms, rose bars, small yellow-green rings
    // deep in the tunnel; the slow drift toward the camera.
    name: "nested",
    primary: [0.25, 0.55, 1.0],
    secondary: [0.15, 0.95, 1.0],
    accent: [1.0, 0.25, 0.45],
    secondaryShare: 0.28,
    accentShare: 0.12,
    ground: [0.0, 0.04, 0.055],
    vignette: 1.0,
    objects: 44,
    shapes: [0.5, 0.05, 0.4, 0.05],
    onAxis: 0.32,
    size: 0.45,
    rodLen: 1.4,
    stroke: 0.02,
    glowA: 0.6,
    glowB: 0.45,
    dir: 1,
    speed: 0.5,
  },
  {
    // Regime 5: gold rods and frames, a warm haze, flying toward the camera.
    name: "gold",
    primary: [1.0, 0.85, 0.15],
    secondary: [1.0, 0.5, 0.1],
    accent: [0.3, 0.5, 1.0],
    secondaryShare: 0.2,
    accentShare: 0.08,
    ground: [0.1, 0.045, 0.0],
    vignette: 0.6,
    objects: 44,
    shapes: [0.15, 0.3, 0.4, 0.15],
    onAxis: 0.37,
    size: 0.4,
    rodLen: 1.8,
    stroke: 0.02,
    glowA: 0.5,
    glowB: 0.9,
    dir: 1,
    speed: 0.6,
  },
];

export interface LookLayout {
  /** Per object: x, y (tunnel cross-section, world), z0 along the tunnel,
   *  and shape + 4 * colour key (0 primary, 1 secondary, 2 accent). */
  objA: Float32Array;
  /** Per object: cross-section half extents sx, sy; depth dz; tube
   *  half-width. */
  objB: Float32Array;
  /** Per object: brightness jitter (0.75..1.25) — part of the object's
   *  identity, generated alongside its other fields, not tied to its array
   *  slot, since a morph can re-pair slots between two layouts. */
  gain: Float32Array;
  count: number;
}

/** How many objects a look gets at a Density setting and a quality detail. */
export function objectCountFor(look: number, density: number, detail: number): number {
  const spec = LOOKS[look];
  const n = spec.objects * (0.4 + 1.2 * density) * (0.5 + 0.5 * detail);
  return Math.max(4, Math.min(MAX_OBJ, Math.round(n)));
}

/** A small deterministic generator so a layout is reproducible per seed. */
export function seededRng(seed: number): () => number {
  let s = (seed * 2654435761 + 1013904223) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function weightedPick(weights: readonly number[], u: number): number {
  let total = 0;
  for (const w of weights) total += w;
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i];
    if (u * total < acc) return i;
  }
  return weights.length - 1;
}

/** Places `count` objects for a look. `shapeMix` 0..1 leans the shape
 *  weights toward prisms and frames (0) or rods and panels (1); 0.5 keeps
 *  the look's own weights.
 *
 *  Prefix-stable by construction: object i's draws depend only on the rng
 *  stream position after objects 0..i-1, never on `count` itself, so a
 *  larger count's layout starts with exactly the smaller count's objects
 *  (buildLook's own test pins this — it's what lets a Density change morph
 *  smoothly instead of reshuffling every object). */
export function buildLook(look: number, seed: number, count: number, shapeMix = 0.5): LookLayout {
  const spec = LOOKS[look];
  const rng = seededRng(seed * 7919 + look);
  const n = Math.max(0, Math.min(MAX_OBJ, count));
  const objA = new Float32Array(MAX_OBJ * 4);
  const objB = new Float32Array(MAX_OBJ * 4);
  const gain = new Float32Array(MAX_OBJ);
  const ringish = Math.max(0, 1 - shapeMix) * 2;
  const barish = Math.max(0, shapeMix) * 2;
  const weights = [
    spec.shapes[0] * ringish,
    spec.shapes[1] * ringish,
    spec.shapes[2] * barish,
    spec.shapes[3] * barish,
  ];
  for (let i = 0; i < n; i++) {
    const shape = weightedPick(weights, rng()) as ShapeId;
    const radius = RADIUS_MIN + (RADIUS_MAX - RADIUS_MIN) * rng();
    let x: number;
    let y: number;
    if (rng() < spec.onAxis) {
      // Exactly on an axis, so the shader can drop the mirror copies that
      // would land on top of it.
      if (rng() < 0.5) {
        x = radius;
        y = 0;
      } else {
        x = 0;
        y = radius;
      }
    } else {
      const th = rng() * Math.PI * 0.5;
      x = radius * Math.cos(th);
      y = radius * Math.sin(th);
    }
    const z0 = rng() * TUNNEL_LEN;
    const cu = rng();
    const key = cu < spec.accentShare ? 2 : cu < spec.accentShare + spec.secondaryShare ? 1 : 0;

    const s = spec.size * (0.55 + 0.9 * rng());
    let sx = 0;
    let sy = 0;
    let dz = 0;
    let half = spec.stroke * (0.7 + 0.6 * rng());
    if (shape === SHAPE.PRISM) {
      sx = s;
      sy = s;
      dz = s * (0.6 + 0.7 * rng());
    } else if (shape === SHAPE.FRAME) {
      sx = s * (0.5 + 0.5 * rng());
      sy = s * (1.0 + 0.8 * rng());
      dz = s * (0.5 + 1.0 * rng());
    } else if (shape === SHAPE.ROD) {
      dz = spec.rodLen * (0.5 + 1.0 * rng());
    } else {
      dz = spec.rodLen * (0.2 + 0.3 * rng());
      half = spec.size * (0.12 + 0.12 * rng());
    }
    objA[i * 4] = x;
    objA[i * 4 + 1] = y;
    objA[i * 4 + 2] = z0;
    objA[i * 4 + 3] = shape + 4 * key;
    objB[i * 4] = sx;
    objB[i * 4 + 1] = sy;
    objB[i * 4 + 2] = dz;
    objB[i * 4 + 3] = half;
    gain[i] = 0.75 + 0.5 * rng();
  }
  return { objA, objB, gain, count: n };
}

/** The segment `i` of a shape in object space, mirrored from glsl.ts's
 *  segmentOf() so the index arithmetic is tested once here. Returns null
 *  for an unused slot. Untouched by the morph work below — still exactly
 *  today's non-morphing shape, so the existing edge-count test keeps
 *  pinning it directly. */
export function segmentOf(
  shape: ShapeId,
  i: number,
  sx: number,
  sy: number,
  dz: number,
): [[number, number, number], [number, number, number]] | null {
  const h = dz * 0.5;
  if (shape === SHAPE.PRISM) {
    const v = (k: number): [number, number] => {
      const a = Math.PI / 2 + (Math.PI / 3) * (k % 6);
      return [sx * Math.cos(a), sx * Math.sin(a)];
    };
    if (i < 6) return [[...v(i), -h], [...v(i + 1), -h]];
    if (i < 12) return [[...v(i - 6), h], [...v(i - 5), h]];
    if (i < 18) return [[...v(i - 12), -h], [...v(i - 12), h]];
    return null;
  }
  if (shape === SHAPE.FRAME) {
    const c = (k: number): [number, number] => {
      const m = k % 4;
      return [m === 0 || m === 3 ? -sx : sx, m < 2 ? -sy : sy];
    };
    if (i < 4) return [[...c(i), -h], [...c(i + 1), -h]];
    if (i < 8) return [[...c(i - 4), h], [...c(i - 3), h]];
    if (i < 12) return [[...c(i - 8), -h], [...c(i - 8), h]];
    return null;
  }
  if (i === 0) return [[0, 0, -h], [0, 0, h]];
  return null;
}

// ---------------------------------------------------------------------------
// Shared shape topology: every shape lives on the same SEG_MAX=18 slots (two
// 6-vertex rings, 6 pillars), so morphSegment can blend one shape's geometry
// toward another's slot-by-slot. glsl.ts ports ringVertex/shapePresence/
// morphSegment verbatim (see its header) — this file is the source of truth
// the tests below pin.

/** Ring vertex `k` (0..5) of `shape`'s cross-section at half-extents
 *  (sx, sy). FRAME maps the 6 slots onto its 4 real corners with 2
 *  duplicated corners (slots 0,1 share one corner; 3,4 share another) so
 *  that, once the duplicate ring edges and pillars are presence-0 (see
 *  shapePresence), what's left is exactly the frame's own 4-corner
 *  rectangle. ROD and PANEL collapse every vertex to the tunnel axis. */
export function ringVertex(shape: ShapeId, k: number, sx: number, sy: number): [number, number] {
  const kk = ((k % 6) + 6) % 6;
  if (shape === SHAPE.PRISM) {
    const a = Math.PI / 2 + (Math.PI / 3) * kk;
    return [sx * Math.cos(a), sx * Math.sin(a)];
  }
  if (shape === SHAPE.FRAME) {
    const corner = kk === 0 || kk === 1 ? 0 : kk === 2 ? 1 : kk === 3 || kk === 4 ? 2 : 3;
    const x = corner === 0 || corner === 3 ? -sx : sx;
    const y = corner < 2 ? -sy : sy;
    return [x, y];
  }
  return [0, 0]; // ROD, PANEL: every ring vertex sits on the axis.
}

/** 1 when slot `i` (0..17: two 6-edge rings, then 6 pillars) is a real edge
 *  of `shape`; 0 for a degenerate dupe that exists only to keep every shape
 *  on the same SEG_MAX topology. Sums to 18 real slots for PRISM, 12 for
 *  FRAME, 1 for ROD/PANEL — the edge-count test below checks this against
 *  segmentOf's own (independently written) count. */
export function shapePresence(shape: ShapeId, i: number): 0 | 1 {
  if (shape === SHAPE.PRISM) return 1;
  if (shape === SHAPE.FRAME) {
    const k = i < 6 ? i : i < 12 ? i - 6 : i - 12;
    if (i < 12) return k === 0 || k === 3 ? 0 : 1;
    return k === 1 || k === 4 ? 0 : 1;
  }
  return i === 12 ? 1 : 0; // ROD, PANEL: one pillar (vertex slot 0).
}

/** Blend of shapeFrom's and shapeTo's presence for slot `i`, at progress
 *  `e`. A slot's presence ramping through low values *is* the morph — its
 *  geometry (from morphSegment) collapses toward the same point at the same
 *  rate, so a fading edge shrinks to nothing rather than popping. */
export function segPresence(shapeFrom: ShapeId, shapeTo: ShapeId, i: number, e: number): number {
  const a = shapePresence(shapeFrom, i);
  const b = shapePresence(shapeTo, i);
  return a + (b - a) * e;
}

export interface MorphedSegment {
  a: [number, number, number];
  b: [number, number, number];
  presence: number;
}

export interface SegmentDims {
  sx: number;
  sy: number;
  dz: number;
}

/** Segment `i`, morphing shapeFrom's topology (at dimsFrom) toward shapeTo's
 *  (at dimsTo) as `e` goes 0 -> 1. At e=0 this reproduces segmentOf(shapeFrom,
 *  i, dimsFrom...) for every slot where shapeFrom has presence; at e=1,
 *  segmentOf(shapeTo, ...) — pinned by the "matches segmentOf at the two
 *  endpoints" test. glsl.ts's GLSL port takes a single already-blended dims
 *  (uObjB.xyz) in place of dimsFrom/dimsTo, since the uniform layout has no
 *  room for two full dims vectors per object — exact at e=0/1 (where the
 *  blended dims already equals dimsFrom/dimsTo respectively), a smooth
 *  approximation in between. */
export function morphSegment(
  shapeFrom: ShapeId,
  shapeTo: ShapeId,
  i: number,
  dimsFrom: SegmentDims,
  dimsTo: SegmentDims,
  e: number,
): MorphedSegment {
  const hFrom = dimsFrom.dz * 0.5;
  const hTo = dimsTo.dz * 0.5;
  const h = hFrom + (hTo - hFrom) * e;
  const presence = segPresence(shapeFrom, shapeTo, i, e);
  const lerp2 = (p: [number, number], q: [number, number]): [number, number] => [
    p[0] + (q[0] - p[0]) * e,
    p[1] + (q[1] - p[1]) * e,
  ];
  if (i < 12) {
    const k = i < 6 ? i : i - 6;
    const k1 = (k + 1) % 6;
    const pFrom = ringVertex(shapeFrom, k, dimsFrom.sx, dimsFrom.sy);
    const pFrom2 = ringVertex(shapeFrom, k1, dimsFrom.sx, dimsFrom.sy);
    const pTo = ringVertex(shapeTo, k, dimsTo.sx, dimsTo.sy);
    const pTo2 = ringVertex(shapeTo, k1, dimsTo.sx, dimsTo.sy);
    const z = i < 6 ? -h : h;
    const [ax, ay] = lerp2(pFrom, pTo);
    const [bx, by] = lerp2(pFrom2, pTo2);
    return { a: [ax, ay, z], b: [bx, by, z], presence };
  }
  const k = i - 12;
  const pFrom = ringVertex(shapeFrom, k, dimsFrom.sx, dimsFrom.sy);
  const pTo = ringVertex(shapeTo, k, dimsTo.sx, dimsTo.sy);
  const [x, y] = lerp2(pFrom, pTo);
  return { a: [x, y, -h], b: [x, y, h], presence };
}

// ---------------------------------------------------------------------------
// Pairing and per-frame morphing between two built layouts.

/** How much a wrap-distance step along the tunnel counts against a plain
 *  cross-section distance when matching objects — small enough that two
 *  objects at a similar (x, y) but opposite ends of the tunnel still pair up
 *  if nothing closer exists, since the wrap makes "far" along z a soft
 *  boundary, not a wall. */
const Z_PAIR_WEIGHT = 0.3;

function objPos(L: LookLayout, i: number): [number, number, number] {
  return [L.objA[i * 4], L.objA[i * 4 + 1], L.objA[i * 4 + 2]];
}

function pairDist(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const rawDz = Math.abs(a[2] - b[2]);
  const dz = Math.min(rawDz, TUNNEL_LEN - rawDz);
  return Math.hypot(dx, dy) + Z_PAIR_WEIGHT * dz;
}

/**
 * A morph's object correspondence: pair `k` moves fromIdx[k] (an index into
 * `from`'s arrays) toward toIdx[k] (an index into `to`'s arrays).
 *
 * `count` is `max(from.count, to.count)` — every source and every target
 * object is referenced by at least one pair. A count mismatch is handled by
 * "borrowing": a pair with `born[k]` set has no real source, so fromIdx[k]
 * is not its own object but its nearest already-matched neighbour's index,
 * borrowed purely to give it a starting position to grow out of (presence
 * ramps 0 -> 1); symmetrically `dying[k]` borrows toIdx[k] as an ending
 * position to shrink into (presence ramps 1 -> 0). Every plain match (both
 * flags 0) has presence 1 throughout.
 */
export interface MorphPairs {
  fromIdx: Int32Array;
  toIdx: Int32Array;
  born: Uint8Array;
  dying: Uint8Array;
  count: number;
}

/** Pairs object i to itself — the settled/holding state, and init()'s
 *  starting point before any morph has run. */
export function identityPairs(L: LookLayout): MorphPairs {
  const n = L.count;
  const fromIdx = new Int32Array(n);
  const toIdx = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    fromIdx[i] = i;
    toIdx[i] = i;
  }
  return { fromIdx, toIdx, born: new Uint8Array(n), dying: new Uint8Array(n), count: n };
}

/** Greedy nearest-neighbour matching between two layouts — see MorphPairs'
 *  header for the born/dying encoding a count mismatch produces. */
export function pairLayouts(from: LookLayout, to: LookLayout): MorphPairs {
  const nf = from.count;
  const nt = to.count;
  const n = Math.max(nf, nt);
  const fromIdx = new Int32Array(n);
  const toIdx = new Int32Array(n);
  const born = new Uint8Array(n);
  const dying = new Uint8Array(n);

  // Every (i, j) candidate, closest first, claimed while both ends are free
  // — simple and O(n^2 log n^2), fine at MAX_OBJ <= 48.
  const candidates: { i: number; j: number; d: number }[] = [];
  for (let i = 0; i < nf; i++) {
    const pi = objPos(from, i);
    for (let j = 0; j < nt; j++) candidates.push({ i, j, d: pairDist(pi, objPos(to, j)) });
  }
  candidates.sort((a, b) => a.d - b.d);

  const usedFrom = new Uint8Array(nf);
  const usedTo = new Uint8Array(nt);
  const matchedTo = new Int32Array(nf).fill(-1); // from-index -> its matched to-index
  const matchedFrom = new Int32Array(nt).fill(-1); // to-index -> its matched from-index
  let k = 0;
  for (const c of candidates) {
    if (usedFrom[c.i] || usedTo[c.j]) continue;
    usedFrom[c.i] = 1;
    usedTo[c.j] = 1;
    matchedTo[c.i] = c.j;
    matchedFrom[c.j] = c.i;
    fromIdx[k] = c.i;
    toIdx[k] = c.j;
    k++;
  }
  // k === min(nf, nt) now — every object on the smaller side is matched.

  if (nf > nt) {
    // Leftover sources die: each borrows its nearest already-matched
    // target's index as an ending position, so it visibly shrinks near a
    // gate that's still there rather than into empty space.
    for (let i = 0; i < nf; i++) {
      if (usedFrom[i]) continue;
      const pi = objPos(from, i);
      let bestJ = 0;
      let bestD = Infinity;
      for (let j = 0; j < nt; j++) {
        if (matchedFrom[j] < 0) continue;
        const d = pairDist(pi, objPos(to, j));
        if (d < bestD) {
          bestD = d;
          bestJ = j;
        }
      }
      fromIdx[k] = i;
      toIdx[k] = bestJ;
      dying[k] = 1;
      k++;
    }
  } else if (nt > nf) {
    // Leftover targets are born: each borrows its nearest already-matched
    // source's index as a starting position, so it visibly grows out of a
    // gate that's already there.
    for (let j = 0; j < nt; j++) {
      if (usedTo[j]) continue;
      const pj = objPos(to, j);
      let bestI = 0;
      let bestD = Infinity;
      for (let i = 0; i < nf; i++) {
        if (matchedTo[i] < 0) continue;
        const d = pairDist(objPos(from, i), pj);
        if (d < bestD) {
          bestD = d;
          bestI = i;
        }
      }
      fromIdx[k] = bestI;
      toIdx[k] = j;
      born[k] = 1;
      k++;
    }
  }

  return { fromIdx, toIdx, born, dying, count: k };
}

function axisWeight(v: number): 0 | 1 {
  return v === 0 ? 0 : 1;
}

/**
 * Fills the three preallocated, uniform-shaped output arrays (caller-owned,
 * `Float32Array(MAX_OBJ * 4)`) for `pairs.count` objects at progress `e`,
 * and returns that count. Per pair, unlike LookLayout's own objA/objB, the
 * encoding is:
 *   outA = (x, y, z0, half) — half is the tube half-width, now per-object
 *     and blended, so stroke width morphs too.
 *   outB = (sx, sy, dz, presence * gain) — cross-section size, blended from
 *     (or to) zero for a birth/death so it grows/shrinks instead of popping.
 *   outC = (wx, wy, shapeFrom + 4*shapeTo, keyFrom + 4*keyTo) — wx/wy are
 *     the blended axis weights glsl.ts fades a mirror copy by; shape/colour
 *     key move here (off objA) since the shader now needs both endpoints of
 *     each to morph between them.
 * At e=0 this reproduces `from`'s own layout for every plain-matched or
 * dying pair; at e=1, `to`'s, for every plain-matched or born pair — pinned
 * by this file's "morphLayout" tests.
 */
export function morphLayout(
  from: LookLayout,
  to: LookLayout,
  pairs: MorphPairs,
  e: number,
  outA: Float32Array,
  outB: Float32Array,
  outC: Float32Array,
): number {
  const n = pairs.count;
  for (let k = 0; k < n; k++) {
    const fi = pairs.fromIdx[k];
    const ti = pairs.toIdx[k];
    const isBorn = pairs.born[k] === 1;
    const isDying = pairs.dying[k] === 1;

    const x0 = from.objA[fi * 4];
    const y0 = from.objA[fi * 4 + 1];
    const z0f = from.objA[fi * 4 + 2];
    const wA0 = from.objA[fi * 4 + 3];
    const shapeFrom = wA0 % 4;
    const keyFrom = Math.floor(wA0 / 4);
    const sx0 = from.objB[fi * 4];
    const sy0 = from.objB[fi * 4 + 1];
    const dz0 = from.objB[fi * 4 + 2];
    const half0 = from.objB[fi * 4 + 3];
    const gain0 = from.gain[fi];

    const x1 = to.objA[ti * 4];
    const y1 = to.objA[ti * 4 + 1];
    const z1 = to.objA[ti * 4 + 2];
    const wA1 = to.objA[ti * 4 + 3];
    const shapeTo = wA1 % 4;
    const keyTo = Math.floor(wA1 / 4);
    const sx1 = to.objB[ti * 4];
    const sy1 = to.objB[ti * 4 + 1];
    const dz1 = to.objB[ti * 4 + 2];
    const half1 = to.objB[ti * 4 + 3];
    const gain1 = to.gain[ti];

    // Cross-section position, interpolated in polar (radius, angle) — a
    // birth/death still uses its borrowed neighbour's *real* position here
    // (only its size is zeroed below), so it visibly slides from/to that
    // neighbour rather than teleporting.
    const r0 = Math.hypot(x0, y0);
    const a0 = Math.atan2(y0, x0);
    const r1 = Math.hypot(x1, y1);
    const a1 = Math.atan2(y1, x1);
    const r = r0 + (r1 - r0) * e;
    const ang = a0 + (a1 - a0) * e;
    const x = r * Math.cos(ang);
    const y = r * Math.sin(ang);

    // z0 the short way around the tunnel's wrap.
    let dz = z1 - z0f;
    if (dz > TUNNEL_LEN / 2) dz -= TUNNEL_LEN;
    else if (dz < -TUNNEL_LEN / 2) dz += TUNNEL_LEN;
    let z0 = z0f + dz * e;
    if (z0 < 0) z0 += TUNNEL_LEN;
    else if (z0 >= TUNNEL_LEN) z0 -= TUNNEL_LEN;

    const half = half0 + (half1 - half0) * e;

    // A birth grows its cross-section from nothing; a death shrinks it to
    // nothing, rather than snapping to (or away from) the borrowed
    // neighbour's real size.
    const sx0e = isBorn ? 0 : sx0;
    const sy0e = isBorn ? 0 : sy0;
    const dz0e = isBorn ? 0 : dz0;
    const sx1e = isDying ? 0 : sx1;
    const sy1e = isDying ? 0 : sy1;
    const dz1e = isDying ? 0 : dz1;
    const sx = sx0e + (sx1e - sx0e) * e;
    const sy = sy0e + (sy1e - sy0e) * e;
    const dzLen = dz0e + (dz1e - dz0e) * e;

    const presence = isBorn ? e : isDying ? 1 - e : 1;
    // Destination's gain for a plain match too — a look's own jitter is
    // part of its identity, and there's no meaningful "half-jitter" to hold
    // onto once an object has fully arrived.
    const gain = gain0 + (gain1 - gain0) * e;

    // Axis weight per endpoint: how far off that axis the object sits, so a
    // mirror copy fades continuously instead of popping when it crosses the
    // axis mid-morph. A birth/death borrows its missing endpoint's weight
    // from the *other* endpoint (rather than the borrowed neighbour's own
    // axis status), so it doesn't fade a mirror copy in/out from nowhere.
    const wx0 = isBorn ? axisWeight(x1) : axisWeight(x0);
    const wy0 = isBorn ? axisWeight(y1) : axisWeight(y0);
    const wx1 = isDying ? axisWeight(x0) : axisWeight(x1);
    const wy1 = isDying ? axisWeight(y0) : axisWeight(y1);
    const wx = wx0 + (wx1 - wx0) * e;
    const wy = wy0 + (wy1 - wy0) * e;

    outA[k * 4] = x;
    outA[k * 4 + 1] = y;
    outA[k * 4 + 2] = z0;
    outA[k * 4 + 3] = half;

    outB[k * 4] = sx;
    outB[k * 4 + 1] = sy;
    outB[k * 4 + 2] = dzLen;
    outB[k * 4 + 3] = presence * gain;

    outC[k * 4] = wx;
    outC[k * 4 + 1] = wy;
    outC[k * 4 + 2] = shapeFrom + 4 * shapeTo;
    outC[k * 4 + 3] = keyFrom + 4 * keyTo;
  }
  return n;
}
