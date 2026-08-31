import { createFullscreenScene } from "../fullscreenScene.ts";
import type { SceneSetting } from "../sceneSettings.ts";
import type { SignalLink } from "../signals.ts";

// The bright wandering filaments you see on the floor of a sunlit pool.
// Domain-warped value noise, sharpened into thin ridges. Two renderer-side
// clocks feed it instead of raw audio: a phase-locked beat/bar clock
// (beatClock.ts) that only ever nudges toward a detected beat rather than
// resetting on every onset — the old FeatureFrame.onsetPhase restarted on
// every hat/fill, which is what made Tempo breathe and Beat ripple stutter —
// and this scene's own drift accumulator below, kept separate from the
// shared uFlowPhase so its speed is user-dialable without reintroducing the
// teleport bug flowClock.ts exists to prevent (scaling an *already
// accumulated* phase is safe; scaling elapsed time by a live value is not).
// Settings map audio onto light and motion rather than position snapping:
// uFog sets the resting look (how thin/bright the ridges sit between beats,
// and how much of the dim wash the dark-water floor cut clips away), uFocus
// is purely how much *harder* a beat sharpens the ridges above that resting
// state — 0 means no snap at all, and the resting look itself never moves
// with uFocus (see focusSharp below; this split replaced an earlier design
// where one slider tried to own both and could only ever get one of "peak
// reachable at any setting", "resting look stays put", "doesn't collapse to
// fog between beats" right at a time — see this file's git history),
// uCausticDensity scales the noise field's spatial frequency (more/fewer,
// finer/fatter filaments; 0.5 is exactly the old fixed frequency),
// uBreathe locks a once-per-bar zoom to the beat
// clock, uRipple sends a pool of overlapping drop-rings out from center so a
// new beat doesn't cut the last ring off, uFlash is a brightness punch,
// uDrift is the base wander speed (its own JS-side accumulator — driven by
// driftRatePerSec below, not a shader uniform driving the rate directly —
// with driftBeat/driftKick/driftLoud each dialing in how much beat pulses,
// bass onsets and overall loudness surge that speed — driftKick alone also
// adds a bounded forward jolt directly to the drift phase itself (see
// KICK_JOLT_PHASE and advanceKickJolt below), because a rate-only surge can
// only ever integrate a kick's sharp attack into a smooth ramp, the same
// shape a higher uDrift already produces; no amount of gain on a rate term
// makes that read as a hit rather than a glide), uBass/uTurbulence/
// uSparkle give the low/mid/high bands each a distinct visual (swell / churn
// / crest glints), and uDropReactivity ties everything to
// sectionIntensity.ts's slow-tracked "which part of the song is this" signal
// — a chorus or drop reads as a sustained, brighter, faster, more turbulent
// surface, with a one-shot extra-strong ring at the exact moment intensity
// spikes.
// The master treble-sparkle knob. Defined outside SETTINGS so the sub-params
// below it (density, brightness ceiling, grain, spread, sustain — all in the
// "Sparkle" group, all `advanced`) can name it directly as their `macro`
// driver: a spec reference costs nothing extra to resolve and can't drift out
// of sync with a key string. See the Sparkle group's own comment further down
// for what each sub-param actually does; this one just carries the auto
// weights and stays the everyday slider.
const SPARKLE: SceneSetting = {
  key: "sparkle",
  label: "Treble sparkle",
  description: "Hats and cymbals glint on the ridge crests",
  group: "Sparkle",
  min: 0,
  max: 1,
  step: 0.05,
  default: 0.4,
  // Directly the hats/cymbals dial.
  auto: { brightness: 0.45, attack: 0.15 },
};

