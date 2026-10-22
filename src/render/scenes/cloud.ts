import { createFullscreenScene } from "../fullscreenScene.ts";
import type { SceneSetting } from "../sceneSettings.ts";
import { NOISE_HASH_GLSL, NOISE_MASK, wrapFlow } from "../noiseHash.ts";

/**
 * Cosmic Cloud — saturated blue cloud on near-black, soft blobs a third of
 * the screen tall with fine curling filaments through them, churning in
 * place: no pan, no zoom, no spin, no cuts.
 *
 * Built from `/ref` on a silent screensaver loop (bundle
 * `tools/.cache/refs/bo8_Igv-Lyg/`, record `docs/scenes/cloud.md`). The
 * reference has no audio, so every reaction here is our own mapping, chosen
 * so silence reproduces the reference: it keeps churning at `churn`'s rate
 * and nothing else moves.
 *
 * The picture is a noise field read through two nested domain warps, plus a
 * ridged high-frequency layer for the filaments, weighted toward the cloud
 * edges where the reference draws them. The churn comes from moving the
 * warps, not the field: each noise call site gets an offset that runs on a
 * closed Lissajous path (CHURN_PATHS), so the warps reshape the cloud
 * without carrying it anywhere — the reference's phase correlation showed
 * zero global shift. Two incommensurate rates per site keep the paths from
 * lining up, so the picture never repeats the way the reference's loop
 * does. The offsets are bounded and computed in JS (`churnOffsets`), so the
 * noise hash never sees a growing coordinate (noiseHash.ts's header).
 *
 * Reactions, each on a drive (drives.ts): `surge` speeds the churn up
 * (energy), `glow` lifts the whole cloud (bass level), `flare` brightens
 * the filaments on a hit and lets them fade at FLARE_DECAY_PER_SEC.
 *
 * Colour: the cloud's value maps to blue alone, with the ramp's ends set
 * so the blue channel's spread matches the reference's measured
 * percentiles; `colours` blends toward the room palette's ramp instead.
 */

/** Per noise call site in FRAG (the outer warp, the inner warp, the
 *  filaments), the radius of its offset path in noise cells and its angular
 *  rates along x and y, in radians per unit of churn phase. */
export const CHURN_PATHS: ReadonlyArray<{ radius: number; wx: number; wy: number }> = [
  { radius: 1.3, wx: 0.31, wy: 0.23 },
  { radius: 1.1, wx: -0.41, wy: 0.37 },
  { radius: 0.9, wx: 0.53, wy: -0.47 },
];
const SITE_WARP_OUTER = 0;
const SITE_WARP_INNER = 1;
const SITE_FILAMENT = 2;
export const CHURN_LEN = CHURN_PATHS.length * 2;

/** A flare relaxes to ~5 % in under half a second: a slower one never
 *  fell back between hits on a busy song and kept the cloud lit. */
export const FLARE_DECAY_PER_SEC = 8;

/** Longest frame step that still counts as motion — a hidden tab hands in
 *  seconds of dt, and the cloud should resume, not lurch. */
const MAX_STEP_SEC = 0.25;

const TWO_PI = Math.PI * 2;

/** Fills `out` with every call site's offset at churn phase `ph`: bounded by
 *  each path's radius however long the page runs, and continuous in `ph`.
 *  The angle is reduced in float64 before cos/sin so precision holds too. */
export function churnOffsets(ph: number, out: Float32Array = new Float32Array(CHURN_LEN)): Float32Array {
  for (let s = 0; s < CHURN_PATHS.length; s++) {
    const { radius, wx, wy } = CHURN_PATHS[s];
    const ax = (ph * wx) % TWO_PI;
    const ay = (ph * wy) % TWO_PI;
    out[s * 2] = radius * Math.cos(ax);
    out[s * 2 + 1] = radius * Math.sin(ay);
  }
  return out;
}

