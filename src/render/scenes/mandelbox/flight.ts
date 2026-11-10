/**
 * Mandelbox Flight's camera, on the CPU: the same fractal glsl.ts marches, in float64, used to
 * find places worth flying into and to fly toward them.
 *
 * - The flight: the camera moves along its view, closing a fixed share every second of the free
 *   distance straight ahead (`Flight.ahead`). That is a steady push in at a fixed zoom rate, the
 *   motion measured on the reference (docs/scenes/mandelbox.md, "Measurements"), and the camera
 *   never reaches what it flies toward. Closing on the nearest wall instead (`de`) zoomed several
 *   times slower than the reference wherever the view looks down an opening. The shader works in
 *   float32, so a place is used up once the gap to the nearest wall falls to `DE_FLOOR`; it also
 *   ends after its own random life.
 * - A place: a point in open space looking down an opening with walls all round it, seen face-on
 *   (`viewScore`). Walls seen edge-on read as a carpet of scales, and the reference looks into
 *   vaults, not along walls. The search is resumable (`stepPlaceSearch`): a scene gives it a
 *   time budget each frame, so finding the next place never stalls a frame.
 * - A place's kind: the Mandelbox is symmetric under every swap and sign flip of its axes, so a
 *   camera on one of its symmetry axes, looking along it, sees a kaleidoscope (4-, 3- or 2-fold,
 *   `AXES`), and one on a mirror plane, looking within it, sees an exact left-right mirror.
 *   Whether the reference was made this way or mirrored afterwards isn't known
 *   (docs/scenes/mandelbox.md). Mirror (card.ts) sets the mix of kinds (`KIND_SHARES`).
 * - The pace: how fast the flight and the colours run, from the music's Level against its own
 *   recent average (`stepPace`), so a quiet song still flies at the usual pace, its loud stretches
 *   push harder, and silence holds still whatever the input's own loudness.
 */

/** Fold iterations at a place's start: glsl.ts's loop runs the same count, so a place found here is
 *  the place drawn. Each fold resolves detail about |scale| times finer, so as the flight closes in
 *  `foldsAt` adds one per factor of |scale| zoomed, up to MAX_EXTRA: without them a deep view's
 *  surface went to smooth bumps a few pixels wide. */
export const ITER = 10;
export const MAX_EXTRA = 10;
/** The fold scale at Roundness 0 and 1 (card.ts). Boxier below, rounder above. */
const SCALE_BOXY = -2.4;
const SCALE_ROUND = -1.4;
/** Below this gap the shader's float32 positions start to shimmer: the place is used up. */
export const DE_FLOOR = 2.5e-4;
/** A new place starts this far from its nearest wall (world units). */
const START_DE_MIN = 0.02;
const START_DE_MAX = 0.12;
/** Points are drawn from a cube this many units across, centred on the fractal. */
const SEARCH_SPAN = 5;
/** Directions tried from each point that passes the gap test. */
const DIRS_PER_POINT = 16;
/** The ray grid that judges a view: columns × rows, and its spread in view-plane units. */
const GRID_COLS = 7;
const GRID_ROWS = 4;
const GRID_SPREAD = 0.3;
/** A view is out to this many gaps. Its centre ray must hit something inside that, so the flight has
 *  a target (a centre ray that escaped flew the camera out of the fractal, faster and faster, into
 *  black), and no nearer than CENTRE_MIN gaps, or it is a wall, not an opening. */
const VIEW_REACH = 90;
const CENTRE_MIN = 8;
/** A place ends once the flight has zoomed this many e-folds toward its target: about a minute at
 *  the reference's zoom rate, a guess: how long its looks last wasn't measured. It also ends if the
 *  camera's gap ever grows ESCAPE times its start, which would mean it is leaving the fractal. */
const ZOOM_MAX = 4.5;
const ESCAPE = 8;
/** Least share of the grid that must hit something, least mean face-on-ness, least depth spread.
 *  Below MIN_HITS views were chunks floating in black; the reference is dense from edge to edge. */
