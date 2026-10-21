/**
 * LED Hearts' motion, kept apart from the shader so it can be tested: the
 * endless zoom's layers, the spin clock, and the envelopes a kick, a hit and
 * a drop start.
 *
 * The zoom is a flat zoom out from the centre (every heart's radial speed is
 * the same multiple of its distance, as measured on the reference; see
 * docs/scenes/ledhearts.md). It is drawn as `LAYERS` lattices of hearts, each
 * a factor `exp(LAYER_STEP)` larger than the last. Every layer grows with the
 * shared log-scale `zoomLog`; when a layer reaches the top of the span it
 * wraps back to the smallest size with a new seed, so the field never
 * repeats and never jumps. The fades in layerFade() hide the wrap.
 */

/** Hearts lattices drawn at once. */
export const LAYERS = 4;
/** Log-scale between neighbouring layers. With LAYERS it spans the measured
 *  heart sizes, smallest to the near ones that fade out. */
export const LAYER_STEP = 0.75;
/** A layer's scale, in half-heights per lattice cell, when it wraps in. */
export const MIN_SCALE = 0.07;
/** Log-scale it takes a new layer to fade in. */
const FADE_IN = 0.9;
/** Log-scale over which a near layer fades out, at the top of the span. */
const FADE_OUT = 0.9;
/** Layer seeds wrap at this power of two: noiseHash's integer hash takes
 *  them as a uint, and a repeat after this many wraps is far past notice. */
const SEED_WRAP = 1024;

const SPAN = LAYERS * LAYER_STEP;

export interface Layer {
  /** Half-heights per lattice cell on screen. */
  scale: number;
  /** Picks the layer's hearts; changes each time the layer wraps. */
  seed: number;
  /** 0 → 1 → 0 across the layer's life. */
  fade: number;
  /** 0 while the layer is in its fade-in or middle, rising to 1 as it fades
   *  out near the camera: the shader softens and reddens it by this. */
  near: number;
}

export function layerAt(zoomLog: number, k: number): Layer {
  const total = zoomLog + k * LAYER_STEP;
  const cycle = Math.floor(total / SPAN);
  const l = total - cycle * SPAN;
  const fadeIn = Math.min(1, l / FADE_IN);
  const near = Math.max(0, Math.min(1, (l - (SPAN - FADE_OUT)) / FADE_OUT));
  return {
    scale: MIN_SCALE * Math.exp(l),
    seed: ((k + LAYERS * cycle) % SEED_WRAP + SEED_WRAP) % SEED_WRAP,
    fade: fadeIn * (1 - near),
    near,
  };
}

/** A value an event raised that sinks back to 0 with time constant `tauSec`. */
export function decay(v: number, dtSec: number, tauSec: number): number {
  return v * Math.exp(-dtSec / tauSec);
}

/** The spin clock wraps at this many radians. Each heart turns at a whole
 *  multiple of SPIN_RATE_UNIT times the clock (glsl.ts), so the wrap lands
 *  every heart on a full turn and never shows. */
export const SPIN_RATE_UNIT = 0.5;
const SPIN_WRAP = (2 * Math.PI) / SPIN_RATE_UNIT;

export function wrapSpin(phase: number): number {
  return phase - Math.floor(phase / SPIN_WRAP) * SPIN_WRAP;
}
