// Sweep's pure model: one generator, the *stack*, and everything it needs
// that isn't GL — the measured palettes, rolling a path from a seed, the
// head/tail span, and packing a frame into the shader's one vec4 array
// (glsl.ts). tests/sweep.test.ts pins it.
//
// The stack (docs/scenes/sweep.md, "Deconstruction"): N copies of one shape,
// each copy's place, size and turn blended between a tail end and a head
// end of a path, coloured by its place in the stack on a cyclic five-stop
// palette, the head on top. Every piece of the reference reel is this one
// generator at different knob values; the knobs are the scene's settings
// (index.ts), and `Knobs` below is their effective (drive-applied) values.
//
// Paths. A path is a cubic Bézier of length `travel` in the direction a
// seed rolled (`rollPath`), bent sideways by `bend` (a C or an S, also
// rolled), and placed by `aim`: -1 ends it at the frame centre (heads
// arrive in the middle), +1 starts it there (heads leave the middle), 0
// centres it. A Pair adds a second stack heading roughly the opposite way,
// its colours a fixed step round the palette from the first.
//
// Span. The head's progress `h` (index.ts's eased motion) moves the copies'
// span along the path parameter u in [0, 1]: both ends start at `spread`/2
// (0 = the path's start, 1 = its middle); the head runs to u = 1 while the
// tail runs back to u = 0 at the same pace (so a middle start spreads both
// ways), and `trail` keeps only the head's end of that span (a comet when
// low).
//
// Coordinates are half-heights from the frame centre, y up.

export const SHAPES = ["Blob", "Disc", "Box", "Cube", "Drop"] as const;
export const OUTLINE_STYLES = ["Ink", "Bevel", "Alternate", "Palette"] as const;

export interface PaletteDef {
  name: string;
  /** The reel piece it was measured from (video seconds). */
  ref: string;
  ground: string;
  /** Five stops, read cyclically. */
  stops: readonly [string, string, string, string, string];
  /** Outline colour. */
  ink: string;
  /** What the head turns to at Head = 1. */
  accent: string;
}

/** The reel's palettes, one per piece, from
 *  docs/scenes/sweep/scripts/measure_pieces.py's k-means colours (stop order
 *  read off the frames; the record's Measurements). The enum's last option,
 *  after these, is the room's own palette (`ROOM_PALETTE`). */
export const PALETTES: readonly PaletteDef[] = [
  { name: "Mint", ref: "0–2 s", ground: "#dedee0", stops: ["#52e8a6", "#3390b2", "#950f4e", "#2d0c37", "#b6cdc4"], ink: "#2d0c37", accent: "#950f4e" },
  { name: "Lilac", ref: "2–4 s", ground: "#e4e4e4", stops: ["#e6e3ee", "#cabec4", "#7665c1", "#532eb6", "#679ea3"], ink: "#2a1f6e", accent: "#da4244" },
  { name: "Opal", ref: "4–6 s", ground: "#d8d6d9", stops: ["#cbbea6", "#5fcec4", "#6477b3", "#593891", "#be2c80"], ink: "#3a2470", accent: "#cbbea6" },
  { name: "Honey", ref: "6–8 s", ground: "#d7dfec", stops: ["#afc5d0", "#7cb0ba", "#dbb672", "#c76193", "#416091"], ink: "#24305a", accent: "#c76193" },
  { name: "Prism", ref: "8–10 s", ground: "#b6c1cc", stops: ["#bb44c8", "#3a5ad8", "#4ec9d8", "#3f8f5a", "#c9a35a"], ink: "#273a50", accent: "#b04ad8" },
  { name: "Candy", ref: "10–12 s", ground: "#c8c6e8", stops: ["#c182d2", "#cc6e94", "#b88858", "#c1aabd", "#af4966"], ink: "#5a2a4a", accent: "#f2eef6" },
  { name: "Pool", ref: "12–14 s", ground: "#dedee0", stops: ["#2a95b9", "#6d5cac", "#1e3b88", "#cc85ae", "#95d9e3"], ink: "#1e2a6e", accent: "#2a95b9" },
  { name: "Ember", ref: "14–16 s", ground: "#dedde4", stops: ["#d60b10", "#e0882a", "#c6bcbf", "#7245ca", "#31258e"], ink: "#3a2a5a", accent: "#d60b10" },
  { name: "Peach", ref: "16–18 s", ground: "#e7ece6", stops: ["#2a3a9c", "#9c85d7", "#eef0ec", "#f2b9a0", "#e86a3a"], ink: "#2a3a9c", accent: "#e86a3a" },
  { name: "Flame", ref: "18–20 s", ground: "#e9e4ec", stops: ["#140423", "#5a3be0", "#f4d8e8", "#f5b52a", "#d23a2a"], ink: "#140423", accent: "#f5b52a" },
];

