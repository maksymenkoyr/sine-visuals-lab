// Fractal Grid's clocks, as a pure module (no GL, unit-tested in
// tests/fractalgrid.test.ts): where the camera is in its dive, how far the
// grid has stepped, how far the iteration count has folded, and how inverted
// the picture is. index.ts resolves settings and drives into DiveInputs once
// a frame and uploads what stepDive returns; the GLSL owns the picture.
//
// **The dive** goes one way: from the whole set straight down into one
// target at `rate` e-folds of zoom per second, easing in off the whole set
// and out at the bottom (EASE_EFOLDS), down to the target's own depth
// (DiveTarget.depth, scaled by Dive depth). It holds there for HOLD_SEC, then
// cuts back to the whole set and starts on the next target in DIVE_TARGETS.
// At the whole-set framing every target puts the camera in the same place
// (the camera note in index.ts), so the cut always lands on the same picture.
//
// **The targets** are Misiurewicz points: c values whose critical orbit
// lands on a repelling cycle, the centres of the set's spirals. Near one the
// set repeats itself, scaled and turned, however far you zoom, so a dive
// never runs out of picture — unlike a bulb's root, which flattens into a
// few giant cells within a handful of e-folds. Each is stored as a
// double-double pair per coordinate (hi + lo, about 32 digits), which is what
// deep.ts computes the reference orbit in, and with the iterations a pixel
// near it needs per e-fold of zoom to escape (p / ln|λ| for an M(k, p) point
// with cycle multiplier λ). docs/scenes/fractalgrid/scripts/find_targets.py
// found and refined them and prints these lines.
//
// **Steps, folds and inversion** are eased targets: a hit moves the target
// and the shown value follows it with its own time constant, so a step reads
// as a jump without teleporting. Values that only matter modulo something
// (the grid's offset in cells, the fold's place on its ping-pong) are wrapped
// together with their targets so they never grow.

export interface DiveTarget {
  /** The target as double-double pairs: re = reHi + reLo, im = imHi + imLo. */
  reHi: number;
  reLo: number;
  imHi: number;
  imLo: number;
  /** Iterations a pixel near the target needs per e-fold of zoom. */
  itersPerEfold: number;
  /** How deep a dive here goes at Dive depth's default, e-folds below the
   *  whole set. */
  depth: number;
}

/** The depth every target dives to at Dive depth's default, e-folds. */
export const TARGET_DEPTH = 45;

export function deepTarget(reHi: number, reLo: number, imHi: number, imLo: number, itersPerEfold: number): DiveTarget {
  return { reHi, reLo, imHi, imLo, itersPerEfold, depth: TARGET_DEPTH };
}

/** Dive order: alternating valleys, spins and shapes so consecutive dives
 *  don't look alike. find_targets.py prints these lines. */
export const DIVE_TARGETS: readonly DiveTarget[] = [
  // elephant valley, slow spin: M(11,3), |λ| 9.656, turns 9.57° per e-fold
  deepTarget(0.3045141924763035, 1.9971779293362468e-17, 0.020036558149489864, 1.5137785363774377e-18, 1.323),
  // seahorse valley, slow reverse spin: M(21,3), |λ| 7.08, turns -27.2° per e-fold
  deepTarget(-0.7776270099068777, -5.0629784125657207e-17, 0.13777341966976073, -9.123780981819498e-18, 1.533),
  // period-3 bulb, dendrite: M(9,3), |λ| 19.24, turns 8.66° per e-fold
  deepTarget(-0.14233282922624627, 9.28968587946176e-18, 0.9785860380998128, -3.1587682567113824e-17, 1.015),
  // elephant valley, upper slow spin: M(19,3), |λ| 9.57, turns 10.7° per e-fold
  deepTarget(0.3249009725216071, -5.323325744085071e-18, 0.045908570906938645, 1.0957704814497071e-18, 1.328),
  // west seahorse valley, reverse spin: M(19,3), |λ| 7.357, turns -33.1° per e-fold
  deepTarget(-1.300596281597996, -9.138356608714281e-17, 0.07721036189209265, -3.1689026691820946e-18, 1.503),
  // elephant valley, fast reverse spin: M(10,1), |λ| 1.338, turns -97.9° per e-fold
  deepTarget(0.34394893541599236, -1.6449791962953398e-17, 0.05607182997787478, 6.478019723304548e-19, 3.437),
  // antenna, flips each repeat: M(3,1), |λ| 1.679, turns 348.0° per e-fold
  deepTarget(-1.5436890126920764, 6.156766738133783e-18, 0.0, 0.0, 1.931),
  // elephant valley, four arms: M(7,4), |λ| 14.28, turns 16.4° per e-fold
  deepTarget(0.33598829354908605, -2.7294744796871246e-17, 0.04390895596122453, 2.504805317324845e-18, 1.504),
  // west seahorse valley, whirl: M(15,1), |λ| 1.488, turns 447.0° per e-fold
  deepTarget(-1.2941017670715493, 8.817860265822383e-17, 0.08085905686745473, -1.4969669159191175e-18, 2.518),
  // elephant valley, lower slow spin: M(11,3), |λ| 10.26, turns 8.67° per e-fold
  deepTarget(0.3177458774814111, 1.2566343099433917e-17, -0.028768463150400148, -1.6351946366295786e-18, 1.289),
  // period-3 bulb tip, whirl: M(4,1), |λ| 1.328, turns 421.0° per e-fold
  deepTarget(-0.10109636384562216, 3.1312710426818716e-18, 0.9562865108091415, -9.287754541577357e-18, 3.522),
  // elephant valley, outer four arms: M(5,4), |λ| 13.23, turns 19.6° per e-fold
  deepTarget(0.37363256928102, -5.852786361674973e-18, 0.08504535015303125, 4.116095671150155e-18, 1.549),
];