const SETTINGS: SceneSetting[] = [
  {
    key: "causticDensity",
    label: "Caustic density",
    description: "How many filaments the pattern resolves into — fewer, fatter cells at low values, a finer mesh at high",
    group: "Pattern",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5, // -> the old fixed noise-sampling frequency, exactly
    // Pure framing geometry the user tunes to taste, same reasoning as
    // sparkleGrain's weight: 0 — not something the music profile should
    // silently redecide underneath a chosen look.
  },
  {
    key: "fog",
    label: "Fog",
    description: "How thin and bright the ridges sit at rest, between beats",
    group: "Pattern",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.4, // -> today's old fixed resting sharpness/floor-cut, closely
    // A busy mix wants the filaments legible (less fog); a dark mix reads as
    // moodier with more haze around them.
    auto: { density: -0.3, brightness: -0.2 },
  },
  {
    key: "focus",
    label: "Focus snap",
    description: "How much harder a beat sharpens the ridges above their resting state; 0 = no snap at all",
    group: "Beat",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.7,
    // Beat-snap only reads as a snap on music with actual beats to snap to.
    // Kept low (not the ~0.9 that `pulse` alone would floor near on almost
    // any locked-tempo track — 60% tempoLock saturates for basically all
    // steady music) because sitting near 1 all track would have the beat
    // snap saturate against FOCUS_SHARP_MAX on nearly every hit rather than
    // responding to a specific one — the resting look itself no longer
    // moves with this slider (see the Fog setting above and focusSharp
    // below), so the old worry about pinning the *floor* up doesn't apply
    // any more, but a saturated snap is just as flat a result.
    auto: { pulse: 0.2, attack: 0.15 },
  },
  {
    key: "breathe",
    label: "Tempo breathe",
    description: "Slow zoom locked to the beat, once per bar",
    group: "Beat",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.35,
    // Bar-locked zoom needs a steady tempo to lock to; slower music has more room for it.
    auto: { pulse: 0.3, tempo: -0.15 },
  },
  {
    key: "ripple",
    label: "Beat ripple",
    description: "Each beat drops a ring that spreads from the center to the edge, like a drop on water; rings overlap instead of replacing each other",
    group: "Beat",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    // Rings read best against punchy, uncluttered material.
    auto: { attack: 0.35, pulse: 0.25, density: -0.2 },
    // Three signals across two layers, not one — see the trigger logic
    // itself, below. A bass onset always fires a ring; a broadband beat only
    // fires one alongside it while Ripple source sits under its own
    // threshold — RIPPLE_SRC_BEAT_THRESHOLD below is the single source of
    // truth both this predicate and the trigger logic read.
    reads: [
      "anim.dropOnset",
      "anim.lowOnset",
      { signal: "feature.onset", activeWhen: (get) => get("rippleSrc") < RIPPLE_SRC_BEAT_THRESHOLD },
    ] satisfies readonly SignalLink[],
  },
  {
    key: "rippleSrc",
    label: "Ripple source",
    description: "Bass hits always ring out. Below 0.5, ordinary beats ring out too; at 0.5 and above, only bass hits do.",
    group: "Beat",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.3,
    // On a busy mix, restrict rings to bass hits so they don't machine-gun.
    auto: { density: 0.3 },
    // The two signals this switches between — dragging the slider across
    // RIPPLE_SRC_BEAT_THRESHOLD is what the Beat pill dimming makes visible.
    reads: [
      "anim.lowOnset",
      { signal: "feature.onset", activeWhen: (get) => get("rippleSrc") < RIPPLE_SRC_BEAT_THRESHOLD },
    ] satisfies readonly SignalLink[],
  },
  {
    key: "flash",
    label: "Beat flash",
    description: "Overall brightness punch on each beat",
    group: "Beat",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    // Same reasoning as ripple, for brightness punch instead of ring shape.
    auto: { attack: 0.3, pulse: 0.2, density: -0.15 },
  },
  {
    key: "drift",
    label: "Drift speed",
    description: "How fast the filaments wander, independent of the beat. 0.5 = the scene's original speed, 1 = double that.",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    // Wander speed tracks the music's own speed.
    auto: { tempo: 0.4, pulse: 0.25 },
  },
  {
    key: "driftBeat",
    label: "Beat surge",
    description: "Drift lurches forward on each beat, then coasts",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.3,
    // Beat-locked lurches only make sense with real beats to lurch on.
    auto: { pulse: 0.35, attack: 0.2 },
  },
  {
    key: "driftKick",
    label: "Kick surge",
    description: "Drift pumps on bass hits, ignoring hats and snares — a gentle speed-up at low settings, a distinct jolt at high ones",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.45, // -> weighted toward the jolt (see advanceKickJolt's driftKick^2), so a lower default would ship with the jolt this setting exists for effectively invisible
    // Dark/bass-heavy mixes carry more kick presence to pump on.
    auto: { brightness: -0.3, attack: 0.2 },
  },
  {
    key: "driftLoud",
    label: "Loudness surge",
    description: "Drift swells smoothly with overall volume",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.4,
    // Swells with volume read best on tracks with real quiet->loud range;
    // an already-dense mix doesn't need more.
    auto: { dynamics: 0.3, density: -0.15 },
  },
  {
    key: "bass",
    label: "Bass swell",
    description: "Low end bulges and warms the center",
    group: "Spectrum",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    // A dark mix wants the low-end swell emphasized; a bright one doesn't need it.
    auto: { brightness: -0.4 },
  },
  {
    key: "turbulence",
    label: "Mid turbulence",
    description: "Vocals and synths churn the filaments",
    group: "Spectrum",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.35,
    // Busy mids churn the filaments; a bright mix reads as more mid-heavy too.
    auto: { density: 0.35, brightness: 0.1 },
  },
  {
    key: "centroidHue",
    label: "Spectral hue",
    description: "Palette drifts one way when the mix is brighter than usual for this track, the other way when it's darker",
    group: "Spectrum",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.3,
    // Already music-driven by construction (it reads the live centroid
    // directly, see FRAG's huePhase) — no auto table needed on top of that.
    reads: ["anim.centroid"],
  },
  SPARKLE,
  // The constants that used to be hardcoded on the sparkle line in FRAG —
  // how bright, how many, how fine, how far the glints spread, and whether
  // they persist through a sustained wash instead of only flashing on a hit.
  // Each tracks SPARKLE as a macro: dragging the master knob moves all five
  // together, and each snaps to manual (stops following) the moment it's
  // touched directly, same as any auto-capable setting. Kept `advanced` —
  // real, but not worth doubling the Sparkle group's row count for settings
  // most people will only ever move via the master.
  {
    key: "sparkleBright",
    label: "Sparkle brightness",
    description: "How bright each glint gets at its peak",
    group: "Sparkle",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5, // -> the old fixed 1.5x gain (see the *3.0 in FRAG)
    advanced: true,
    macro: { driver: SPARKLE, weight: 0.5 },
  },
  {
    key: "sparkleDensity",
    label: "Sparkle density",
    description: "How many glints appear at once",
    group: "Sparkle",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5, // -> the old fixed pow() exponent of 8.0
    advanced: true,
    macro: { driver: SPARKLE, weight: 0.35 },
  },
  {
    key: "sparkleGrain",
    label: "Sparkle grain",
    description: "How fine each glint is",
    group: "Sparkle",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5, // -> the old fixed noise scale of 38.0
    advanced: true,
    // Left off the master: glint size reads as a taste choice, not an
    // intensity one, and tying it to SPARKLE would make "stronger" also
    // silently resize every glint.
    macro: { driver: SPARKLE, weight: 0 },
  },
  {
    key: "sparkleSpread",
    label: "Sparkle spread",
    description: "How far into dim water glints can reach",
    group: "Sparkle",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5, // -> the old fixed crest-gate smoothstep(0.15, 0.6, acc)
    advanced: true,
    macro: { driver: SPARKLE, weight: 0.2 },
  },
  {
    key: "sparkleSustain",
    label: "Sparkle sustain",
    description: "Cymbal wash glints continuously, not just on hits",
    group: "Sparkle",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0, // -> today's behavior: glints only follow the onset pulse
    advanced: true,
    macro: { driver: SPARKLE, weight: 0.3 },
  },
  {
    key: "dropReactivity",
    label: "Drop reactivity",
    description: "Choruses and drops push brightness, turbulence, ripple and drift",
    group: "Dynamics",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    // Only lean into drop behavior on a track that actually has real dynamic swings.
    auto: { dynamics: 0.45 },
  },
];