export const FBM_OCTAVES = 5;
export const FBM_LACUNARITY = 2.03;
/** How far the cloud field's time axis moves, in its coarsest octave's
 *  noise cells per unit of churn phase, and how much faster each finer
 *  octave boils than the one above it. Both tuned so ours loses its
 *  likeness to itself at the reference's pace and curve shape: scaling the
 *  time axis by FBM_LACUNARITY per octave made fine detail flicker away
 *  well before the shapes changed (docs/scenes/cloud.md). */
export const BOIL_RATE = 0.5;
export const BOIL_OCTAVE_GROWTH = 1;

/** Golden-ratio stagger between octaves' depths: value noise loses contrast
 *  halfway between two lattice slices, and octaves passing that point
 *  together made the whole picture breathe. */
const BOIL_STAGGER = 0.618;

/** Fills `out` with each cloud octave's position along the time axis, each
 *  wrapped into the lattice period — the hash is periodic there, so the
 *  wrap is invisible (noiseHash.ts's header). */
export function boilDepths(ph: number, out: Float32Array = new Float32Array(FBM_OCTAVES)): Float32Array {
  let z = ph * BOIL_RATE;
  for (let k = 0; k < FBM_OCTAVES; k++) {
    out[k] = wrapFlow(z + k * BOIL_STAGGER);
    z *= BOIL_OCTAVE_GROWTH;
  }
  return out;
}

/** One frame of the churn phase: `rate` is churn × (1 + surge reading). */
export function advanceChurn(ph: number, dtSec: number, rate: number): number {
  if (!(dtSec > 0) || !Number.isFinite(rate)) return ph;
  return ph + Math.min(dtSec, MAX_STEP_SEC) * Math.max(0, rate);
}

/** The flare envelope: `hit` is 0 for no hit, else the hit's size. A hit
 *  lifts the envelope to its size (never lowers it), then it relaxes. */
export function advanceFlare(env: number, dtSec: number, hit: number): number {
  const decayed = env * Math.exp(-Math.max(0, dtSec) * FLARE_DECAY_PER_SEC);
  return hit > 0 ? Math.max(decayed, hit) : decayed;
}

const SETTINGS: SceneSetting[] = [
  {
    key: "scale",
    label: "Cloud size",
    description: "How big the cloud's blobs are — bigger shows fewer, softer shapes.",
    group: "Form",
    min: 0.4,
    max: 2.5,
    step: 0.05,
    default: 1,
    auto: { density: -0.2 },
  },
  {
    key: "warp",
    label: "Curl",
    description: "How hard the cloud is twisted — calm puffs at the left, tangled smoke at the right.",
    group: "Form",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
    auto: { dynamics: 0.2, brightness: 0.15 },
  },
  {
    key: "filaments",
    label: "Filaments",
    description: "How many fine curling threads run through the cloud's edges.",
    group: "Form",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
    auto: { brightness: 0.3 },
  },
  {
    key: "churn",
    label: "Churn",
    description: "How fast the cloud reshapes itself, even with no music.",
    group: "Motion",
    min: 0,
    max: 3,
    step: 0.05,
    default: 1,
    auto: { tempo: 0.3, pulse: 0.15 },
  },
  {
    key: "surge",
    label: "Surge",
    description: "How much the music speeds the churn up.",
    group: "Motion",
    min: 0,
    max: 3,
    step: 0.05,
    default: 1,
    auto: { loudness: 0.2 },
    drive: { default: "anim.energy" },
  },
  {
    key: "light",
    label: "Brightness",
    description: "How bright the whole cloud is.",
    group: "Look",
    min: 0.3,
    max: 1.6,
    step: 0.05,
    default: 1,
  },
  {
    key: "glow",
    label: "Glow",
    description: "How much each hit lights the whole cloud up before it dims again.",
    group: "Look",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
    auto: { loudness: 0.2 },
    // A pulse, not the bass level: a held level kept the whole picture
    // lifted for an entire song, which read as "brighter", not "reacting".
    drive: { default: "anim.lowOnset" },
  },
  {
    key: "flare",
    label: "Flare",
    description: "How bright the threads flash on a hit before they fade.",
    group: "Look",
    min: 0,
    max: 2,
    step: 0.05,
    default: 0.8,
    auto: { attack: 0.3 },
    drive: { default: "feature.onset", hit: { reactionLabel: "flare" } },
  },
  {
    key: "colours",
    label: "Colours",
    description: "How far the cloud pulls toward the app's own palette instead of the measured blue.",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0,
  },
];

