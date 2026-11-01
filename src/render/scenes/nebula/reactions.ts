/**
 * Nebula's music reactions on the JS side: the state behind Twinkle, Inner light, Drop shock and
 * Colour tilt, which index.ts advances once a frame and turns into uniforms for glsl.ts and stars.ts.
 *
 * - Twinkle: each hat starts a flash in one of two slots, the older one, so a hat landing while the
 *   last flash fades doesn't cut it off. A slot's seed picks which stars it lights (stars.ts).
 * - Drop shock: a drop fixes a burst centre ahead of the camera, in world units, and starts a clock.
 *   The shader gets the centre as an offset from the camera, so the distance flown never reaches it,
 *   and the front's radius. The front fades fast; the gas it crossed burns on for longer.
 * - Inner light and Colour tilt each read their signal against the song's own recent level (a
 *   `Swing`): smoothed, then measured from its median over the last half-minute or so in units of its
 *   spread there. On real
 *   songs Lead sat between about 0.6 and 1 the whole way and the centroid's spread was several times
 *   the prototype's, so raw readings made Inner light a constant lift and pinned the tilt warm
 *   (docs/scenes/nebula.md, 2026-11-01). The median, not the mean: the centroid's rare bright
 *   spikes pulled a mean above its usual level and still left the tilt warm most of a song. The
 *   median is taken from stored samples rather than stepped toward, which took most of a minute to
 *   settle at the start of a song.
 * - Inner light: the lead's level, scaled from `INNER_REST` of itself up to all of it as the lead
 *   rises above its usual level, so silence stays dark and a melody that swells still lights more.
 * - Colour tilt: below the centroid's usual level leans warm (+1), above leans cool (-1).
 *
 * The four were picked by the owner from a live prototype (docs/scenes/nebula.md, 2026-10-30).
 */

/** Twinkle's rise and fall, in seconds. */
const TWINKLE_RISE = 0.012;
const TWINKLE_FALL = 0.15;
/** Seeds stay below this, so the float uniform carries them exactly. */
const SEED_SPAN = 65536;

/** Drop shock: where the burst starts ahead of the camera, how far its front reaches and how fast it
 *  gets there (world units, seconds), how long the front stays lit, and how long the gas it crossed
 *  keeps burning. */
export const SHOCK_AHEAD = 5;
export const SHOCK_RMAX = 11;
const SHOCK_TAU = 1.3;
const SHOCK_LIFE = 1.8;
const IGNITE_LIFE = 3.5;
/** The burst's attack, in seconds. */
const SHOCK_RISE = 0.03;

/** A swing's median and spread come from its smoothed reading sampled every SWING_EVERY_SEC over
 *  the last SWING_SAMPLES samples; a reading this many spreads from the median is a full swing; the
 *  spread never counts as less than SWING_FLOOR, so a steady signal doesn't turn its smallest wobble
 *  into a full swing. */
const SWING_EVERY_SEC = 0.25;
const SWING_SAMPLES = 120;
const SWING_SPREADS = 2;
const SWING_FLOOR = 0.02;
/** The share of SWING_SAMPLES a swing waits for before it swings in full. */
const SWING_SETTLE = 0.25;
/** Inner light: how fast the lead's reading is smoothed (seconds), and the share of the lead's level
 *  that lights the gas when the lead sits at its usual level or below. */
const INNER_SMOOTH_SEC = 0.25;
const INNER_REST = 0.35;
/** Colour tilt: the centroid is smoothed over this long first, so a single bright hit doesn't swing
 *  the colours; then the lean follows over TILT_SMOOTH_SEC. */
const TILT_FOLLOW_SEC = 1.5;
const TILT_SMOOTH_SEC = 0.6;

/** A signal against its own recent level: the swing is -1..1, 0 at its median. */
interface Swing {
  smooth: number | null;
  ring: Float32Array;
  sorted: Float32Array;
  count: number;
  next: number;
  clock: number;
  median: number;
  spread: number;
}

function createSwing(): Swing {
  const ring = new Float32Array(SWING_SAMPLES);
  return { smooth: null, ring, sorted: new Float32Array(SWING_SAMPLES), count: 0, next: 0, clock: 0, median: 0, spread: 0 };
}

function medianOf(xs: Float32Array): number {
  xs.sort();
  const n = xs.length;
  return n % 2 ? xs[(n - 1) / 2] : 0.5 * (xs[n / 2 - 1] + xs[n / 2]);
}

function sampleSwing(s: Swing, x: number): void {
  s.ring[s.next] = x;
  s.next = (s.next + 1) % SWING_SAMPLES;
  s.count = Math.min(s.count + 1, SWING_SAMPLES);
  const window = s.sorted.subarray(0, s.count);
  window.set(s.ring.subarray(0, s.count));
  s.median = medianOf(window);
  for (let k = 0; k < s.count; k++) window[k] = Math.abs(s.ring[k] - s.median);
  s.spread = medianOf(window);
}

