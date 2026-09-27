// Beat ripple's continuous ring emitter, for Caustics (caustics.ts). This is
// the third design this scene's Beat ripple has shipped with, and it's
// deliberately a compromise between the first two, not a fourth idea:
//
// 1. A fixed pool of analytic gaussian rings (see caustics.ts's git history
//    around `createRipplePool`), each launched whole by a yes/no trigger. The
//    user liked this look — a clean, defined gaussian ring expanding from
//    centre to edge, refracting the filaments by the ring's own slope — but a
//    trigger is a bad fit for a busy or continuous driver: every tick that
//    read as "fire" launched a full ring on top of whatever was already
//    travelling, so a fast driver stacked or relaunched rings instead of
//    reading as one surface responding proportionally.
// 2. A real 2D wave-equation simulation (rippleTank.ts, since removed): a
//    stepped height field that carries whatever pushes it, so a busy driver
//    reads as a busy, interfering surface instead of a machine-gun of rings.
//    Correct as physics, but the user's verdict after seeing it running was
//    "nah, that's not it" — the tank's own texture (many small overlapping
//    wavelets, edge interference, a grid's own discretisation) doesn't read
//    as the same thing the old rings did, and asked for something in between.
//
// This module keeps design 1's exact ring shape (rippleEnvelope's
// attack-then-decay, the gaussian crest/slope profile, the mirrored term that
// keeps slope zero at the origin — all identical to the old pool's FRAG math,
// see buildProfile below) but replaces "launch a whole ring on a yes/no
// trigger" with "continuously emit ring height in proportion to how much the
// driver just rose" (advanceEmission). The two failure modes design 1 had
// disappear as a consequence, not as a special case: a clean, isolated hit
// (the driver jumps up then decays back down) rises by its full height in one
// go, so it still launches one ring at essentially full strength — bit-for-
// bit the old pool's look. A busy driver (hits arriving faster than the
// signal can fall back between them) can only ever emit the *difference*
// between where it last was and where it is now, so each successive ring in
// a fast run is weaker than the last purely because there was less room left
// to rise into — the surface ducks itself, the way a struck bell rings
// quietly if you strike it again before it's stopped, with no explicit rate
// limiting or spacing logic needed anywhere. And a slow swell or a level held
// steady rises too slowly (or not at all) to clear the rise deadband, so it
// emits nothing — the tank's own "only a change should ring the water"
// property, carried over without needing a separate slow-average high-pass
// (advanceRippleHighpass is gone; the deadbanded rise detector here does that
// job on a much shorter timescale, tuned to reject a single frame's noise
// rather than a whole song section's).
//
// Because every ring still shares one centre (the frame's own, same as both
// earlier designs), the whole visible field is a single 1D function of
// radius — there is no 2D state to simulate. createRippleEmitter keeps every
// ring in flight as a plain {ageSec, amp} entry in a ring buffer; buildProfile
// walks that buffer once per frame and sums each entry's contribution into
// two flat arrays (crest and slope, sampled at PROFILE_SAMPLES radii up to
// PROFILE_MAX_RADIUS), which caustics.ts uploads as uRippleCrest/uRippleSlope
// and FRAG samples with a linear interpolation at each pixel's own radius —
// no GPU simulation pass, no per-slot uniform array for FRAG to loop over
// itself (the old pool's own approach), just two small float arrays.

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

// ---- Settings mappings -----------------------------------------------
//
// Wave speed/Wave fade carry over by name from the wave-tank era (their
// defaults are unchanged), now read here instead of by rippleTank.ts; Ring
// width is new, replacing that era's Drop size as the one shape control a
// centre-seated emitter still needs (there's no separate "how wide is the
// source" question without a source radius to speak of — Ring width is
// simply how tight the travelling ring's own gaussian is). All three are
// geometric (log-linear) interpolations except Wave fade — see that
// function's own comment for why.

