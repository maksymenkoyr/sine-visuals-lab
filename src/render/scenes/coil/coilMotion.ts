/**
 * Coil's own timers, pure and unit-tested (tests/coil.test.ts) — the JS half
 * of the model index.ts's header describes: everything that isn't the
 * per-pixel stack search itself (glsl.ts owns that). Four state pieces, one
 * `stepCoil()` advancing all of them together each frame:
 *
 * - `F`, the flow phase (log-scale e-folds): rises every frame at
 *   `input.flowRatePerSec`, plus an instant jump on a Push hit — this is
 *   what "toothpaste squeezed outward" actually is (material below reads
 *   `(l* - F) / period`, so a rising F slides every band toward larger l,
 *   i.e. outward).
 * - `L`/`Ltarget`, the outer copy's log-size: `Ltarget` climbs at the same
 *   flow rate up to `L_BIG` (the silhouette overfilling the frame) and drops
 *   by `input.breatheDrop` on a Breathe edge (the partial fall-back); `L`
 *   itself eases toward `Ltarget` on its own time constant rather than
 *   snapping, which is what makes growth read as breathing instead of a
 *   ramp.
 * - `spinDeg`, the whole picture's rotation — a plain accumulator.
 * - `shape`/reset morph: a New shape edge starts an UNINTERRUPTIBLE
 *   `RESET_DURATION_SEC`-long morph (Neon Gates' lesson — see gates/index.ts —
 *   applied here: a running morph swallows both a later New-shape edge and
 *   any Breathe edge until it finishes) that eases `L` down to `L_SMALL`
 *   (the peel) while every shape field lerps from the old roll to a fresh
 *   one from `rollShape()` — `armsBlend` is one continuous field like the
 *   rest (0 = two lobes, 1 = four), so a 2-arm <-> 4-arm reset crossfades
 *   the extra pair of lobes in/out by scaling them toward zero rather than
 *   popping a lobe count.
 *
 * `coilPaletteRGB` mirrors glsl.ts's PALETTE_GLSL ramp in plain TS purely so
 * tests/coil.test.ts can check the sharp-red/sharp-blue phases without a GL
 * context — keep the two in sync by hand if the ramp ever changes.
 */

export interface ShapeParams {
  /** Radians; lobes sit at baseAngle + j*(pi/2), j = 0..3. */
  baseAngle: number;
  /** 0..~0.55: how far a lobe's centre sits from the origin. */
  verm: number;
  /** ~0.5..1: a lobe's radial (outward) semi-axis. */
  lobeA: number;
  /** ~0.25..0.7: a lobe's tangential semi-axis. */
  lobeB: number;
  /** -0.3..0.3: cos(2*arms*phi) radius wobble, for pinched/bow-tie variety. */
  wobble: number;
  /** -2.2..2.2 rad/e-fold: how much each nested copy winds relative to the
   *  next (the *rolled* amount — the Twist setting scales this at render
   *  time, never baked in here). */
  twist: number;
  /** 0 = only the two lobes at baseAngle/baseAngle+pi (a 2-arm shape); 1 =
   *  all four lobes at full strength (4-arm); continuous so a reset morph
   *  can crossfade between them. */
  armsBlend: number;
}

export interface CoilState {
  F: number;
  L: number;
  Ltarget: number;
  spinDeg: number;
  shape: ShapeParams;
  resetting: boolean;
  resetElapsed: number;
  resetFrom: ShapeParams;
  resetTo: ShapeParams;
  resetLStart: number;
  readonly rng: () => number;
}

export interface CoilInputs {
  /** Seconds since the last step; caller clamps (see index.ts). */
  dt: number;
  /** e-folds/s F and Ltarget both rise at — already floored and shaped by
   *  the Flow setting + its drive (index.ts's flowRatePerSec). */
  flowRatePerSec: number;
  /** A Push hit fired this frame (drives.fired("push", ...)). */
  pushFired: boolean;
  /** e-folds F jumps by on a Push hit — already scaled by the Push setting
   *  and the hit's own graded strength. */
  pushJump: number;
  /** A Breathe edge fired this frame — ignored while resetting. */
  breatheFired: boolean;
  /** e-folds Ltarget drops by on a Breathe edge — already scaled by the
   *  Breathe setting. */
  breatheDrop: number;
  /** A New-shape edge fired this frame — ignored while a reset is already
   *  running (uninterruptible). */
  newShapeFired: boolean;
  /** deg/s the whole picture spins at — already shaped by the Spin setting
   *  + its drive. */
  spinRateDegPerSec: number;
}