// Beat ripple pool. Every ring in flight is summed in the shader, so a new
// beat only ever adds a ring — it never replaces one. The pool is sized so
// that the slot a fresh ring reclaims (always the most-faded one, see
// createRipplePool) has long since left the screen at any musical tempo:
// with fewer slots and round-robin reuse, the fifth beat of a bar used to
// erase a ring that was still a third as bright as when it started, which
// read as the whole pattern being redrawn on that beat.
const MAX_RIPPLES = 8;
// Below this, a broadband beat rings out alongside a bass onset; at or above
// it, only a bass onset does — see the trigger logic below and the "ripple"
// SceneSetting's `reads`, which points its Beat pill at this same constant.
const RIPPLE_SRC_BEAT_THRESHOLD = 0.5;
const RIPPLE_SPEED = 1.1; // units/sec a ring expands at
const RIPPLE_WIDTH = 4.0; // gaussian tightness of a ring's height profile — lower = wider ring
const RIPPLE_DECAY_PER_SEC = 0.45; // lower = the ring lives longer and travels farther
// A drop starts as a dimple that grows into the ring rather than appearing
// fully formed, so a beat reads as a strike on the water, not a cut.
const RIPPLE_ATTACK_SEC = 0.06;
// A drop moment gets one ring this much stronger than an ordinary beat.
// Used to claim two coincident slots instead, which was the same picture
// but burned a slot's worth of ring history for nothing.
const RIPPLE_DROP_AMP = 1.8;
// The refraction the shader applies is the *slope* of the ring's height
// profile, not its height (see the ripple comment in FRAG). This scales the
// gaussian derivative so its peak is exactly 1 per unit of ring strength;
// RIPPLE_REFRACT below is then the peak displacement, in p-space units, of
// a full-strength ring at uRipple = 1.
const RIPPLE_SLOPE_NORM = Math.sqrt(2 * RIPPLE_WIDTH) * Math.exp(0.5);
const RIPPLE_REFRACT = 0.3;

// Hard ceiling on sharp regardless of uFog/uFocus. Was 26 in a brief period
// where every focus setting shared this same ceiling as its *peak* — lowered
// then because that shared ceiling got reached far more often (any focus
// setting, given a strong enough beat, not just uFocus=1), and 26 pushes
// pow(ridge, sharp) close enough to a step function that the underlying
// value-noise contour lines read as a banded "pixel ladder" rather than a
// smooth thin ridge, especially where the domain warp bunches several
// octaves' contours together near the vortex point. Kept at 18 — still the
// same visual line-width danger zone.
const FOCUS_SHARP_MAX = 18;

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

// uFocus=1 on a full beat (uBeatPulse=1) multiplies the resting sharpness by
// (1 + FOCUS_SNAP_RATIO) — see focusSharp below. Chosen so the defaults (fog
// 0.4, focus 0.7) land close to the swing this scene's very first version
// had before any of its later focus-formula rewrites (rest ~9.4, peak ~19.4,
// ~2.07x — see this file's git history and tests/caustics.test.ts's
// "stays filamentary" case): every rewrite since has either scaled the rest
// and peak together (the slider read as "merely thinner lines", not more
// snap) or pinned the peak to the same value at every setting (the slider
// stopped moving the actual snap, only the quiet resting state) — see the
// long history of this exact tradeoff across 5fe4b3c, db884a0, b44000d, and
// 9b52b66. Decoupling "resting state" (uFog, above) from "how much a beat
// pushes above it" (uFocus, here) is what makes both failure modes
// impossible at once: uFocus=0 always means literally no snap (sharp never
// moves off whatever uFog set), and the resting state never moves with
// uFocus no matter how the slider is dragged.
const FOCUS_SNAP_RATIO = 1.3;