const WAVE_SPEED_AT_0 = 0.6; // p-space units/sec at Wave speed = 0
const WAVE_SPEED_AT_1 = 2.2; // p-space units/sec at Wave speed = 1
const WAVE_DECAY_AT_0 = 0.15; // /sec at Wave fade = 0 (a ring rings almost losslessly)
const WAVE_DECAY_AT_1 = 1.2; // /sec at Wave fade = 1 (dies out within a fraction of a second)
const RING_GAUSSIAN_W_AT_0 = 12; // tight, crisp ring at Ring width = 0
const RING_GAUSSIAN_W_AT_1 = 1.5; // wide, soft ring at Ring width = 1

/** Wave speed (0..1) -> ring expansion speed, p-space units/sec. Geometric
 *  between WAVE_SPEED_AT_0/1 — the same log-linear idiom
 *  causticDensityScale() uses in caustics.ts — so the setting's own default
 *  (0.5) lands close to RIPPLE_SPEED, the old ring pool's fixed speed
 *  (sqrt(0.6*2.2) ≈ 1.15 against the old 1.1). */
export function rippleSpeedFor(waveSpeed: number): number {
  const t = clamp01(waveSpeed);
  return WAVE_SPEED_AT_0 * Math.pow(WAVE_SPEED_AT_1 / WAVE_SPEED_AT_0, t);
}

/** Wave fade (0..1) -> exponential decay rate, per real second. Linear, not
 *  geometric like the other two mappings here: Wave fade's own default is
 *  0.3, not 0.5 (unlike Wave speed/Ring width, chosen to reproduce this
 *  scene's own long-standing default and Ring width's own new one), and a
 *  linear map over [WAVE_DECAY_AT_0, WAVE_DECAY_AT_1] lands close to the old
 *  ring pool's fixed decay right at that default; a geometric map centred at
 *  0.5 would land nowhere near it at 0.3. */
export function rippleDecayFor(waveFade: number): number {
  const t = clamp01(waveFade);
  return WAVE_DECAY_AT_0 + (WAVE_DECAY_AT_1 - WAVE_DECAY_AT_0) * t;
}

/** Ring width (0..1) -> the profile's own gaussian tightness (W in
 *  exp(-d^2 * W); lower W is a wider, softer ring). Geometric between
 *  RING_GAUSSIAN_W_AT_0/1, same idiom as rippleSpeedFor: the default (0.5)
 *  lands close to RIPPLE_WIDTH, the old ring pool's fixed width
 *  (sqrt(12*1.5) ≈ 4.24 against the old 4.0). */
export function rippleWidthFor(ringWidth: number): number {
  const t = clamp01(ringWidth);
  return RING_GAUSSIAN_W_AT_0 * Math.pow(RING_GAUSSIAN_W_AT_1 / RING_GAUSSIAN_W_AT_0, t);
}

/** The three resolved physics values buildProfile/RippleEmitter.tick need
 *  each frame, bundled so a caller only has to thread one object through
 *  instead of three loose numbers. */
export interface RippleProfileParams {
  /** rippleDecayFor(waveFade). */
  decayPerSec: number;
  /** rippleSpeedFor(waveSpeed). */
  speedUnitsPerSec: number;
  /** rippleWidthFor(ringWidth). */
  widthGaussianW: number;
}

// ---- Ring envelope ------------------------------------------------------

// A short attack from 0 so a beat reads as a strike on the water, not a cut
// — identical to the old ring pool's own RIPPLE_ATTACK_SEC. Left as a fixed
// constant, not a setting: it's what makes a ring read as a ring rather than
// a step at all, not a look someone would want to detune away.
const RIPPLE_ATTACK_SEC = 0.06;

/** A ring's strength over its life since it was emitted: the same
 *  short-attack, exponential-decay shape the old ring pool's rippleEnvelope
 *  used (fluid.ts's own puff clock and shockwave pool still cite this shape
 *  by name) — only now `decayPerSec` is a live parameter (Wave fade) instead
 *  of a fixed constant. */
export function rippleEnvelope(ageSec: number, decayPerSec: number): number {
  if (ageSec <= 0) return 0;
  return (1 - Math.exp(-ageSec / RIPPLE_ATTACK_SEC)) * Math.exp(-ageSec * decayPerSec);
}

// ---- Emission conditioning ------------------------------------------------

