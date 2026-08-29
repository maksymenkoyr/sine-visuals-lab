import { createFullscreenScene } from "../fullscreenScene.ts";
import type { SceneSetting } from "../sceneSettings.ts";

// The bright wandering filaments you see on the floor of a sunlit pool.
// Domain-warped value noise, sharpened into thin ridges. Two renderer-side
// clocks feed it instead of raw audio: a phase-locked beat/bar clock
// (beatClock.ts) that only ever nudges toward a detected beat rather than
// resetting on every onset — the old FeatureFrame.beatPhase restarted on
// every hat/fill, which is what made Tempo breathe and Beat ripple stutter —
// and this scene's own drift accumulator below, kept separate from the
// shared uFlowPhase so its speed is user-dialable without reintroducing the
// teleport bug flowClock.ts exists to prevent (scaling an *already
// accumulated* phase is safe; scaling elapsed time by a live value is not).
// Settings map audio onto light and motion rather than position snapping:
// uFocus snaps the ridges thin *and* bright on each beat (both used to move
// together only in width), uBreathe locks a once-per-bar zoom to the beat
// clock, uRipple sends a pool of overlapping drop-rings out from center so a
// new beat doesn't cut the last ring off, uFlash is a brightness punch,
// uDrift is the base wander speed (its own JS-side accumulator — driven by
// driftRatePerSec below, not a shader uniform driving the rate directly —
// with driftBeat/driftKick/driftLoud each dialing in how much beat pulses,
// bass onsets and overall loudness surge that speed), uBass/uTurbulence/
// uSparkle give the low/mid/high bands each a distinct visual (swell / churn
// / crest glints), and uDropReactivity ties everything to
// sectionIntensity.ts's slow-tracked "which part of the song is this" signal
// — a chorus or drop reads as a sustained, brighter, faster, more turbulent
// surface, with a one-shot double-ring flash at the exact moment intensity
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
    key: "focus",
    label: "Focus snap",
    description: "Ridges pull thin and bright on each beat",
    group: "Beat",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.7,
    // Beat-snap only reads as a snap on music with actual beats to snap to.
    // Was { pulse: 0.35, attack: 0.25 } — but `pulse` alone floors near 0.92
    // on almost any locked-tempo track (it's 60% tempoLock, which saturates
    // for basically all steady music), so the old weights resolved focus to
    // ~0.90 and held it there for the whole track, not just a snap. Since
    // uFocus scales the resting floor below (focusFloor = 0.35 * uFocus),
    // sitting that close to 1 kept the *resting* state elevated for the
    // whole track too, not just responding to a specific beat. Lower
    // weights keep the auto swing real without pinning the floor that high
    // on ordinary percussive material.
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
    description: "Wide overlapping rings expand from the center on each beat",
    group: "Beat",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    // Rings read best against punchy, uncluttered material.
    auto: { attack: 0.35, pulse: 0.25, density: -0.2 },
  },
  {
    key: "rippleSrc",
    label: "Ripple source",
    description: "0 = any beat rings out, 1 = bass hits only",
    group: "Beat",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.3,
    // On a busy mix, restrict rings to bass hits so they don't machine-gun.
    auto: { density: 0.3 },
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
    description: "Drift pumps on bass hits specifically, ignoring hats and snares",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.2,
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

const MAX_RIPPLES = 4;
const RIPPLE_SPEED = 1.1; // units/sec a ring expands at
const RIPPLE_WIDTH = 1.6; // gaussian tightness — lower = wider ring
const RIPPLE_DECAY_PER_SEC = 0.55; // lower = the ring lives longer and travels farther

// Ceiling every focus setting converges to on a full-strength beat (see the
// focusDrive comment in FRAG). Was 26 before focus setting stopped scaling
// this directly — lowered alongside that change because a shared ceiling
// now gets reached far more often (any focus setting, given a strong
// enough beat, not just uFocus=1), and 26 pushes pow(ridge, sharp) close
// enough to a step function that the underlying value-noise contour lines
// read as a banded "pixel ladder" rather than a smooth thin ridge,
// especially where the domain warp bunches several octaves' contours
// together near the vortex point.
const FOCUS_SHARP_MAX = 18;

// How hard the palette's cosine modulation damps where hue phase is
// changing faster than a pixel can resolve smoothly (see the hueDamp
// comment in FRAG). Computed on the palette's actual per-channel cosine
// argument now, not a scalar proxy, so this one constant applies correctly
// across every palette rather than implicitly assuming uPalC == 1 (true
// only for "neon" — see src/render/palette.ts's presets).
const HUE_DAMP_K = 1.2;

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

function createRipplePool() {
  const age = new Float32Array(MAX_RIPPLES).fill(1000); // large = inactive, fully decayed
  let nextSlot = 0;
  return {
    age,
    /** Claims the next slot(s) for a fresh ring. `count` > 1 seeds several
     *  adjacent slots at once (a fatter, more emphatic sweep) for the
     *  once-in-a-while drop moment rather than an ordinary beat. */
    trigger(count = 1): void {
      for (let i = 0; i < count; i++) {
        age[nextSlot] = 0;
        nextSlot = (nextSlot + 1) % MAX_RIPPLES;
      }
    },
    tick(dtSec: number): void {
      for (let i = 0; i < MAX_RIPPLES; i++) age[i] += dtSec;
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
  p += dir0 * bassBulge * 0.22 * exp(-pLen0 * 0.8);

  // This scene's own drift phase (uDriftPhase, uploaded by extraUniforms
  // below) replaces the shared uFlowPhase so drift speed is dialable.
  vec2 flow = vec2(uDriftPhase * 0.15, -uDriftPhase * 0.09);

  // Beat ripple pool: up to 4 rings can be in flight at once, so a new beat
  // overlaps the last ring instead of cutting it off. Each is a gaussian
  // lobe expanding from center; ringDist relative to a slot's own age.
  float pLen = length(p);
  vec2 radialDir = pLen > 1e-4 ? p / pLen : vec2(1.0, 0.0);
  float ringSum = 0.0;
  for (int i = 0; i < ${MAX_RIPPLES}; i++) {
    float age = uRippleAge[i];
    float ringR = age * ${RIPPLE_SPEED};
    float ringDist = pLen - ringR;
    ringSum += exp(-ringDist * ringDist * ${RIPPLE_WIDTH}) * exp(-age * ${RIPPLE_DECAY_PER_SEC});
  }
  float ring = uRipple * ringSum;
  vec2 q = p + radialDir * ring * 0.6;

  int iterations = int(mix(3.0, 6.0, uDetail));
  float acc = 0.0;
  float amp = 1.0;
  // Resting floor, scaled by uFocus — this is the scene's original design
  // (focusDrive = uFocus * (0.35 + 0.65*beatPulse)), reinstated after
  // dropping it (an earlier fix, "widen the beat swing instead of lifting
  // the whole range") turned out to cost more than it fixed once the
  // ceiling-convergence invariant below existed too: together they made
  // sharp collapse to pure fog between every beat and swing the full
  // distance to the ceiling on every single one — a much bigger, more
  // constant swing than the scene ever had, which read as the pattern
  // dissolving and reforming twice a second rather than a clean snap
  // ("chaotic decay," "waves moving too much"). A straight linear mix from
  // this floor to a *fixed* ceiling (not a response curve shaped by
  // uFocus — that was a later addition this revert also drops, since nothing
  // asked for it and it's part of what steepened the decay) reconstructs the
  // original's swing and decay rate almost exactly, while still keeping the
  // one thing worth keeping from the ceiling-convergence fix: the peak
  // (uBeatPulse -> 1) always reaches FOCUS_SHARP_MAX regardless of uFocus,
  // so low focus still isn't capped to a soft peak — only the floor moves
  // with the slider now, exactly as it did originally.
  float focusFloor = 0.35 * uFocus;
  float focusDrive = mix(focusFloor, 1.0, uBeatPulse);
  float sharp = mix(4.0, ${FOCUS_SHARP_MAX}.0, focusDrive) * (1.0 - bassBulge * 0.25);
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
    // least ~1px wide regardless of how fast focusDrive moves.
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
  float sparkleNoise = noise(q * sparkleFreq + vec2(uDriftPhase * 2.0));
  float sparkleExp = mix(${SPARKLE_DENSITY_EXP_LO.toFixed(1)}, ${SPARKLE_DENSITY_EXP_HI.toFixed(1)}, uSparkleDensity);
  float sparkleGain = uSparkleBright * ${SPARKLE_BRIGHT_GAIN.toFixed(1)};
  acc += uSparkle * sparkleDrive * crestGate * pow(sparkleNoise, sparkleExp) * sparkleGain;

  // Soft center bloom on a bass hit, on top of the geometric bulge above.
  acc += bassBulge * exp(-pLen0 * 1.5) * 0.6;

  acc *= 0.35 + pow(uEnergy, 1.5) * 0.7 + uFlash * uBeatPulse * 1.5 + ring * 0.8
       + dropDrive * 0.5 + dropFlash * 1.2;
  acc = max(0.0, acc - 0.08); // dark water floor, so filaments read as bright threads
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
  float huePhase = acc * 0.3 + uTime * 0.02 - bassBulge * 0.15;
  vec3 hueArg = 6.28318 * (uPalC * huePhase + uPalD);
  vec3 hueDamp = exp(-${HUE_DAMP_K.toFixed(2)} * fwidth(hueArg) * fwidth(hueArg));
  vec3 col = (uPalA + uPalB * cos(hueArg) * hueDamp) * acc;
  col = col / (1.0 + col); // tonemap — the shader had no ceiling before, so bright hits clipped flat

  outColor = vec4(col, 1.0);
}
`;

export const causticsScene = createFullscreenScene("caustics", "Caustics", FRAG, {
  settings: SETTINGS,
  extraUniformDecls: `uniform float uDriftPhase;\nuniform float uRippleAge[${MAX_RIPPLES}];`,
  extraUniforms: (() => {
    let driftPhase = 0;
    const ripples = createRipplePool();
    let prevDropOnset = false;

    return (frame, anim, getSetting) => {
      driftPhase += anim.dtSec * driftRatePerSec({
        drift: getSetting("drift"),
        driftBeat: getSetting("driftBeat"),
        driftKick: getSetting("driftKick"),
        driftLoud: getSetting("driftLoud"),
        beatPulse: anim.beatPulse,
        lowPulse: anim.lowPulse,
        energy: frame.energy,
        dropReactivity: getSetting("dropReactivity"),
        sectionIntensity: anim.sectionIntensity,
      });

      ripples.tick(anim.dtSec);
      const rippleSrc = getSetting("rippleSrc");
      // rippleSrc < 0.5: any broadband beat rings out. >= 0.5: bass onsets only.
      if (anim.lowOnset || (frame.beat && rippleSrc < 0.5)) ripples.trigger(1);
      // A drop is rarer and bigger than an ordinary beat — claim two slots
      // for a fatter double-ring instead of the usual single lobe. Edge-
      // triggered locally since anim.dropOnset is already a one-shot pulse,
      // but the guard keeps this robust if that ever changes.
      if (anim.dropOnset && !prevDropOnset) ripples.trigger(2);
      prevDropOnset = anim.dropOnset;

      return { uDriftPhase: driftPhase, uRippleAge: ripples.age };
    };
  })(),
});