// uCausticDensity's reach: 0.5 is exactly today's old fixed noise-sampling
// frequency (densScale = 1); the endpoints are ±1.2 octaves off that, mild
// enough that both ends still read as this scene's own pool-caustics look
// rather than a different pattern entirely.
const DENSITY_SPAN_OCTAVES = 2.4;

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
 *  value, uFocus scales how much *harder* a full beat pushes above it — a
 *  pure multiplier on the resting value, never a replacement for it, so
 *  uFocus=0 holds sharp exactly at rest (no snap) and the resting value
 *  itself never depends on uFocus at any beatPulse. Clamped to
 *  FOCUS_SHARP_MAX, the same anti-ladder ceiling every past version of this
 *  formula has respected. Exported so tests/caustics.test.ts can pin the
 *  monotonicity and rest-independence invariants this file's history keeps
 *  breaking one at a time. */
export function focusSharp(fog: number, focus: number, beatPulse: number): number {
  const rest = fogRestingSharp(fog);
  return Math.min(rest * (1 + focus * beatPulse * FOCUS_SNAP_RATIO), FOCUS_SHARP_MAX);
}

/** uCausticDensity (0..1) -> the noise-sampling frequency multiplier. Default
 *  0.5 -> 1.0, today's old fixed frequency exactly. */
export function causticDensityScale(density: number): number {
  return Math.pow(2, (density - 0.5) * DENSITY_SPAN_OCTAVES);
}

// How hard the palette's cosine modulation damps where hue phase is
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

// The treble-sparkle sub-params (see the Sparkle group in SETTINGS above)
// each interpolate between two endpoints of what used to be one hardcoded
// shader constant. Named here — spliced into FRAG below via template
// interpolation, exactly like FOCUS_SHARP_MAX/HUE_DAMP_K above — so the
// numbers exist in one place and the pure functions beneath them can pin
// each sub-param's default to the old constant it replaces in
// tests/caustics.test.ts, the same role driftRatePerSec's export plays for
// the drift sliders.
const SPARKLE_DENSITY_EXP_LO = 13.0; // uSparkleDensity = 0 -> sparsest glints
const SPARKLE_DENSITY_EXP_HI = 3.0; // uSparkleDensity = 1 -> densest glints
const SPARKLE_GRAIN_FREQ_LO = 60.0; // uSparkleGrain = 0 -> finest glints
const SPARKLE_GRAIN_FREQ_HI = 16.0; // uSparkleGrain = 1 -> coarsest glints
const SPARKLE_SPREAD_LO_AT_0 = 0.35;
const SPARKLE_SPREAD_LO_AT_1 = -0.05;
const SPARKLE_SPREAD_HI_AT_0 = 0.8;
const SPARKLE_SPREAD_HI_AT_1 = 0.4;
const SPARKLE_BRIGHT_GAIN = 3.0; // uSparkleBright is a 0..1 fraction of this ceiling

/** uSparkleDensity (0..1) -> the pow() exponent gating how many noise peaks
 *  survive as glints. Default 0.5 -> 8.0, today's old hardcoded exponent. */
export function sparkleDensityExponent(sparkleDensity: number): number {
  return SPARKLE_DENSITY_EXP_LO + (SPARKLE_DENSITY_EXP_HI - SPARKLE_DENSITY_EXP_LO) * sparkleDensity;
}

/** uSparkleGrain (0..1) -> the noise field's spatial frequency. Default 0.5
 *  -> 38.0, today's old hardcoded scale. */
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

// Own accumulator for the domain-warp drift: never reset, only advanced, so
// dragging the Drift slider mid-run changes the *rate* going forward and
// never jumps the field (see the file header and flowClock.ts).
//
// DRIFT_BASE_RATE used to be 0.15 — chosen to "match the original fixed
// speed" — but the shader's flow term (see FRAG below) already multiplies
// uDriftPhase by 0.15. That halved the intended attenuation twice over, so
// drift=1 (the old default) ran ~6.7x slower than the scene's original
// wander and even the old max (2) was ~3.3x slower. 2.0 here is what
// actually cancels out to flowClock.ts's own base rate of 1.0/sec at the
// slider's new midpoint — see driftRatePerSec below.
const DRIFT_BASE_RATE = 2.0;
// Gain each surge slider applies at its own max, audio driver at 1. Tuned so
// driftLoud's default (0.4) reproduces the old hardcoded energy response
// exactly: 0.4 * 1.5 = 0.6, the previous DRIFT_ENERGY_GAIN.
const BEAT_SURGE_GAIN = 2.0;
const KICK_SURGE_GAIN = 2.0;
const LOUD_SURGE_GAIN = 1.5;
// Hard ceiling on the combined speed multiplier. Uncapped, maxing every
// surge slider against loud audio plus a maxed Drop reactivity boost
// (driftBoost up to 1.8) reaches ~11.7x — reads as chaotic scrambling
// rather than "fast". 5 keeps the top end at 10x the base rate (drift=1),
// which is still a clear, coherent sprint.
const SURGE_CAP = 5;