function stepSwing(s: Swing, x: number, dtSec: number, smoothSec: number): number {
  if (s.smooth === null) {
    s.smooth = x;
    sampleSwing(s, x);
  } else {
    s.smooth += (x - s.smooth) * (1 - Math.exp(-dtSec / smoothSec));
    s.clock += dtSec;
    if (s.clock >= SWING_EVERY_SEC) {
      s.clock %= SWING_EVERY_SEC;
      sampleSwing(s, s.smooth);
    }
  }
  // With few samples the spread reads near zero and every wobble would be a full swing: ease in.
  const settled = Math.min(1, s.count / (SWING_SAMPLES * SWING_SETTLE));
  return settled * Math.min(Math.max((s.smooth - s.median) / (SWING_SPREADS * Math.max(s.spread, SWING_FLOOR)), -1), 1);
}

interface TwinkleSlot {
  seed: number;
  /** Seconds since its hat; Infinity before the first. */
  age: number;
  /** The hat's size, 0..1 (drives.hitSize). */
  size: number;
}

export interface Reactions {
  twinkle: [TwinkleSlot, TwinkleSlot];
  /** Seconds since the last drop; Infinity before the first. */
  shockAge: number;
  /** The burst's centre in world units (flight.ts's cameraWorld frame). */
  shockCentre: [number, number, number];
  lead: Swing;
  centroid: Swing;
  /** Inner light's level, 0..1, before its setting. */
  inner: number;
  /** The colour lean, -1 (cool) .. +1 (warm). */
  tilt: number;
}

export function createReactions(): Reactions {
  return {
    twinkle: [
      { seed: 0, age: Infinity, size: 0 },
      { seed: 0, age: Infinity, size: 0 },
    ],
    shockAge: Infinity,
    shockCentre: [0, 0, 0],
    lead: createSwing(),
    centroid: createSwing(),
    inner: 0,
    tilt: 0,
  };
}

export function triggerTwinkle(r: Reactions, size: number, rand: () => number = Math.random): void {
  const slot = r.twinkle[0].age >= r.twinkle[1].age ? r.twinkle[0] : r.twinkle[1];
  slot.seed = Math.floor(rand() * SEED_SPAN) % SEED_SPAN;
  slot.age = 0;
  slot.size = Math.min(Math.max(size, 0), 1);
}

/** Starts a burst `SHOCK_AHEAD` along `forward` (a unit vector) from the camera at `cam`. */
export function triggerShock(r: Reactions, cam: readonly number[], forward: readonly number[]): void {
  r.shockCentre = [cam[0] + forward[0] * SHOCK_AHEAD, cam[1] + forward[1] * SHOCK_AHEAD, cam[2] + forward[2] * SHOCK_AHEAD];
  r.shockAge = 0;
}

export function advanceReactions(r: Reactions, dtSec: number, lead: number, centroid: number): void {
  r.twinkle[0].age += dtSec;
  r.twinkle[1].age += dtSec;
  r.shockAge += dtSec;
  const rise = Math.max(stepSwing(r.lead, lead, dtSec, INNER_SMOOTH_SEC), 0);
  r.inner = Math.max(r.lead.smooth ?? 0, 0) * (INNER_REST + (1 - INNER_REST) * rise);
  const lean = -stepSwing(r.centroid, centroid, dtSec, TILT_FOLLOW_SEC);
  r.tilt += (lean - r.tilt) * (1 - Math.exp(-dtSec / TILT_SMOOTH_SEC));
}

function flash(s: TwinkleSlot): number {
  if (!(s.age < 5 * TWINKLE_FALL)) return 0;
  return s.size * (1 - Math.exp(-s.age / TWINKLE_RISE)) * Math.exp(-s.age / TWINKLE_FALL);
}

/** stars.ts's `uTw`: each slot's seed and flash, 0..1. */
export function twinkleUniforms(r: Reactions, out = new Float32Array(4)): Float32Array {
  out[0] = r.twinkle[0].seed;
  out[1] = flash(r.twinkle[0]);
  out[2] = r.twinkle[1].seed;
  out[3] = flash(r.twinkle[1]);
  return out;
}

/** The front's strength, 0..1: a fast attack, then a fade over SHOCK_LIFE. */
export function shockAmp(r: Reactions): number {
  const a = r.shockAge;
  if (!(a < 3 * SHOCK_LIFE)) return 0;
  return (1 - Math.exp(-a / SHOCK_RISE)) * Math.exp((-1.6 * a) / SHOCK_LIFE);
}

/** How hot the gas behind the front still burns, 0..1. */
export function igniteAmp(r: Reactions): number {
  const a = r.shockAge;
  if (!(a < 4 * IGNITE_LIFE)) return 0;
  return (1 - Math.exp(-a / SHOCK_RISE)) * Math.exp(-a / IGNITE_LIFE);
}

/** glsl.ts's `uShockAt`: the burst centre minus the camera at `cam` (xyz) and the front's radius (w). */
export function shockUniforms(r: Reactions, cam: readonly number[], out = new Float32Array(4)): Float32Array {
  const age = Number.isFinite(r.shockAge) ? r.shockAge : 0;
  out[0] = r.shockCentre[0] - cam[0];
  out[1] = r.shockCentre[1] - cam[1];
  out[2] = r.shockCentre[2] - cam[2];
  out[3] = SHOCK_RMAX * (1 - Math.exp(-age / SHOCK_TAU));
  return out;
}
