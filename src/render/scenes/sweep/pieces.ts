// Sweep's pure model: the piece recipes, rolling one into a concrete piece,
// stepping the head along its path, and packing it all into the one vec4
// array the shader reads (glsl.ts). No GL here, so tests/sweep.test.ts can
// pin it.
//
// A *piece* is one picture: a shape (`SHAPES`) swept along one or two cubic
// Bézier paths, each path stamped `copies` times from the tail end to the
// head with the copies coloured off a five-stop palette, outlined, and the
// oldest ones blurred and faded. A *recipe* (`RECIPES`) is a family of pieces
// measured off one piece of the reference reel (docs/scenes/sweep.md,
// Measurements — the hex colours and sizes below come from
// docs/scenes/sweep/scripts/measure_pieces.py); `rollPiece` turns a recipe
// into a concrete piece with a seeded rng (mirror, turn, path jitter, palette
// phase), so two pieces of one recipe are related, not identical.
//
// Head motion: the head's path parameter `h` is an eased function of an
// unbounded progress `progress` (`headOf`) — the head slows as it nears the
// end of its path and never runs off it, however long a phrase lasts. The
// copies span the path from `sTail = h * (1 - trail)` to `h` (`copySpan`), so
// at Trail = 1 the sweep reaches back to where the piece started, the way
// every piece of the reel does.
//
// Coordinates are half-heights from the frame centre, y up (the reference is
// square; a landscape frame just shows more ground at the sides).

export const SHAPES = { blob: 0, disc: 1, rect: 2, cube: 3, drop: 4 } as const;
export type ShapeName = keyof typeof SHAPES;

/** How a copy's outline is coloured: one ink, ink and near-white taking
 *  turns copy by copy (the contour look), or a darker palette colour. */
export const OUTLINE_MODES = { ink: 0, alternate: 1, palette: 2 } as const;
export type OutlineMode = keyof typeof OUTLINE_MODES;

export type Vec2 = readonly [number, number];
export type Rgb = readonly [number, number, number];

export interface SweepPath {
  /** Cubic Bézier control points, tail end first. */
  p: readonly [Vec2, Vec2, Vec2, Vec2];
  /** Shape scale (half-heights) at the tail end and at the head end. */
  scale: readonly [number, number];
  /** Shape rotation (radians, counter-clockwise) at the tail and the head. */
  angle: readonly [number, number];
  /** Where on the palette this path's copies start. */
  palOffset: number;
}

export interface PieceLook {
  shape: ShapeName;
  ground: string;
  /** Five stops, read cyclically. */
  palette: readonly [string, string, string, string, string];
  ink: string;
  /** The newest copy's fill, how far it takes over the palette colour, and
   *  its opacity (Rings' front circle is more solid than the copies). */
  head: string;
  headMix: number;
  headAlpha: number;
  outline: OutlineMode;
  /** Outline width, half-heights. */
  outlineW: number;
  /** How far down the trail outlines stay, as a share of the copies (1 = all). */
  outlineAge: number;
  /** Fill opacity of one copy (below 1 shows the copies behind it). */
  fillAlpha: number;
  /** Palette shift toward a copy's middle — the iridescent rim. */
  rim: number;
  /** Palette shift across the shape (a linear sheen, like light on one side). */
  sheen: number;
  /** Cube face shading strength (0 for every other shape). */
  faceShade: number;
  /** Edge softness of the oldest copy, half-heights. */
  blur: number;
  /** Share of that softness every copy has, the head included. */
  headBlur: number;
  /** How far the oldest copy fades out (1 = gone). */
  fade: number;
  /** Palette cycles from the head to the tail end. */
  stripeCycles: number;
  /** Copies at Copies = 1. */
  copies: number;
  /** Where the head sits on the palette, and how far a roll may shift it
   *  (1 = anywhere): low where the colours belong to particular paths, like
   *  Panels, or run in a set order down the trail, like Drip. */
  phase: number;
  phaseJitter: number;
}

export interface Recipe {
  name: string;
  /** The reel piece it was measured from (video seconds). */
  ref: string;
  look: PieceLook;
  paths: readonly SweepPath[];
  /** Random turn of the whole piece when rolled, radians either way. */
  turn: number;
  /** May the roll mirror it left-right? */
  mirror: boolean;
  /** Control-point jitter when rolled, half-heights. */
  jitter: number;
}