// How fast advanceEmission's own smoothing chases the raw driver signal.
// This has to stay short: anim.lowPulse/beatPulse jump to 1 in a single tick
// and decay at a fixed rate (BEAT_PULSE_DECAY_PER_SEC = 6/sec, animClock.ts)
// that a one-pole filter is chasing at the same time it's rising — the
// filter's own peak response to that race is what a lone hit's total
// emission is capped by (see tests/rippleEmitter.test.ts's own numbers), so
// a tau much above this starts visibly undershooting "one full old-style
// ring" for an ordinary beat, not just for noise. What's left still knocks
// down noise faster than any real driver moves: a beat's own attack is exactly
// one render tick wide, but the audio analysis feeding FeatureFrame can jitter
// sample-to-sample faster than that (this scene reads AnimFrame, itself
// downstream of that analysis), and this is still several times that
// timescale.
const EMISSION_SMOOTH_TAU_SEC = 0.005;

// A rise slower than this (driver units per second) is a swell or a fade-in,
// not a hit, and emits nothing. 0.5/s means a signal climbing from 0 to 1
// over two seconds or slower nets ~0 (see tests/rippleEmitter.test.ts's ramp
// case), while a real hit's rise — order 1 unit within roughly one smoothing
// time constant, i.e. hundreds of units/sec — clears it by well over two
// orders of magnitude and is barely dented by the subtraction (see the
// "single hit" test's ~10% tolerance).
const RISE_DEADBAND_PER_SEC = 0.5;

// Salience: a ring is sized by how much a rise stands out from the recent
// rises, not by its absolute height. In real music the hit detectors behind
// the driver fire on everything — hats, ghost notes, small transients — and
// every one of them makes the driver jump; sized by absolute height, each
// sent a fresh ring from the centre every fraction of a second, burying the
// ring the real hit sent (it read as the ripple being reset by noise; only a
// hit followed by clean silence looked right).
//
// A rise is measured as a whole *climb* — from the last dip to wherever the
// signal has got to — not frame by frame. A hit is a one-frame climb; a
// smooth source (a level, a drawn line) climbs over many frames, and sized
// per frame each step was too small to count, so the trackers below never
// learned that source and every climbing frame sent its own small ring. Per
// climb, the ring grows as the climb does (each frame emits only what the
// climb's salience has gained since the last frame, so a slow bump starts
// its ring the moment it crosses the bar), and the finished climb's total
// is what the trackers learn from. Two trackers, updated when a climb ends
// (a climb past SALIENCE_EVENT_MIN):
//   - the peak follows the *big* rises: it jumps straight to a bigger one
//     and eases down slowly toward a smaller one;
//   - the floor is the running average of the *background* rises only —
//     those below SALIENCE_BACKGROUND_FRACTION of the peak (or below the
//     floor itself). A hit near the peak never raises the floor, so a steady
//     four-on-the-floor of equal kicks keeps ringing at full strength however
//     long it runs.
// A rise emits (rise − SALIENCE_MARGIN·floor) / (peak − SALIENCE_MARGIN·floor),
// clamped to 0..1: background hits sit near the floor and emit ~nothing, a
// hit at the peak emits a full ring. SALIENCE_SPREAD_MIN keeps that ratio
// from amplifying tiny differences when every recent rise is about the same
// size (a noise-only passage). Both trackers relax over time
// (SALIENCE_*_RELAX_SEC), so after a quiet spell even a modest hit stands out
// again.
const SALIENCE_EVENT_MIN = 0.05; // a rise smaller than this doesn't move the trackers (the smoothing's own one-frame tail, sub-noise jitter)
const SALIENCE_BACKGROUND_FRACTION = 0.6; // a rise below this share of the peak counts as background
const SALIENCE_FLOOR_RATE = 0.2; // per background event, toward that rise
const SALIENCE_PEAK_DOWN = 0.05; // per event, toward a smaller rise
const SALIENCE_MARGIN = 1.5; // a rise must clear this multiple of the floor to ring at all
const SALIENCE_FLOOR_RELAX_SEC = 3; // floor decays toward 0 with this time constant
const SALIENCE_PEAK_RELAX_SEC = 6; // peak decays toward the floor with this time constant
const SALIENCE_SPREAD_MIN = 0.3;