/** Outward-growth ceiling: a copy at this log-size overfills the frame
 *  (world radius e^L_BIG =~ 1.6 half-heights). */
export const L_BIG = Math.log(1.6);
/** The reset target: a small fresh shape (world radius e^L_SMALL =~ 0.3
 *  half-heights — the ref's post-reset bow-tie in frames/look_4.jpg). */
export const L_SMALL = Math.log(0.3);
/** How long a reset's peel-and-morph takes — matches burst 016.63's ~0.8s
 *  spin-down with no hard cut. */
export const RESET_DURATION_SEC = 0.8;
/** L's own chase rate toward Ltarget between resets (1/s) — a lag, not a
 *  snap, which is what reads as "breathing" rather than a ramp. */
const L_EASE_PER_SEC = 3.2;
/** e-folds/s the coil regrows at before the flow's own rate is added — the
 *  ref's |zoom| (report.md "Look, as statistics"). */
export const GROW_BASE_PER_SEC = 0.5;

const TWO_PI = Math.PI * 2;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Shortest signed angular delta from a to b, in (-pi, pi] — so a reset's
 *  baseAngle lerp always turns the short way round. */
function angleDelta(a: number, b: number): number {
  let d = (b - a) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  if (d < -Math.PI) d += TWO_PI;
  return d;
}

/** Mulberry32 — the same small deterministic PRNG slats/ambience/storm each
 *  keep their own copy of (see slats/layout.ts's own doc comment): a seed
 *  reproduces a whole session's roll sequence, which is what makes this
 *  module's reset tests stable. */
export function createRng(seed: number): () => number {
  let s = (seed >>> 0) || 0x9e3779b9;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ranges chosen to span the ref's silhouettes (bow-tie with no twist up to
 *  its 11 s coil at about ±1.5 — docs/scenes/coil.md): arms {2,4} (-> armsBlend 0
 *  or 1, coin-flipped); verm 0..0.55; lobeA 0.5..1; lobeB 0.25..0.7; wobble
 *  -0.3..0.3; twist -2.2..2.2 rad/e-fold. baseAngle is a full free spin
 *  (0..2pi) — the ranges above don't constrain it, only "a base angle"
 *  exists at all. */
export function rollShape(rng: () => number): ShapeParams {
  return {
    baseAngle: rng() * TWO_PI,
    verm: rng() * 0.55,
    lobeA: 0.5 + rng() * 0.5,
    lobeB: 0.25 + rng() * 0.45,
    wobble: (rng() * 2 - 1) * 0.3,
    twist: (rng() * 2 - 1) * 2.2,
    armsBlend: rng() < 0.5 ? 0 : 1,
  };
}

function lerpShape(a: ShapeParams, b: ShapeParams, t: number): ShapeParams {
  return {
    baseAngle: a.baseAngle + angleDelta(a.baseAngle, b.baseAngle) * t,
    verm: lerp(a.verm, b.verm, t),
    lobeA: lerp(a.lobeA, b.lobeA, t),
    lobeB: lerp(a.lobeB, b.lobeB, t),
    wobble: lerp(a.wobble, b.wobble, t),
    twist: lerp(a.twist, b.twist, t),
    armsBlend: lerp(a.armsBlend, b.armsBlend, t),
  };
}

/** Smoothstep ease for the reset's L lerp and shape crossfade — 0 velocity
 *  at both ends, so the peel starts and lands soft rather than snapping. */
function smooth01(t: number): number {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}

export function createCoilState(seed = 1): CoilState {
  const rng = createRng(seed);
  const shape = rollShape(rng);
  return {
    F: 0,
    L: L_SMALL,
    Ltarget: L_BIG,
    spinDeg: 0,
    shape,
    resetting: false,
    resetElapsed: 0,
    resetFrom: shape,
    resetTo: shape,
    resetLStart: L_SMALL,
    rng,
  };
}

