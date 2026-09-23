// Silk's sequencer — pure, no GL. See index.ts's header for the reference
// (a YouTube short, bundle tools/.cache/refs/vKJu9mfeDS8/) and the sync
// hypotheses this implements: continuous morph/saturation/brightness
// envelopes from the mids/level, a bar-and-phrase swell, and a slow
// "regime" (fold count, hole size, field scale, zoom direction, hue lean)
// that travels over REGIME_TRAVEL_SEC — never a cut, per the reference's
// "NO HARD CUTS in 30s" finding.
//
// The picture is built from K "echoes" of one domain-warped noise field,
// computed directly rather than resampled out of a feedback texture: each
// echo k reads the SAME field at a smaller/larger scale
// (scaleK = exp(-zoomRate*k/ECHO_HZ), computed in the shader from a single
// `zoomRate` uniform) and at an earlier point in the field's own morph
// clock (morph - k*morphStepPerEcho). A real ping-pong feedback buffer
// blurs a little on every resample — after ~20 steps the reference's ~3px
// line spacing would be mush (see the Tessera scene's "feedback draws a
// path, not the object" lesson) — so only the diffuse haze beyond the
// crisp echoes is a real feedback texture (index.ts's tail pass); it lags
// one frame behind the sharp picture, which is invisible on a slow haze.
//
// Regime values are NOT rewound per echo (a deliberate simplification):
// they travel on a REGIME_TRAVEL_SEC (1s) timescale, ECHO_MAX echoes span
// well under 300ms, so using the current value for every echo costs a few
// frames of very slightly-soft blending mid-travel, never a visible cut.
//
// Bar detection copies crystal/driver.ts's idiom (barWrap on a locked
// barPhase, else every UNLOCKED_BAR_BEATS-th onset) rather than
// beatListener's "bar" source: that source falls back to the raw onset
// edge when unlocked (see beatListener.ts's sourceEdge), which would count
// every beat as a bar — crystal's own copied fallback is the one that
// actually approximates a bar without a lock. Scenes don't import each
// other, so this is copied, not imported.
//
// Runtime gaps this scene works around rather than papers over (see
// index.ts's header for the reference-side numbers): our beatClock has no
// downbeat or phrase concept, so "phrase" here means every 4th of *our own*
// bar count, not the reference's actual bar one; and `anim.dropOnset`
// didn't fire at this clip's own section boundaries, so the regime hold
// falls back to a bar-counted timer — this scene's own clock, not audio.

import { wrapFlow } from "../../noiseHash.ts";

/** Echo cadence, ticks/sec — the fixed rate `morphStepPerEcho` and
 *  `zoomRate`-per-echo assume; independent of display frame rate. */
export const ECHO_HZ = 30;
/** Most echoes ever computed (quality-preset counts in index.ts are ≤ this). */
export const ECHO_MAX = 8;
/** Octaves in the strand field's domain warp (glsl.ts's strandField) — one
 *  wrapped flow offset per octave (warp, v0, v1, v2 — Round 3 added the
 *  4th for finer curls; each octave gets its own properly-wrapped offset
 *  rather than the earlier version's `off1 * 1.7` reuse, which changed
 *  discontinuously right when off1 itself wrapped 256→0). K echoes each
 *  pay for this, so cost is K × OCTAVES. */
export const FIELD_OCTAVES = 4;
/** Level-set lines the sharp pass ever draws — glsl.ts's strand loop bound,
 *  interpolated in as a literal so it can't drift from the `strands`
 *  setting's own max (index.ts). */
export const MAX_STRANDS = 8;
/** The field's single flow "site" (one field, not ink.ts's three) — same
 *  per-octave rotate+lacunarity transform as ink.ts's noiseFlows, just one
 *  rate pair instead of three. */
const FLOW_RATE: readonly [number, number] = [0.6, -0.45];
const FLOW_LACUNARITY = 2.1;
const FLOW_ROT_COS = 0.8;
const FLOW_ROT_SIN = 0.6;
/** Flat length of the per-echo flow-offset uniform array. */
export const ECHO_FLOW_STRIDE = FIELD_OCTAVES * 2;
export const ECHO_FLOW_LEN = ECHO_MAX * ECHO_FLOW_STRIDE;

/** A bar wrap can't be told from a tempo lock; without one, every fourth
 *  onset stands in for the bar — crystal/driver.ts's own constant, copied. */
