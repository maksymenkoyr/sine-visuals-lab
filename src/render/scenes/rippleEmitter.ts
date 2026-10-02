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

// ---- Auto-narrowing -------------------------------------------------------
//
// Rings in a steady train are identical and evenly spaced, and a train of
// identical soft rings sums to a flat plateau: the surface only keeps a
// visible ripple (slope) at the train's own spacing if each ring is narrow
// next to that spacing. For gaussian rings the ripple left in the sum falls
// off as exp(-2π²σ²/spacing²) — about a third of a lone ring's at
// σ = spacing/4, under 1% at σ = spacing/2. Ring width's own default is
// already past that at an ordinary beat, and a fast driver (a Beat wave
// swinging several times a second) left nothing but the centre moving.
// Real water does the same thing on its own: a source bobbing faster makes
// shorter waves. So the ring width is capped at NARROW_SPREAD_PER_GAP of the
// current gap between rings (speed × time between ring starts, smoothed),
// never wider than the user's Ring width and never narrower than
// NARROW_MAX_W allows. A pause lets the gap estimate grow again, so the next
// lone hit is back to full width.
const NARROW_SPREAD_PER_GAP = 0.25;
const NARROW_MAX_W = 200; // σ ≈ 0.05 p-space units, a few profile samples wide
const NARROW_EVENT_MIN = 0.05; // an emission run has to reach this to count as a ring start
const NARROW_INTERVAL_RATE = 0.35; // how fast the smoothed interval follows each new one

export interface RingRateState {
  /** Seconds since the last ring start. */
  sinceStartSec: number;
  /** Smoothed seconds between ring starts (Infinity until two starts). */
  intervalSec: number;
  /** Whether the previous frame was already emitting (a run in progress). */
  emitting: boolean;
  started: boolean;
}

export function createRingRateState(): RingRateState {
  return { sinceStartSec: Infinity, intervalSec: Infinity, emitting: false, started: false };
}

/** Tracks how often rings start, from each frame's emitted amount. */
export function advanceRingRate(state: RingRateState, dtSec: number, emitted: number): void {
  state.sinceStartSec += dtSec;
  const on = emitted > NARROW_EVENT_MIN;
  if (on && !state.emitting) {
    if (state.started && Number.isFinite(state.sinceStartSec)) {
      state.intervalSec = Number.isFinite(state.intervalSec)
        ? state.intervalSec + (state.sinceStartSec - state.intervalSec) * NARROW_INTERVAL_RATE
        : state.sinceStartSec;
    }
    state.started = true;
    state.sinceStartSec = 0;
  }
  state.emitting = on;
}

/** The gaussian tightness buildProfile should use: the user's Ring width,
 *  tightened when rings come close enough together to blur into each other
 *  (see the Auto-narrowing comment above). */