/** Advances every timer one tick. Returns a new state object (the `rng`
 *  closure itself is shared/mutated, same as any other frame-to-frame
 *  generator — only the plain numeric/shape fields are replaced). */
export function stepCoil(state: CoilState, input: CoilInputs): CoilState {
  const dt = Math.max(0, input.dt);

  // The paste keeps streaming outward through a reset — the peel is a
  // shrink of the outer copy L, not a pause of the flow that colours every
  // band, so F always advances first, unconditionally.
  let F = state.F + input.flowRatePerSec * dt;
  if (input.pushFired) F += input.pushJump;

  let { L, Ltarget, resetting, resetElapsed, resetFrom, resetTo, resetLStart, shape } = state;

  if (resetting) {
    resetElapsed += dt;
    const t = clamp01(resetElapsed / RESET_DURATION_SEC);
    const eased = smooth01(t);
    L = lerp(resetLStart, L_SMALL, eased);
    shape = lerpShape(resetFrom, resetTo, eased);
    if (t >= 1) {
      resetting = false;
      resetElapsed = 0;
      L = L_SMALL;
      Ltarget = L_SMALL;
      shape = resetTo;
    }
    // Breathe is ignored while a reset owns L (state header's "uninterruptible"
    // note) — input.breatheFired simply isn't read on this branch. A later
    // New-shape edge can't interrupt either, for the same reason.
  } else {
    // Growth has its own base rate on top of the flow: riding the flow alone
    // (floored at a crawl on quiet input) let the Breathe fall-backs outpace
    // regrowth, so the coil never filled the frame — the ref overfills it
    // for most of the clip.
    Ltarget = Math.min(L_BIG, Ltarget + (GROW_BASE_PER_SEC + input.flowRatePerSec) * dt);
    // A fall-back is *to* a size below the ceiling, not *by* an amount, so
    // edges landing while the coil is still regrowing don't stack it down
    // to nothing.
    if (input.breatheFired) Ltarget = Math.min(Ltarget, L_BIG - input.breatheDrop);
    L += (Ltarget - L) * Math.min(1, dt * L_EASE_PER_SEC);

    if (input.newShapeFired) {
      resetting = true;
      resetElapsed = 0;
      resetLStart = L;
      resetFrom = shape;
      resetTo = rollShape(state.rng);
    }
  }

  const spinDeg = state.spinDeg + input.spinRateDegPerSec * dt;

  return {
    F,
    L,
    Ltarget,
    spinDeg,
    shape,
    resetting,
    resetElapsed,
    resetFrom,
    resetTo,
    resetLStart,
    rng: state.rng,
  };
}

// --- Palette mirror (see this file's header) --------------------------------

const COL_RED: readonly [number, number, number] = [0.769, 0.176, 0.314]; // #c42d50
const COL_PINK: readonly [number, number, number] = [0.835, 0.482, 0.584]; // #d57b95
const COL_BLUE: readonly [number, number, number] = [0.365, 0.549, 0.863]; // #5d8cdc
const COL_LILAC: readonly [number, number, number] = [0.745, 0.729, 0.843]; // #bebad7
const COL_WHITE: readonly [number, number, number] = [0.91, 0.902, 0.949]; // #e8e6f2

function mix3(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  t: number,
): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

/** One stripe period: a SHARP red edge at t=0, a solid red run, a fade to white
 *  by t=0.5; the same in blue through pale lilac from t=0.5 to
 *  white by t=1 — glsl.ts's `paletteRamp` GLSL function, kept in sync by
 *  hand. `t` wraps. */
export function coilPaletteRGB(t: number): [number, number, number] {
  const u = t - Math.floor(t);
  if (u < 0.15) return [...COL_RED];
  if (u < 0.25) return mix3(COL_RED, COL_PINK, (u - 0.15) / 0.1);
  if (u < 0.5) return mix3(COL_PINK, COL_WHITE, (u - 0.25) / 0.25);
  if (u < 0.65) return [...COL_BLUE];
  if (u < 0.75) return mix3(COL_BLUE, COL_LILAC, (u - 0.65) / 0.1);
  return mix3(COL_LILAC, COL_WHITE, (u - 0.75) / 0.25);
}