export interface Piece {
  recipe: number;
  look: PieceLook;
  paths: SweepPath[];
  stripePhase: number;
}

// Recipes, one per sweep piece of the reel. The reel's mosaic (10–12 s) and
// contour-band (18–20 s) pieces are not sweeps and were left out (the
// record's Decisions). Grounds and palettes are measure_pieces.py's numbers;
// sizes are read off its bounding boxes, path shapes and colour order off
// the burst frames and a side-by-side with ours (the record's Measurements).
export const RECIPES: readonly Recipe[] = [
  {
    name: "Smear",
    ref: "0–2 s",
    look: {
      shape: "disc",
      ground: "#dedee0",
      // Edge teal, centre magenta (the rim), older copies toward ink.
      palette: ["#52e8a6", "#3390b2", "#950f4e", "#2d0c37", "#b6cdc4"],
      ink: "#2d0c37",
      head: "#2d0c37",
      headMix: 0,
      headAlpha: 1,
      outline: "ink",
      outlineW: 0.006,
      outlineAge: 0.08,
      fillAlpha: 1,
      rim: 0.45,
      sheen: 0.15,
      faceShade: 0,
      blur: 0.18,
      headBlur: 0,
      fade: 0.85,
      stripeCycles: 0.6,
      copies: 40,
      phase: 0,
      phaseJitter: 0.08,
    },
    paths: [
      {
        p: [
          [0.28, 0.3],
          [0.25, -0.05],
          [-0.05, -0.3],
          [-0.22, -0.12],
        ],
        scale: [0.26, 0.3],
        angle: [0, 0],
        palOffset: 0,
      },
    ],
    turn: Math.PI,
    mirror: true,
    jitter: 0.06,
  },
  {
    name: "Contours",
    ref: "2–4 s",
    look: {
      shape: "drop",
      ground: "#e4e4e4",
      palette: ["#e6e3ee", "#cabec4", "#7665c1", "#532eb6", "#679ea3"],
      ink: "#2a1f6e",
      head: "#da4244",
      headMix: 1,
      headAlpha: 1,
      outline: "alternate",
      outlineW: 0.008,
      outlineAge: 1,
      fillAlpha: 1,
      rim: 0.3,
      sheen: 0,
      faceShade: 0,
      blur: 0,
      headBlur: 0,
      fade: 0,
      stripeCycles: 1.5,
      copies: 40,
      phase: 0,
      phaseJitter: 1,
    },
    paths: [
      {
        // Centred on the frame, so any turn of the roll keeps the tail in it.
        p: [
          [-0.28, -0.3],
          [-0.11, -0.27],
          [0.09, 0.12],
          [0.29, 0.32],
        ],
        scale: [0.32, 0.09],
        angle: [-0.7, -0.7],
        palOffset: 0,
      },
    ],
    turn: Math.PI,
    mirror: true,
    jitter: 0.06,
  },
  {
    name: "Halo",
    ref: "4–6 s",
    look: {
      shape: "blob",
      ground: "#d8d6d9",
      palette: ["#cbbea6", "#5fcec4", "#6477b3", "#593891", "#be2c80"],
      ink: "#3a2470",
      head: "#cbbea6",
      headMix: 0.4,
      headAlpha: 1,
      outline: "palette",
      outlineW: 0.011,
      outlineAge: 1,
      fillAlpha: 1,
      rim: 0.6,
      sheen: 0.2,
      faceShade: 0,
      blur: 0.02,
      headBlur: 0,
      fade: 0,
      stripeCycles: 1,
      copies: 10,
      phase: 0,
      phaseJitter: 1,
    },
    paths: [
      {
        p: [
          [0.0, 0.14],
          [0.05, 0.12],
          [0.09, 0.08],
          [0.12, 0.05],
        ],
        scale: [0.31, 0.12],
        angle: [0, 0.5],
        palOffset: 0,
      },
    ],
    turn: Math.PI,
    mirror: true,
    jitter: 0.03,
  },
  {
    name: "Drip",
    ref: "6–8 s",
    look: {
      shape: "drop",
      ground: "#d7dfec",
      // Read head to tail: pink tip, gold stem, teal and pale bulb.
      palette: ["#afc5d0", "#7cb0ba", "#dbb672", "#c76193", "#416091"],
      ink: "#24305a",
      head: "#c76193",
      headMix: 0.5,
      headAlpha: 1,
      outline: "ink",
      outlineW: 0.005,
      outlineAge: 0.3,
      fillAlpha: 1,
      rim: 0.3,
      sheen: 0.15,
      faceShade: 0,
      blur: 0.14,
      headBlur: 0,
      fade: 0.8,
      stripeCycles: -0.6,
      copies: 48,
      phase: 0.62,
      phaseJitter: 0.06,
    },
    paths: [
      {
        p: [
          [0.15, 0.72],
          [0.26, 0.02],
          [0.08, -0.48],
          [-0.2, -0.3],
        ],
        scale: [0.15, 0.035],
        angle: [Math.PI, Math.PI],
        palOffset: 0,
      },
    ],
    turn: 0.25,
    mirror: true,
    jitter: 0.05,
  },
  {
    name: "Rings",
    ref: "8–10 s",
    look: {
      shape: "disc",
      ground: "#b6c1cc",
      palette: ["#bb44c8", "#3a5ad8", "#4ec9d8", "#3f8f5a", "#c9a35a"],
      ink: "#273a50",
      head: "#b04ad8",
      headMix: 0.6,
      headAlpha: 0.55,
      outline: "palette",
      outlineW: 0.011,
      outlineAge: 1,
      fillAlpha: 0.1,
      rim: 0.3,
      sheen: 0.3,
      faceShade: 0,
      blur: 0,
      headBlur: 0,
      fade: 0.2,
      stripeCycles: 2.5,
      copies: 22,
      phase: 0,
      phaseJitter: 1,
    },
    paths: [
      {
        // Swings out to one side and back, so the head ends in the middle
        // with copies on both sides of it, as in the reel.
        p: [
          [-0.3, 0.02],
          [0.55, -0.04],
          [0.35, 0.02],
          [0.0, 0.0],
        ],
        scale: [0.47, 0.47],
        angle: [0, 0],
        palOffset: 0,
      },
    ],
    turn: 0.4,
    mirror: true,
    jitter: 0.04,
  },
  {
    name: "Panels",
    ref: "12–14 s",
    look: {
      shape: "rect",
      ground: "#dedee0",
      palette: ["#2a95b9", "#6d5cac", "#1e3b88", "#cc85ae", "#95d9e3"],
      ink: "#1e2a6e",
      head: "#2a95b9",
      headMix: 0,
      headAlpha: 0.82,
      outline: "ink",
      outlineW: 0.005,
      outlineAge: 0.1,
      fillAlpha: 0.82,
      rim: 0,
      sheen: 0,
      faceShade: 0,
      blur: 0.1,
      headBlur: 0,
      fade: 0.95,
      stripeCycles: 0.15,
      copies: 28,
      phase: 0,
      phaseJitter: 0.05,
    },
    paths: [
      {
        p: [
          [0.0, -0.08],
          [0.02, 0.02],
          [0.05, 0.12],
          [0.08, 0.2],
        ],
        scale: [0.15, 0.46],
        angle: [0, 0],
        palOffset: 0,
      },
      {
        p: [
          [0.05, -0.12],
          [0.0, -0.15],
          [-0.06, -0.18],
          [-0.12, -0.2],
        ],
        scale: [0.13, 0.44],
        angle: [0, 0],
        palOffset: 0.2,
      },
    ],
    turn: 0.05,
    mirror: true,
    jitter: 0.04,
  },
  {
    name: "Cubes",
    ref: "14–16 s",
    look: {
      shape: "cube",
      ground: "#dedde4",
      palette: ["#d60b10", "#e0882a", "#c6bcbf", "#7245ca", "#31258e"],
      ink: "#3a2a5a",
      head: "#d60b10",
      headMix: 0,
      headAlpha: 1,
      outline: "ink",
      outlineW: 0.004,
      outlineAge: 0.05,
      fillAlpha: 1,
      rim: 0,
      sheen: 0,
      faceShade: 1,
      blur: 0.08,
      headBlur: 0,
      fade: 0.55,
      stripeCycles: 1,
      copies: 64,
      phase: 0,
      phaseJitter: 0.08,
    },
    paths: [
      {
        p: [
          [-1.15, 0.3],
          [-0.95, 0.75],
          [-0.45, 0.55],
          [0.02, 0.18],
        ],
        scale: [0.2, 0.2],
        angle: [0.25, 0.05],
        palOffset: 0,
      },
      {
        p: [
          [0.95, -0.85],
          [0.75, -0.35],
          [0.45, -0.1],
          [0.1, 0.08],
        ],
        scale: [0.2, 0.2],
        angle: [-0.2, 0.0],
        palOffset: 0.8,
      },
    ],
    turn: 0.35,
    mirror: true,
    jitter: 0.08,
  },
  {
    name: "Haze",
    ref: "16–18 s",
    look: {
      shape: "cube",
      ground: "#e7ece6",
      palette: ["#2a3a9c", "#9c85d7", "#eef0ec", "#f2b9a0", "#e86a3a"],
      ink: "#2a3a9c",
      head: "#2a3a9c",
      headMix: 0,
      headAlpha: 0.9,
      outline: "ink",
      outlineW: 0,
      outlineAge: 0,
      fillAlpha: 0.9,
      rim: 0.2,
      sheen: 0.4,
      faceShade: 0.2,
      blur: 0.5,
      headBlur: 0.7,
      fade: 0.4,
      stripeCycles: 0.9,
      // The blur is wider than the copy spacing even at this count, so more
      // copies add cost and nothing visible (the record's Measurements).
      copies: 10,
      phase: 0,
      phaseJitter: 0.1,
    },
    paths: [
      {
        p: [
          [0.9, -0.9],
          [0.6, -0.2],
          [0.45, 0.1],
          [0.3, -0.25],
        ],
        scale: [0.7, 0.75],
        angle: [0.3, 0.6],
        palOffset: 0,
      },
      {
        p: [
          [-0.9, 0.9],
          [-0.7, 0.4],
          [-0.55, 0.35],
          [-0.45, 0.5],
        ],
        scale: [0.6, 0.65],
        angle: [-0.4, -0.1],
        palOffset: 0.8,
      },
    ],
    turn: 0.5,
    mirror: true,
    jitter: 0.1,
  },
];