// A kick strike also adds a bounded *position* offset on top of driftPhase,
// separate from the rate term above — see the file header. A rate-only surge
// integrates a kick's sharp attack into a smooth ramp (the same shape a
// higher Drift speed already produces, just briefly), so no amount of gain
// on the rate term can ever make it read as a hit rather than a glide. This
// term is what actually produces the "pump", and is weighted toward the top
// of the driftKick slider (driftKick^2 in advanceKickJolt below) so low
// settings stay purely the existing smooth rate surge.
// -> ~0.3 of a noise cell in flow's own units (flow = uDriftPhase * 0.15,
// noise sampled at q*1.7/q*2.3) — clearly visible, well short of a teleport.
const KICK_JOLT_PHASE = 2.0;
// One-pole slew rate toward the jolt's target (see advanceKickJolt). Fast
// enough to read as a strike; not instant, because lowPulse itself steps
// 0->1 in a single tick (bandEnergy.ts) and stepping driftPhase that fast
// would tear the field instead of reading as a strike — the same reasoning
// RIPPLE_ATTACK_SEC applies to a fresh ring, below.
const KICK_JOLT_SLEW_PER_SEC = 18;

export interface DriftInputs {
  /** The Drift speed slider, 0..1 (0.5 = original scene speed, 1 = 2x). */
  drift: number;
  /** Beat/kick/loudness surge sliders, each 0..1. */
  driftBeat: number;
  driftKick: number;
  driftLoud: number;
  /** anim.beatPulse / anim.lowPulse, each already a decaying 0..1 pulse. */
  beatPulse: number;
  lowPulse: number;
  /** frame.energy, broadband loudness — may be negative before floor tracking settles. */
  energy: number;
  /** Drop reactivity slider (0..1) and sectionIntensity (0..1) — same boost
   *  the shader's dropDrive/dropFlash terms use, so drift speeds up with the
   *  song's own intensity in the same choruses/drops that brighten it. */
  dropReactivity: number;
  sectionIntensity: number;
}

/** Pure phase-rate math for the drift accumulator, split out from
 *  extraUniforms so it's directly testable (see tests/caustics.test.ts) —
 *  this is the function that would have caught the 2x-attenuation bug. */
export function driftRatePerSec(s: DriftInputs): number {
  const driftBoost = 1 + s.sectionIntensity * s.dropReactivity * 0.8;
  const surge =
    1 +
    s.driftBeat * s.beatPulse * BEAT_SURGE_GAIN +
    s.driftKick * s.lowPulse * KICK_SURGE_GAIN +
    s.driftLoud * Math.max(0, s.energy) * LOUD_SURGE_GAIN;
  const modulation = Math.min(driftBoost * surge, SURGE_CAP);
  return DRIFT_BASE_RATE * s.drift * modulation;
}

/** Bounded forward offset added on top of driftPhase for a kick strike — see
 *  KICK_JOLT_PHASE's own comment above for why driftRatePerSec's rate term
 *  can't produce this on its own. Slewed toward its target (never jumped),
 *  so it stays within [0, KICK_JOLT_PHASE] for any driftKick/lowPulse in
 *  [0, 1] and any non-negative dtSec, converging on its own as lowPulse
 *  decays — no separate release handling needed. Exported so
 *  tests/caustics.test.ts can pin its bounds, weighting and decay directly. */
export function advanceKickJolt(prevJolt: number, driftKick: number, lowPulse: number, dtSec: number): number {
  const target = KICK_JOLT_PHASE * driftKick * driftKick * lowPulse;
  return prevJolt + (target - prevJolt) * Math.min(1, KICK_JOLT_SLEW_PER_SEC * dtSec);
}

/** A ring's strength over its life: a short attack from 0 (the strike),
 *  then an exponential fade slow enough that a ring is still clearly
 *  visible by the time it reaches the far corner of a 16:9 frame (p-space
 *  radius ~3 at this scene's 3x zoom). Pure so tests/caustics.test.ts can
 *  pin that "rings reach the edge" property directly. */
export function rippleEnvelope(ageSec: number): number {
  if (ageSec <= 0) return 0;
  return (1 - Math.exp(-ageSec / RIPPLE_ATTACK_SEC)) * Math.exp(-ageSec * RIPPLE_DECAY_PER_SEC);
}

/** Pool of rings in flight. Per-slot radius and strength are computed here
 *  each tick and uploaded as two uniform arrays, so the shader only does the
 *  spatial part. Exported for tests/caustics.test.ts. */