export function autoNarrowWidthW(userW: number, speedUnitsPerSec: number, rate: RingRateState): number {
  // A long pause counts as a wide gap, so a lone hit isn't narrowed by the
  // rate of a busy passage that has already ended.
  const gapSec = Math.max(rate.intervalSec, rate.sinceStartSec);
  if (!Number.isFinite(gapSec)) return userW;
  const sigmaMax = NARROW_SPREAD_PER_GAP * speedUnitsPerSec * gapSec;
  if (sigmaMax <= 0) return Math.max(userW, NARROW_MAX_W);
  const neededW = 1 / (2 * sigmaMax * sigmaMax);
  return Math.max(userW, Math.min(neededW, NARROW_MAX_W));
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

// ---- Ring style -----------------------------------------------------------
//
// Caustics' "Ring style" setting picks the per-ring shape buildProfile sums
// (Bump/Wave) and the emitter's own combining rule for close-together
// emissions (Merge) — see caustics.ts's own SETTINGS entry for the
// user-facing picker. Bump is every entry's shape today (a positive gaussian
// crest, unconditionally) and stays the default so nothing here changes
// until someone picks a different style.
//
// The problem Wave/Merge each answer, in their own way: a fast driver's
// rings land close enough together (their spacing shrinking as the driver
// speeds up) that they land closer than a ring's own width, so their
// (always-positive) Bump crests just pile into a rising, nearly flat
// plateau — the *slope* that actually refracts the filaments (RIPPLE_REFRACT
// in caustics.ts) cancels out in the interior of that pile-up, so a busy
// passage reads as "the centre brightens" rather than "rings are travelling
// outward". Wave fixes this at the shape level (each ring is zero-mean, so a
// dense pile-up can't accumulate a rising plateau — see WAVE_TROUGH_SHIFT_SIGMAS'
// own comment below); Merge fixes it at the emission level instead (fold
// close emissions into fewer, taller rings, so there's more real spacing
// between the ones that remain — see mergeWindowSec below). Both are
// legitimate, different answers to the same complaint, which is exactly why
// the user gets to compare them live rather than this file picking one.
export type RingStyle = "bump" | "wave" | "merge";

/** `ringStyle` setting value (0/1/2, rounded — same convention as fluid.ts's
 *  `symmetryToMirror`) -> the style it picks. Caustics' own SETTINGS entry
 *  owns the display labels ("Bump"/"Wave"/"Merge"); this is the one place
 *  the numeric value becomes the internal id buildProfile/emit key off. */
const RING_STYLES: readonly RingStyle[] = ["bump", "wave", "merge"];

export function ringStyleFor(value: number): RingStyle {
  const idx = Math.min(RING_STYLES.length - 1, Math.max(0, Math.round(value)));
  return RING_STYLES[idx]!;
}

// Wave's own shape: each ring is Bump's crest gaussian minus a second,
// identically-shaped gaussian trough trailing it by WAVE_TROUGH_SHIFT_SIGMAS
// standard deviations (sigma = 1/sqrt(2*widthGaussianW), the same sigma
// buildProfile's Bump branch and tick() already derive) — literally
// "profile(d) = g(d) - g(d + shift)" for d = r - R, the crest-minus-shifted-
// trough formulation this feature's own design discussion settled on over a
// Ricker/second-derivative-of-gaussian wavelet: a Ricker's own two flanking
// troughs sit within about one sigma of the crest (its natural wavelength is
// pinned to the ring's own width), which turned out too tight to survive a
// dense train's superposition — a directly *chosen* trough distance is what
// lets a train of these still show real separation between one ring's crest
// and the next's trough rather than blurring back into a plateau. The trough
// gaussian is subtracted with amplitude 1 (not dialable): a gaussian's own
// integral doesn't depend on where it's centred, so `g(d) - g(d+shift)`
// integrates to exactly 0 over d for *any* shift — the "net zero height"
// property comes free, not from tuning amplitude against shift.
//
// Both the crest gaussian and the trough gaussian get Bump's own mirrored
// term (reflecting each one through r=0 individually, not the combined
// crest-minus-trough shape as a whole): each is separately an even function
// of its own offset from its own centre, so each one's own mirror term
// cancels its own slope at r=0 exactly the way Bump's gIn cancels gOut's,
// and the sum of two exactly-cancelling pairs still cancels. This is what
// "keep the mirrored term for the origin" means for a two-gaussian shape —
// mirroring the *pieces*, not the whole.
//
// WAVE_TROUGH_SHIFT_SIGMAS=4 is chosen for the dense-train case Ring style
// exists for (tests/rippleEmitter.test.ts's own dense-train case): shifting
// the trough this far behind the crest is what lets a fast train of these
// keep a large *slope* amplitude in the middle of the pack instead of
// averaging toward flat the way Bump's same train does (a smaller shift
// interferes with its own neighbours too closely and washes back out toward
// flat, much like Bump). The cost is a young ring's own transient: for
// roughly its first ring-width's worth of travel (until its trough has fully
// "emerged" past r=0), the mirrored crest and mirrored trough terms interact
// at comparable strength and the ring's apparent height/slope swings well
// off its long-run value — even briefly reading near-zero around a third of
// the way through that window — before settling to match Bump's own
// full-strength peak from then on. This is Bump's own "the mirrored term
// adds a little near a young ring" allowance (buildProfile's own single-
// entry test), just larger, because Wave's own two length scales (the ring's
// width and the trough's shift) both compete with r=0 instead of one. In a
// dense train the effect is inaudible/invisible — many overlapping young
// rings at different phases average it away, which is the whole point of
// this style — but a single isolated hit will show it plainly; that's a real
// tradeoff for the user's own live comparison to weigh against Bump's clean
// (but flat-under-density) alternative, not a bug to hide.
const WAVE_TROUGH_SHIFT_SIGMAS = 4;
// The far-field (mirror-free) shape's own peak crest/slope, in the same
// sigma-normalized units buildProfile's Bump branch already uses (u = d /
// sigma): C(u) = e^(-u²/2) - e^(-(u+k)²/2) for the crest, S(u) = u·e^(-u²/2)
// - (u+k)·e^(-(u+k)²/2) for the (pre-normalization) slope shape, k =
// WAVE_TROUGH_SHIFT_SIGMAS — found by a numeric peak search over each
// formula (not closed-form; re-run the search if WAVE_TROUGH_SHIFT_SIGMAS
// ever changes). buildProfile divides by these so a lone full-strength
// ring's own peak crest/slope land at exactly 1, matching Bump's — the same
// role slopeNorm plays there, just needing its own peak constant since this
// shape isn't a plain gaussian.
const WAVE_CREST_PEAK = 0.9996654331533247;
const WAVE_SLOPE_PEAK = 0.6439621668208355;

// Merge's own window: two emissions within this many seconds of each other
// join into one ring instead of becoming two. Sized as the time a ring takes
// to travel its own width (2·sigma, the span within one standard deviation
// either side of its peak) at the current Wave speed/Ring width — a fast
// driver (rings closer together than this) reads as fewer, heavier rings; a
// slow one (rings further apart) is untouched, same as Bump. Recomputed from
// whichever RippleProfileParams tick() last saw (see createRippleEmitter's
// own `lastParams`), since Wave speed/Ring width can move at runtime.
const MERGE_AMP_CAP = 2.5;

function ringWidthUnits(widthGaussianW: number): number {
  return 2 / Math.sqrt(2 * widthGaussianW);
}

function mergeWindowSec(params: RippleProfileParams | null): number {
  if (!params || params.speedUnitsPerSec <= 0) return 0;
  return ringWidthUnits(params.widthGaussianW) / params.speedUnitsPerSec;
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
// A rise emits (rise − bar) / (peak − bar), clamped to 0..1, where the bar
// is ringThresholdBar — a margin above the floor plus a small fixed minimum,
// both set by the user's Ring threshold setting. In signal-processing terms
// this is an adaptive threshold: the floor is a noise-floor estimate, and
// the bar sits a margin above it. Background hits sit near the floor and
// emit ~nothing, a hit at the peak emits a full ring. SALIENCE_SPREAD_MIN keeps that ratio
// from amplifying tiny differences when every recent rise is about the same
// size (a noise-only passage). Both trackers relax over time
// (SALIENCE_*_RELAX_SEC), so after a quiet spell even a modest hit stands out
// again.
const SALIENCE_EVENT_MIN = 0.05; // a rise smaller than this doesn't move the trackers (the smoothing's own one-frame tail, sub-noise jitter)
const SALIENCE_BACKGROUND_FRACTION = 0.6; // a rise below this share of the peak counts as background
const SALIENCE_FLOOR_RATE = 0.2; // per background event, toward that rise
const SALIENCE_PEAK_DOWN = 0.05; // per event, toward a smaller rise
const SALIENCE_FLOOR_RELAX_SEC = 3; // floor decays toward 0 with this time constant
const SALIENCE_PEAK_RELAX_SEC = 6; // peak decays toward the floor with this time constant
const SALIENCE_SPREAD_MIN = 0.3;

// Ring threshold (0..1) → the bar. The margin runs from 1× the floor (ring
// on anything just above the everyday sounds) to 3×. Above the default a
// fixed minimum also grows, up to RING_THRESHOLD_MIN_AT_1, so raising the
// setting still does something on a clean source whose floor is 0.
// RING_THRESHOLD_DEFAULT is exactly the behaviour before this was a setting:
// a 1.5× margin and no minimum.
export const RING_THRESHOLD_DEFAULT = 0.25;
const RING_THRESHOLD_MARGIN_AT_0 = 1;
const RING_THRESHOLD_MARGIN_AT_1 = 3;
const RING_THRESHOLD_MIN_AT_1 = 0.25;

/** How far a climb must rise above its starting dip before it rings, for
 *  this floor and Ring threshold setting. Only ever called with the setting
 *  on — advanceEmission/salienceMarks skip straight to a bar of 0 while it's
 *  off, per this file's own advanceEmission doc. */
export function ringThresholdBar(floor: number, threshold: number): number {
  const t = clamp01(threshold);
  const margin = RING_THRESHOLD_MARGIN_AT_0 + (RING_THRESHOLD_MARGIN_AT_1 - RING_THRESHOLD_MARGIN_AT_0) * t;
  const minimum = RING_THRESHOLD_MIN_AT_1 * Math.max(0, (t - RING_THRESHOLD_DEFAULT) / (1 - RING_THRESHOLD_DEFAULT));
  return margin * floor + minimum;
}

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
  /** The Ring threshold the last advance used, while it was on — salienceMarks
   *  reads it to recompute the bar between climbs. Meaningless (but kept, not
   *  reset) while `thresholdOn` is false. */
  threshold: number;
  /** Whether the last advanceEmission call had a real threshold (Ring
   *  threshold's own On) or `null` (Off) — salienceMarks reads it to decide
   *  whether there's a bar to draw at all. */
  thresholdOn: boolean;
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
    threshold: RING_THRESHOLD_DEFAULT,
    thresholdOn: true,
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
 *  climbs emit ~0, standout ones a full ring.
 *
 *  `threshold` is `null` for Ring threshold's own Off switch: every climb
 *  rings, sized by nothing but its own absolute size (the bar is 0, the
 *  spread 1, so `target` above is just `clamp01(climb)`) — no standout
 *  required. The salience trackers (`floor`/`peak`) keep learning regardless
 *  of on/off, so switching back on doesn't start them from scratch. */
export function advanceEmission(
  state: RippleEmissionState,
  dtSec: number,
  signal: number,
  threshold: number | null = RING_THRESHOLD_DEFAULT,
): number {
  if (threshold === null) {
    state.thresholdOn = false;
  } else {
    state.thresholdOn = true;
    state.threshold = threshold;
  }
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
    if (state.thresholdOn) {
      state.climbBar = ringThresholdBar(state.floor, state.threshold);
      state.climbSpread = Math.max(state.peak - state.climbBar, SALIENCE_SPREAD_MIN);
    } else {
      state.climbBar = 0;
      state.climbSpread = 1;
    }
  }
  const climb = state.smoothed - state.base;
  const target = clamp01((climb - state.climbBar) / state.climbSpread);
  const emitted = Math.max(0, target - state.emittedThisClimb);
  state.emittedThisClimb = Math.max(state.emittedThisClimb, target);
  return emitted;
}

/** How much of a full ring a climb must have earned before advanceStandout
 *  says yes. A background blip that only just clears the line emits a sliver
 *  of a ring (the ring it would draw is faint); a hit that really stands out
 *  earns most of one in a single step, so half is a clean divide. */
const STANDOUT_FIRE_LEVEL = 0.5;
/** With the threshold Off a climb is sized by its own height alone (no bar,
 *  no spread), so the level is just "an audible climb" — the same size the
 *  salience trackers already ignore below (SALIENCE_EVENT_MIN). */
const STANDOUT_FIRE_LEVEL_OFF = 0.1;

/** advanceEmission as a yes/no: true on the frame a climb has earned
 *  STANDOUT_FIRE_LEVEL of a full ring, once per climb — the rest of that
 *  climb (and every climb that stays under) answers false. For a scene that
 *  wants a single event per standout hit rather than a graded amount (Physarum
 *  2's Dose reseed), with the same learned floor/peak and the same
 *  Ring-threshold-style setting Caustics' Beat ripple has, so a hit has to
 *  stand out from the everyday ones to count. `threshold` is `null` for the
 *  Off switch: every climb counts, sized by its own climb. */
export function advanceStandout(
  state: RippleEmissionState,
  dtSec: number,
  signal: number,
  threshold: number | null = RING_THRESHOLD_DEFAULT,
): boolean {
  const level = threshold === null ? STANDOUT_FIRE_LEVEL_OFF : STANDOUT_FIRE_LEVEL;
  const before = state.climbing ? state.emittedThisClimb : 0;
  advanceEmission(state, dtSec, signal, threshold);
  return state.climbing && state.emittedThisClimb >= level && before < level;
}

/** Where advanceEmission's salience puts the line right now, as signal
 *  heights on the same axis the driver is plotted on — for the panel's graph
 *  (settingMarks.ts). `ringsAbove` is the level the signal has to climb to
 *  for a ring to start, `fullRing` the level that makes it full strength,
 *  both measured from where the current climb started (or, between climbs,
 *  from where the signal is now — the dip a next climb would start from).
 *  `null` while Ring threshold is off — there's no bar to draw when every
 *  climb rings regardless of size (caustics.ts then publishes no lines at
 *  all, though the ring itself still shows as a reaction). */
export function salienceMarks(state: RippleEmissionState): { ringsAbove: number; fullRing: number } | null {
  if (!state.thresholdOn) return null;
  if (state.climbing) {
    return { ringsAbove: state.base + state.climbBar, fullRing: state.base + state.climbBar + state.climbSpread };
  }
  const bar = ringThresholdBar(state.floor, state.threshold);
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
  /** Launches a new ring of this amplitude at age 0 — or, if the newest
   *  entry in flight is still within `style`'s own merge window, adds to it
   *  instead of spending a second slot. For Bump/Merge that window is
   *  exactly "this frame already launched one" (the newest entry is still
   *  age 0) — a drop's own extra kick and an ordinary beat landing on the
   *  same tick become one ring, not two coincident ones (the old pool's own
   *  reasoning for merging coincident triggers). Merge widens that window to
   *  mergeWindowSec's own "about one ring-width's travel time" (see that
   *  function's doc) and caps the merged amplitude at MERGE_AMP_CAP — the
   *  display's own soft ceiling (RIPPLE_CEIL_KNEE/MAX in caustics.ts) handles
   *  whatever's left past that. `style` defaults to "bump" (today's only
   *  shape) so every existing caller/test is unaffected. Amounts below
   *  EMIT_MIN_AMP are ignored. If the buffer is full, the oldest entry is
   *  dropped to make room — in practice this should be unreachable: an entry
   *  ages out (see tick) long before `maxEntries` real hits could stack up. */
  emit(amp: number, style?: RingStyle): void;
  /** Ages every entry by `dtSec` and drops any that can no longer read as
   *  visible: its own envelope*amp has faded below ENTRY_FADE_FLOOR, or its
   *  ring has already travelled past where buildProfile would ever sample it
   *  (PROFILE_MAX_RADIUS plus its own gaussian tail, 3 standard deviations
   *  of `params.widthGaussianW`) — the same test is valid for every Ring
   *  style, Wave included, since its trough only ever trails the crest
   *  (never leads it), so once the crest has exited, the trough has too.
   *  Call once per frame, before emit() for that frame, so a freshly emitted
   *  ring starts this frame at age 0 rather than ageing before its first
   *  sample; also what lets emit()'s own Merge window read `params` back
   *  (see createRippleEmitter's own `lastParams`) without a caller having to
   *  pass it to both calls by hand. */
  tick(dtSec: number, params: RippleProfileParams): void;
}

export function createRippleEmitter(maxEntries = DEFAULT_MAX_ENTRIES): RippleEmitter {
  const ageSec = new Float32Array(maxEntries);
  const amp = new Float32Array(maxEntries);
  let count = 0;
  // The params tick() last saw — Merge's own window is sized off the
  // *current* Wave speed/Ring width (mergeWindowSec), and tick() always runs
  // once per frame before that frame's own emit() calls (this interface's
  // own tick() doc), so caching the last-seen params here is what lets
  // emit() read them without a second argument every caller would otherwise
  // have to thread through. Never read for Bump/Merge's own "same frame"
  // check below, since that one doesn't depend on params at all — only
  // Merge's own wider window does.
  let lastParams: RippleProfileParams | null = null;

  return {
    get count() {
      return count;
    },
    ageSec,
    amp,

    emit(amount, style = "bump") {
      if (amount < EMIT_MIN_AMP) return;
      // Bump/Wave: exactly "this frame already launched one" (age can never
      // be negative, so `<= 0` means `=== 0`). Merge: widens the window to
      // mergeWindowSec's own travel-time estimate — "younger than" in this
      // file's header's own wording, but `<=` (not `<`) is what keeps the
      // Bump/Wave case above exactly its old behaviour at window 0, and the
      // boundary itself is a measure-zero case for a continuous age.
      const mergeWindow = style === "merge" ? mergeWindowSec(lastParams) : 0;
      if (count > 0 && ageSec[count - 1]! <= mergeWindow) {
        const merged = amp[count - 1]! + amount;
        amp[count - 1] = style === "merge" ? Math.min(MERGE_AMP_CAP, merged) : merged;
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
      lastParams = params;
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
 *  PROFILE_SAMPLES * entry count. `style` picks the per-ring shape (the
 *  "Ring style" section above) — defaults to "bump", today's only shape, so
 *  every existing caller/test is unaffected; "merge" reads the same shape as
 *  "bump" here (Merge only changes how rings are combined in the emitter,
 *  never the shape one reads as once it's in flight). */
export function buildProfile(
  emitter: RippleEmitter,
  params: RippleProfileParams,
  crestOut: Float32Array,
  slopeOut: Float32Array,
  style: RingStyle = "bump",
): void {
  crestOut.fill(0);
  slopeOut.fill(0);
  const { decayPerSec, speedUnitsPerSec, widthGaussianW } = params;
  const sigma = 1 / Math.sqrt(2 * widthGaussianW);
  const dr = PROFILE_MAX_RADIUS / (PROFILE_SAMPLES - 1);
  const { ageSec, amp, count } = emitter;

  if (style === "wave") {
    // See WAVE_TROUGH_SHIFT_SIGMAS/WAVE_CREST_PEAK/WAVE_SLOPE_PEAK's own
    // comments above for the shape and the two normalizing constants.
    const shift = WAVE_TROUGH_SHIFT_SIGMAS * sigma;
    const waveCrestNorm = 1 / WAVE_CREST_PEAK;
    const waveSlopeNorm = Math.sqrt(2 * widthGaussianW) / WAVE_SLOPE_PEAK;
    // The trough gaussian's own reach can land further from r0 than the
    // crest's own ±3σ (its centre, r0 - shift, trails the crest by `shift`)
    // — widened here so a young ring's trough mirror (which can land well
    // past r0 itself while the ring is still close to the origin) is never
    // clipped out of the sampled window.
    const reach = shift + 3 * sigma;
    for (let e = 0; e < count; e++) {
      const age = ageSec[e]!;
      const s = amp[e]! * rippleEnvelope(age, decayPerSec);
      if (s < ENTRY_FADE_FLOOR) continue;
      const r0 = age * speedUnitsPerSec;
      const r2 = r0 - shift; // the trough's own current radius — may be negative for a young ring; its own mirror term (dInT below) handles that the same way dIn handles r0 < 0 never happening but r2 < 0 routinely does.
      const loR = Math.max(0, r0 - reach);
      const hiR = r0 + reach;
      const loIdx = Math.max(0, Math.floor(loR / dr));
      const hiIdx = Math.min(PROFILE_SAMPLES - 1, Math.ceil(hiR / dr));
      for (let i = loIdx; i <= hiIdx; i++) {
        const r = i * dr;
        const dOut = r - r0;
        const dIn = r + r0;
        const dOutT = r - r2;
        const dInT = r + r2;
        const gOut = Math.exp(-dOut * dOut * widthGaussianW);
        const gIn = Math.exp(-dIn * dIn * widthGaussianW);
        const gOutT = Math.exp(-dOutT * dOutT * widthGaussianW);
        const gInT = Math.exp(-dInT * dInT * widthGaussianW);
        crestOut[i]! += s * (gOut + gIn - (gOutT + gInT)) * waveCrestNorm;
        slopeOut[i]! += s * (dOut * gOut + dIn * gIn - (dOutT * gOutT + dInT * gInT)) * waveSlopeNorm;
      }
    }
    return;
  }

  const slopeNorm = Math.sqrt(2 * widthGaussianW) * Math.exp(0.5);
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
