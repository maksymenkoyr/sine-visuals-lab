// Fractal Grid's clocks, as a pure module (no GL, unit-tested in
// tests/fractalgrid.test.ts): where the camera is in its dive, how far the
// grid has stepped, how far the iteration count has folded, and how inverted
// the picture is. index.ts resolves settings and drives into DiveInputs once
// a frame and uploads what stepDive returns; the GLSL owns the picture.
//
// **The dive.** One dive is a round trip: from the whole set (log-zoom 0)
// down to the target's own depth (DiveTarget.depth, scaled by Dive depth)
// and back out, on a raised-cosine path so the camera eases at both ends —
// it lingers on the whole set and at the bottom, and moves fastest in
// between. The phase advances at `rate / (2 · depth)` per second, which
// makes `rate` the average zoom speed in e-folds per second whatever the
// depth. When a dive ends (back at the
// whole set) the next target in DIVE_TARGETS takes over; at the whole-set
// framing every target puts the camera in the same place (see the GLSL's
// camera note in index.ts), so the switch can't be seen.
//
// **The targets** are the roots of bulbs: where a bulb touches the one it
// grew from. The iteration slows to a crawl there (the point is parabolic),
// so a fixed iteration count leaves the orbit mid-way, and the grid drawn on
// it folds into the circles and petals the reference dives through. Main-
// cardioid roots are c = e^{iθ}/2 − e^{2iθ}/4 and the period-2 bulb's are
// c = −1 + e^{iθ}/4, θ = 2πp/q for the p/q bulb.
//
// **Steps, folds and inversion** are eased targets: a hit moves the target
// and the shown value follows it with its own time constant, so a step reads
// as a jump without teleporting. Values that only matter modulo something
// (the grid's offset in cells, the fold's place on its ping-pong) are wrapped
// together with their targets so they never grow.

export interface DiveTarget {
  x: number;
  y: number;
  /** How deep a dive here goes at Dive depth's default, in e-folds below
   *  the whole set: where the grid is still richest, picked from shots of
   *  every root at several depths (docs/scenes/fractalgrid.md). Past it a
   *  root's view is a few giant cells; the cusp stays busy much deeper. */
  depth: number;
}

/** Root of the main cardioid's p/q bulb (q = 1 is the cusp). */
export function cardioidRoot(p: number, q: number, depth: number): DiveTarget {
  const t = (2 * Math.PI * p) / q;
  return { x: Math.cos(t) / 2 - Math.cos(2 * t) / 4, y: Math.sin(t) / 2 - Math.sin(2 * t) / 4, depth };
}

/** Root of the period-2 bulb's p/q satellite. */
export function twoBulbRoot(p: number, q: number, depth: number): DiveTarget {
  const t = (2 * Math.PI * p) / q;
  return { x: -1 + Math.cos(t) / 4, y: Math.sin(t) / 4, depth };
}

/** Dive order: the cusp first (the reference's own last dive), then roots
 *  alternating above and below the axis so consecutive dives don't land on
 *  the same side. */
export const DIVE_TARGETS: readonly DiveTarget[] = [
  cardioidRoot(0, 1, 7),
  cardioidRoot(1, 3, 5),
  cardioidRoot(1, 2, 4),
  cardioidRoot(-2, 5, 5),
  twoBulbRoot(1, 2, 4),
  cardioidRoot(1, 4, 5),
  twoBulbRoot(-1, 3, 5),
  cardioidRoot(-1, 5, 5),
  cardioidRoot(3, 7, 5),
];

/** The deepest any dive may go, e-folds: past it 32-bit floats run out of
 *  room to tell neighbouring pixels apart. */
export const MAX_DEPTH = 9;

/** The current target's dive depth, scaled by Dive depth relative to its
 *  default (`depthScale`). */
export function targetDepth(targetIndex: number, depthScale: number): number {
  return Math.min(MAX_DEPTH, Math.max(0, DIVE_TARGETS[targetIndex].depth * depthScale));
}

/** Where the whole-set framing is centred, and the half-extents it must fit
 *  (the set spans about −2..0.47 by ±1.12, plus a margin). The GLSL fits
 *  these to the screen's aspect. */
