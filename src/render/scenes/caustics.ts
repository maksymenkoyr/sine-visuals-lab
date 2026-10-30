import { createFullscreenScene } from "../fullscreenScene.ts";
import { card } from "./caustics.card.ts";
import { NOISE_HASH_GLSL, NOISE_MASK, wrapFlow } from "../noiseHash.ts";
import {
  advanceRingRate,
  autoNarrowWidthW,
  createRingRateState,
  buildProfile,
  createRippleEmitter,
  PROFILE_MAX_RADIUS,
  PROFILE_SAMPLES,
  rippleDecayFor,
  ringStyleFor,
  rippleSpeedFor,
  rippleWidthFor,
  type RippleProfileParams,
} from "./rippleEmitter.ts";
import {
  buildRippleSpots,
  createRippleSpots,
  emitRippleSpot,
  RIPPLE_SPOTS,
  ringOriginFor,
  SPOT_REACH,
  spotStartsRing,
  tickRippleSpots,
} from "./causticsRippleSpots.ts";
import { advanceStandout, advanceStandoutAmount, createStandoutState, standoutLine } from "../standout.ts";
import { publishSettingMarks } from "../settingMarks.ts";
import type { SceneContext } from "../scene.ts";
import type { GLProgram } from "../gl.ts";
import { advanceSparkleHits, createSparkleHits, EFFECT_GRAIN, EFFECT_PRISM, EFFECT_RUN, MODE_ADAPTIVE } from "./causticsSparkle.ts";

// The bright wandering filaments you see on the floor of a sunlit pool.
// Domain-warped value noise, sharpened into thin ridges. Motion comes from
// renderer-side clocks instead of raw audio: the beat edges arrive as the
// latched one-shots on AnimFrame (renderLatch.ts) — the old
// FeatureFrame.onsetPhase restarted on every hat/fill, which is what made
// the old bar-locked breathe and Beat ripple stutter — and this scene's own
// drift accumulator below, kept separate from the shared uFlowPhase so its
// speed is user-dialable without reintroducing the teleport bug
// flowClock.ts exists to prevent (scaling an *already accumulated* phase is
// safe; scaling elapsed time by a live value is not).
// Settings map audio onto light and motion rather than position snapping:
// uFog sets the resting look (how thin/bright the ridges sit between beats,
// and how much of the dim wash the dark-water floor cut clips away), uFocus
// (the "Fog pulse" slider) is purely how much *softer* a beat hazes the
// ridges below that resting state — 0 means no pulse at all, and the resting
// look itself never moves with uFocus (see focusSharp below; this split
// replaced an earlier design where one slider tried to own both and could
// only ever get one of "peak reachable at any setting", "resting look stays
// put", "doesn't collapse to fog between beats" right at a time — see this
// file's git history),
// Caustic density scales how many filaments the ridge noise resolves into,
// at the same filament width and over the same warp (it is not a zoom; 0.5 is
// exactly the old fixed frequency); Density reach is how far its own source
// lifts that toward a finer mesh (Section by default), and the result is
// eased in by advanceDensityFlow rather than applied on the frame it changes,
// uBreathe is the depth of a zoom its own source moves — Bar wave by
// default, once per bar (breatheDrive in FRAG) — uRipple drives a continuous ring emitter (rippleEmitter.ts) seated
// at the center of the frame: rather than launching a whole ring on every
// yes/no beat (this scene's very first design) or carrying the raw driver
// through a stepped wave-equation height field (a brief detour — see
// docs/scenes/caustics.md's 2026-09-26/2026-09-27 entries for why each was
// replaced), the driver's own *rise* each frame becomes a thin ring's worth
// of height, launched from the center and left to travel outward and fade on
// its own. A clean, isolated hit still reads as exactly one full old-style
// ring; a busy driver naturally ducks itself — it can't rise as far between
// hits that arrive faster than it can fall back — so it reads as lighter,
// denser rings rather than a stack of identical ones. Wave speed/Wave fade/
// Ring width (waveSpeed/waveFade/ringWidth) tune the emitted rings
// themselves — how fast they travel, how fast they fade, how wide each one
// is; Ring style (ringStyle) instead picks what a ring *is* — Bump's own
// gaussian crest, Wave's crest-plus-trailing-trough (net zero height, so a
// dense train stays visible as alternating rings instead of piling into a
// flat plateau), or Merge (folds emissions that land close together into
// one stronger ring instead of changing the shape at all) — see
// rippleEmitter.ts's own `RingStyle` section; the emission and profile-building logic live in the `extraUniforms`
// closure below. uFlash is a brightness punch, and uLevelGlow is how far the
// whole pool brightens with its source (Level by default). It used to be
// a fixed brightening on uEnergy that no setting could turn off (#449).
// uDrift is the base wander speed (its own JS-side accumulator — driven by
// driftRatePerSec below, not a shader uniform driving the rate directly).
// driftLevel adds to that rate directly, right now: the louder the music is
// playing at this instant, the faster the pool wanders, and it drops
// straight back down the moment the music quietens, with no envelope of its
// own beyond that instantaneous reading (LEVEL_GAIN * driftLevel *
// levelValue in driftRatePerSec below). It's driven by loudSwell — a value
// advanceLoudSwell derives from FeatureFrame.level, calibrated in-scene
// against its own slow-contracting extremes — not frame.energy: energy is
// AGC-normalized per band, and that AGC "re-adapts in ~1.25s and erases
// quiet-vs-loud by design" (see FeatureFrame.energy's own doc comment in
// audio/types.ts), which is exactly the dynamic range this dial exists to
// show. level survives that AGC (audio/types.ts and autoTune.ts both call it
// "the one field that survives it"), but its resting point is
// playback/mic-gain dependent, which is what advanceLoudSwell's own
// calibration is for — see that function's comment for why this isn't
// sectionIntensity.ts's job (different input, and a deliberately faster
// calibration timescale). driftPump answers the other half of what was
// asked for it: "energy would pump up drift speed but it would slowly be
// going back to the one set by drift... like push acceleration in a car" —
// so unlike driftLevel it doesn't track its input directly. Each push
// (advancePump below) accelerates a velocity that then coasts back down
// over PUMP_RELEASE_SEC, the way a car keeps rolling faster for a while
// after you lift off the gas. Both driftLevel and driftPump are additive on
// top of the Drift-speed base rather than multipliers on it (see
// driftRatePerSec below) — a multiplier on a base of zero can only ever stay
// zero, so additive is what lets either one still move the pool with Drift
// speed parked at 0. Speed boost is rate-only: it never touches the pool's
// aperture or the floor (an earlier loudSwell → uLoudSwell channel zoomed
// the pool the way Breathe does, which read as Speed boost "breathing" at
// high settings — removed; see docs/scenes/caustics.md's decision entry).
// uBass/uTurbulence/
// uSparkle give the low/mid/high bands each a distinct visual (swell / churn
// / whichever sparkle effect is picked — crest glints by default; each
// hat hit plays the picked shape, causticsSparkle.ts's header). Every
// music-driven term is a slider times its drive, so
// with the sliders at 0 the picture only drifts on its own clock.
//
// Precision, or why nothing the shader hashes ever grows with session
// length: the drift phase only ever accumulates (advanceDensityFlow's
// scaledPhase — never reset, so the field never jumps), and for a long time
// it was uploaded raw and added to every noise coordinate in FRAG. A
// value-noise hash built on fract() of a large product loses its low bits
// as that offset climbs, and on mobile GPU compilers the shared corner
// hash between two neighbouring cells stopped agreeing well before the
// desktop degradation was visible — the pattern broke along cell
// boundaries: straight screen-aligned seams for the first, unwarped
// octave, curved ones for the warped octaves, and fwidth() in the ridge
// anti-aliasing then lit each seam up as a dashed line. The fix is in two
// halves that only work together: every offset FRAG adds to a noise
// coordinate is reduced modulo NOISE_PERIOD on the JS side, in float64
// (driftFlows below — one entry per distinct offset the shader used to
// derive from the raw phase, since they carry different multipliers and can't
// share one wrap), and hashCell in FRAG is an integer hash over the cell
// lattice masked to that same period, so the field is exactly periodic and
// a wrap is invisible by construction. The phase itself still never wraps;
// only what reaches the GPU does. The hash, the period and wrapFlow now live
// in noiseHash.ts (its header is the standing explanation) so other drifting
// scenes share them.

// Beat ripple's display-side read of the continuous emitter (rippleEmitter.ts
// owns emission and profile-building; see that file's header). uRipple (the
// "ripple" setting) scales crest brightening and slope-based refraction here,
// at display time — not a launched ring's own amplitude, which is always a
// full-strength ring for a full hit regardless of this dial (see the
// "ripple" setting's own comment) — the same split the scene's very first
// ring pool used, restored here after the wave tank's detour scaled the
// *source* instead (see docs/scenes/caustics.md's 2026-09-27 entries).
const RIPPLE_REFRACT = 0.3; // peak p-space displacement at uRipple=1 for one full-strength ring — the old pool's own RIPPLE_REFRACT
// A soft knee, not a hard clamp, on the crest/slope a pixel reads: unchanged
// up to RIPPLE_CEIL_KNEE — exactly where a single full-strength ring's own
// peak sits, by construction (buildProfile normalizes to that) — so one ring
// looks bit-for-bit like the old pool's; only several overlapping rings
// pushing past that peak get gently pulled toward RIPPLE_CEIL_MAX instead of
// tearing the pattern. Applied to crest and to |slope| alike (see softCeil in
// FRAG) since both are normalized to the same single-ring peak of 1.
const RIPPLE_CEIL_KNEE = 1.0;
const RIPPLE_CEIL_MAX = 1.5;
// A drop moment emits one ring this strong in addition to whatever an
// ordinary beat is already emitting this tick (see the `extraUniforms`
// closure below) — carried over from the old ring pool's RIPPLE_DROP_AMP,
// same reasoning: a drop should read as a bigger strike than a plain beat.
const RIPPLE_DROP_AMP = 1.8;