/** The most paths any recipe uses — the shader's loop bound. */
export const MAX_PATHS = 2;

/** The shape's reach from its own centre at scale 1 (every shape in
 *  glsl.ts's shapeSdf fits inside it) — the copy and bounding-box reject. */
export const SHAPE_REACH = 1.3;

// ---------------------------------------------------------------- rng

/** mulberry32: small, seedable, good enough for picking a picture. */
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

// ---------------------------------------------------------------- rolling

function turnPoint(v: Vec2, c: number, s: number, flip: number, jx: number, jy: number): Vec2 {
  const x = v[0] * flip;
  const y = v[1];
  return [x * c - y * s + jx, x * s + y * c + jy];
}

/** One concrete piece of recipe `index`: mirrored, turned and jittered by
 *  `rng`, with a fresh palette phase. */
export function rollPiece(index: number, rng: () => number): Piece {
  const recipe = RECIPES[index];
  const flip = recipe.mirror && rng() < 0.5 ? -1 : 1;
  const turn = (rng() * 2 - 1) * recipe.turn;
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  const paths = recipe.paths.map((path) => {
    const p = path.p.map((v, i) => {
      // The tail and head ends keep their place better than the inner
      // handles, which is where the curve's character is.
      const j = recipe.jitter * (i === 1 || i === 2 ? 1 : 0.5);
      return turnPoint(v, c, s, flip, (rng() * 2 - 1) * j, (rng() * 2 - 1) * j);
    }) as unknown as SweepPath["p"];
    const angle: SweepPath["angle"] = [path.angle[0] * flip + turn, path.angle[1] * flip + turn];
    return { p, scale: path.scale, angle, palOffset: path.palOffset };
  });
  return { recipe: index, look: recipe.look, paths, stripePhase: recipe.look.phase + rng() * recipe.look.phaseJitter };
}