export interface RippleEmissionState {
  smoothed: number;
  init: boolean;
  /** Salience floor — the size of the frequent, background climbs. */
  floor: number;
  /** Salience peak — the size of the big climbs. */
  peak: number;
  /** Whether the signal is climbing right now. */
  climbing: boolean;
  /** The level the current climb started from (the last dip). */
  base: number;
  /** Ring height already emitted for the current climb. */
  emittedThisClimb: number;
  /** The salience bar and full-ring climb, frozen at the climb's start. */
  climbBar: number;
  climbSpread: number;
}

export function createRippleEmissionState(): RippleEmissionState {
  return {
    smoothed: 0,
    init: false,
    floor: 0,
    peak: 0,
    climbing: false,
    base: 0,
    emittedThisClimb: 0,
    climbBar: 0,
    climbSpread: SALIENCE_SPREAD_MIN,
  };
}

function learnClimb(state: RippleEmissionState, climb: number): void {
  if (climb < SALIENCE_EVENT_MIN) return;
  if (climb < SALIENCE_BACKGROUND_FRACTION * state.peak || climb < state.floor) {
    state.floor += (climb - state.floor) * SALIENCE_FLOOR_RATE;
  }
  state.peak = climb > state.peak ? climb : state.peak + (climb - state.peak) * SALIENCE_PEAK_DOWN;
}

/** Conditions a raw driver reading into "how much ring height to launch this
 *  frame": a light one-pole smoothing (EMISSION_SMOOTH_TAU_SEC, frame-rate
 *  independent) to kill frame-to-frame noise, then a deadbanded rise
 *  detector (RISE_DEADBAND_PER_SEC) so only an actual rise — not a slow
 *  swell, not a held level, not a falling signal — emits anything. Advances
 *  `state` in place and returns the emitted amount (>= 0). The first call
 *  seeds the smoothing from `signal` and emits nothing, so startup never
 *  reads as a rise from a falsely zeroed average — same idiom as
 *  advanceLoudSwell/advanceRippleHighpass elsewhere in this scene's history.
 *  Pure aside from `state`, and exported so tests/rippleEmitter.test.ts can
 *  pin the load-bearing property directly: a clean 0->1 jump followed by a
 *  decay emits a total close to 1 (one old-style full-strength ring), while
 *  a constant signal or a slow ramp emits close to 0. Each climb is then
 *  sized by salience (see the SALIENCE_* constants' comment): background
 *  climbs emit ~0, standout ones a full ring. */
export function advanceEmission(state: RippleEmissionState, dtSec: number, signal: number): number {
  if (!state.init) {
    state.smoothed = signal;
    state.init = true;
    return 0;
  }
  const prev = state.smoothed;
  const rate = 1 - Math.exp(-dtSec / EMISSION_SMOOTH_TAU_SEC);
  state.smoothed = prev + (signal - prev) * rate;
  const rising = state.smoothed - prev > RISE_DEADBAND_PER_SEC * dtSec;

  state.floor *= Math.exp(-dtSec / SALIENCE_FLOOR_RELAX_SEC);
  state.peak = state.floor + (state.peak - state.floor) * Math.exp(-dtSec / SALIENCE_PEAK_RELAX_SEC);

  if (!rising) {
    if (state.climbing) {
      state.climbing = false;
      learnClimb(state, prev - state.base);
    }
    return 0;
  }
  if (!state.climbing) {
    // A new climb from the last dip. The bar and spread are frozen here, as
    // the trackers stood *before* this climb, so a climb bigger than
    // anything recent reads as a full ring rather than as merely equal to a
    // peak it is itself raising.
    state.climbing = true;
    state.base = prev;
    state.emittedThisClimb = 0;
    state.climbBar = SALIENCE_MARGIN * state.floor;
    state.climbSpread = Math.max(state.peak - state.climbBar, SALIENCE_SPREAD_MIN);
  }
  const climb = state.smoothed - state.base;
  const target = clamp01((climb - state.climbBar) / state.climbSpread);
  const emitted = Math.max(0, target - state.emittedThisClimb);
  state.emittedThisClimb = Math.max(state.emittedThisClimb, target);
  return emitted;
}

