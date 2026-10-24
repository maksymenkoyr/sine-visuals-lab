// Beat ripple's "Rings start: Random spot" mode for Caustics (caustics.ts).
// Each new ring start picks a spot at a new random place on the water, the way
// Physarum 2's Dose drops each colony somewhere new. There is a fixed set of
// spots, each with its own RippleEmitter (rippleEmitter.ts): a ring start takes
// the next spot, and later emissions of the same run go to that spot, so one
// run keeps one ring. When every spot is busy, the spot whose strongest ring is
// weakest is cleared and reused, since that is the least visible ring to lose.
// buildRippleSpots writes each spot's crest/slope profile as one row of an RG
// texture that FRAG samples and sums per pixel. A texture rather than uniform
// arrays, because one profile array per spot would blow the fragment-uniform
// budget that the centre mode's two float arrays already use most of.
// Positions come from an integer hash of a ring counter, not Math.random, so
// every render of the same audio picks the same spots.

import {
  buildProfile,
  createRippleEmitter,
  NARROW_EVENT_MIN,
  PROFILE_SAMPLES,
  rippleEnvelope,
  type RingStyle,
  type RippleEmitter,
  type RippleProfileParams,
} from "./rippleEmitter.ts";

export const RIPPLE_SPOTS = 8;
// How far from the centre a spot may land, as a share of the frame's half-width/half-height. Kept inside so a ring from a spot still reaches the far corner within PROFILE_MAX_RADIUS.
export const SPOT_REACH = 0.4;

export type RingOrigin = "center" | "spot";

export function ringOriginFor(value: number): RingOrigin {
  return Math.round(value) >= 1 ? "spot" : "center";
}

export interface RippleSpots {
  readonly emitters: RippleEmitter[];
  /** Per spot: x, y in -1..1 (FRAG scales by the frame and SPOT_REACH), live (1 if rings in flight else 0), unused. */
  readonly spot: Float32Array;
  /** PROFILE_SAMPLES x RIPPLE_SPOTS, two floats (crest, slope) per texel, row k = spot k. */
  readonly tex: Float32Array;
  current: number;
  ringsStarted: number;
  emitting: boolean;
  lastParams: RippleProfileParams | null;
}

export function createRippleSpots(): RippleSpots {
  return {
    emitters: Array.from({ length: RIPPLE_SPOTS }, () => createRippleEmitter()),
    spot: new Float32Array(RIPPLE_SPOTS * 4),
    tex: new Float32Array(RIPPLE_SPOTS * PROFILE_SAMPLES * 2),
    current: 0,
    ringsStarted: 0,
    emitting: false,
    lastParams: null,
  };
}

// A murmur3-style finalizer; applied twice with different seeds below so the
// x and y of one spot don't come out correlated.
function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

export function spotPosition(n: number): [number, number] {
  const hx = fmix32(fmix32(n ^ 0x68e31da4) ^ 0x2545f491);
  const hy = fmix32(fmix32(n ^ 0xb5297a4d) ^ 0x9e3779b9);
  return [(hx / 0xffffffff) * 2 - 1, (hy / 0xffffffff) * 2 - 1];
}

export function tickRippleSpots(s: RippleSpots, dtSec: number, params: RippleProfileParams): void {
  for (const e of s.emitters) e.tick(dtSec, params);
  s.lastParams = params;
}

export function spotStartsRing(s: RippleSpots, emitted: number): boolean {
  const on = emitted > NARROW_EVENT_MIN;
  const starts = on && !s.emitting;
  s.emitting = on;
  return starts;
}

function strongestRing(e: RippleEmitter, decayPerSec: number): number {
  let best = 0;
  for (let i = 0; i < e.count; i++) {
    best = Math.max(best, e.amp[i]! * rippleEnvelope(e.ageSec[i]!, decayPerSec));
  }
  return best;
}

// Without tick() there are no decay params to rank by, so fall back to the
// spot whose newest ring is oldest.
function pickSpot(s: RippleSpots): number {
  let pick = 0;
  let pickStrength = Infinity;
  for (let k = 0; k < RIPPLE_SPOTS; k++) {
    const e = s.emitters[k]!;
    if (e.count === 0) return k;
    const strength = s.lastParams
      ? strongestRing(e, s.lastParams.decayPerSec)
      : -e.ageSec[e.count - 1]!;
    if (strength < pickStrength) {
      pickStrength = strength;
      pick = k;
    }
  }
  return pick;
}

export function emitRippleSpot(s: RippleSpots, amount: number, style: RingStyle, newSpot: boolean): void {
  if (newSpot) {
    const k = pickSpot(s);
    s.emitters[k]!.clear();
    s.current = k;
    const [x, y] = spotPosition(s.ringsStarted++);
    s.spot[k * 4] = x;
    s.spot[k * 4 + 1] = y;
  }
  s.emitters[s.current]!.emit(amount, style);
}

const crestScratch = new Float32Array(PROFILE_SAMPLES);
const slopeScratch = new Float32Array(PROFILE_SAMPLES);

export function buildRippleSpots(s: RippleSpots, params: RippleProfileParams, style: RingStyle): void {
  for (let k = 0; k < RIPPLE_SPOTS; k++) {
    const e = s.emitters[k]!;
    buildProfile(e, params, crestScratch, slopeScratch, style);
    const row = k * PROFILE_SAMPLES;
    for (let i = 0; i < PROFILE_SAMPLES; i++) {
      s.tex[(row + i) * 2] = crestScratch[i]!;
      s.tex[(row + i) * 2 + 1] = slopeScratch[i]!;
    }
    s.spot[k * 4 + 2] = e.count > 0 ? 1 : 0;
  }
}