// uFog's two endpoints (see focusSharp below). CRISP is deliberately *below*
// today's old fixed floor of 4 (uFocus's floor used to bottom out there) —
// Fog is the setting that now owns "how thin/bright the resting look gets",
// so it needs its own reach past what Focus alone ever offered. HAZY drops
// the floor cut to 0 too: nothing is clipped away, so the dim wash between
// filaments glows instead of reading as flat black water.
const FOG_SHARP_CRISP = 14.0;
const FOG_SHARP_HAZY = 2.0;
const FOG_FLOOR_CRISP = 0.13; // uFog = 0 -> today's old fixed dark-water cut (0.08) is inside this range
const FOG_FLOOR_HAZY = 0.0;

// uBreathe's zoom depth per full-strength cable — the same 0.10 swing the
// old bar-locked cosine had at its peak (uBreathe 1, tempoLock 1). The
// cable supplies the waveform, not this constant; see breatheDrive(0.0) in
// FRAG for why a stale-"scene" fallback (never reached at Breathe's own
// default, Bar wave) still swings zero.
const BREATHE_ZOOM = 0.10;

// uFocus=1 on a full beat (uBeatPulse=1) divides the resting sharpness by
// (1 + FOCUS_SNAP_RATIO) — see focusSharp below: the pulse's direction is
// reversed from the original Focus snap (which multiplied sharpness *up* on
// a beat), so a beat now hazes toward Fog's soft end instead of snapping
// crisp, and the label reads "Fog pulse" to say so. The magnitude, the
// decoupling and the failure modes it dodges are unchanged: every rewrite of
// this formula before the Fog/Focus split either scaled the rest and peak
// together (the slider read as "merely thinner lines", not more pulse) or
// pinned the peak to the same value at every setting (the slider stopped
// moving the actual on-beat swing, only the quiet resting state) — see the
// long history of this exact tradeoff across 5fe4b3c, db884a0, b44000d, and
// 9b52b66. Decoupling "resting state" (uFog, above) from "how much a beat
// moves below it" (uFocus, here) is what makes both failure modes impossible
// at once: uFocus=0 always means literally no pulse (sharp never moves off
// whatever uFog set), and the resting state never moves with uFocus no
// matter how the slider is dragged. Division (not rest * (1 - …)) keeps the
// pulse always-positive and finite at any reading, so there's no floor to
// clamp and no ceiling to saturate against.
const FOCUS_SNAP_RATIO = 1.3;

// Caustic density's span (causticDensityScale below): the endpoints sit half
// the span either side of the dial's middle in octaves. Widened once (#454) when density stopped
// zooming: with the filament width held, a wide range reads as a sparse web
// at one end and a dense mesh at the other, still this scene's own look.
const DENSITY_SPAN_OCTAVES = 3.2;
// Every Caustic density position resolves this share of the filaments the
// span alone gives — halved on the owner's ask that the slider read sparser
// (2026-10-27).
const DENSITY_FILAMENTS = 0.5;

/** Caustic density's target (advanceDensityFlow glides toward it): the
 *  slider lifted toward 1 by `reach` (Density reach) times its drive's
 *  reading — the slider exactly at reach 0 or drive 0, never outside 0..1
 *  (a patched source's weight can exceed 1). */
export function densityTargetFor(slider: number, reach: number, drive: number): number {
  const s = Math.min(1, Math.max(0, slider));
  const d = Number.isFinite(drive) ? drive : 0;
  return Math.min(1, Math.max(0, s + (1 - s) * reach * d));
}

/** uFog (0..1) -> the sharpness the ridges sit at with no beat driving them.
 *  Default 0.4 reproduces today's old fixed floor (4) closely. */
export function fogRestingSharp(fog: number): number {
  return FOG_SHARP_CRISP + (FOG_SHARP_HAZY - FOG_SHARP_CRISP) * fog;
}

/** uFog (0..1) -> the dark-water floor cut applied to `acc` before tonemap.
 *  Default 0.4 reproduces today's old fixed cut (0.08) almost exactly. */
export function fogFloorCut(fog: number): number {
  return FOG_FLOOR_CRISP + (FOG_FLOOR_HAZY - FOG_FLOOR_CRISP) * fog;
}

/** The ridge sharpness FRAG actually renders with: uFog sets the resting
 *  value, uFocus scales how much *softer* a full beat hazes it below — the
 *  reciprocal of the old Focus snap's multiply (rest / (1 + f·b·ratio)
 *  instead of rest · (1 + f·b·ratio)), so the pulse only ever pulls sharp
 *  down toward Fog's soft end, never above rest and never non-positive, with
 *  no clamp needed. uFocus=0 holds sharp exactly at rest (no pulse) and the
 *  resting value itself never depends on uFocus at any beatPulse. Exported
 *  so tests/caustics.test.ts can pin the monotonicity and rest-independence
 *  invariants this file's history keeps breaking one at a time. */
export function focusSharp(fog: number, focus: number, beatPulse: number): number {
  const rest = fogRestingSharp(fog);
  return rest / (1 + focus * beatPulse * FOCUS_SNAP_RATIO);
}

/** Caustic density (0..1) -> the ridge noise's sampling frequency multiplier,
 *  i.e. how many filaments there are relative to the scene's original fixed
 *  frequency. FRAG computes the same curve from uDensityLive. */
export function causticDensityScale(density: number): number {
  return DENSITY_FILAMENTS * Math.pow(2, (density - 0.5) * DENSITY_SPAN_OCTAVES);
}

// Level glow (the "levelGlow" setting, #449): how far the whole pool's
// brightness rises with its source, Level by default. The default
// reproduces the coefficient this scene used to hard-code on uEnergy (with
// LEVEL_GLOW_GAIN). LEVEL_GLOW_EXP keeps that old curve: quiet passages
// barely lift, loud ones lift a lot.
const LEVEL_GLOW_GAIN = 1.4;
const LEVEL_GLOW_EXP = 1.5;
// The brightness multiplier's floor with nothing driving it, and the gains on
// Beat flash and the ripple crest. FRAG's `acc *=` line reads these same
// constants (see brightnessGain).
const BRIGHT_BASE = 0.35;
const FLASH_GAIN = 1.5;
const RING_BRIGHT_GAIN = 0.8;

/** The multiplier FRAG applies to `acc` before the dark-water floor: BRIGHT_BASE
 *  plus Level glow, Beat flash and the ripple crest. Each term is its slider
 *  times what it reads (`ring` is already the crest scaled by Beat ripple's
 *  own slider), so with those sliders at 0 the multiplier is BRIGHT_BASE and
 *  nothing in it moves with the music. FRAG computes the same sum from the
 *  same constants. Exported for tests/caustics.test.ts. */
export function brightnessGain(levelGlow: number, levelDrive: number, flash: number, flashDrive: number, ring: number): number {
  return BRIGHT_BASE
    + levelGlow * LEVEL_GLOW_GAIN * Math.pow(Math.max(levelDrive, 0), LEVEL_GLOW_EXP)
    + flash * flashDrive * FLASH_GAIN
    + ring * RING_BRIGHT_GAIN;
}

// The Colour setting's (colourStyle) options, by index.
const COLOUR_SHADES = 0;
const COLOUR_RAINBOW = 2;

// Shades: how fast brightness climbs the palette's ramp (acc times this,
// through x/(1+x)). Lower leaves every palette in its dark half, one dim
// colour with no crests; picked by eye (the record's 2026-10-15 entry).
const SHADE_GAIN = 2.0;
// How far Spectral hue at 1 slides the mid-tones along the ramp.
const CENTROID_SHADE_GAIN = 0.6;
// Shades + accent: where on the ramp the accent band rises to full, and how
// much of the accent it mixes in there.
const ACCENT_BAND_LO = 0.55;
const ACCENT_BAND_PEAK = 0.75;
const ACCENT_MIX = 0.75;

// Rainbow: how hard the palette's cosine modulation damps where hue phase is
// changing faster than a pixel can resolve smoothly (see the hueDamp
// comment in FRAG). Computed on the palette's actual per-channel cosine
// argument now, not a scalar proxy, so this one constant applies correctly
// across every palette rather than implicitly assuming uPalC == 1 (true
// only for "neon" — see src/render/palette.ts's presets).
const HUE_DAMP_K = 1.2;

// How far uCentroid's swing around its own 0.5 midpoint (see
// spectralCentroid.ts) can push huePhase at uCentroidHue = 1 — modest
// against the acc*0.3 ridge term and uTime*0.02 drift already driving
// huePhase, so it reads as a tint that leans with the mix's own brightness
// rather than a competing color cycle.
const CENTROID_HUE_GAIN = 0.5;