export function createRipplePool() {
  const age = new Float32Array(MAX_RIPPLES).fill(1e6); // huge = never triggered, fully faded
  const amp = new Float32Array(MAX_RIPPLES); // 0 = inactive
  const radius = new Float32Array(MAX_RIPPLES);
  const strength = new Float32Array(MAX_RIPPLES);
  return {
    /** Current ring radius per slot, in p-space units. */
    radius,
    /** Current ring strength per slot: amplitude x rippleEnvelope(age). */
    strength,
    /** Starts a fresh ring in whichever slot has been fading the longest.
     *  Never the youngest — a beat must not erase the ring the last beat
     *  sent out, only add its own. */
    trigger(amplitude = 1): void {
      let slot = 0;
      for (let i = 1; i < MAX_RIPPLES; i++) if (age[i] > age[slot]) slot = i;
      age[slot] = 0;
      amp[slot] = amplitude;
      radius[slot] = 0;
      strength[slot] = 0;
    },
    tick(dtSec: number): void {
      for (let i = 0; i < MAX_RIPPLES; i++) {
        age[i] += dtSec;
        // An inactive slot reports radius 0 (not a huge stale one) so the
        // arrays stay readable in tests and probes; strength 0 already
        // makes it contribute nothing.
        radius[i] = amp[i] > 0 ? age[i] * RIPPLE_SPEED : 0;
        strength[i] = amp[i] * rippleEnvelope(age[i]);
      }
    },
  };
}

