// The Neon Gates tunnel as data: the looks the cut cycles through and the
// object list each look is built from. Pure and exported — tests/gates.test.ts
// pins the placement rules; index.ts uploads the result as uniform arrays
// and glsl.ts turns each object into segments.
//
// Every number in LOOKS traces to a "Picture, measured" regime block of the
// reference bundle (tools/.cache/refs/neon-groove/report.md, measured by
// tools/reflook.py): the two hues that carry each regime and their shares,
// the accent, the ground colour and its centre/edge brightness, how many
// lit objects there were and of which shape classes, the share sitting
// exactly on the mirror axes, the stroke width, the glow e-fold, and which
// way the camera flew.

/** Shape ids, as glsl.ts's segmentOf() reads them from uObjA.w. */
export const SHAPE = { PRISM: 0, FRAME: 1, ROD: 2, PANEL: 3 } as const;
export type ShapeId = (typeof SHAPE)[keyof typeof SHAPE];

/** Segment slots per object: a hex prism's two rings plus its pillars. */
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
 *  the look's own weights. */
export function buildLook(look: number, seed: number, count: number, shapeMix = 0.5): LookLayout {
  const spec = LOOKS[look];
  const rng = seededRng(seed * 7919 + look);
  const n = Math.max(0, Math.min(MAX_OBJ, count));
  const objA = new Float32Array(MAX_OBJ * 4);
  const objB = new Float32Array(MAX_OBJ * 4);
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
  }
  return { objA, objB, count: n };
}

/** The segment `i` of a shape in object space, mirrored from glsl.ts's
 *  segmentOf() so the index arithmetic is tested once here. Returns null
 *  for an unused slot. */
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