/** The Palette enum's index for the room palette (after the measured ones). */
export const ROOM_PALETTE = PALETTES.length;

/** Palette step between a Pair's two stacks (Pool's blue/purple sit one
 *  stop apart; Ember's red/navy one stop the other way round). */
export const PAIR_PALETTE_STEP = 0.2;

/** Every shape fits inside this of its centre at scale 1 and Stretch 1
 *  (glsl.ts's shapeSdf) — the copy reject and the bounding boxes. */
export const SHAPE_REACH = 1.3;

export const MAX_COPIES = 160;
export const MAX_STACKS = 2;

/** Steps' band height at Steps = 1, half-heights. */
export const STEP_MAX = 0.09;

export type Vec2 = readonly [number, number];

/** Effective knob values (settings with their drives applied). */
export interface Knobs {
  shape: number;
  stretch: number;
  copies: number;
  size: number;
  taper: number;
  /** Radians, tail to head. */
  twist: number;
  pair: boolean;
  travel: number;
  bend: number;
  aim: number;
  spread: number;
  trail: number;
  palette: number;
  bands: number;
  head: number;
  rim: number;
  sheen: number;
  faces: number;
  opacity: number;
  multiply: number;
  outline: number;
  outlineStyle: number;
  outlineReach: number;
  blur: number;
  headBlur: number;
  fade: number;
  steps: number;
}

// ---------------------------------------------------------------- rng

/** mulberry32: small, seedable, good enough for picking a path. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- paths

/** What a seed decides about a piece: everything the knobs don't. */
export interface PathRoll {
  /** Travel direction of the first stack, radians. */
  theta: number;
  /** An S (handles on opposite sides) rather than a C. */
  sCurve: boolean;
  bendSign: number;
  centre: Vec2;
  /** The pair's own direction, bend side and centre. */
  pairTheta: number;
  pairBendSign: number;
  pairCentre: Vec2;
  /** Which way round the palette the pair's colours step. */
  pairPalSign: number;
  /** A small turn for the shapes that sit upright (Box, Cube). */
  tilt: number;
}

export function rollPath(seed: number): PathRoll {
  const rng = createRng(seed);
  const theta = rng() * Math.PI * 2;
  const jitter = () => (rng() * 2 - 1) * 0.12;
  return {
    theta,
    sCurve: rng() < 0.4,
    bendSign: rng() < 0.5 ? -1 : 1,
    centre: [jitter(), jitter()],
    pairTheta: theta + Math.PI + (rng() * 2 - 1) * 0.6,
    pairBendSign: rng() < 0.5 ? -1 : 1,
    pairCentre: [jitter(), jitter()],
    pairPalSign: rng() < 0.5 ? -1 : 1,
    tilt: (rng() * 2 - 1) * 0.25,
  };
}

export interface StackGeom {
  /** Cubic Bézier control points, tail end first. */
  p: readonly [Vec2, Vec2, Vec2, Vec2];
  /** The shape's own turn at the tail end, radians. */
  angle0: number;
  palOffset: number;
}

const UPRIGHT_SHAPES: ReadonlySet<number> = new Set([SHAPES.indexOf("Box"), SHAPES.indexOf("Cube")]);

export function stackGeometry(roll: PathRoll, k: Knobs, j: number): StackGeom {
  const theta = j === 0 ? roll.theta : roll.pairTheta;
  const sign = j === 0 ? roll.bendSign : roll.pairBendSign;
  const c = j === 0 ? roll.centre : roll.pairCentre;
  const d: Vec2 = [Math.cos(theta), Math.sin(theta)];
  const n: Vec2 = [-d[1], d[0]];
  const L = Math.max(0, k.travel);
  // aim -1: the path ends at the centre; +1: it starts there; 0: centred.
  const startAlong = -L * (1 - k.aim) * 0.5;
  const p0: Vec2 = [c[0] + d[0] * startAlong, c[1] + d[1] * startAlong];
  const off1 = k.bend * L * 0.75 * sign;
  const off2 = roll.sCurve ? -off1 : off1;
  const at = (f: number, off: number): Vec2 => [p0[0] + d[0] * L * f + n[0] * off, p0[1] + d[1] * L * f + n[1] * off];
  const angle0 = UPRIGHT_SHAPES.has(Math.round(k.shape)) ? roll.tilt : theta - Math.PI / 2;
  return {
    p: [p0, at(1 / 3, off1), at(2 / 3, off2), at(1, 0)],
    angle0,
    palOffset: j === 0 ? 0 : PAIR_PALETTE_STEP * roll.pairPalSign,
  };
}