const FRAG = `
#define TWO_PI 6.28318530718

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

void main() {
  vec2 uv = roomUv(vUv);
  vec2 aspectFix = vec2(uResolution.x / uResolution.y, 1.0);
  vec2 p = (uv - 0.5) * aspectFix * 3.0;

  float dropDrive = uDropReactivity * uSectionIntensity;
  float dropFlash = uDropReactivity * uDropPulse;

  // Tempo-locked breathing: a slow zoom once per bar, off the phase-locked
  // beat clock (never restarts mid-beat) and faded by tempoLock so it eases
  // in/out with tempo detection instead of popping.
  float breatheAmt = uBreathe * uTempoLock * 0.10 * cos(uBarPhase * TWO_PI);
  p *= 1.0 + breatheAmt;

  // Bass swell: a sustained radial bulge near center, strongest right on a
  // low-band onset and fading outward — distinct from the beat ripple, which
  // is a one-shot ring rather than a standing bulge.
  float pLen0 = length(p);
  vec2 dir0 = pLen0 > 1e-4 ? p / pLen0 : vec2(1.0, 0.0);
  float bassBulge = uBass * uLowPulse;
  // Faded to zero at the origin: dir0 flips sign across the center, so a
  // displacement that's still nonzero there tears the field at a single
  // point — every filament near the middle gets dragged into a pinch.
  p += dir0 * bassBulge * 0.22 * exp(-pLen0 * 0.8) * smoothstep(0.0, 0.4, pLen0);

  // uCausticDensity scales the noise field's own sampling frequency — more,
  // finer filaments at higher values. Applied once, here, to the drift phase
  // (flow); every later use of q inherits it because q is built by
  // accumulating onto a scaled starting point (see q's definition below),
  // not by re-scaling p at each octave separately. flow is scaled by the
  // same factor so a finer/coarser pattern doesn't also drift visibly
  // faster/slower on screen — screen-space drift speed is flowRate /
  // (samplingFreq), and densScale cancels between the two.
  float densScale = pow(2.0, (uCausticDensity - 0.5) * ${DENSITY_SPAN_OCTAVES.toFixed(2)});

  // This scene's own drift phase (uDriftPhase, uploaded by extraUniforms
  // below) replaces the shared uFlowPhase so drift speed is dialable.
  vec2 flow = vec2(uDriftPhase * 0.15, -uDriftPhase * 0.09) * densScale;

  // Beat ripple pool: every ring in flight (MAX_RIPPLES slots, radius and
  // strength per slot from createRipplePool) is summed here, so a new beat
  // adds a ring on top of the ones still travelling instead of replacing
  // them. Each ring is modelled as a gaussian bump in the water's height at
  // its current radius, and the pattern is refracted through it the way a
  // real ripple bends the caustics beneath it: the sampling point shifts
  // radially by the surface *slope* (the bump's derivative), not by its
  // height. That matters for two reasons. The slope is an odd function
  // around the crest — the pattern is pushed outward just inside the ring
  // and drawn back just outside it — so a passing ring reads as a wave
  // sweeping through the filaments, where the old height-based push shifted
  // everything near the ring toward the center in one lump. And the slope
  // of a bump sitting at radius 0 (a ring that just spawned) is zero at the
  // origin and grows linearly away from it, so a fresh ring is a smooth
  // dimple. The old lobe was at full height exactly at the origin, where
  // radialDir flips sign — a tear that dragged every nearby filament into a
  // single pinch point on each beat.
  //
  // The mirrored term (pLen + r) is what a radially symmetric wave actually
  // looks like on the other side of the origin. It only matters while a
  // ring is still small, and its job is to keep the total slope exactly
  // zero at the origin for every radius, not just at spawn.
  float pLen = length(p);
  vec2 radialDir = pLen > 1e-4 ? p / pLen : vec2(1.0, 0.0);
  float ringCrest = 0.0; // summed ring height here — lights the crest
  float ringSlope = 0.0; // summed radial slope here — refracts the pattern
  for (int i = 0; i < ${MAX_RIPPLES}; i++) {
    float s = uRippleStrength[i];
    float r = uRippleRadius[i];
    float dOut = pLen - r;
    float dIn = pLen + r;
    float gOut = exp(-dOut * dOut * ${RIPPLE_WIDTH.toFixed(2)});
    float gIn = exp(-dIn * dIn * ${RIPPLE_WIDTH.toFixed(2)});
    ringCrest += s * (gOut + gIn);
    ringSlope += s * (dOut * gOut + dIn * gIn);
  }
  float ring = uRipple * ringCrest;
  // Scaled by densScale here, once — every later octave builds on q by
  // accumulating onto it (see the loop below), so the whole pattern inherits
  // the frequency change from this one multiply rather than re-scaling p at
  // each octave separately.
  vec2 q = (p + radialDir * uRipple * ringSlope * ${(RIPPLE_SLOPE_NORM * RIPPLE_REFRACT).toFixed(4)}) * densScale;

  int iterations = int(mix(3.0, 6.0, uDetail));
  float acc = 0.0;
  float amp = 1.0;
  // uFog sets the resting sharpness (sharpRest); uFocus is a pure multiplier
  // on top of it, driven by uBeatPulse, so uFocus=0 always holds sharp
  // exactly at sharpRest (no snap, at any beatPulse) and sharpRest itself
  // never moves with uFocus (see focusSharp's own doc comment above, and
  // this file's git history for the two different ways earlier versions of
  // this line each conflated the two: scaling floor and peak together, or
  // pinning the peak identical at every focus setting).
  float sharpRest = mix(${FOG_SHARP_CRISP.toFixed(1)}, ${FOG_SHARP_HAZY.toFixed(1)}, uFog);
  float sharp = min(sharpRest * (1.0 + uFocus * uBeatPulse * ${FOCUS_SNAP_RATIO.toFixed(2)}), ${FOCUS_SHARP_MAX}.0)
    * (1.0 - bassBulge * 0.25);
  float ridgeGain = sqrt(sharp / 4.0); // a thinner ridge is proportionally brightened, so Focus snaps intensity too, not just width
  // Warp compresses screen space into q-space, and near its own fold points
  // that compression runs unbounded — arbitrarily fine screen-space detail,
  // no antialiasing trick fixes that after the fact. Ordinarily this stays
  // hidden: the six octaves' ridge contours pass through those fold points
  // at very different widths and never gang up. A focus snap breaks that —
  // every octave goes thin at once, so right where warp already folds
  // several of their contours close together, they all render as hard
  // near-coincident lines simultaneously, reading as a dense "pixel ladder"
  // fan. A previous fix eased warpAmt down in sync with focusDrive to
  // loosen that fold right when sharpness would otherwise expose it
  // hardest — removed again here: it was the only change in this scene's
  // history that moves ridge *positions* (not just their thinness or
  // brightness), so the warp field was physically reshaping on every beat,
  // which is real, newly-introduced motion. It also didn't demonstrably
  // reduce the ladder it was added for (see that round's own verification
  // notes) — not worth the added motion for an unproven benefit. warpAmt
  // is back to depending only on the music, not on the beat snap itself.
  float warpAmt = 0.45 * (1.0 + uTurbulence * uMid * 1.2 + dropDrive * 0.7);
  for (int i = 0; i < 6; i++) {
    if (i >= iterations) break;
    float band = sampleBands(float(i) / 6.0);
    float fi = float(i);
    q += vec2(
      noise(q * 1.7 + flow + fi),
      noise(q * 1.7 - flow + fi * 1.3)
    ) * warpAmt;
    float v = noise(q * 2.3 + flow * (1.0 + fi * 0.2));
    float ridge = 1.0 - abs(v * 2.0 - 1.0);
    // Anti-alias the ridge against its own screen-space footprint. pow()
    // has no concept of pixel size, so whenever the true line width (which
    // shrinks as sharp climbs) drops below what a pixel's worth of noise
    // change (fwidth(v)) can resolve, the rasterizer can only stair-step
    // between "in" and "out" — the "pixel ladder" artifact, worst right
    // when uFocus slams sharp up fast on a beat. Capping the exponent used
    // here (never the uniform "sharp" itself, so ridgeGain's brightness
    // still tracks the real, unclamped snap) keeps the rendered line at
    // least ~1px wide regardless of how fast sharp moves.
    float aaSharp = min(sharp, 0.3 / max(fwidth(v), 1e-4));
    acc += amp * (0.5 + band * 0.8) * pow(ridge, aaSharp) * ridgeGain;
    amp *= 0.6;
  }

  // Treble sparkle: fine glints gated to where the pattern is already bright
  // (ridge crests), driven by a high-band onset pulse — or, once
  // uSparkleSustain is dialed up, kept alive through a sustained wash too.
  // uSparkleBright/Density/Grain/Spread/Sustain used to be fixed constants
  // here (1.5, 8.0, 38.0, smoothstep(0.15, 0.6, ...), pulse-only); each
  // defaults to reproduce its old constant exactly (see the Sparkle group in
  // SETTINGS above) and is a macro of uSparkle, so the master knob still
  // moves all of them together.
  float sparkleLo = mix(${SPARKLE_SPREAD_LO_AT_0.toFixed(2)}, ${SPARKLE_SPREAD_LO_AT_1.toFixed(2)}, uSparkleSpread);
  float sparkleHi = mix(${SPARKLE_SPREAD_HI_AT_0.toFixed(2)}, ${SPARKLE_SPREAD_HI_AT_1.toFixed(2)}, uSparkleSpread);
  float crestGate = smoothstep(sparkleLo, sparkleHi, acc);
  // uHigh is the slewed continuous high-band level (vs. uHighPulse's
  // decaying onset spike) — max() rather than a blend so sustain=0 leaves
  // the pulse-only drive bit-for-bit untouched.
  float sparkleDrive = max(uHighPulse, uSparkleSustain * uHigh);
  float sparkleFreq = mix(${SPARKLE_GRAIN_FREQ_LO.toFixed(1)}, ${SPARKLE_GRAIN_FREQ_HI.toFixed(1)}, uSparkleGrain);
  float sparkleNoise = noise(q * sparkleFreq + vec2(uDriftPhase * 2.0) * densScale);
  float sparkleExp = mix(${SPARKLE_DENSITY_EXP_LO.toFixed(1)}, ${SPARKLE_DENSITY_EXP_HI.toFixed(1)}, uSparkleDensity);
  float sparkleGain = uSparkleBright * ${SPARKLE_BRIGHT_GAIN.toFixed(1)};
  acc += uSparkle * sparkleDrive * crestGate * pow(sparkleNoise, sparkleExp) * sparkleGain;

  // Soft center bloom on a bass hit, on top of the geometric bulge above.
  acc += bassBulge * exp(-pLen0 * 1.5) * 0.6;

  acc *= 0.35 + pow(uEnergy, 1.5) * 0.7 + uFlash * uBeatPulse * 1.5 + ring * 0.8
       + dropDrive * 0.5 + dropFlash * 1.2;
  // Dark-water floor: uFog=0 clips almost exactly today's old fixed cut
  // (0.08), so filaments read as bright threads on black water; uFog=1 clips
  // nothing at all, so the dim wash the haze sits in actually glows instead.
  acc = max(0.0, acc - mix(${FOG_FLOOR_CRISP.toFixed(2)}, ${FOG_FLOOR_HAZY.toFixed(2)}, uFog));
  // Hue phase rides brightness (a ridge crest tints differently than the
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
  vec3 col = (uPalA + uPalB * cos(hueArg) * hueDamp) * acc;
  col = col / (1.0 + col); // tonemap — the shader had no ceiling before, so bright hits clipped flat

  outColor = vec4(col, 1.0);
}
`;