/** Where advanceEmission's salience puts the line right now, as signal
 *  heights on the same axis the driver is plotted on — for the panel's graph
 *  (settingMarks.ts). `ringsAbove` is the level the signal has to climb to
 *  for a ring to start, `fullRing` the level that makes it full strength,
 *  both measured from where the current climb started (or, between climbs,
 *  from where the signal is now — the dip a next climb would start from). */
export function salienceMarks(state: RippleEmissionState): { ringsAbove: number; fullRing: number } {
  if (state.climbing) {
    return { ringsAbove: state.base + state.climbBar, fullRing: state.base + state.climbBar + state.climbSpread };
  }
  const bar = SALIENCE_MARGIN * state.floor;
  const spread = Math.max(state.peak - bar, SALIENCE_SPREAD_MIN);
  return { ringsAbove: state.smoothed + bar, fullRing: state.smoothed + bar + spread };
}

// ---- Ring buffer ----------------------------------------------------------

const DEFAULT_MAX_ENTRIES = 512;
// emit() ignores anything smaller than this — the same "not worth a slot"
// floor the old pool's own amplitude comparisons used implicitly.
const EMIT_MIN_AMP = 1e-4;
// tick() drops an entry once its own envelope*amp can no longer read as
// visible — matches the crest/slope contribution a sample would compute to
// effectively 0 anyway, just skipped here so buildProfile never has to walk
// dead entries.
const ENTRY_FADE_FLOOR = 1e-3;

export interface RippleEmitter {
  /** Number of entries currently in flight — the valid prefix of ageSec/amp. */
  readonly count: number;
  /** Age, in seconds since launch, of each in-flight entry (index < count). */
  readonly ageSec: Float32Array;
  /** Launch amplitude of each in-flight entry (index < count) — the ring's
   *  strength at rippleEnvelope(0, ...), i.e. before its own attack/decay. */
  readonly amp: Float32Array;
  /** Launches a new ring of this amplitude at age 0 — or, if this frame
   *  already launched one (the newest entry is still exactly age 0), adds
   *  to it instead of spending a second slot, so a drop's own extra kick and
   *  an ordinary beat landing on the same tick become one ring, not two
   *  coincident ones (the old pool's own reasoning for merging coincident
   *  triggers). Amounts below EMIT_MIN_AMP are ignored. If the buffer is
   *  full, the oldest entry is dropped to make room — in practice this
   *  should be unreachable: an entry ages out (see tick) long before
   *  `maxEntries` real hits could stack up. */
  emit(amp: number): void;
  /** Ages every entry by `dtSec` and drops any that can no longer read as
   *  visible: its own envelope*amp has faded below ENTRY_FADE_FLOOR, or its
   *  ring has already travelled past where buildProfile would ever sample it
   *  (PROFILE_MAX_RADIUS plus its own gaussian tail, 3 standard deviations
   *  of `params.widthGaussianW`). Call once per frame, before emit() for that
   *  frame, so a freshly emitted ring starts this frame at age 0 rather than
   *  ageing before its first sample. */
  tick(dtSec: number, params: RippleProfileParams): void;
}

export function createRippleEmitter(maxEntries = DEFAULT_MAX_ENTRIES): RippleEmitter {
  const ageSec = new Float32Array(maxEntries);
  const amp = new Float32Array(maxEntries);
  let count = 0;

  return {
    get count() {
      return count;
    },
    ageSec,
    amp,

    emit(amount) {
      if (amount < EMIT_MIN_AMP) return;
      if (count > 0 && ageSec[count - 1] === 0) {
        amp[count - 1] += amount;
        return;
      }
      if (count >= maxEntries) {
        for (let i = 1; i < count; i++) {
          ageSec[i - 1] = ageSec[i]!;
          amp[i - 1] = amp[i]!;
        }
        count--;
      }
      ageSec[count] = 0;
      amp[count] = amount;
      count++;
    },

    tick(dtSec, params) {
      const sigma = 1 / Math.sqrt(2 * params.widthGaussianW);
      const exitRadius = PROFILE_MAX_RADIUS + 3 * sigma;
      let w = 0;
      for (let i = 0; i < count; i++) {
        const age = ageSec[i]! + dtSec;
        const a = amp[i]!;
        const s = a * rippleEnvelope(age, params.decayPerSec);
        const r = age * params.speedUnitsPerSec;
        if (s < ENTRY_FADE_FLOOR || r > exitRadius) continue;
        ageSec[w] = age;
        amp[w] = a;
        w++;
      }
      count = w;
    },
  };
}