/** The next recipe: the picked one, or with `pick` < 0 ("Mix") any recipe
 *  but the current one. */
export function nextRecipe(current: number, pick: number, rng: () => number): number {
  if (pick >= 0) return Math.min(RECIPES.length - 1, Math.round(pick));
  const n = RECIPES.length;
  if (n < 2) return 0;
  const step = 1 + Math.floor(rng() * (n - 1));
  return (current + step) % n;
}

// ---------------------------------------------------------------- motion

/** How fast the eased head approaches the end of its path per unit of
 *  progress. */
export const HEAD_EASE = 1.6;

/** The head parameter a piece starts at — the reel's pieces open with the
 *  shape already there, not a bare ground. */
export const HEAD_START = 0.25;

export function headOf(progress: number): number {
  return 1 - Math.exp(-HEAD_EASE * Math.max(0, progress));
}

export function progressFor(head: number): number {
  return -Math.log(1 - Math.min(0.999, Math.max(0, head))) / HEAD_EASE;
}

/** Path parameters the copies span: [tail end, head]. */
export function copySpan(head: number, trail: number): [number, number] {
  const t = Math.min(1, Math.max(0, trail));
  return [head * (1 - t), head];
}

export interface SweepState {
  piece: Piece;
  progress: number;
  /** Grid ticks counted toward the next piece. */
  ticks: number;
  /** The Look pick the current piece was rolled under. */
  pick: number;
}