/** The deepest any dive may go, e-folds. Two limits meet here: the GPU's
 *  32-bit offsets from the reference reach their smallest normal value a
 *  little past this, and the double-double reference orbit has to stay a
 *  few thousand times finer than a pixel. */
export const MAX_DEPTH = 55;

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

/** The dive eases in over its first EASE_EFOLDS and out over its last,
 *  never slower than EASE_FLOOR of full speed. */
export const EASE_EFOLDS = 1.5;
export const EASE_FLOOR = 0.15;
/** Seconds the dive holds at the bottom before cutting back. */
export const HOLD_SEC = 3;

export const STEP_EASE_SEC = 0.09;
export const FOLD_EASE_SEC = 0.35;
export const INVERT_EASE_SEC = 0.12;
/** The longest frame step that still counts as motion: a hidden tab or a
 *  swapped clock must not fling the camera through a whole dive. */
export const MAX_STEP_SEC = 0.25;

export interface DiveState {
  /** E-folds below the whole set. */
  depth: number;
  /** Seconds left at the bottom; 0 while diving. */
  hold: number;
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
  return { depth: 0, hold: 0, targetIndex: 0, grid: 0, gridTarget: 0, fold: 0, foldTarget: 0, invertHold: 0, invert: 0 };
}

export interface DiveInputs {
  dt: number;
  /** Zoom speed, e-folds per second, between the eased ends. */
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

/** Share of full speed at `depth` on the way down to `bottom`. */
export function diveSpeedShare(depth: number, bottom: number): number {
  const fromTop = Math.min(1, depth / EASE_EFOLDS);
  const toBottom = Math.min(1, Math.max(0, bottom - depth) / EASE_EFOLDS);
  return Math.max(EASE_FLOOR, Math.min(fromTop, toBottom));
}

export function stepDive(s: DiveState, inp: DiveInputs): DiveState {
  const dt = Math.min(MAX_STEP_SEC, Math.max(0, inp.dt));

  let depth = s.depth;
  let hold = s.hold;
  let targetIndex = s.targetIndex;
  const bottom = targetDepth(targetIndex, inp.depthScale);
  if (hold > 0) {
    hold -= dt;
    if (hold <= 0) {
      hold = 0;
      depth = 0;
      targetIndex = (targetIndex + 1) % DIVE_TARGETS.length;
    }
  } else {
    depth += dt * Math.max(0, inp.rate) * diveSpeedShare(depth, bottom);
    if (depth >= bottom) {
      depth = bottom;
      hold = HOLD_SEC;
    }
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

  return { depth, hold, targetIndex, grid, gridTarget, fold, foldTarget, invertHold, invert };
}

/** Iterations a pixel gets at this depth: the base (Iterations) plus what
 *  escaping near the target costs, with `margin` for the slower pixels. */
export function diveIterations(base: number, s: DiveState, margin: number): number {
  return base + Math.ceil(s.depth * DIVE_TARGETS[s.targetIndex].itersPerEfold * margin);
}

/** The fold's ping-pong over FOLD_SPAN: rises 0 → FOLD_SPAN, then falls back. */
export function foldPosition(fold: number): number {
  const x = ((fold % (2 * FOLD_SPAN)) + 2 * FOLD_SPAN) % (2 * FOLD_SPAN);
  return x <= FOLD_SPAN ? x : 2 * FOLD_SPAN - x;
}