// The treble-sparkle sub-params (see the sparkleBright..sparkleSustain
// entries in SETTINGS above) each interpolate between two endpoints of what
// used to be one hardcoded shader constant. Named here — spliced into FRAG
// below via template interpolation, exactly like FOCUS_SNAP_RATIO/HUE_DAMP_K
// above — so the numbers exist in one place and the pure functions beneath
// them can pin each sub-param's default to the old constant it replaces in
// tests/caustics.test.ts, the same role driftRatePerSec's export plays for
// the drift sliders.
const SPARKLE_DENSITY_EXP_LO = 13.0; // uSparkleDensity = 0 -> sparsest glints
const SPARKLE_DENSITY_EXP_HI = 3.0; // uSparkleDensity = 1 -> densest glints
// Raised from the original 60.0 so the finest end of the Sparkle grain dial
// (uSparkleGrain = 0) can go smaller still — 60 was already this scene's
// entire old fixed constant, never a deliberately chosen floor.
const SPARKLE_GRAIN_FREQ_LO = 90.0; // uSparkleGrain = 0 -> finest glints
const SPARKLE_GRAIN_FREQ_HI = 16.0; // uSparkleGrain = 1 -> coarsest glints
const SPARKLE_SPREAD_LO_AT_0 = 0.35;
const SPARKLE_SPREAD_LO_AT_1 = -0.05;
const SPARKLE_SPREAD_HI_AT_0 = 0.8;
const SPARKLE_SPREAD_HI_AT_1 = 0.4;
const SPARKLE_BRIGHT_GAIN = 3.0; // uSparkleBright is a 0..1 fraction of this ceiling
// uSparkleWarp's reach, in the same q-space units sparkleNoise samples in.
// About half of the ridge loop's own accumulated warp (warpAmt up to ~0.45
// per octave over 6 octaves) — enough to visibly bend the glint field's
// shape without dissolving it into incoherent noise at 1.
const SPARKLE_WARP_GAIN = 1.4;

/** uSparkleDensity (0..1) -> the pow() exponent gating how many noise peaks
 *  survive as glints. Default 0.5 -> 8.0, today's old hardcoded exponent. */
export function sparkleDensityExponent(sparkleDensity: number): number {
  return SPARKLE_DENSITY_EXP_LO + (SPARKLE_DENSITY_EXP_HI - SPARKLE_DENSITY_EXP_LO) * sparkleDensity;
}

/** uSparkleGrain (0..1) -> the noise field's spatial frequency. Default 0.5
 *  -> 53.0 (widened from the old fixed 38.0 so the finest end of the dial
 *  can go smaller — see SPARKLE_GRAIN_FREQ_LO's own comment). */
export function sparkleGrainFreq(sparkleGrain: number): number {
  return SPARKLE_GRAIN_FREQ_LO + (SPARKLE_GRAIN_FREQ_HI - SPARKLE_GRAIN_FREQ_LO) * sparkleGrain;
}

/** uSparkleSpread (0..1) -> the crest-gate smoothstep's [lo, hi] edges.
 *  Default 0.5 -> [0.15, 0.6], today's old hardcoded gate. */
export function sparkleSpreadRange(sparkleSpread: number): { lo: number; hi: number } {
  return {
    lo: SPARKLE_SPREAD_LO_AT_0 + (SPARKLE_SPREAD_LO_AT_1 - SPARKLE_SPREAD_LO_AT_0) * sparkleSpread,
    hi: SPARKLE_SPREAD_HI_AT_0 + (SPARKLE_SPREAD_HI_AT_1 - SPARKLE_SPREAD_HI_AT_0) * sparkleSpread,
  };
}

/** uSparkleBright (0..1) -> the linear gain on the whole sparkle term.
 *  Default 0.5 -> 1.5, today's old hardcoded gain. */
export function sparkleBrightGain(sparkleBright: number): number {
  return sparkleBright * SPARKLE_BRIGHT_GAIN;
}

// Flare and Tighten, at a full slider and a full reading of their drives.
// Flare: how much hotter a crest burns, on top of its own brightness raised
// to FLARE_CURVE, so the brightest crests gain the most.
const FLARE_GAIN = 0.7;
const FLARE_CURVE = 1.8;
// Tighten: the ridge exponent is multiplied by exp(TIGHTEN_GAIN * reading).
const TIGHTEN_GAIN = 1.25;
// Contour: the light snaps to CONTOUR_STEPS flat levels of the Shades tone,
// with a white line of CONTOUR_RIM_MIX along each step's edge. The top level
// stops at CONTOUR_TOP because the tone only reaches 1 at infinite light.
const CONTOUR_STEPS = 5;
const CONTOUR_RIM_MIX = 0.85;
const CONTOUR_TOP = 0.97;
// The sparkle effects (causticsSparkle.ts). Each reads sparkleE in FRAG:
// Sparkle times the hits' summed, signed shape (uSparkleEnv). The distances
// are in FRAG's p units, where the frame is 3 tall.
//
// Prism: the red and blue copies of the ridges are sampled this far either
// side of the pixel at sparkleE 1, and their fringes drawn at PRISM_GAIN.
const PRISM_REACH = 0.022;
const PRISM_GAIN = 2.0;
// Run: bands of light (RUN_FREQ_X/RUN_FREQ_Y radians per p unit) slide
// along the warped filaments. Their phase advances at
// RUN_IDLE_RATE always and RUN_PUSH_RATE more per unit of sparkle, so each
// hit shoves them forward; RUN_BASE/RUN_GAIN set how bright they glow at
// rest and on a hit.
const RUN_FREQ_X = 11.5;
const RUN_FREQ_Y = 7.6;
const RUN_SHARP = 7.0;
const RUN_IDLE_RATE = 0.6;
const RUN_PUSH_RATE = 9.0;
const RUN_BASE = 0.35;
const RUN_GAIN = 2.2;
// The ridge loop's octave count, and the flow multipliers FRAG applies per
// use of the drift phase — named here because driftFlows has to reproduce
// exactly the offsets the shader adds, one wrapped entry each. FLOW_X/FLOW_Y
// are the base flow direction (the x/y scale of the old
// per-phase-unit flow the shader used to compute itself), and FLOW_OCTAVE_STEP the
// per-octave speed-up on the ridge sample (the old `flow * (1.0 + fi * 0.2)`).
// SPARKLE_FLOW is the glint field's own, faster scroll.
const RIDGE_OCTAVES = 6;
const FLOW_X = 0.15;
const FLOW_Y = -0.09;
const FLOW_OCTAVE_STEP = 0.2;
const SPARKLE_FLOW = 2.0;
// Layout of the uDriftFlow uniform array driftFlows fills: [x, y] pairs for
// the forward warp sample and the backward one, then one pair per ridge
// octave, then the scalar glint scroll.
const FLOW_FWD = 0;
const FLOW_BACK = 2;
const FLOW_RIDGE = 4;
const FLOW_SPARKLE = FLOW_RIDGE + 2 * RIDGE_OCTAVES;
const DRIFT_FLOW_LEN = FLOW_SPARKLE + 1;

/** Fills `out` with every drift offset FRAG adds to a noise coordinate, each
 *  already wrapped by wrapFlow: the field is periodic in NOISE_PERIOD
 *  (hashCell in FRAG), so each entry is equivalent to its unwrapped value
 *  and the GPU never sees the raw, ever-growing phase. `phase` drives the
 *  warp and glint samples, whose frequency Caustic density leaves alone;
 *  `ridgePhase` drives the six ridge samples, whose frequency it scales, so
 *  it is advanceDensityFlow's `scaledPhase`, which already carries that
 *  factor (see that function for why it's folded in per tick rather than
 *  here). */
export function driftFlows(phase: number, ridgePhase: number, out: Float32Array = new Float32Array(DRIFT_FLOW_LEN)): Float32Array {
  const fx = phase * FLOW_X;
  const fy = phase * FLOW_Y;
  out[FLOW_FWD] = wrapFlow(fx);
  out[FLOW_FWD + 1] = wrapFlow(fy);
  out[FLOW_BACK] = wrapFlow(-fx);
  out[FLOW_BACK + 1] = wrapFlow(-fy);
  const rx = ridgePhase * FLOW_X;
  const ry = ridgePhase * FLOW_Y;
  for (let i = 0; i < RIDGE_OCTAVES; i++) {
    const k = 1 + i * FLOW_OCTAVE_STEP;
    out[FLOW_RIDGE + 2 * i] = wrapFlow(rx * k);
    out[FLOW_RIDGE + 2 * i + 1] = wrapFlow(ry * k);
  }
  out[FLOW_SPARKLE] = wrapFlow(phase * SPARKLE_FLOW);
  return out;
}

// Caustic density's glide: the exponential time constant the live density
// eases toward its target with (~95% of a slider move lands within 3τ).
// Slow enough that a drag reads as the pool easing to a finer/coarser mesh
// rather than snapping; fast enough that a patched level source still
// visibly follows the music instead of averaging every swing away.
export const DENSITY_GLIDE_SEC = 0.6;

/** advanceDensityFlow's state: `live` is the glided density (null until the
 *  first tick), `phase` the plain drift phase (warp and glints), and
 *  `scaledPhase` the density-scaled one (the ridges) — both for driftFlows. */
export interface DensityFlowState {
  live: number | null;
  phase: number;
  scaledPhase: number;
}

export function createDensityFlowState(): DensityFlowState {
  return { live: null, phase: 0, scaledPhase: 0 };
}

/** One tick: `live` glides toward `targetDensity` over DENSITY_GLIDE_SEC
 *  (the first tick snaps, so the scene doesn't ease in on load), then
 *  `scaledPhase` gains this tick's `phaseStep` scaled by the live density.
 *
 *  Scaling each tick's step, never the running total, is the point. The
 *  drift offsets used to be the whole accumulated phase times whatever
 *  density was live that frame, so any density change rescaled all the
 *  distance the field had ever travelled and teleported it — worse the
 *  longer the scene had run. Now a change only bends the drift rate from
 *  here on. At a constant density the sum is exactly the old product, so
 *  screen-space drift speed is still independent of density (rate ×
 *  densScale in noise space, sampled at densScale × the frequency). Only the
 *  ridges sample at that scaled frequency; the warp and glints keep `phase`. */