export function createSweepState(rng: () => number, pick = -1): SweepState {
  const recipe = nextRecipe(Math.floor(rng() * RECIPES.length), pick, rng);
  return { piece: rollPiece(recipe, rng), progress: progressFor(HEAD_START), ticks: 0, pick };
}

export interface SweepInputs {
  dt: number;
  /** Progress per second (Speed × its drive, already resolved). */
  rate: number;
  /** A grid tick of the New piece drive landed this frame. */
  tick: boolean;
  /** Ticks per new piece (newPieceDivisor). 0 = never. */
  ticksPerPiece: number;
  /** The Look setting: < 0 for Mix, else a recipe index. */
  pick: number;
}

export function stepSweep(state: SweepState, input: SweepInputs, rng: () => number): SweepState {
  let { piece, progress, ticks } = state;
  let cut = false;
  if (input.pick !== state.pick) {
    cut = true;
  } else if (input.tick && input.ticksPerPiece > 0) {
    ticks++;
    if (ticks >= input.ticksPerPiece) cut = true;
  }
  if (cut) {
    piece = rollPiece(nextRecipe(piece.recipe, input.pick, rng), rng);
    progress = progressFor(HEAD_START);
    ticks = 0;
  } else {
    progress += Math.max(0, input.rate) * Math.max(0, input.dt);
  }
  return { piece, progress, ticks, pick: input.pick };
}

/** Grid ticks per new piece for a New piece amount: the default amount
 *  waits `base` ticks, right waits fewer, 0 never cuts. */
export function newPieceDivisor(amount: number, defaultAmount: number, base: number): number {
  if (amount <= 0.02) return 0;
  return Math.max(1, Math.round((base * defaultAmount) / amount));
}

// ---------------------------------------------------------------- geometry

export function bezier(p: SweepPath["p"], s: number): [number, number] {
  const u = 1 - s;
  const a = u * u * u;
  const b = 3 * u * u * s;
  const c = 3 * u * s * s;
  const d = s * s * s;
  return [a * p[0][0] + b * p[1][0] + c * p[2][0] + d * p[3][0], a * p[0][1] + b * p[1][1] + c * p[2][1] + d * p[3][1]];
}

/** Box (minX, minY, maxX, maxY) holding every copy on [s0, s1] at any edge
 *  softness up to `blur`. */