export const UNLOCKED_BAR_BEATS = 4;
/** Bars per phrase — our own bar count, not the reference's (see header). */
const BARS_PER_PHRASE = 4;
/** A regime never changes again this soon after the last one, even if a
 *  drop fires — keeps "a drop can shorten the hold" from also making two
 *  regimes flicker back to back. */
export const MIN_BARS_BETWEEN = 4;
/** How long a regime change takes to travel — a fold/hole/zoom-direction
 *  change is this, never a switch. */
export const REGIME_TRAVEL_SEC = 1.0;
/** Time constant the zoom rate itself eases toward its (possibly
 *  direction-flipping) target over — keeps the rate a smooth accumulator
 *  even though its target can jump when a regime is picked. */
const ZOOM_EASE_TAU = 0.6;

const MID_TAU = 0.4;
const LEVEL_TAU = 0.12;
const BRIGHT_TAU = 1.5;

const SWELL_ATTACK_SEC = 0.08;
const SWELL_RELEASE_SEC = 0.9;
const SWELL_STACK_CAP = 1.5;
const SWELL_KA = 1 / SWELL_ATTACK_SEC;
const SWELL_KR = 1 / SWELL_RELEASE_SEC;
/** Peak of one un-stacked difference-of-exponentials impulse — divides the
 *  raw (rel - att) so `swellAmplitude(push, false)` reaches exactly `push`
 *  at its peak, same normalisation as crystal/kaleido's beat swell. */
export const SWELL_PEAK = (() => {
  const tPeak = Math.log(SWELL_KA / SWELL_KR) / (SWELL_KA - SWELL_KR);
  return Math.exp(-SWELL_KR * tPeak) - Math.exp(-SWELL_KA * tPeak);
})();

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
/** Ease-toward-target factor for one frame of a one-pole filter; caps at 1
 *  so a large dt (a backgrounded tab resuming) snaps fully caught up
 *  instead of overshooting. */
function towardFactor(dt: number, tau: number): number {
  return Math.min(1, dt / tau);
}
function smootherstep(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * x * (x * (x * 6 - 15) + 10);
}
/** Shortest-way angle interpolation — a plain `lerp` on `webTilt` would
 *  occasionally spin the web's tilt almost a full turn in one
 *  REGIME_TRAVEL_SEC when the hash picks values on opposite sides of the
 *  0/2π seam, reading as a fast, out-of-place spin on an otherwise
 *  travel-only scene. */
function lerpAngle(a: number, b: number, t: number): number {
  const twoPi = Math.PI * 2;
  let diff = (b - a) % twoPi;
  if (diff > Math.PI) diff -= twoPi;
  else if (diff < -Math.PI) diff += twoPi;
  return a + diff * t;
}

/** A tiny deterministic hash, seed × k -> [0, 1) — copied from
 *  crystal/driver.ts's own copy (scenes don't import each other). */