export function advanceDensityFlow(state: DensityFlowState, dtSec: number, targetDensity: number, phaseStep: number): void {
  state.live = state.live === null ? targetDensity : state.live + (targetDensity - state.live) * (1 - Math.exp(-dtSec / DENSITY_GLIDE_SEC));
  state.phase += phaseStep;
  state.scaledPhase += phaseStep * causticDensityScale(state.live);
}

// Own accumulator for the domain-warp drift: never reset, only advanced, so
// dragging the Drift slider mid-run changes the *rate* going forward and
// never jumps the field (see the file header and flowClock.ts).
//
// DRIFT_BASE_RATE used to be 0.15 — chosen to "match the original fixed
// speed" — but the flow term (driftFlows above) already multiplies the
// phase by FLOW_X. That halved the intended attenuation twice over, so
// drift=1 (the old default) ran ~6.7x slower than the scene's original
// wander and even the old max (2) was ~3.3x slower. 2.0 here is what
// actually cancels out to flowClock.ts's own base rate of 1.0/sec at the
// slider's new midpoint — see driftRatePerSec below.
const DRIFT_BASE_RATE = 2.0;
// Gain Speed boost applies at its own max against a fully loud passage
// (levelValue 1): LEVEL_GAIN/DRIFT_BASE_RATE = 1.5, so Speed boost at 1 adds
// up to 1.5x the mid Drift speed on top of the base — additive, not a
// multiplier on it (see driftRatePerSec below), which is what lets it still
// move the pool with Drift speed parked at 0.
const LEVEL_GAIN = 3.0;

// Speed pump's own accumulator (advancePump, below). One hit's whole decaying
// pulse (drives.ts's continuous reading of a catalogue hit, which decays at
// BEAT_PULSE_DECAY_PER_SEC, animClock.ts) has an area of about
// 1/BEAT_PULSE_DECAY_PER_SEC seconds, so PUMP_ACCEL=6.0 is sized so one
// full-height hit at amount 1 adds about 1.0 phase/s to vel — doubling the
// mid Drift speed for a moment, the same magnitude a single strike ought to
// read as. PUMP_RELEASE_SEC is "slowly going back" from the user's own
// description: at a steady 120bpm (2 hits/sec) that same ~1.0/s per hit
// settles near 1.0 * 2 * PUMP_RELEASE_SEC = 3/s once the push and the decay
// balance. PUMP_VEL_CAP keeps a fast, dense passage (a drum roll, hits with
// little refractory gap between them) from accumulating without bound.
const PUMP_ACCEL = 6.0;
const PUMP_RELEASE_SEC = 1.5;
const PUMP_VEL_CAP = 8;

// Absolute ceiling on the rate driftRatePerSec returns. The additive model
// below can't reach this on its own even with every term maxed at once —
// base = DRIFT_BASE_RATE(2) * drift(1) = 2, level = LEVEL_GAIN(3), pump
// capped at PUMP_VEL_CAP(8), summing to 13 — so this is now a generous backstop
// rather than a value any combination of settings is meant to reach, unlike
// the older multiplicative surge design this rate replaced (see this file's
// git history), which could actually walk right up to it.
const DRIFT_RATE_MAX = 20;

// Speed boost's driver: FeatureFrame.level, fast-tracked and calibrated
// against its own leaky floor/ceiling. This is the deliberate inverse of
// sectionIntensity.ts, which contracts its own floor/ceiling on a
// phrase-length timescale (~3.3s/~12s) so a long quiet passage climbs back
// toward mid — correct for "which section of the song is this", exactly
// wrong for "quiet should stay quiet". Contracting an order of magnitude
// slower (~30s) is what makes this gain-independent instead: it settles
// into the room/playback's own observed range and stays there, rather than
// re-normalizing away the very quiet-vs-loud contrast it exists to show. It
// also reads a different signal (`level`, not `energy`), so this isn't a
// duplicate of that module — it's a different job on a different input.
const LOUD_FAST_RATE_PER_SEC = 5; // ~0.2s: a loud bar registers at once, without chasing individual transients
const LOUD_ENV_EXPAND_RATE_PER_SEC = 1 / 0.3; // ~0.3s: a new extreme is grabbed almost immediately
const LOUD_ENV_CONTRACT_RATE_PER_SEC = 1 / 30; // ~30s: an old extreme is forgotten slowly — see above
const LOUD_MIN_RANGE = 0.15; // below this observed range, confidence blends the output toward neutral instead of amplifying noise
// advanceLoudSwell's own seed/no-signal value (0.5 = neither expand nor
// contract — the calibration's neutral, where level sits mid-range).
const LOUD_NEUTRAL = 0.5;

export interface LoudSwellState {
  fast: number;
  floor: number;
  ceil: number;
  init: boolean;
}