export function pathBounds(path: SweepPath, s0: number, s1: number, blur: number, outlineW: number): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    const s = s0 + ((s1 - s0) * i) / steps;
    const [x, y] = bezier(path.p, s);
    const r = (path.scale[0] + (path.scale[1] - path.scale[0]) * s) * SHAPE_REACH + 2 * blur + outlineW;
    x0 = Math.min(x0, x - r);
    y0 = Math.min(y0, y - r);
    x1 = Math.max(x1, x + r);
    y1 = Math.max(y1, y + r);
  }
  // Sampling can step over a bulge between two samples; a small margin
  // covers it at these path lengths.
  const m = 0.04;
  return [x0 - m, y0 - m, x1 + m, y1 + m];
}

// ---------------------------------------------------------------- packing

export function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** vec4 slots of the shader's `uSw` array. glsl.ts generates its #defines
 *  from this table, so the two cannot drift apart. */
export const SW = {
  GROUND: 0, // rgb, shape
  PAL: 1, // five slots: rgb
  HEAD: 6, // rgb, headMix
  INK: 7, // rgb, outline mode
  LOOK: 8, // outlineW, outlineAge, fillAlpha, rim
  LOOK2: 9, // faceShade, blur, fade, stripeCycles
  LOOK3: 10, // copies, path count, stripePhase, sheen
  LOOK4: 11, // headBlur, headAlpha, -, -
  PATH0: 12, // per path, four slots: p0 p1 | p2 p3 | scale0 scale1 angle0 angle1 | sTail head palOffset -
  BOX0: 20, // per path: minX minY maxX maxY
  LEN: 22,
} as const;

export interface PackInputs {
  head: number;
  trail: number;
  /** Copies setting (a multiplier on the recipe's count). */
  copies: number;
  /** Blur setting (a multiplier on the recipe's blur), for the boxes. */
  blur: number;
  /** Outlines setting (a multiplier on the recipe's width), for the boxes. */
  outlines: number;
}

export const MAX_COPIES = 96;

export function copiesFor(look: PieceLook, multiplier: number): number {
  return Math.max(2, Math.min(MAX_COPIES, Math.round(look.copies * Math.max(0, multiplier))));
}

export function packPiece(piece: Piece, input: PackInputs, out: Float32Array = new Float32Array(SW.LEN * 4)): Float32Array {
  out.fill(0);
  const set = (slot: number, x: number, y: number, z: number, w: number) => {
    out[slot * 4] = x;
    out[slot * 4 + 1] = y;
    out[slot * 4 + 2] = z;
    out[slot * 4 + 3] = w;
  };
  const L = piece.look;
  const g = hexToRgb(L.ground);
  set(SW.GROUND, g[0], g[1], g[2], SHAPES[L.shape]);
  L.palette.forEach((hex, i) => {
    const c = hexToRgb(hex);
    set(SW.PAL + i, c[0], c[1], c[2], 0);
  });
  const h = hexToRgb(L.head);
  set(SW.HEAD, h[0], h[1], h[2], L.headMix);
  const ink = hexToRgb(L.ink);
  set(SW.INK, ink[0], ink[1], ink[2], OUTLINE_MODES[L.outline]);
  set(SW.LOOK, L.outlineW, L.outlineAge, L.fillAlpha, L.rim);
  set(SW.LOOK2, L.faceShade, L.blur, L.fade, L.stripeCycles);
  const n = Math.min(MAX_PATHS, piece.paths.length);
  set(SW.LOOK3, copiesFor(L, input.copies), n, piece.stripePhase, L.sheen);
  set(SW.LOOK4, L.headBlur, L.headAlpha, 0, 0);
  const [sTail, head] = copySpan(input.head, input.trail);
  for (let j = 0; j < n; j++) {
    const path = piece.paths[j];
    const base = SW.PATH0 + j * 4;
    set(base, path.p[0][0], path.p[0][1], path.p[1][0], path.p[1][1]);
    set(base + 1, path.p[2][0], path.p[2][1], path.p[3][0], path.p[3][1]);
    set(base + 2, path.scale[0], path.scale[1], path.angle[0], path.angle[1]);
    set(base + 3, sTail, head, path.palOffset, 0);
    const box = pathBounds(path, sTail, head, L.blur * input.blur, L.outlineW * input.outlines);
    set(SW.BOX0 + j, box[0], box[1], box[2], box[3]);
  }
  return out;
}