export const causticsScene = createFullscreenScene("caustics", "Caustics", FRAG, {
  settings: SETTINGS,
  extraUniformDecls: `uniform float uDriftPhase;\nuniform float uRippleRadius[${MAX_RIPPLES}];\nuniform float uRippleStrength[${MAX_RIPPLES}];`,
  extraUniforms: (() => {
    let driftPhase = 0;
    let kickJolt = 0;
    const ripples = createRipplePool();
    let prevDropOnset = false;

    return (frame, anim, getSetting) => {
      const driftKick = getSetting("driftKick");
      driftPhase += anim.dtSec * driftRatePerSec({
        drift: getSetting("drift"),
        driftBeat: getSetting("driftBeat"),
        driftKick,
        driftLoud: getSetting("driftLoud"),
        beatPulse: anim.beatPulse,
        lowPulse: anim.lowPulse,
        energy: frame.energy,
        dropReactivity: getSetting("dropReactivity"),
        sectionIntensity: anim.sectionIntensity,
      });
      // Not gated behind Drift speed the way the rate term above is — a
      // kick strike should still land even with drift=0 (see the file
      // header's driftKick comment).
      kickJolt = advanceKickJolt(kickJolt, driftKick, anim.lowPulse, anim.dtSec);

      ripples.tick(anim.dtSec);
      const rippleSrc = getSetting("rippleSrc");
      // A drop is rarer and bigger than an ordinary beat — one stronger ring
      // in place of (not on top of) the beat that usually lands on the same
      // tick. Edge-triggered locally since anim.dropOnset is already a
      // one-shot pulse, but the guard keeps this robust if that ever
      // changes.
      const drop = anim.dropOnset && !prevDropOnset;
      prevDropOnset = anim.dropOnset;
      if (drop) ripples.trigger(RIPPLE_DROP_AMP);
      // A bass onset always rings; a broadband beat rings too, but only
      // below RIPPLE_SRC_BEAT_THRESHOLD — see that constant's own comment,
      // and the "ripple"/"rippleSrc" SceneSettings' `reads` above. Reads
      // anim.onset, not frame.onset directly — see AnimFrame's own doc: a
      // scene reading FeatureFrame.onset can miss the tick it fired on
      // whenever the render cap skips it, which is exactly the bug this
      // scene used to have (renderLatch.ts's header has the story).
      else if (anim.lowOnset || (anim.onset && rippleSrc < RIPPLE_SRC_BEAT_THRESHOLD)) ripples.trigger(1);

      return { uDriftPhase: driftPhase + kickJolt, uRippleRadius: ripples.radius, uRippleStrength: ripples.strength };
    };
  })(),
});