// ---- Radial profile --------------------------------------------------------

/** Samples per profile array — the resolution buildProfile fills and FRAG
 *  linearly interpolates between. */
export const PROFILE_SAMPLES = 256;
// The far edge of the sampled profile, in p-space units. The 16:9 frame's
// own far corner at this scene's 3x zoom is length((0.5*aspectFix, 0.5)*3)
// ≈ 3.06 for a 16:9 aspectFix; uBreathe's own zoom widens that to ~3.4 at
// its own peak. PROFILE_MAX_RADIUS leaves a further margin past that so a
// ring's own gaussian tail (its ±3σ reach — the same margin tick()'s own
// exit test adds) doesn't visibly clip right at the corner.
export const PROFILE_MAX_RADIUS = 4.2;

/** Fills `crestOut`/`slopeOut` (each PROFILE_SAMPLES long, one sample every
 *  PROFILE_MAX_RADIUS/(PROFILE_SAMPLES-1) units of radius starting at 0) with
 *  the emitter's current radial ring profile: every entry still in flight
 *  summed via exactly the old ring pool's own per-ring formula (see the file
 *  header) — a gaussian crest centred on the ring's own current radius R,
 *  plus a mirrored gaussian centred at -R so the summed *slope* comes out
 *  exactly zero at r=0 for any entry (a young ring's own dimple has to be
 *  smooth right at the origin, not a discontinuity). `slopeOut` is
 *  normalized so a single full-strength entry's own peak slope is exactly 1
 *  — the old pool's RIPPLE_SLOPE_NORM did the same job for a fixed
 *  RIPPLE_WIDTH; recomputed here every call since Ring width can now move
 *  the gaussian's own tightness at runtime. FRAG then only has to apply its
 *  own single display gain (the Beat ripple slider, plus RIPPLE_REFRACT) on
 *  top — no different from reading a lone ring under the old pool. Each
 *  entry only touches the samples within its own ±3σ reach (both the outward
 *  crest and, while the ring is still young, the inward mirror near r=0), so
 *  cost stays close to linear in the number of visible rings rather than
 *  PROFILE_SAMPLES * entry count. */
export function buildProfile(
  emitter: RippleEmitter,
  params: RippleProfileParams,
  crestOut: Float32Array,
  slopeOut: Float32Array,
): void {
  crestOut.fill(0);
  slopeOut.fill(0);
  const { decayPerSec, speedUnitsPerSec, widthGaussianW } = params;
  const sigma = 1 / Math.sqrt(2 * widthGaussianW);
  const slopeNorm = Math.sqrt(2 * widthGaussianW) * Math.exp(0.5);
  const dr = PROFILE_MAX_RADIUS / (PROFILE_SAMPLES - 1);
  const { ageSec, amp, count } = emitter;

  for (let e = 0; e < count; e++) {
    const age = ageSec[e]!;
    const s = amp[e]! * rippleEnvelope(age, decayPerSec);
    if (s < ENTRY_FADE_FLOOR) continue;
    const r0 = age * speedUnitsPerSec;
    const loR = r0 < 3 * sigma ? 0 : r0 - 3 * sigma;
    const hiR = r0 + 3 * sigma;
    const loIdx = Math.max(0, Math.floor(loR / dr));
    const hiIdx = Math.min(PROFILE_SAMPLES - 1, Math.ceil(hiR / dr));
    for (let i = loIdx; i <= hiIdx; i++) {
      const r = i * dr;
      const dOut = r - r0;
      const dIn = r + r0;
      const gOut = Math.exp(-dOut * dOut * widthGaussianW);
      const gIn = Math.exp(-dIn * dIn * widthGaussianW);
      crestOut[i]! += s * (gOut + gIn);
      slopeOut[i]! += s * (dOut * gOut + dIn * gIn) * slopeNorm;
    }
  }
}