export function bezier(p: StackGeom["p"], s: number): [number, number] {
  const u = 1 - s;
  const a = u * u * u;
  const b = 3 * u * u * s;
  const c = 3 * u * s * s;
  const d = s * s * s;
  return [a * p[0][0] + b * p[1][0] + c * p[2][0] + d * p[3][0], a * p[0][1] + b * p[1][1] + c * p[2][1] + d * p[3][1]];
}

/** Path parameters the copies span, [tail, head], for head progress h. */
export function span(h: number, spread: number, trail: number): [number, number] {
  const v0 = 0.5 * Math.min(1, Math.max(0, spread));
  const hh = Math.min(1, Math.max(0, h));
  const head = v0 + (1 - v0) * hh;
  const tail = v0 * (1 - hh);
  const t = Math.min(1, Math.max(0, trail));
  return [head - (head - tail) * t, head];
}

/** Scales at the tail and head ends: Size is their geometric middle, Taper
 *  the log2 of half their ratio (−1: the head is a quarter of the tail). */
export function endScales(size: number, taper: number): [number, number] {
  return [size * Math.pow(2, -taper), size * Math.pow(2, taper)];
}

// ---------------------------------------------------------------- motion

/** How fast the eased head approaches the end of its path per unit of
 *  progress. */
export const HEAD_EASE = 1.6;

/** Where a fresh path's head starts — the reel's pieces open with the
 *  shape already there, not a bare ground. */
export const HEAD_START = 0.25;

export function headOf(progress: number): number {
  return 1 - Math.exp(-HEAD_EASE * Math.max(0, progress));
}

export function progressFor(head: number): number {
  return -Math.log(1 - Math.min(0.999, Math.max(0, head))) / HEAD_EASE;
}

/** Grid ticks per new path for a New path amount: the default amount waits
 *  `base` ticks, right waits fewer, 0 never re-rolls. */
export function newPathDivisor(amount: number, defaultAmount: number, base: number): number {
  if (amount <= 0.02) return 0;
  return Math.max(1, Math.round((base * defaultAmount) / amount));
}

// ---------------------------------------------------------------- packing

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** vec4 slots of the shader's `uSw` array. glsl.ts generates its #defines
 *  from this table, so the two cannot drift apart. */
export const SW = {
  GROUND: 0, // rgb, shape
  PAL: 1, // five slots: rgb
  HEAD: 6, // accent rgb, head
  INK: 7, // rgb, outline style
  LOOK: 8, // outline width, outline reach, opacity, rim
  LOOK2: 9, // faces, blur, fade, bands
  LOOK3: 10, // copies, stack count, palette phase, sheen
  LOOK4: 11, // head blur, stretch, multiply, step height
  FLAGS: 12, // room palette (0/1), -, -, -
  STACK0: 13, // per stack, four slots: p0 p1 | p2 p3 | tailScale log2(head/tail) angle0 twist | uTail uHead palOffset boundarySpeed
  BOX0: 21, // per stack: minX minY maxX maxY
  LEN: 23,
} as const;

export interface FrameState {
  roll: PathRoll;
  /** Eased head progress, 0..1. */
  head: number;
  /** Palette phase from Colour flow, cycles. */
  phase: number;
}

export function copiesFor(copies: number): number {
  return Math.max(2, Math.min(MAX_COPIES, Math.round(copies)));
}

/** Box (minX, minY, maxX, maxY) holding every copy of a stack on [s0, s1]. */
export function stackBounds(g: StackGeom, s0: number, s1: number, k: Knobs): [number, number, number, number] {
  const [tailScale, headScale] = endScales(k.size, k.taper);
  const reach = SHAPE_REACH * Math.max(1, k.stretch);
  const pad = 2 * k.blur + k.outline * 1.6 + k.steps * STEP_MAX;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const steps = 32;
  for (let i = 0; i <= steps; i++) {
    const s = s0 + ((s1 - s0) * i) / steps;
    const [x, y] = bezier(g.p, s);
    const r = tailScale * Math.pow(headScale / tailScale, s) * reach + pad;
    x0 = Math.min(x0, x - r);
    y0 = Math.min(y0, y - r);
    x1 = Math.max(x1, x + r);
    y1 = Math.max(y1, y + r);
  }
  // Sampling can step over a bulge between two samples.
  const m = 0.04;
  return [x0 - m, y0 - m, x1 + m, y1 + m];
}