const MIN_HITS = 0.7;
const MIN_FACING = 0.45;
const MIN_DEPTH_SPREAD = 0.3;
const RAY_STEPS = 120;
/** A place's life, in seconds of flight, drawn uniformly from this range. */
const LIFE_MIN = 50;
const LIFE_SPAN = 50;
/** A free place's roll, radians per second of flight at most, either way. A symmetric place doesn't
 *  roll, so its mirror line stays upright. */
const ROLL_MAX = 0.004;

export type Vec3 = [number, number, number];
type PlaceKind = "free" | "plane" | "axis";

/** The symmetry axes an axis place sits on, and how often each is picked: down a cube axis the view
 *  is 4-fold, down a body diagonal 3-fold, down a face diagonal 2-fold. With `basis`'s up vector each
 *  view's mirror line is upright. */
const AXES: readonly Vec3[] = [
  [0, 0, 1],
  [1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3)],
  [Math.SQRT1_2, 0, Math.SQRT1_2],
];
const AXIS_WEIGHTS = [0.6, 0.25, 0.15];
/** An axis place sits this far from the centre, either way along its axis. */
const AXIS_T_MIN = 0.2;
const AXIS_T_MAX = 2.6;
/** The share of each kind of place by Mirror's option (Off, On, Per place). Per place mirrors the
 *  share of places the reference was mirrored for over its hour. */
const KIND_SHARES: readonly (readonly [axis: number, plane: number])[] = [
  [0, 0],
  [0.45, 0.55],
  [0.2, 0.25],
];

export function foldScale(roundness: number): number {
  const r = Math.min(Math.max(roundness, 0), 1);
  return SCALE_BOXY + (SCALE_ROUND - SCALE_BOXY) * r;
}

/** The Mandelbox distance estimate: box fold, sphere fold, scale and add the point (glsl.ts's `de`). */
export function de(x: number, y: number, z: number, scale: number, folds = ITER): number {
  let zx = x;
  let zy = y;
  let zz = z;
  let dr = 1;
  const as = Math.abs(scale);
  for (let i = 0; i < folds; i++) {
    zx = (zx > 1 ? 1 : zx < -1 ? -1 : zx) * 2 - zx;
    zy = (zy > 1 ? 1 : zy < -1 ? -1 : zy) * 2 - zy;
    zz = (zz > 1 ? 1 : zz < -1 ? -1 : zz) * 2 - zz;
    const r2 = zx * zx + zy * zy + zz * zz;
    const k = r2 < 0.25 ? 4 : r2 < 1 ? 1 / r2 : 1;
    zx = zx * k * scale + x;
    zy = zy * k * scale + y;
    zz = zz * k * scale + z;
    dr = dr * k * as + 1;
  }
  return Math.sqrt(zx * zx + zy * zy + zz * zz) / dr;
}