/** One standard deviation of the warped fbm FRAG reads as the cloud,
 *  measured on our own frames. */
const CLOUD_SPREAD = 0.1125;
/** Octave gain of the cloud's own fbm — tuned against the reference's
 *  spatial autocorrelation (docs/scenes/cloud.md). */
const CLOUD_GAIN = 0.62;

const FRAG = `
${NOISE_HASH_GLSL}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hashCell(i, ${NOISE_MASK}, 0u);
  float b = hashCell(i + vec2(1.0, 0.0), ${NOISE_MASK}, 0u);
  float c = hashCell(i + vec2(0.0, 1.0), ${NOISE_MASK}, 0u);
  float d = hashCell(i + vec2(1.0, 1.0), ${NOISE_MASK}, 0u);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Rotated between octaves so no ridge lines up with the screen axes. The
// weights are normalised, so any gain keeps the result centred on 0.5.
float fbmGain(vec2 p, float gain) {
  float v = 0.0;
  float amp = 1.0;
  float total = 0.0;
  mat2 m = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < ${FBM_OCTAVES}; i++) {
    v += amp * vnoise(p);
    total += amp;
    p = m * p * ${FBM_LACUNARITY.toFixed(3)} + vec2(1.7, 9.2);
    amp *= gain;
  }
  return v / total;
}

float fbm(vec2 p) {
  return fbmGain(p, 0.5);
}

// Value noise with time as a third lattice axis, periodic in it like the
// other two, so the cloud boils in place instead of sliding anywhere.
float hash3Cell(vec3 c) {
  uint h = cellBits(c.xy, ${NOISE_MASK}, 1u) ^ (uint(int(c.z) & ${NOISE_MASK}) * 0x85ebca6bu);
  return float(uhash(h) >> 8u) * (1.0 / 16777216.0);
}

float vnoise3(vec2 p, float t) {
  vec3 i = floor(vec3(p, t));
  vec3 f = vec3(p, t) - i;
  vec3 u = f * f * (3.0 - 2.0 * f);
  float a0 = mix(mix(hash3Cell(i), hash3Cell(i + vec3(1.0, 0.0, 0.0)), u.x),
                 mix(hash3Cell(i + vec3(0.0, 1.0, 0.0)), hash3Cell(i + vec3(1.0, 1.0, 0.0)), u.x), u.y);
  float a1 = mix(mix(hash3Cell(i + vec3(0.0, 0.0, 1.0)), hash3Cell(i + vec3(1.0, 0.0, 1.0)), u.x),
                 mix(hash3Cell(i + vec3(0.0, 1.0, 1.0)), hash3Cell(i + vec3(1.0, 1.0, 1.0)), u.x), u.y);
  return mix(a0, a1, u.z);
}

// fbmGain with each octave read at its own depth along the time axis
// (uBoilDepth, already scaled and wrapped per octave by boilDepths).
float fbmBoil(vec2 p, float gain) {
  float v = 0.0;
  float amp = 1.0;
  float total = 0.0;
  mat2 m = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < ${FBM_OCTAVES}; i++) {
    v += amp * vnoise3(p, uBoilDepth[i]);
    total += amp;
    p = m * p * ${FBM_LACUNARITY.toFixed(3)} + vec2(1.7, 9.2);
    amp *= gain;
  }
  return v / total;
}

vec2 fbm2(vec2 p) {
  return vec2(fbm(p), fbm(p + vec2(5.2, 1.3)));
}

vec2 churn(int site) {
  return vec2(uChurnOffset[site * 2], uChurnOffset[site * 2 + 1]);
}

void main() {
  vec2 uv = roomUv(vUv);
  float aspect = uResolution.x / uResolution.y;
  // Half-height units, centred.
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0) * 2.0 / max(uScale, 0.05);
  // Keeps the noise coordinate positive and away from the lattice origin.
  p += vec2(37.0, 61.0);

  vec2 w1 = fbm2(p * 1.3 + churn(${SITE_WARP_OUTER})) - 0.5;
  vec2 q = p + uWarp * 0.55 * w1;
  vec2 w2 = fbm2(q * 1.6 + vec2(2.3, 7.1) + churn(${SITE_WARP_INNER})) - 0.5;
  vec2 r = q + uWarp * 0.35 * w2;

  // The warped fbm is near-normal around 0.5 with a spread of CLOUD_SPREAD;
  // z puts it in standard units so the tone curve below can be fitted to
  // the reference's measured blue percentiles (docs/scenes/cloud.md).
  // A slower-falling gain than the warps': the reference carries much more
  // of its contrast in mid-size grain than plain fbm does.
  float cloud = fbmBoil(r * 2.2, ${CLOUD_GAIN.toFixed(3)});
  float z = (cloud - 0.5) / ${CLOUD_SPREAD.toFixed(3)};
  // Ridged noise on the warped coordinate: thin bright creases that curl
  // with the cloud. Weighted toward the cloud's edges, where the reference
  // draws its threads.
  // A flare widens the threads as well as brightening them: brightening
  // alone barely showed, the ridges being so thin.
  float flare = clamp(uFlareEnv * uFlare, 0.0, 2.0);
  float n = fbm(r * 4.5 + vec2(9.4, 3.3) + churn(${SITE_FILAMENT}));
  float ridge = pow(1.0 - abs(2.0 * n - 1.0), mix(7.0, 4.5, min(flare, 1.0)));
  float edge = smoothstep(-1.2, 0.0, z) * (1.0 - smoothstep(1.0, 2.2, z));
  float threads = ridge * edge * uFilaments * (1.0 + 1.2 * flare);

  float lift = 1.0 + 0.35 * uGlow * glowDrive(uLowPulse);
  float x = max((0.385 + 0.183 * z + 0.036 * z * z + 0.35 * threads) * uLight * lift, 0.0);
  // A soft shoulder instead of a clip, so Glow brightens without flattening
  // the bright half into solid blue. It starts above the reference's 95th
  // percentile, so the resting look is untouched.
  float v = x < 0.8 ? x : 0.8 + 0.2 * (1.0 - exp(-(x - 0.8) / 0.2));

  vec3 blue = vec3(0.0, 0.0, v);
  vec3 room = mix(uPalGround, palRamp(v), smoothstep(0.0, 0.2, v));
  outColor = vec4(mix(blue, room, uColours), 1.0);
}
`;

// This scene's gallery section and the day it was added (scenes/sceneModules.ts).
export const gallery = { stage: "development", added: "2026-10-21" } as const;

export const cloudScene = createFullscreenScene("cloud", "Cosmic Cloud", FRAG, {
  settings: SETTINGS,
  extraUniformDecls: `uniform float uChurnOffset[${CHURN_LEN}];\nuniform float uBoilDepth[${FBM_OCTAVES}];\nuniform float uFlareEnv;`,
  extraUniforms: (() => {
    const offsets = new Float32Array(CHURN_LEN);
    const depths = new Float32Array(FBM_OCTAVES);
    let ph = 0;
    let flareEnv = 0;
    return (frame, anim, getSetting, drives) => {
      const surge = getSetting("surge") * drives.value("surge", frame.energy);
      ph = advanceChurn(ph, anim.dtSec, getSetting("churn") * (1 + surge));
      const hit = drives.fired("flare", anim.onset) ? drives.hitSize("flare") : 0;
      flareEnv = advanceFlare(flareEnv, anim.dtSec, hit);
      return { uChurnOffset: churnOffsets(ph, offsets), uBoilDepth: boilDepths(ph, depths), uFlareEnv: flareEnv };
    };
  })(),
});