export const HOME_X = -0.765;
export const HOME_HALF_W = 1.42;
export const HOME_HALF_H = 1.29;

/** The fold ping-pongs over this many iteration steps, so the loop's extra
 *  work stays bounded and a fold never has to wrap with a jump. A multiple
 *  of every short cycle length, so a turn-around never lands mid-cycle. */
export const FOLD_SPAN = 12;

export const STEP_EASE_SEC = 0.09;
export const FOLD_EASE_SEC = 0.35;
export const INVERT_EASE_SEC = 0.12;
/** The longest frame step that still counts as motion: a hidden tab or a
 *  swapped clock must not fling the camera through a whole dive. */
export const MAX_STEP_SEC = 0.25;

export interface DiveState {
  /** 0..1 through the current dive; 0 and 1 are the whole set. */
  phase: number;
  targetIndex: number;
  /** Grid offset in cells (both line families step together). */
  grid: number;
  gridTarget: number;
  /** Fold position in iteration steps, before the ping-pong. */
  fold: number;
  foldTarget: number;
  /** Seconds the drop inversion still holds. */
  invertHold: number;
  /** 0..1, eased toward 1 while held. */
  invert: number;
}

export function createDiveState(): DiveState {
  return { phase: 0, targetIndex: 0, grid: 0, gridTarget: 0, fold: 0, foldTarget: 0, invertHold: 0, invert: 0 };
}

export interface DiveInputs {
  dt: number;
  /** Average zoom speed, e-folds per second. */
  rate: number;
  /** Dive depth relative to its default: scales every target's own depth. */
  depthScale: number;
  /** Cells the grid steps this frame (0 when nothing fired). */
  stepCells: number;
  /** Iteration steps the fold advances this frame (0 when nothing fired). */
  foldSteps: number;
  /** A drop fired this frame. */
  dropFired: boolean;
  /** How long a drop's inversion holds, seconds. */
  invertHoldSec: number;
}

function ease(current: number, target: number, dt: number, tau: number): number {
  return current + (target - current) * (1 - Math.exp(-dt / tau));
}

export function stepDive(s: DiveState, inp: DiveInputs): DiveState {
  const dt = Math.min(MAX_STEP_SEC, Math.max(0, inp.dt));

  let phase = s.phase;
  let targetIndex = s.targetIndex;
  const depth = targetDepth(targetIndex, inp.depthScale);
  if (depth > 0) phase += (dt * Math.max(0, inp.rate)) / (2 * depth);
  while (phase >= 1) {
    phase -= 1;
    targetIndex = (targetIndex + 1) % DIVE_TARGETS.length;
  }

  let gridTarget = s.gridTarget + inp.stepCells;
  let grid = ease(s.grid, gridTarget, dt, STEP_EASE_SEC);
  const gridWrap = Math.floor(grid);
  grid -= gridWrap;
  gridTarget -= gridWrap;

  let foldTarget = s.foldTarget + inp.foldSteps;
  let fold = ease(s.fold, foldTarget, dt, FOLD_EASE_SEC);
  const foldWrap = Math.floor(fold / (2 * FOLD_SPAN)) * 2 * FOLD_SPAN;
  fold -= foldWrap;
  foldTarget -= foldWrap;

  const invertHold = inp.dropFired ? inp.invertHoldSec : Math.max(0, s.invertHold - dt);
  const invert = ease(s.invert, invertHold > 0 ? 1 : 0, dt, INVERT_EASE_SEC);

  return { phase, targetIndex, grid, gridTarget, fold, foldTarget, invertHold, invert };
}

/** Log-zoom relative to the whole set: 0 there, −depth at the bottom. */
export function diveLogZoom(phase: number, depth: number): number {
  return -depth * (0.5 - 0.5 * Math.cos(2 * Math.PI * phase));
}

/** The fold's ping-pong over FOLD_SPAN: rises 0 → FOLD_SPAN, then falls back. */
export function foldPosition(fold: number): number {
  const x = ((fold % (2 * FOLD_SPAN)) + 2 * FOLD_SPAN) % (2 * FOLD_SPAN);
  return x <= FOLD_SPAN ? x : 2 * FOLD_SPAN - x;
}