function norm(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function gradient(p: Vec3, scale: number, h: number): Vec3 {
  return [
    de(p[0] + h, p[1], p[2], scale) - de(p[0] - h, p[1], p[2], scale),
    de(p[0], p[1] + h, p[2], scale) - de(p[0], p[1] - h, p[2], scale),
    de(p[0], p[1], p[2] + h, scale) - de(p[0], p[1], p[2] - h, scale),
  ];
}

/** Right and up for a view direction, level with the world's y unless it looks nearly straight up or down. */
function basis(fwd: Vec3): { right: Vec3; up: Vec3 } {
  const worldUp: Vec3 = Math.abs(fwd[1]) > 0.95 ? [0, 0, 1] : [0, 1, 0];
  const right = norm(cross(fwd, worldUp));
  return { right, up: cross(right, fwd) };
}

function rayLength(p: Vec3, rd: Vec3, scale: number, tMax: number, folds = ITER): number {
  let t = 0;
  for (let k = 0; k < RAY_STEPS; k++) {
    const d = de(p[0] + rd[0] * t, p[1] + rd[1] * t, p[2] + rd[2] * t, scale, folds);
    if (d < t * 0.004 + 1e-6) return t;
    t += d * 0.9;
    if (t > tMax) return tMax;
  }
  return t;
}

/** How good a view `fwd` from `p` is, or -1 if it isn't one: an open centre, a grid that mostly hits, walls seen face-on, varied depth. */
export function viewScore(p: Vec3, fwd: Vec3, gap: number, scale: number): number {
  const tMax = gap * VIEW_REACH;
  const centre = rayLength(p, fwd, scale, tMax);
  if (centre >= tMax || centre < gap * CENTRE_MIN) return -1;
  const { right, up } = basis(fwd);
  const n = GRID_COLS * GRID_ROWS;
  const depths: number[] = [];
  let facing = 0;
  let misses = 0;
  for (let j = 0; j < GRID_ROWS; j++) {
    for (let i = 0; i < GRID_COLS; i++) {
      const sx = (i - (GRID_COLS - 1) / 2) * GRID_SPREAD;
      const sy = (j - (GRID_ROWS - 1) / 2) * GRID_SPREAD;
      const rd = norm([fwd[0] + sx * right[0] + sy * up[0], fwd[1] + sx * right[1] + sy * up[1], fwd[2] + sx * right[2] + sy * up[2]]);
      const t = rayLength(p, rd, scale, tMax);
      if (t >= tMax) {
        // Past this many misses the view can't pass: skip the rest of the grid.
        if (++misses > n * (1 - MIN_HITS)) return -1;
        continue;
      }
      depths.push(t);
      const g = norm(gradient([p[0] + rd[0] * t, p[1] + rd[1] * t, p[2] + rd[2] * t], scale, t * 0.01));
      facing += Math.abs(g[0] * rd[0] + g[1] * rd[1] + g[2] * rd[2]);
    }
  }
  if (depths.length < n * MIN_HITS) return -1;
  facing /= depths.length;
  if (facing < MIN_FACING) return -1;
  const mean = depths.reduce((a, b) => a + b, 0) / depths.length;
  const sd = Math.sqrt(depths.reduce((a, b) => a + (b - mean) * (b - mean), 0) / depths.length);
  if (sd / mean < MIN_DEPTH_SPREAD) return -1;
  return Math.min(centre / gap, 40) + (10 * depths.length) / n + 20 * facing;
}

export interface Place {
  p: Vec3;
  fwd: Vec3;
  /** The fold scale it was found for: a place is only a place in the fractal it was found in. */
  scale: number;
  kind: PlaceKind;
  /** Radians per second of flight. */
  roll: number;
  /** Seconds of flight it lasts unless its gap runs out first. */
  life: number;
  /** How far round the colour wheel the colours jump as it arrives, in turns. */
  hueJump: number;
}

export interface PlaceSearch {
  scale: number;
  /** Mirror's option (card.ts), which sets the mix of kinds a search is drawn from. */
  mirror: number;
  seed: number;
  /** The kind of place this search looks for, drawn once: drawn per point, the kinds that fail the
   *  view test more often would almost never be found. */
  kind: PlaceKind;
  /** The point being judged and how many of its directions are done. */
  point: Vec3 | null;
  /** An axis place's only two directions, along its axis; other kinds draw random ones. */
  axisDirs: Vec3[] | null;
  gap: number;
  dir: number;
  best: Vec3 | null;
  bestScore: number;
  found: Place | null;
}

/** A Park–Miller step: a seeded search finds the same places every run, which the tests rely on. */
function nextRandom(s: PlaceSearch): number {
  s.seed = (s.seed * 16807) % 2147483647;
  return s.seed / 2147483647;
}

export function createPlaceSearch(scale: number, seed: number, mirror: number): PlaceSearch {
  const s = Math.floor(Math.abs(seed)) % 2147483646;
  const search: PlaceSearch = {
    scale,
    mirror,
    seed: s === 0 ? 1 : s,
    kind: "free",
    point: null,
    axisDirs: null,
    gap: 0,
    dir: 0,
    best: null,
    bestScore: 0,
    found: null,
  };
  // Park–Miller's first draws from a small seed are tiny: let it run a few steps first.
  for (let i = 0; i < 4; i++) nextRandom(search);
  const [axisShare, planeShare] = KIND_SHARES[Math.min(Math.max(Math.round(mirror), 0), KIND_SHARES.length - 1)];
  const r = nextRandom(search);
  search.kind = r < axisShare ? "axis" : r < axisShare + planeShare ? "plane" : "free";
  return search;
}

function randomDirection(s: PlaceSearch): Vec3 {
  const z = nextRandom(s) * 2 - 1;
  const a = nextRandom(s) * Math.PI * 2;
  const r = Math.sqrt(1 - z * z);
  return [r * Math.cos(a), r * Math.sin(a), z];
}

/** A direction inside the mirror plane x = 0, where `basis` puts the view's right along x. */
function planeDirection(s: PlaceSearch): Vec3 {
  const a = nextRandom(s) * Math.PI * 2;
  return [0, Math.cos(a), Math.sin(a)];
}

/** A candidate point of the search's kind, with an axis place's two directions. */
function drawPoint(s: PlaceSearch): { p: Vec3; axisDirs: Vec3[] | null } {
  if (s.kind === "axis") {
    let pick = nextRandom(s);
    let i = 0;
    while (i < AXES.length - 1 && pick >= AXIS_WEIGHTS[i]) pick -= AXIS_WEIGHTS[i++];
    const a = AXES[i];
    const side = nextRandom(s) < 0.5 ? -1 : 1;
    const t = side * (AXIS_T_MIN + nextRandom(s) * (AXIS_T_MAX - AXIS_T_MIN));
    const out: Vec3 = [a[0] * side, a[1] * side, a[2] * side];
    return { p: [a[0] * t, a[1] * t, a[2] * t], axisDirs: [[-out[0], -out[1], -out[2]], out] };
  }
  if (s.kind === "plane") return { p: [0, (nextRandom(s) - 0.5) * SEARCH_SPAN, (nextRandom(s) - 0.5) * SEARCH_SPAN], axisDirs: null };
  return { p: [(nextRandom(s) - 0.5) * SEARCH_SPAN, (nextRandom(s) - 0.5) * SEARCH_SPAN, (nextRandom(s) - 0.5) * SEARCH_SPAN], axisDirs: null };
}

/**
 * Advances the search until it finds a place or `budgetMs` runs out (one direction at a time, so
 * the budget is kept to within one view's cost). Returns the place once found, and keeps
 * returning it.
 */
export function stepPlaceSearch(s: PlaceSearch, budgetMs: number, now: () => number = () => performance.now()): Place | null {
  if (s.found) return s.found;
  const until = now() + budgetMs;
  do {
    if (!s.point) {
      const { p, axisDirs } = drawPoint(s);
      const gap = de(p[0], p[1], p[2], s.scale);
      if (gap < START_DE_MIN || gap > START_DE_MAX) continue;
      s.point = p;
      s.axisDirs = axisDirs;
      s.gap = gap;
      s.dir = 0;
      s.best = null;
      s.bestScore = 0;
    }
    const fwd = s.axisDirs ? s.axisDirs[s.dir] : s.kind === "plane" ? planeDirection(s) : randomDirection(s);
    const score = viewScore(s.point, fwd, s.gap, s.scale);
    if (score > s.bestScore) {
      s.bestScore = score;
      s.best = fwd;
    }
    if (++s.dir < (s.axisDirs ? s.axisDirs.length : DIRS_PER_POINT)) continue;
    if (s.best) {
      s.found = {
        p: s.point,
        fwd: s.best,
        scale: s.scale,
        kind: s.kind,
        roll: s.kind === "free" ? (nextRandom(s) * 2 - 1) * ROLL_MAX : 0,
        life: LIFE_MIN + nextRandom(s) * LIFE_SPAN,
        hueJump: nextRandom(s),
      };
      return s.found;
    }
    s.point = null;
  } while (now() < until);
  return null;
}

export interface Flight {
  place: Place;
  /** Seconds of flight at this place, counted at the pace it flew. */
  age: number;
  rollAngle: number;
  /** The gap to the nearest wall at the start and now, world units. */
  startGap: number;
  gap: number;
  /** The free distance straight ahead at the start and now, world units. */
  startAhead: number;
  ahead: number;
  /** Fold iterations now (`foldsAt`), for the camera here and for the march. */
  folds: number;
}

/** ITER plus one fold per factor of |scale| zoomed toward the target since the start, up to MAX_EXTRA.
 *  Counted on the way ahead, which only shrinks: the gap to the nearest wall rises and falls as walls
 *  pass, and each fold it added read the gap smaller again. */
function foldsAt(startAhead: number, ahead: number, scale: number): number {
  const extra = Math.round(Math.log(startAhead / ahead) / Math.log(Math.abs(scale)));
  return ITER + Math.min(Math.max(extra, 0), MAX_EXTRA);
}

export function createFlight(place: Place): Flight {
  const p = [...place.p] as Vec3;
  const gap = de(p[0], p[1], p[2], place.scale);
  const ahead = rayLength(p, place.fwd, place.scale, gap * VIEW_REACH);
  return { place: { ...place, p }, age: 0, rollAngle: 0, startGap: gap, gap, startAhead: ahead, ahead, folds: ITER };
}

/**
 * Flies `dtSec` along the view, closing `rate` of the distance ahead per second (scaled by `pace`).
 * Returns true once the place is used up: its gap at DE_FLOOR, ZOOM_MAX zoomed, the camera escaping,
 * or its life spent.
 */
export function advanceFlight(f: Flight, dtSec: number, rate: number, pace: number): boolean {
  const { p, fwd, scale } = f.place;
  // The ray ahead is free out to `ahead`, so a move shorter than that never meets a wall; the
  // exponential keeps the zoom rate the same whatever the frame rate.
  const move = f.ahead * (1 - Math.exp(-rate * pace * dtSec));
  p[0] += fwd[0] * move;
  p[1] += fwd[1] * move;
  p[2] += fwd[2] * move;
  f.gap = de(p[0], p[1], p[2], scale, f.folds);
  // Never further than the target already was: the way ahead only closes.
  f.ahead = Math.min(f.ahead - move, rayLength(p, fwd, scale, f.gap * VIEW_REACH, f.folds));
  f.folds = foldsAt(f.startAhead, f.ahead, scale);
  f.age += dtSec * pace;
  f.rollAngle += f.place.roll * dtSec * pace;
  const zoomed = Math.log(f.startAhead / f.ahead);
  return f.gap < DE_FLOOR || zoomed > ZOOM_MAX || f.gap > f.startGap * ESCAPE || f.age > f.place.life;
}

/** The camera's right and up after its roll. */
export function cameraAxes(f: Flight, right: Float32Array, up: Float32Array): void {
  const b = basis(f.place.fwd);
  const c = Math.cos(f.rollAngle);
  const s = Math.sin(f.rollAngle);
  for (let i = 0; i < 3; i++) {
    right[i] = c * b.right[i] + s * b.up[i];
    up[i] = c * b.up[i] - s * b.right[i];
  }
}

/** Level (src/render/signals.ts) is loudness on a fixed 60 dB scale: at LEVEL_QUIET the room is all but silent. */
export const LEVEL_QUIET = 0.35;
/** Where the average starts before it has heard anything: a typical song on line-in. */
const LEVEL_START = 0.75;
/** The average follows the music over this long, and never comes closer to LEVEL_QUIET than MIN_SPAN. */
const AVERAGE_SEC = 20;
const MIN_SPAN = 0.08;
/** The pace eases toward its target over this long, and never runs faster than PACE_MAX. */
const PACE_SMOOTH_SEC = 0.6;
export const PACE_MAX = 2.5;

export interface Pace {
  average: number;
  value: number;
}

export function createPace(): Pace {
  return { average: LEVEL_START, value: 1 };
}

/**
 * The flight's pace from the music's Level: 1 at the song's own average, higher when it is louder
 * than that, 0 at LEVEL_QUIET and below. `push` blends from a steady 1 (0) to the full reading (1)
 * and past it. The average only learns from sound, so a silence doesn't drag it down and the next
 * song starts where the last one sat.
 */
export function stepPace(s: Pace, level: number, push: number, dtSec: number): number {
  if (level > LEVEL_QUIET) s.average += (level - s.average) * (1 - Math.exp(-dtSec / AVERAGE_SEC));
  const reading = Math.max(0, level - LEVEL_QUIET) / Math.max(s.average - LEVEL_QUIET, MIN_SPAN);
  const target = Math.min(Math.max(1 + push * (reading - 1), 0), PACE_MAX);
  s.value += (target - s.value) * (1 - Math.exp(-dtSec / PACE_SMOOTH_SEC));
  return s.value;
}
