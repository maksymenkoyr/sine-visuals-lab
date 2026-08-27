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
    auto: { pulse: 0.35, attack: 0.25 },
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
  {
    key: "sparkle",
    label: "Treble sparkle",
    description: "Hats and cymbals glint on the ridge crests",
    group: "Spectrum",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.4,
    // Directly the hats/cymbals dial.
    auto: { brightness: 0.45, attack: 0.15 },
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

  int iterations = int(mix(3.0, 6.0, uQuality));
  float acc = 0.0;
  float amp = 1.0;
  float focusDrive = uFocus * (0.35 + 0.65 * uBeatPulse);
  float sharp = mix(4.0, 26.0, focusDrive) * (1.0 - bassBulge * 0.25);
  float ridgeGain = sqrt(sharp / 4.0); // a thinner ridge is proportionally brightened, so Focus snaps intensity too, not just width
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
    acc += amp * (0.5 + band * 0.8) * pow(ridge, sharp) * ridgeGain;
    amp *= 0.6;
  }

  // Treble sparkle: fine glints gated to where the pattern is already bright
  // (ridge crests), only appearing with a high-band onset.
  float crestGate = smoothstep(0.15, 0.6, acc);
  float sparkleNoise = noise(q * 38.0 + vec2(uDriftPhase * 2.0));
  acc += uSparkle * uHighPulse * crestGate * pow(sparkleNoise, 8.0) * 1.5;

  // Soft center bloom on a bass hit, on top of the geometric bulge above.
  acc += bassBulge * exp(-pLen0 * 1.5) * 0.6;

  acc *= 0.35 + pow(uEnergy, 1.5) * 0.7 + uFlash * uBeatPulse * 1.5 + ring * 0.8
       + dropDrive * 0.5 + dropFlash * 1.2;
  acc = max(0.0, acc - 0.08); // dark water floor, so filaments read as bright threads
  vec3 col = palette(acc * 0.3 + uTime * 0.02 - bassBulge * 0.15, uPalA, uPalB, uPalC, uPalD) * acc;
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
