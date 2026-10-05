// Zoom out: the square plate's endless pull-back (chladni.ts's header has
// how the scene uses it). No real plate can do this: a real plate has an
// edge, and pulling back from it would only show the plate getting smaller.
// It is a Shepard-style illusion that borrows one true thing, that a bigger
// plate rings finer figures (Pattern complexity is in effect the plate's
// size). The plate rings the music's figure at ZOOM_LAYERS sizes at once,
// each an octave (twice as fine) from the next. As the zoom runs every layer
// gets finer, and its weight follows a bell (zoomBell) over where it sits in
// the stack: the coarsest fades in from nothing, the finest fades out to
// nothing. After one octave each layer stands exactly where the next finer
// one began, at that one's weight, so the stack repeats with no seam and the
// zoom can run for ever while the figure on screen keeps changing.
//
// The zoom is a phase in octaves, kept as its fractional part u (only u
// matters). Layer k's scale is ZOOM_BASE * 2^(k + u): the field at plate
// point p is sum_k w_k * blend(p * scale_k), the blend being the plate's
// own music-picked modes. The sand rides it: each frame the sim shrinks
// every grain toward the centre by zoomShrink, so a formed figure shrinks as
// one piece with the field, and moves a random zoomRespawnShare of the bed to
// the strip that shrinking freed at the edges, which keeps the sand's
// density even.
//
// Speed is the setting times its drive (the All level jack by default), at
// ZOOM_OCTAVES_PER_MIN for both at 1: silence stops the zoom, as it freezes
// the figure.

/** How many sizes of the figure the plate rings at once. */
export const ZOOM_LAYERS = 3;

/** Octaves per minute at Zoom out 1 with its drive reading 1. Music's All
 *  level sits well under 1 (docs/scenes/chladni.md, Measurements), so full
 *  speed on real music is that share of this. */
export const ZOOM_OCTAVES_PER_MIN = 3;

/** How peaked the layer bell is: zoomBell is sin(pi x) to twice this power.
 *  Peaked, so most of the time one layer carries the plate and the figure
 *  reads as one figure: the plain sin^2 bell kept two or three layers mixed
 *  and the sum read as a busy lattice. */
export const ZOOM_BELL_POWER = 3;

/** Bell values under this count as nothing: subtracted from every layer's
 *  bell (so the weights stay continuous), which drops the layers on the
 *  bell's tails from the shader's sum. Mostly one or two layers then pay. */
export const ZOOM_WEIGHT_FLOOR = 0.05;

/** The scale where the bell peaks: the layer carrying the plate at mid
 *  handover. Coarser than the plate's own scale (1), because the zoom shows
 *  the plate at its true aspect with its mirror copies beside it, and at 1
 *  the frame read far busier than the plate without the zoom. */
export const ZOOM_PEAK_SCALE = 2 ** -0.5;

/** Scale of the coarsest layer at u = 0, so the middle of the stack sits at
 *  ZOOM_PEAK_SCALE. */
export const ZOOM_BASE = ZOOM_PEAK_SCALE * 2 ** (-ZOOM_LAYERS / 2);

/** The bell over a layer's place x in the stack, 0 (coarsest end) .. 1
 *  (finest end): exactly 0 at both ends, peaked in the middle, less
 *  ZOOM_WEIGHT_FLOOR. */
export function zoomBell(x: number): number {
  if (!(x > 0 && x < 1)) return 0;
  const s = Math.sin(Math.PI * x);
  return Math.max(0, Math.pow(s * s, ZOOM_BELL_POWER) - ZOOM_WEIGHT_FLOOR);
}

export interface ZoomLayer {
  /** Multiplies plate space for this layer: above 1, a finer figure. */
  scale: number;
  /** Share of the plate's motion; the layers sum to 1. */
  weight: number;
}

/** The layer stack at zoom phase `phase` (octaves; only its fractional part
 *  counts), coarsest first, weights normalised to sum 1 so the field peaks at
 *  |f| = 2 like one square mode. `out` is reused when given. */
export function zoomLayers(phase: number, out: ZoomLayer[] = []): ZoomLayer[] {
  const u = phase - Math.floor(phase);
  let sum = 0;
  for (let k = 0; k < ZOOM_LAYERS; k++) {
    const w = zoomBell((k + u) / ZOOM_LAYERS);
    const layer = out[k] ?? (out[k] = { scale: 0, weight: 0 });
    layer.scale = ZOOM_BASE * 2 ** (k + u);
    layer.weight = w;
    sum += w;
  }
  out.length = ZOOM_LAYERS;
  // sum > 0 for every u: the stack's strongest layer is never weaker than at
  // u = 0, where two layers share the middle, well above ZOOM_WEIGHT_FLOOR.
  for (const layer of out) layer.weight /= sum;
  return out;
}

/** How far the zoom moves this frame, in octaves: the setting (clamped to
 *  the slider) times its drive's reading (never negative), at
 *  ZOOM_OCTAVES_PER_MIN. 0 when either is 0. */
export function zoomPhaseStep(dtSec: number, setting: number, drive: number): number {
  const dt = Number.isFinite(dtSec) && dtSec > 0 ? dtSec : 0;
  const s = Math.max(0, Math.min(1, setting));
  const d = Number.isFinite(drive) ? Math.max(0, drive) : 0;
  return (ZOOM_OCTAVES_PER_MIN / 60) * s * d * dt;
}

/** What a frame's step `du` shrinks every grain by, toward the centre. */
export function zoomShrink(du: number): number {
  return 2 ** -du;
}

/** The share of the bed moved to the edges each frame: the share of the
 *  plate's area the shrink frees, so the density stays even. */
export function zoomRespawnShare(du: number): number {
  return 1 - 2 ** (-2 * du);
}

/** The finest scale among the layers with any weight, for the sim's step
 *  cap (chladni.ts's STEP_CELL_FRACTION of the finest cell on the plate). */
export function zoomFinestScale(layers: readonly ZoomLayer[]): number {
  let s = 0;
  for (const layer of layers) if (layer.weight > 0) s = Math.max(s, layer.scale);
  return s;
}