/** How far any point of a copy's boundary can move per unit of the path
 *  parameter, at most, over [s0, s1] — the centre's own speed, the reach
 *  growing or shrinking with the scale, and the reach swinging with the
 *  twist. The shader divides it by the copy count to get the most one copy
 *  can differ from the next, and skips copies that cannot reach a pixel yet
 *  (glsl.ts's copy loop). */
export function boundarySpeed(g: StackGeom, s0: number, s1: number, k: Knobs): number {
  const [tailScale, headScale] = endScales(k.size, k.taper);
  const reach = SHAPE_REACH * Math.max(1, k.stretch);
  const lnRatio = Math.log(headScale / tailScale);
  const steps = 32;
  const ds = (s1 - s0) / steps;
  let best = 0;
  for (let i = 0; i < steps; i++) {
    const a = s0 + ds * i;
    const b = a + ds;
    const [xa, ya] = bezier(g.p, a);
    const [xb, yb] = bezier(g.p, b);
    const scale = Math.max(tailScale * Math.pow(headScale / tailScale, a), tailScale * Math.pow(headScale / tailScale, b));
    const move = ds === 0 ? 0 : Math.hypot(xb - xa, yb - ya) / Math.abs(ds);
    best = Math.max(best, move + scale * reach * (Math.abs(lnRatio) + Math.abs(k.twist)));
  }
  // Sampling can miss the fastest point between two samples.
  return best * 1.1 + 1e-4;
}

export function packFrame(state: FrameState, k: Knobs, out: Float32Array = new Float32Array(SW.LEN * 4)): Float32Array {
  out.fill(0);
  const set = (slot: number, x: number, y: number, z: number, w: number) => {
    out[slot * 4] = x;
    out[slot * 4 + 1] = y;
    out[slot * 4 + 2] = z;
    out[slot * 4 + 3] = w;
  };
  const palIndex = Math.round(k.palette);
  const room = palIndex >= ROOM_PALETTE;
  const pal = PALETTES[Math.min(PALETTES.length - 1, Math.max(0, palIndex))];
  const g = hexToRgb(pal.ground);
  set(SW.GROUND, g[0], g[1], g[2], Math.round(k.shape));
  pal.stops.forEach((hex, i) => {
    const c = hexToRgb(hex);
    set(SW.PAL + i, c[0], c[1], c[2], 0);
  });
  const a = hexToRgb(pal.accent);
  set(SW.HEAD, a[0], a[1], a[2], k.head);
  const ink = hexToRgb(pal.ink);
  set(SW.INK, ink[0], ink[1], ink[2], Math.round(k.outlineStyle));
  set(SW.LOOK, k.outline, k.outlineReach, k.opacity, k.rim);
  set(SW.LOOK2, k.faces, k.blur, k.fade, k.bands);
  const nStacks = k.pair ? 2 : 1;
  set(SW.LOOK3, copiesFor(k.copies), nStacks, state.phase, k.sheen);
  set(SW.LOOK4, k.headBlur, k.stretch, k.multiply, k.steps * STEP_MAX);
  set(SW.FLAGS, room ? 1 : 0, 0, 0, 0);
  const [uTail, uHead] = span(state.head, k.spread, k.trail);
  const [tailScale, headScale] = endScales(k.size, k.taper);
  for (let j = 0; j < nStacks; j++) {
    const geom = stackGeometry(state.roll, k, j);
    const base = SW.STACK0 + j * 4;
    set(base, geom.p[0][0], geom.p[0][1], geom.p[1][0], geom.p[1][1]);
    set(base + 1, geom.p[2][0], geom.p[2][1], geom.p[3][0], geom.p[3][1]);
    set(base + 2, tailScale, Math.log2(headScale / tailScale), geom.angle0, k.twist);
    set(base + 3, uTail, uHead, geom.palOffset, boundarySpeed(geom, uTail, uHead, k));
    const box = stackBounds(geom, uTail, uHead, k);
    set(SW.BOX0 + j, box[0], box[1], box[2], box[3]);
  }
  return out;
}