export function hash01(seed: number, k: number): number {
  const x = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** The amplitude a bar's swell impulse is stacked with — bigger on a
 *  phrase bar (our own 4-bar count), so the colour/shape push the
 *  reference shows hardest at phrase starts still pops hardest here even
 *  though our "phrase" tracks a different beat than the reference's. Pure
 *  and exported so tests/silk.test.ts can pin "phrase > bar" without
 *  simulating a whole run. */
export function swellAmplitude(push: number, isPhrase: boolean): number {
  return Math.max(0, push) * (isPhrase ? 1.8 : 1.0);
}

/** One regime's resting values — everything a "fold changes, hole
 *  breathes, zoom reverses" moment sets, travelled toward rather than cut
 *  to. `zoomDir` is always exactly ±1 (never lerped in place — see
 *  advanceSilk's snapshot-on-interrupt, which carries the *target*
 *  direction forward rather than an in-between fraction, so the field
 *  driving `zoomRate`'s own easing never has to interpret a fractional
 *  "direction"). */
export interface RegimeTarget {
  /** 0 = fold 8, 1 = fold 6 — blended in the shader as
   *  mix(foldPoint(p,8), foldPoint(p,6), foldMix), which stays continuous
   *  through the middle even though it isn't a physical fold there. */
  foldMix: number;
  holeMul: number;
  fieldScaleMul: number;
  zoomDir: 1 | -1;
  hueBias: number;
  /** 0 = a straight-chord star polygon, 1 = a circular-arc rosette — the
   *  faint geometric web under the silk (Round 3). Blended like foldMix, so
   *  it travels smoothly through an in-between shape mid-transition. */
  webShape: number;
  /** Web radius, in the same half-height units as `hole`, before the
   *  per-frame breathing SilkOut.webBreath adds. */
  webR: number;
  /** Web rotation, radians — travelled with lerpAngle, not a plain lerp
   *  (see that function's doc). */
  webTilt: number;
}

function lerpRegime(a: RegimeTarget, b: RegimeTarget, t: number): RegimeTarget {
  return {
    foldMix: lerp(a.foldMix, b.foldMix, t),
    holeMul: lerp(a.holeMul, b.holeMul, t),
    fieldScaleMul: lerp(a.fieldScaleMul, b.fieldScaleMul, t),
    // The direction itself is never a fraction — see the interface doc.
    zoomDir: b.zoomDir,
    hueBias: lerp(a.hueBias, b.hueBias, t),
    webShape: lerp(a.webShape, b.webShape, t),
    webR: lerp(a.webR, b.webR, t),
    webTilt: lerpAngle(a.webTilt, b.webTilt, t),
  };
}

/** `foldOpt`: 0 = Auto (regime picks 8 most of the time, per the
 *  reference), 1 = pin every regime to fold 8, 2 = pin to fold 6 — the
 *  scene's `fold` enum setting, read straight through so a manual pin
 *  overrides every future pick without touching the travel machinery. */
function pickRegime(idx: number, foldOpt: number): RegimeTarget {
  const h1 = hash01(idx, 1);
  const h2 = hash01(idx, 2);
  const h3 = hash01(idx, 3);
  const h4 = hash01(idx, 4);
  const h5 = hash01(idx, 5);
  const h6 = hash01(idx, 6);
  const h7 = hash01(idx, 7);
  const h8 = hash01(idx, 8);
  const foldMix = foldOpt === 1 ? 0 : foldOpt === 2 ? 1 : h1 < 0.7 ? 0 : 1;
  const holeMul = 0.3 + h2 * 1.4;
  const fieldScaleMul = 0.8 + h3 * 0.6;
  // Recede favoured 60/40 so the net mean zoom across many regimes leans
  // negative, matching the reference's measured zoom mean of -0.12.
  const zoomDir: 1 | -1 = h4 < 0.6 ? -1 : 1;
  const hueBias = (h5 - 0.5) * 2;
  const webShape = h6 < 0.5 ? 0 : 1;
  const webR = 0.35 + h7 * 0.5;
  const webTilt = h8 * Math.PI * 2;
  return { foldMix, holeMul, fieldScaleMul, zoomDir, hueBias, webShape, webR, webTilt };
}

export interface SilkState {
  morph: number;
  zoomRateCur: number;
  midS: number;
  levelS: number;
  brightS: number;
  beatCount: number;
  barCount: number;
  barsSinceChange: number;
  prevBarPhase: number;
  prevDropOnset: boolean;
  regimeIdx: number;
  from: RegimeTarget;
  to: RegimeTarget;
  travelT: number;
  rel: number;
  att: number;
}

export function createSilkState(): SilkState {
  const first = pickRegime(0, 0);
  return {
    morph: 0,
    zoomRateCur: 0,
    midS: 0,
    levelS: 0,
    brightS: 0,
    beatCount: 0,
    barCount: 0,
    barsSinceChange: 0,
    prevBarPhase: 0,
    prevDropOnset: false,
    regimeIdx: 0,
    from: first,
    to: first,
    travelT: 0,
    rel: 0,
    att: 0,
  };
}

export interface SilkInputs {
  dtSec: number;
  /** anim.onset / anim.dropOnset, not frame.* — the render cap can skip
   *  the tick a feature fired on (renderLatch.ts). */
  onset: boolean;
  dropOnset: boolean;
  barPhase: number;
  tempoLock: number;
  low: number;
  mid: number;
  /** frame.level — absolute mic loudness, NOT auto-gained. Saturation
   *  rides this rather than anim.mid/low so it fades out with the song
   *  instead of being re-normalised back up by the AGC (see
   *  src/audio/types.ts's FeatureFrame.level doc). */
  level: number;
}

export interface SilkOpts {
  /** Level-set count K — how many strand lines the field draws. */
  strands: number;
  /** Presence-gate strength: higher lights more of the field. */
  density: number;
  hole: number;
  /** The `fold` enum setting's raw index (0 Auto / 1 "8" / 2 "6"). */
  foldOpt: number;
  flow: number;
  zoom: number;
  /** Regime hold, in bars. */
  hold: number;
  push: number;
  /** Flower scale multiplier (the `size` setting). */
  size: number;
}

export interface SilkOut {
  morph: number;
  /** How far (in morph units) one echo tick back sits — echoK's field
   *  phase is `morph - k * morphStepPerEcho`. */
  morphStepPerEcho: number;
  /** Signed, eased log-zoom rate, units/sec — echoK's spatial scale is
   *  exp(-zoomRate * k / ECHO_HZ), computed shader-side from this alone. */
  zoomRate: number;
  hole: number;
  fieldScale: number;
  foldMix: number;
  hueBias: number;
  /** 0 = star-polygon web, 1 = arc rosette — travels like foldMix. */
  webShape: number;
  /** Web radius before breathing, half-height units, already ×opts.size. */
  webR: number;
  webTilt: number;
  /** -1..1, a slow sinusoid of `morph` — the web's own subtle breathing,
   *  applied shader-side as `uWebR + 0.06 * uWebBreath` (kept a separate
   *  uniform, not baked into webR, so the shader's amplitude constant is
   *  the one place that number lives). */
  webBreath: number;
  swell: number;
  midS: number;
  levelS: number;
  brightS: number;
}

/** One frame of the sequencer. Pure apart from `st`; exported for
 *  tests/silk.test.ts. */
export function advanceSilk(st: SilkState, input: SilkInputs, opts: SilkOpts): SilkOut {
  const dt = Math.max(0, input.dtSec);
  const locked = input.tempoLock > 0.5;
  const barWrap = locked && input.barPhase < st.prevBarPhase - 0.5;
  st.prevBarPhase = input.barPhase;
  const drop = input.dropOnset && !st.prevDropOnset;
  st.prevDropOnset = input.dropOnset;
  if (input.onset) st.beatCount++;
  const barLike = barWrap || (!locked && input.onset && st.beatCount % UNLOCKED_BAR_BEATS === 0);

  // Envelopes: one-pole toward the live signal, tau chosen per field (see
  // the file header — brightness rides the mids with no onset term at all,
  // matching the reference's "brightness does not flash on onsets" finding).
  st.midS += (input.mid - st.midS) * towardFactor(dt, MID_TAU);
  const levelTarget = Math.max(input.level, input.low);
  st.levelS += (levelTarget - st.levelS) * towardFactor(dt, LEVEL_TAU);
  st.brightS += (st.midS - st.brightS) * towardFactor(dt, BRIGHT_TAU);

  // Morph clock: an accumulated phase, never time × level (a level jump
  // would otherwise jump the phase too — see the kaleido/tessera lesson).
  const morphRate = opts.flow * (0.05 + 0.25 * st.midS);
  st.morph += dt * morphRate;

  // Bars, phrase, swell.
  if (barLike) {
    st.barCount++;
    st.barsSinceChange++;
    const isPhrase = st.barCount % BARS_PER_PHRASE === 0;
    const amp = swellAmplitude(opts.push, isPhrase);
    st.rel = Math.min(st.rel + amp, SWELL_STACK_CAP);
    st.att = Math.min(st.att + amp, SWELL_STACK_CAP);
  }
  st.rel *= Math.exp(-dt * SWELL_KR);
  st.att *= Math.exp(-dt * SWELL_KA);
  const swell = Math.max(0, st.rel - st.att) / SWELL_PEAK;

  // Regime travel: advance time-in-travel, then (only if a change is due)
  // snapshot the *currently displayed* blend as the new `from` before
  // picking the next target — see lerpRegime's doc for why `zoomDir` is
  // never itself a fraction.
  st.travelT += dt;
  const ePre = smootherstep(st.travelT / REGIME_TRAVEL_SEC);
  const changeReady = st.barsSinceChange >= MIN_BARS_BETWEEN;
  if (changeReady && (drop || st.barsSinceChange >= opts.hold)) {
    st.from = lerpRegime(st.from, st.to, ePre);
    st.regimeIdx++;
    st.to = pickRegime(st.regimeIdx, opts.foldOpt);
    st.travelT = 0;
    st.barsSinceChange = 0;
  }
  const e = smootherstep(st.travelT / REGIME_TRAVEL_SEC);
  const flipping = st.from.zoomDir !== st.to.zoomDir;
  // The hole dips hardest exactly when a flip's blended direction crosses
  // zero (e = 0.5) — "the hole collapses, the flower re-forms", timed to
  // the same moment the zoom itself pauses, not an independent cue.
  const holeMul = lerp(st.from.holeMul, st.to.holeMul, e) * (flipping ? 1 - 0.8 * Math.sin(Math.PI * e) : 1);
  const fieldScaleMul = lerp(st.from.fieldScaleMul, st.to.fieldScaleMul, e);
  const foldMix = lerp(st.from.foldMix, st.to.foldMix, e);
  const hueBias = lerp(st.from.hueBias, st.to.hueBias, e);
  const webShape = lerp(st.from.webShape, st.to.webShape, e);
  const webR = lerp(st.from.webR, st.to.webR, e) * opts.size;
  const webTilt = lerpAngle(st.from.webTilt, st.to.webTilt, e);

  const zoomDirBlend = lerp(st.from.zoomDir, st.to.zoomDir, e);
  const zoomTarget = zoomDirBlend * opts.zoom * (0.6 + 0.8 * st.midS);
  st.zoomRateCur += (zoomTarget - st.zoomRateCur) * towardFactor(dt, ZOOM_EASE_TAU);

  return {
    morph: st.morph,
    morphStepPerEcho: morphRate / ECHO_HZ,
    zoomRate: st.zoomRateCur,
    hole: clamp(opts.hole * holeMul, 0.02, 0.9),
    fieldScale: Math.max(0.05, opts.size * fieldScaleMul),
    foldMix,
    hueBias,
    webShape,
    webR: clamp(webR, 0.05, 1.3),
    webTilt,
    webBreath: Math.sin(st.morph * 2.3),
    swell,
    midS: st.midS,
    levelS: st.levelS,
    brightS: st.brightS,
  };
}

/** Fills `out[k*ECHO_FLOW_STRIDE .. ]` with echo k's per-octave flow
 *  offset, each already wrapped into the noise lattice's period — the same
 *  idea as ink.ts's noiseFlows, run once per echo at that echo's own
 *  backdated phase (`morph - k*morphStepPerEcho`) rather than once for the
 *  whole field, so each echo samples the field as it stood that many
 *  ticks ago. `count` lets the caller only fill the echoes this quality
 *  preset actually draws. */
export function fillEchoFlows(morph: number, morphStepPerEcho: number, count: number, out: Float32Array): void {
  for (let k = 0; k < count; k++) {
    const ph = morph - k * morphStepPerEcho;
    let ox = ph * FLOW_RATE[0];
    let oy = ph * FLOW_RATE[1];
    const base = k * ECHO_FLOW_STRIDE;
    for (let oct = 0; oct < FIELD_OCTAVES; oct++) {
      out[base + oct * 2] = wrapFlow(ox);
      out[base + oct * 2 + 1] = wrapFlow(oy);
      const nx = FLOW_ROT_COS * ox - FLOW_ROT_SIN * oy;
      const ny = FLOW_ROT_SIN * ox + FLOW_ROT_COS * oy;
      ox = nx * FLOW_LACUNARITY;
      oy = ny * FLOW_LACUNARITY;
    }
  }
}

/** The tail buffer's per-step decay, in the sqrt-encoded domain the shader
 *  stores (see index.ts's header): `s' = max(s*sqrt(decay) - floor, 0)`.
 *  Exported so tests/silk.test.ts can prove the floor is what makes every
 *  level actually reach 0 — without it, `s*sqrt(decay)` alone never clears
 *  the last representable step once rounding gives the same value back. */
export function tailDecayStep(s: number, decay: number, floor: number): number {
  return Math.max(s * Math.sqrt(decay) - floor, 0);
}

/** How many `tailDecayStep` calls (each simulating one 8-bit code, i.e.
 *  rounded to the nearest 1/255) it takes a starting level to reach
 *  exactly 0. Infinity if it never does (no floor, or decay >= 1). Test-only
 *  proof that the shader's decay actually clears every trail rather than
 *  freezing above 0 — see the header's "8-bit floor" paragraph. */
export function stepsToZero(startCode: number, decay: number, floor: number, maxSteps = 10_000): number {
  let s = startCode / 255;
  for (let n = 0; n < maxSteps; n++) {
    if (s <= 0) return n;
    const next = tailDecayStep(s, decay, floor);
    // Emulate 8-bit storage: the GPU rounds to the nearest 1/255 on write.
    s = Math.round(next * 255) / 255;
  }
  return Infinity;
}