export function createLoudSwellState(): LoudSwellState {
  return { fast: LOUD_NEUTRAL, floor: LOUD_NEUTRAL, ceil: LOUD_NEUTRAL, init: false };
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Advances the loudness calibration in place and returns loudSwell (0..1,
 *  0.5 = neutral): `level`'s position within its own recently observed
 *  range. The first call seeds floor/ceil/fast from that sample (so startup
 *  acquires rather than reporting a false full range) and returns neutral.
 *  Pure aside from `st`, and exported so tests/caustics.test.ts can pin the
 *  gain-invariance (any constant input settles at neutral), extremes-tracking
 *  and slow-forgetting properties directly. */
export function advanceLoudSwell(st: LoudSwellState, dtSec: number, level: number): number {
  const lvl = clamp01(level);
  if (!st.init) {
    st.fast = lvl;
    st.floor = lvl;
    st.ceil = lvl;
    st.init = true;
    return LOUD_NEUTRAL;
  }

  st.fast += (lvl - st.fast) * Math.min(1, LOUD_FAST_RATE_PER_SEC * dtSec);

  const expand = Math.min(1, LOUD_ENV_EXPAND_RATE_PER_SEC * dtSec);
  const contract = Math.min(1, LOUD_ENV_CONTRACT_RATE_PER_SEC * dtSec);
  st.floor += (st.fast - st.floor) * (st.fast < st.floor ? expand : contract);
  st.ceil += (st.fast - st.ceil) * (st.fast > st.ceil ? expand : contract);

  const range = st.ceil - st.floor;
  const raw = range > 1e-4 ? clamp01((st.fast - st.floor) / range) : LOUD_NEUTRAL;
  const confidence = clamp01(range / LOUD_MIN_RANGE);
  return LOUD_NEUTRAL + confidence * (raw - LOUD_NEUTRAL);
}

export interface PumpState {
  vel: number;
}

export function createPumpState(): PumpState {
  return { vel: 0 };
}

/** Advances Speed pump's own accumulating velocity in place: `input` (0..1 —
 *  whatever the "driftPump" drive picker is wired to, a hit's decaying
 *  envelope by default) accelerates `vel` by
 *  `PUMP_ACCEL * amount * input * dtSec`, then `vel` decays exponentially
 *  toward 0 with time constant PUMP_RELEASE_SEC — "each push accelerates
 *  drift speed, then it slowly goes back to the one set by drift", the
 *  user's own gas-pedal description. `amount` is the driftPump slider
 *  (0..1); the resulting `vel` is what driftRatePerSec below adds straight
 *  onto the rate, so a maxed amount with no input still decays to 0 rather
 *  than holding a floor. Capped at PUMP_VEL_CAP so a dense run of pushes
 *  can't accumulate without bound. Pure aside from `st`, and exported so
 *  tests/caustics.test.ts can pin the accelerate/release shape directly. */
export function advancePump(st: PumpState, dtSec: number, input: number, amount: number): void {
  st.vel += PUMP_ACCEL * amount * input * dtSec;
  st.vel *= Math.exp(-dtSec / PUMP_RELEASE_SEC);
  if (st.vel > PUMP_VEL_CAP) st.vel = PUMP_VEL_CAP;
}

export interface DriftInputs {
  /** The Drift speed slider, 0..1 (0.5 = original scene speed, 1 = 2x). */
  drift: number;
  /** Speed boost slider, 0..1 — see LEVEL_GAIN above. */
  driftLevel: number;
  /** loudSwell by default (0..1, 0.5 = neutral) — advanceLoudSwell's
   *  calibrated loudness — or whatever source the "driftLevel" picker is
   *  wired to instead: drives.value("driftLevel", loudSwellCalibrated) in
   *  extraUniforms below. */
  levelValue: number;
  /** Speed pump's own accumulating velocity (advancePump's `vel`), already scaled
   *  by the driftPump slider and its input, and added straight onto the
   *  rate — see PUMP_ACCEL/PUMP_RELEASE_SEC above. */
  pumpVel: number;
}

/** Pure phase-rate math for the drift accumulator, split out from
 *  extraUniforms so it's directly testable (see tests/caustics.test.ts) —
 *  this is the function that would have caught the 2x-attenuation bug.
 *  Additive rather than multiplicative: driftLevel and pumpVel both add
 *  straight onto the Drift-speed base instead of scaling it, which is what
 *  lets either one still move the pool while Drift speed itself sits at 0 —
 *  a multiplier on a base of zero can only ever stay zero. */
export function driftRatePerSec(s: DriftInputs): number {
  const base = DRIFT_BASE_RATE * s.drift;
  const level = LEVEL_GAIN * s.driftLevel * s.levelValue;
  return Math.min(base + level + s.pumpVel, DRIFT_RATE_MAX);
}

/** The assembled fragment shader, exported so tests/caustics.test.ts can pin the
 *  brightness line to brightnessGain's constants. */
export const FRAG = `
// The integer lattice hash (hashCell / hash2Cell) — see the file header's
// precision paragraph and noiseHash.ts for why nothing here uses fract() of
// a large product.
${NOISE_HASH_GLSL}
#define TWO_PI 6.28318530718

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hashCell(i, ${NOISE_MASK}, 0u);
  float b = hashCell(i + vec2(1.0, 0.0), ${NOISE_MASK}, 0u);
  float c = hashCell(i + vec2(0.0, 1.0), ${NOISE_MASK}, 0u);
  float d = hashCell(i + vec2(1.0, 1.0), ${NOISE_MASK}, 0u);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// The ridges: RIDGE_OCTAVES octaves (iterations of them) of warped noise
// sharpened into thin lines, summed. A function so the Prism sparkle effect
// can sample the same field either side of a pixel; q comes back warped
// (the glints sample there).
float ridgeField(inout vec2 q, int iterations, float sharp, float ridgeGain, float densScale, float warpAmt, vec2 flowFwd, vec2 flowBack) {
  float acc = 0.0;
  float amp = 1.0;
    for (int i = 0; i < ${RIDGE_OCTAVES}; i++) {
      if (i >= iterations) break;
      float band = sampleBands(float(i) / ${RIDGE_OCTAVES}.0);
      float fi = float(i);
      q += vec2(
        noise(q * 1.7 + flowFwd + fi),
        noise(q * 1.7 + flowBack + fi * 1.3)
      ) * warpAmt;
      vec2 ridgeFlow = vec2(uDriftFlow[${FLOW_RIDGE} + 2 * i], uDriftFlow[${FLOW_RIDGE + 1} + 2 * i]);
      float v = noise(q * 2.3 * densScale + ridgeFlow);
      float ridge = 1.0 - abs(v * 2.0 - 1.0);
      // Anti-alias the ridge against its own screen-space footprint. pow()
      // has no concept of pixel size, so whenever the true line width (which
      // shrinks as sharp climbs) drops below what a pixel's worth of noise
      // change (fwidth(v)) can resolve, the rasterizer can only stair-step
      // between "in" and "out" — the "pixel ladder" artifact, worst at a
      // crisp resting look (uFog low). Fog pulse only ever lowers sharp, so
      // it widens lines and never triggers this; the cap stays for the
      // resting case, for any drive patch that might push sharp up, and for
      // Tighten, which does. Capping
      // the exponent used here (never the uniform "sharp" itself, so
      // ridgeGain's brightness still tracks the real value) keeps the
      // rendered line at least ~1px wide regardless of how sharp moves.
      // sharp / densScale: v changes densScale times faster across the screen,
      // so the same exponent would thin every filament by that factor.
      float aaSharp = min(sharp / densScale, 0.3 / max(fwidth(v), 1e-4));
      acc += amp * (0.5 + band * 0.8) * pow(ridge, aaSharp) * ridgeGain;
      amp *= 0.6;
    }
  return acc;
}

void main() {
  vec2 uv = roomUv(vUv);
  vec2 aspectFix = vec2(uResolution.x / uResolution.y, 1.0);
  vec2 p = (uv - 0.5) * aspectFix * 3.0 / uZoom;

  // Breathe: the pool zooms on whatever source is patched onto the breathe
  // setting, at BREATHE_ZOOM depth scaled by uBreathe — Bar wave by default,
  // the once-per-bar swing the old bar-locked cosine this line replaced used
  // to get straight off the beat clock. The literal 0.0 argument here is
  // only ever read for a stale-"scene" fallback (Custom=0, unreachable at
  // Breathe's own default) or no drive engine at all (PASSTHROUGH_DRIVES) —
  // bit-for-bit no zoom in either of those cases, not "the scene's own
  // contribution" (there's a real one now: Bar wave).
  p *= 1.0 + ${BREATHE_ZOOM.toFixed(2)} * uBreathe * breatheDrive(0.0);

  // Bass swell: a sustained radial bulge near center, strongest right on a
  // low-band onset and fading outward — distinct from the beat ripple, which
  // is a one-shot ring rather than a standing bulge.
  float pLen0 = length(p);
  vec2 dir0 = pLen0 > 1e-4 ? p / pLen0 : vec2(1.0, 0.0);
  float bassBulge = uBass * bassDrive(uKickPulse);
  // Faded to zero at the origin: dir0 flips sign across the center, so a
  // displacement that's still nonzero there tears the field at a single
  // point — every filament near the middle gets dragged into a pinch.
  p += dir0 * bassBulge * 0.22 * exp(-pLen0 * 0.8) * smoothstep(0.0, 0.4, pLen0);

  // Sparkle (causticsSparkle.ts): the picked effect, driven by sparkleE —
  // Sparkle times the hits' summed, signed shape. Each acts on the ridges
  // further down.
  int sparkleFx = int(uSparkleFx + 0.5);
  float sparkleE = uSparkle * uSparkleEnv;

  // uDensityLive scales only the ridge noise's sampling frequency — more
  // filaments at higher values, laid over the same warp field. It is the
  // glided, drive-scaled density advanceDensityFlow keeps (the raw
  // uCausticDensity setting uniform isn't read, so a change eases in instead
  // of landing in one frame). Scaling q itself, as this used to, zoomed the
  // whole pattern (warp, filament width and glints with it); here the warp
  // and the glints stay put and the ridge loop below divides sharp by the
  // same factor, so a filament keeps its width while there are more or fewer
  // of them. The ridge drift offsets in uDriftFlow carry the factor, folded
  // in per tick JS-side (advanceDensityFlow), so a denser pattern doesn't
  // also drift faster on screen.
  float densScale = ${DENSITY_FILAMENTS.toFixed(2)} * pow(2.0, (uDensityLive - 0.5) * ${DENSITY_SPAN_OCTAVES.toFixed(2)});

  // This scene's own drift (uDriftFlow, uploaded by extraUniforms below)
  // replaces the shared uFlowPhase so drift speed is dialable. It arrives
  // as one already-wrapped offset per use (see driftFlows and the file
  // header's precision paragraph) rather than as a raw phase to multiply
  // here — the multiply is exactly what used to push the hash past fp32.
  vec2 flowFwd = vec2(uDriftFlow[${FLOW_FWD}], uDriftFlow[${FLOW_FWD + 1}]);
  vec2 flowBack = vec2(uDriftFlow[${FLOW_BACK}], uDriftFlow[${FLOW_BACK + 1}]);
  vec2 sparkleFlow = vec2(uDriftFlow[${FLOW_SPARKLE}]);

  // Beat ripple: rippleEmitter.ts's continuous ring emitter, built on the
  // CPU each frame into a 1D radial crest/slope profile (uRippleCrest/
  // uRippleSlope — see that file's buildProfile) and sampled here at this
  // pixel's own radius via rippleSampleCrest/rippleSampleSlope (declared in
  // extraUniformDecls below), in place of the old pool's own per-slot loop
  // over ring uniforms — see rippleEmitter.ts's header for why this shape
  // replaced both the pool and, briefly, a real 2D wave simulation. The
  // pattern is refracted by the ring's *slope*, not its height — the same
  // reasoning the old pool used: a slope pushes the pattern outward on the
  // rising side of a ring and draws it back on the falling side, reading as
  // a wave sweeping through the filaments, where a height-based push would
  // instead drag everything near a crest toward one lump.
  vec2 radialDir;
  float ringCrestRaw;
  float ringSlopeRaw;
  if (uRingOrigin < 0.5) {
    float pLen = length(p);
    radialDir = pLen > 1e-4 ? p / pLen : vec2(1.0, 0.0);
    ringCrestRaw = rippleSampleCrest(pLen);
    ringSlopeRaw = rippleSampleSlope(pLen);
  } else {
    // Random spot: each live spot's rings push outward from that spot, so the
    // refraction is the vector sum of the spots' pushes. p is (uv-0.5) *
    // aspectFix * 3, so the frame's half-size in p-space is 1.5 * aspectFix.
    float crestSum = 0.0;
    vec2 push = vec2(0.0);
    for (int k = 0; k < ${RIPPLE_SPOTS}; k++) {
      vec4 s = uRippleSpot[k];
      if (s.z < 0.5) continue;
      vec2 d = p - s.xy * aspectFix * ${(1.5 * SPOT_REACH).toFixed(3)};
      float r = length(d);
      if (r >= ${PROFILE_MAX_RADIUS.toFixed(2)}) continue;
      vec2 cs = textureLod(uRippleSpotTex, vec2((r / ${(PROFILE_MAX_RADIUS / (PROFILE_SAMPLES - 1)).toFixed(8)} + 0.5) / ${PROFILE_SAMPLES}.0, (float(k) + 0.5) / ${RIPPLE_SPOTS}.0), 0.0).rg;
      crestSum += cs.r;
      push += (r > 1e-4 ? d / r : vec2(0.0)) * cs.g;
    }
    ringCrestRaw = crestSum;
    ringSlopeRaw = length(push);
    radialDir = ringSlopeRaw > 1e-6 ? push / ringSlopeRaw : vec2(1.0, 0.0);
  }
  // A soft knee, not a hard clamp: unchanged up to RIPPLE_CEIL_KNEE, exactly
  // where a single full-strength ring's own peak sits by construction (see
  // RIPPLE_CEIL_KNEE's own comment) — so one ring looks bit-for-bit like the
  // old pool's; only several overlapping rings pushing past that peak get
  // gently pulled toward RIPPLE_CEIL_MAX instead of tearing the pattern.
  float ringCrest = softCeil(ringCrestRaw, ${RIPPLE_CEIL_KNEE.toFixed(2)}, ${RIPPLE_CEIL_MAX.toFixed(2)});
  float ringSlope = softCeil(ringSlopeRaw, ${RIPPLE_CEIL_KNEE.toFixed(2)}, ${RIPPLE_CEIL_MAX.toFixed(2)});
  // max(., 0.0): Bump/Merge's crest never goes negative (a bare sum of two
  // positive gaussians), so this is a no-op for them; Wave's own crest can
  // (its trough dips below the resting level), and a trough shouldn't darken
  // the picture below its own resting look — only a crest brightens it. The
  // refraction term below reads ringSlope directly, signed, unaffected.
  float ring = uRipple * max(ringCrest, 0.0);
  vec2 q = p + radialDir * uRipple * ringSlope * ${RIPPLE_REFRACT.toFixed(3)};

  int iterations = int(mix(3.0, 6.0, uDetail));
  // uFog sets the resting sharpness (sharpRest); uFocus is a pure divisor
  // on it, driven by uBeatPulse, so uFocus=0 always holds sharp exactly at
  // sharpRest (no pulse, at any beatPulse) and sharpRest itself never moves
  // with uFocus (see focusSharp's own doc comment above, and this file's
  // git history for the two different ways earlier versions of this line
  // each conflated the two: scaling floor and peak together, or pinning the
  // peak identical at every focus setting). The division is the reverse of
  // the original Focus snap's multiply: a beat pulls sharp *down* toward
  // Fog's soft end, so sharp <= sharpRest always — no ceiling to clamp
  // against (the old FOCUS_SHARP_MAX) and never a non-positive exponent.
  float sharpRest = mix(${FOG_SHARP_CRISP.toFixed(1)}, ${FOG_SHARP_HAZY.toFixed(1)}, uFog);
  float sharp = (sharpRest / (1.0 + uFocus * focusDrive(uBeatPulse) * ${FOCUS_SNAP_RATIO.toFixed(2)}))
    * (1.0 - bassBulge * 0.25);
  sharp *= exp(${TIGHTEN_GAIN.toFixed(2)} * uTighten * tightenDrive(uHatPulse));
  float ridgeGain = sqrt(sharp / 4.0); // a wider ridge is proportionally dimmed, so Fog pulse eases intensity too, not just width
  // Warp compresses screen space into q-space, and near its own fold points
  // that compression runs unbounded — arbitrarily fine screen-space detail,
  // no antialiasing trick fixes that after the fact. Ordinarily this stays
  // hidden: the six octaves' ridge contours pass through those fold points
  // at very different widths and never gang up. Anything that thins every
  // octave at once breaks that — right where warp already folds several of
  // their contours close together, they all render as hard near-coincident
  // lines simultaneously, reading as a dense "pixel ladder" fan. That used
  // to be the focus *snap* (sharp slamming up on a beat); Fog pulse can't
  // do it any more since its beat only ever widens lines, so the remaining
  // case is a crisp resting look (uFog low, sharp high at rest) against a
  // strong warp. An earlier attempt eased warpAmt down in sync with
  // focusDrive to loosen that fold right when sharpness would otherwise
  // expose it hardest — removed at the time (see this file's git history)
  // because it moved ridge *positions* on every beat as a side effect of an
  // anti-aliasing fix that didn't demonstrably work, i.e. unwanted motion
  // for no proven benefit. uTurbulence below already owns this same warpAmt
  // channel and is drive-wirable (see the "turbulence" SceneSetting's own
  // drive) — pick Any hit there instead of reaching for a second, dedicated
  // beat-reshape control (a "Beat churn" setting used to duplicate exactly
  // this channel with its own decaying pulse; removed for that reason — see
  // this file's git history). aaSharp below still bounds the pixel-ladder
  // artifact independent of warpAmt; a maxed Mid turbulence against the
  // crispest Fog is the case to eyeball for it.
  float warpAmt = 0.45 * (1.0 + uTurbulence * turbulenceDrive(uMid) * 1.2);
  vec2 qRidges = q;
  float acc = ridgeField(q, iterations, sharp, ridgeGain, densScale, warpAmt, flowFwd, flowBack);
  // Prism: red and blue copies of the ridges, sampled either side of this
  // pixel; where a copy is brighter than the ridge here, its colour shows
  // as a fringe (added after the palette below). Costs two more passes of
  // the ridges, only while Prism is picked and a hit is sounding.
  float prismR = 0.0;
  float prismB = 0.0;
  if (sparkleFx == ${EFFECT_PRISM} && abs(sparkleE) > 0.005) {
    vec2 prismOff = vec2(0.8, 0.6) * ${PRISM_REACH.toFixed(3)} * sparkleE;
    vec2 qR = qRidges + prismOff;
    vec2 qB = qRidges - prismOff;
    prismR = max(ridgeField(qR, iterations, sharp, ridgeGain, densScale, warpAmt, flowFwd, flowBack) - acc, 0.0);
    prismB = max(ridgeField(qB, iterations, sharp, ridgeGain, densScale, warpAmt, flowFwd, flowBack) - acc, 0.0);
  }

  // Flare: the brightest crests gain the most; dim water stays dim.
  acc += ${FLARE_GAIN.toFixed(2)} * uFlare * flareDrive(uHatPulse) * pow(max(acc, 0.0), ${FLARE_CURVE.toFixed(2)}) * smoothstep(0.45, 1.0, acc);
  // Run acts on the finished ridges here; Prism's fringes are added to the
  // colour below. Both read sparkleE, so at Sparkle 0 or between hits they
  // leave the pool exactly as it is.
  if (sparkleFx == ${EFFECT_RUN}) {
    // Bands of light slide along the warped filaments (q), pushed forward
    // by each hit (uSparkleRun's rate, JS-side) and glowing brighter on one.
    float bands = pow(0.5 + 0.5 * sin(q.x * ${RUN_FREQ_X.toFixed(2)} + q.y * ${RUN_FREQ_Y.toFixed(2)} - uSparkleRun), ${RUN_SHARP.toFixed(1)});
    acc += acc * smoothstep(0.25, 0.8, acc) * bands * uSparkle * (${RUN_BASE.toFixed(2)} + ${RUN_GAIN.toFixed(2)} * abs(uSparkleEnv));
  }

  // Grain: fine glints gated to where the pattern is already bright (ridge
  // crests) — the sparkle this scene always had, and still its default.
  // uSparkleBright/Density/Grain/Spread/Sustain used to be fixed constants
  // here (1.5, 8.0, 38.0, smoothstep(0.15, 0.6, ...), pulse-only); each
  // defaults to reproduce its old constant exactly (see the
  // sparkleBright..sparkleSustain entries in SETTINGS in caustics.card.ts) and is a macro
  // of uSparkle, so the master knob still moves all of them together.
  // sparkleGlintDrive is the hits' shape (uSparkleEnv's positive part),
  // which already folds in Sparkle sustain's wash JS-side; before the Shape
  // pick existed it was sparkleDrive() of the treble pulse.
  float sparkleLo = mix(${SPARKLE_SPREAD_LO_AT_0.toFixed(2)}, ${SPARKLE_SPREAD_LO_AT_1.toFixed(2)}, uSparkleSpread);
  float sparkleHi = mix(${SPARKLE_SPREAD_HI_AT_0.toFixed(2)}, ${SPARKLE_SPREAD_HI_AT_1.toFixed(2)}, uSparkleSpread);
  float crestGate = smoothstep(sparkleLo, sparkleHi, acc);
  float sparkleGlintDrive = max(uSparkleEnv, 0.0);
  // uSparkleWarp bends the coordinate glints are sampled at with its own
  // small warp pass — independent of the ridge loop's warpAmt above, so
  // dragging it changes only the glints' own curvature, never the ridges'.
  // Zero at default: sparkleQ is q verbatim until this is touched.
  vec2 sparkleQ = q;
  if (uSparkleWarp > 0.0) {
    vec2 sparkleWarpOffset = vec2(
      noise(q * 0.8 + flowFwd + 11.0),
      noise(q * 0.8 + flowBack + 23.0)
    ) - 0.5;
    sparkleQ += sparkleWarpOffset * uSparkleWarp * ${SPARKLE_WARP_GAIN.toFixed(2)};
  }
  float sparkleFreq = mix(${SPARKLE_GRAIN_FREQ_LO.toFixed(1)}, ${SPARKLE_GRAIN_FREQ_HI.toFixed(1)}, uSparkleGrain);
  float sparkleGain = uSparkleBright * ${SPARKLE_BRIGHT_GAIN.toFixed(1)};
  if (sparkleFx == ${EFFECT_GRAIN}) {
    float sparkleNoise = noise(sparkleQ * sparkleFreq + sparkleFlow);
    float sparkleExp = mix(${SPARKLE_DENSITY_EXP_LO.toFixed(1)}, ${SPARKLE_DENSITY_EXP_HI.toFixed(1)}, uSparkleDensity);
    acc += uSparkle * sparkleGlintDrive * crestGate * pow(sparkleNoise, sparkleExp) * sparkleGain;
  }

  // Soft center bloom on a kick, on top of the geometric bulge above.
  acc += bassBulge * exp(-pLen0 * 1.5) * 0.6;

  // Level glow, Beat flash and the ripple crest: each is its slider times what
  // it reads (brightnessGain above), so with those sliders at 0 brightness
  // holds at the base.
  float brightMul = ${BRIGHT_BASE.toFixed(2)}
    + uLevelGlow * ${LEVEL_GLOW_GAIN.toFixed(2)} * pow(max(levelGlowDrive(uEnergy), 0.0), ${LEVEL_GLOW_EXP.toFixed(2)})
    + uFlash * flashDrive(uBeatPulse) * ${FLASH_GAIN.toFixed(2)}
    + ring * ${RING_BRIGHT_GAIN.toFixed(2)};
  acc *= brightMul;
  // Dark-water floor: uFog=0 clips almost exactly today's old fixed cut
  // (0.08), so filaments read as bright threads on black water; uFog=1 clips
  // nothing at all, so the dim wash the haze sits in actually glows instead.
  acc = max(0.0, acc - mix(${FOG_FLOOR_CRISP.toFixed(2)}, ${FOG_FLOOR_HAZY.toFixed(2)}, uFog));
  // Contour steps the Shades tone and maps it back to light, so Rainbow,
  // whose hue rides the light, steps its colours too. The lowest edge gets
  // no line, or every speck of dark water would be outlined.
  float contourAmt = clamp(uContour * contourDrive(uChordPulse), 0.0, 1.0);
  float contourRim = 0.0;
  if (contourAmt > 0.001) {
    float cx = acc * ${SHADE_GAIN.toFixed(2)};
    float ct = cx / (1.0 + cx);
    float tn = ct * ${CONTOUR_STEPS.toFixed(1)};
    float tf = fract(tn);
    float tw = fwidth(tn);
    contourRim = (1.0 - smoothstep(tw * 0.7, tw * 2.0, min(tf, 1.0 - tf))) * step(0.7, tn) * contourAmt;
    ct = mix(ct, min(floor(tn) / ${(CONTOUR_STEPS - 1).toFixed(1)}, ${CONTOUR_TOP.toFixed(2)}), contourAmt);
    acc = ct / (1.0 - ct) / ${SHADE_GAIN.toFixed(2)};
  }
  // Prism's fringes (prismR/prismB above), lit like the ridges they split
  // off and in fixed prism colours rather than the palette's.
  vec3 prism = (vec3(1.0, 0.25, 0.45) * prismR + vec3(0.35, 0.45, 1.0) * prismB) * ${PRISM_GAIN.toFixed(2)} * brightMul;
  vec3 col;
  if (uColourStyle < ${(COLOUR_RAINBOW - 0.5).toFixed(1)}) {
    // Shades: brightness climbs the palette's ramp, so dim water takes its
    // dark end and crests its bright end, never a hue the ramp lacks.
    // Spectral hue slides the mid-tones up or down the ramp; t*(1-t) keeps
    // the black and the brightest crest where they are.
    float x = acc * ${SHADE_GAIN.toFixed(2)};
    float t = x / (1.0 + x);
    t = clamp(t + (uCentroid - 0.5) * uCentroidHue * ${CENTROID_SHADE_GAIN.toFixed(2)} * t * (1.0 - t), 0.0, 1.0);
    col = mix(uPalGround, palRamp(t), smoothstep(0.0, 0.25, t));
    if (uColourStyle > ${(COLOUR_SHADES + 0.5).toFixed(1)}) {
      // Shades + accent: a band just below the brightest crests takes the
      // accent, which only loud passages reach.
      float band = smoothstep(${ACCENT_BAND_LO.toFixed(2)}, ${ACCENT_BAND_PEAK.toFixed(2)}, t) * (1.0 - smoothstep(0.86, 0.98, t));
      col = mix(col, uPalAccent, band * ${ACCENT_MIX.toFixed(2)});
    }
    // Screen the fringes over the shade: col is already in 0..1.
    col = 1.0 - (1.0 - col) * (1.0 - prism / (1.0 + prism));
    col = mix(col, vec3(1.0), contourRim * ${CONTOUR_RIM_MIX.toFixed(2)});
    outColor = vec4(col, 1.0);
    return;
  }
  // Rainbow: the palette's cosine curve, as Caustics was coloured before
  // the shades. Hue phase rides brightness (a ridge crest tints differently than the
  // dim water around it) through a cosine, which wraps through its full
  // hue cycle for roughly a unit change of phase. Raw acc can swing several
  // units within a couple of pixels right at a sharp ridge edge — most of
  // all exactly on a beat, when ridgeGain is also elevated — and cycling
  // through hues that fast across so few pixels is what actually read as a
  // rainbow "pixel ladder" tracing every ridge (not luminance banding —
  // lowering sharp's own ceiling barely touched it, which is what ruled
  // luminance out). Clamping huePhase's own range would have killed the
  // fringing too, but it also flattened the deliberate hue spread between
  // dim water and bright crests everywhere, not just at the hard edges.
  // Instead, damp the palette's cosine *modulation* — never its average
  // color — by how fast huePhase is moving per pixel (fwidth): a slowly
  // drifting phase (ridge interiors, open water) keeps its full designed
  // color swing, while a phase that's trying to wrap within a pixel or two
  // fades toward the average color instead of aliasing through the wrap.
  //
  // The damp is measured on the palette's actual per-channel cosine
  // argument (hueArg = 2π(uPalC·huePhase + uPalD)), not on huePhase alone —
  // uPalC varies per channel and per palette ("neon" is [1,1,1], but "acid"
  // is [1.2, 0.9, 0.6] and "fire" is [1.0, 0.7, 0.4]), so a palette's
  // fastest channel wraps sooner than a shared scalar constant can account
  // for. fwidth/exp are componentwise on vec3 in GLSL ES 3.00, so each
  // channel damps on its own actual wrap rate.
  float huePhase = acc * 0.3 + uTime * 0.02 - bassBulge * 0.15
    + (uCentroid - 0.5) * uCentroidHue * ${CENTROID_HUE_GAIN.toFixed(2)};
  vec3 hueArg = 6.28318 * (uPalC * huePhase + uPalD);
  vec3 hueDamp = exp(-${HUE_DAMP_K.toFixed(2)} * fwidth(hueArg) * fwidth(hueArg));
  col = (uPalA + uPalB * cos(hueArg) * hueDamp) * acc + prism;
  col = col / (1.0 + col); // tonemap — the shader had no ceiling before, so bright hits clipped flat
  col = mix(col, vec3(1.0), contourRim * ${CONTOUR_RIM_MIX.toFixed(2)});

  outColor = vec4(col, 1.0);
}
`;

export const causticsScene = createFullscreenScene(
  card.id,
  card.name,
  FRAG,
  (() => {
    const densityFlow = createDensityFlowState();
    const pump = createPumpState();
    const loudSwellState = createLoudSwellState();
    const flowBuf = new Float32Array(DRIFT_FLOW_LEN);

    // Beat ripple's own emitter state: `emission` conditions the driver
    // signal into a launched amount each frame (standout.ts's
    // advanceStandoutAmount), `emitter` holds every ring still in flight, and
    // `crestBuf`/`slopeBuf` are the persistent arrays buildProfile fills and
    // extraUniforms uploads — see rippleEmitter.ts's header for how the
    // three fit together.
    const emission = createStandoutState();
    const ringRate = createRingRateState();
    const emitter = createRippleEmitter();
    const crestBuf = new Float32Array(PROFILE_SAMPLES);
    const slopeBuf = new Float32Array(PROFILE_SAMPLES);
    const spots = createRippleSpots();
    let spotsDirty = false;
    let prevDropOnset = false;
    // Random spot's profile rows, one per spot (causticsRippleSpots.ts), sampled
    // from FRAG. Built per GL context, like chaikin's seed texture.
    let spotTex: WebGLTexture | null = null;
    let spotGl: WebGL2RenderingContext | null = null;

    function ensureSpotTex(gl: WebGL2RenderingContext): WebGLTexture | null {
      if (spotTex && spotGl === gl) return spotTex;
      spotGl = gl;
      spotTex = gl.createTexture();
      if (!spotTex) return null;
      gl.bindTexture(gl.TEXTURE_2D, spotTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, PROFILE_SAMPLES, RIPPLE_SPOTS, 0, gl.RG, gl.FLOAT, null);
      // RG16F is filterable in core WebGL2; a 32-bit float texture isn't without an extension.
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      spotsDirty = true;
      return spotTex;
    }

    function beforeDraw(ctx: SceneContext, prog: GLProgram): void {
      const { gl } = ctx;
      const tex = ensureSpotTex(gl);
      if (!tex) return;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      if (spotsDirty) {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, PROFILE_SAMPLES, RIPPLE_SPOTS, gl.RG, gl.FLOAT, spots.tex);
        spotsDirty = false;
      }
      prog.setI("uRippleSpotTex", 0);
    }

    // Sparkle's hits (causticsSparkle.ts) and the phase its Run effect
    // scrolls by — its own clock, advanced here and wrapped before upload,
    // like the drift (this file's header).
    const sparkleHits = createSparkleHits();
    let runPhase = 0;

    return {
      settings: card.settings,
      extraUniformDecls: `
uniform float uDriftFlow[${DRIFT_FLOW_LEN}];
// The glided, drive-scaled Caustic density (advanceDensityFlow) — see
// densScale in FRAG.
uniform float uDensityLive;
uniform float uRippleCrest[${PROFILE_SAMPLES}];
uniform float uRippleSlope[${PROFILE_SAMPLES}];
uniform vec4 uRippleSpot[${RIPPLE_SPOTS}];
uniform sampler2D uRippleSpotTex;
// Sparkle (causticsSparkle.ts): the hits' summed, signed shape plus
// Sparkle sustain's wash, and Run's band phase, wrapped JS-side.
uniform float uSparkleEnv;
uniform float uSparkleRun;
// Linear interpolation into a profile array built by rippleEmitter.ts's
// buildProfile — see FRAG's own comment above the Beat ripple block for how
// these two feed the display.
float rippleSampleCrest(float r) {
  float t = clamp(r / ${PROFILE_MAX_RADIUS.toFixed(2)}, 0.0, 1.0) * ${(PROFILE_SAMPLES - 1).toFixed(1)};
  int i0 = int(t);
  int i1 = min(i0 + 1, ${PROFILE_SAMPLES - 1});
  return mix(uRippleCrest[i0], uRippleCrest[i1], fract(t));
}
float rippleSampleSlope(float r) {
  float t = clamp(r / ${PROFILE_MAX_RADIUS.toFixed(2)}, 0.0, 1.0) * ${(PROFILE_SAMPLES - 1).toFixed(1)};
  int i0 = int(t);
  int i1 = min(i0 + 1, ${PROFILE_SAMPLES - 1});
  return mix(uRippleSlope[i0], uRippleSlope[i1], fract(t));
}
// A soft knee, not a hard clamp — see RIPPLE_CEIL_KNEE/RIPPLE_CEIL_MAX's own
// comment in caustics.ts. Signed, so a slope's own push/pull direction
// survives the ceiling.
float softCeil(float x, float knee, float ceil) {
  float m = abs(x);
  float c = m <= knee ? m : knee + (ceil - knee) * tanh((m - knee) / (ceil - knee));
  return sign(x) * c;
}`,

      extraUniforms: (frame, anim, getSetting, drives) => {
        const driftLevel = getSetting("driftLevel");
        // Kept up to date every tick regardless of driftLevel's own drive
        // choice — see the "driftLevel" SceneSetting's own comment — and
        // drives.value()'s sceneDefault, so at that setting's Scene default
        // (today's behavior) levelValue is exactly this calibrated reading.
        const loudSwellCalibrated = advanceLoudSwell(loudSwellState, anim.dtSec, frame.level);
        // Rest 0 for an unplugged jack (drives.ts's header's "Nothing
        // plugged in" paragraph): the rate only ever adds on top of Drift
        // speed's own base, so nothing plugged in should add nothing.
        const levelValue = drives.value("driftLevel", loudSwellCalibrated);
        // Speed pump's own accelerate-then-release velocity, advanced before the
        // rate below reads pump.vel, so this tick's push already counts.
        // Kick's own decaying envelope at driftPump's Beat-hit default —
        // see the "driftPump" SceneSetting's own comment.
        advancePump(pump, anim.dtSec, drives.value("driftPump", anim.song.kickPulse), getSetting("driftPump"));
        const phaseStep = anim.dtSec * driftRatePerSec({
          drift: getSetting("drift"),
          driftLevel,
          levelValue,
          pumpVel: pump.vel,
        });
        // advanceDensityFlow glides toward the target and folds the live
        // value into the drift phase. The sceneDefault is the reading the
        // default (Section) equals, for a stale stored "scene".
        const densityTarget = densityTargetFor(getSetting("causticDensity"), getSetting("densityReach"), drives.value("densityReach", anim.sectionIntensity));
        advanceDensityFlow(densityFlow, anim.dtSec, densityTarget, phaseStep);

        // Beat ripple: age every ring already in flight first, so a ring
        // emitted below starts this frame at age 0 instead of ageing before
        // its own first sample (see rippleEmitter.ts's tick's own doc
        // comment). Wave speed/Wave fade/Ring width are resolved into one
        // params object shared by tick and buildProfile below.
        const rippleParams: RippleProfileParams = {
          decayPerSec: rippleDecayFor(getSetting("waveFade")),
          speedUnitsPerSec: rippleSpeedFor(getSetting("waveSpeed")),
          widthGaussianW: rippleWidthFor(getSetting("ringWidth")),
        };
        const ringStyle = ringStyleFor(getSetting("ringStyle"));
        const ringOrigin = ringOriginFor(getSetting("ringOrigin"));
        emitter.tick(anim.dtSec, rippleParams);
        tickRippleSpots(spots, anim.dtSec, rippleParams);

        // The Scene default this setting's drive picker reproduces — "bass
        // or beat hit" — read here as the two decaying pulses' max, a
        // continuous envelope rather than a one-shot edge (see the "ripple"
        // setting's own comment and advanceStandoutAmount's own doc comment for
        // why a continuous rise-based read is what makes a busy driver duck
        // itself instead of stacking full rings).
        const sceneDefaultSignal = Math.max(anim.song.kickPulse, anim.beatPulse);
        const rawSignal = drives.value("ripple", sceneDefaultSignal);
        // rawSignal has already been through the shared Threshold gate (when
        // it's on); Ring threshold then sets how far a climb must stand out
        // from the learned everyday ones to send a ring.
        // Sized (the default) launches the amount; Flat a full ring per
        // climb that earns half a standout.
        const ringThreshold = getSetting("ringThreshold");
        const emitted =
          (drives.readout("ripple") ?? "sized") === "flat"
            ? advanceStandout(emission, anim.dtSec, rawSignal, ringThreshold)
              ? 1
              : 0
            : advanceStandoutAmount(emission, anim.dtSec, rawSignal, ringThreshold);
        if (ringOrigin === "spot") emitRippleSpot(spots, emitted, ringStyle, spotStartsRing(spots, emitted));
        else emitter.emit(emitted, ringStyle);
        // The panel draws these on Beat ripple's own "What it receives"
        // graph (settingMarks.ts): the level a bump has to reach to send a
        // ring, and each ring actually sent.
        publishSettingMarks("caustics", "ripple", { lines: standoutLine(emission, "reach to ring"), reactionLabel: "ring sent" }, emitted);

        // A drop is rarer and bigger than an ordinary beat — a stronger ring
        // emitted in addition to whatever the continuous driver above just
        // emitted, independent of the "ripple" setting's own drive choice.
        // Edge-triggered locally since anim.dropOnset is already a one-shot
        // pulse, but the guard keeps this robust if that ever changes.
        const drop = anim.dropOnset && !prevDropOnset;
        prevDropOnset = anim.dropOnset;
        if (drop) {
          if (ringOrigin === "spot") emitRippleSpot(spots, RIPPLE_DROP_AMP, ringStyle, true);
          else emitter.emit(RIPPLE_DROP_AMP, ringStyle);
        }

        // Rings that come close together are drawn narrower so they stay
        // separate instead of summing to a flat plateau (rippleEmitter.ts's
        // Auto-narrowing comment). Merge already spaces its rings out by
        // combining close ones, so it keeps the plain Ring width.
        advanceRingRate(ringRate, anim.dtSec, emitted);
        if (ringOrigin === "spot") {
          // Auto-narrowing is for a train of evenly spaced rings; each spot's
          // rings don't form one, so there is nothing for it to separate.
          buildRippleSpots(spots, rippleParams, ringStyle);
          spotsDirty = true;
        } else {
          const profileParams: RippleProfileParams =
            ringStyle === "merge"
              ? rippleParams
              : { ...rippleParams, widthGaussianW: autoNarrowWidthW(rippleParams.widthGaussianW, rippleParams.speedUnitsPerSec, ringRate) };
          buildProfile(emitter, profileParams, crestBuf, slopeBuf, ringStyle);
        }

        // Sparkle: each edge of the sparkle drive starts a hit (the
        // "sparkle" setting's own comment), played Basic or Adaptive. A
        // Hats onset plays at the Hats pulse's height (a flat 1 while
        // hitStrength.ts's shape is flat) and hands Adaptive the hat level at
        // the hit as its stand-out;
        // a wire's edge plays at full size with none. The drive's level is
        // both Adaptive's ring test and Sparkle sustain's wash, a floor under
        // the shape that keeps a below-zero swing's direction.
        const sparkleFired = drives.fired("sparkle", anim.song.hatOnset);
        const sparkleSize = anim.song.hatOnset ? anim.song.hatPulse : 1;
        const sparkleStandout = anim.song.hatOnset ? anim.song.hatLevel : -1;
        const sparkleLevel = drives.value("sparkle", anim.high);
        const adaptive = Math.round(getSetting("sparkleAdapt")) === MODE_ADAPTIVE;
        const shapeEnv = advanceSparkleHits(sparkleHits, anim.dtSec, sparkleFired, sparkleSize, {
          shape: Math.round(getSetting("sparkleShape")),
          length: getSetting("sparkleLength"),
          vibration: getSetting("sparkleVibration"),
          speedHz: getSetting("sparkleSpeed"),
          vibDecay: getSetting("sparkleVibDecay"),
          bounces: getSetting("sparkleBounces"),
          attack: getSetting("sparkleAttack"),
          decay: getSetting("sparkleDecay"),
          rise: getSetting("sparkleRise"),
          release: getSetting("sparkleRelease"),
        }, adaptive, sparkleLevel, sparkleStandout);
        const wash = getSetting("sparkleSustain") * sparkleLevel;
        const sparkleEnv = shapeEnv >= 0 ? Math.max(shapeEnv, wash) : shapeEnv + wash;
        runPhase = (runPhase + anim.dtSec * (RUN_IDLE_RATE + RUN_PUSH_RATE * Math.abs(sparkleEnv) * getSetting("sparkle"))) % (2 * Math.PI);

        return {
          uSparkleEnv: sparkleEnv,
          uSparkleRun: runPhase,
          uDriftFlow: driftFlows(densityFlow.phase, densityFlow.scaledPhase, flowBuf),
          uDensityLive: densityFlow.live ?? densityTarget,
          uRippleCrest: crestBuf,
          uRippleSlope: slopeBuf,
          uRippleSpot: { vec4: spots.spot },
        };
      },
      beforeDraw,
      onDispose: (ctx) => {
        if (spotTex) ctx.gl.deleteTexture(spotTex);
        spotTex = null;
        spotGl = null;
      },
    };
  })(),
);
