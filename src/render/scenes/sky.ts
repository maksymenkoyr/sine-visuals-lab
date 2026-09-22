import { createProgram, createFullscreenQuad, drawFullscreenQuad, type GLProgram } from "../gl.ts";
import type { SceneSetting } from "../sceneSettings.ts";
import { resolveSceneSetting } from "../autoTune.ts";
import type { Scene, SceneContext } from "../scene.ts";
import { COMMON_UNIFORMS_GLSL, ROOM_UV_GLSL, settingUniformName, uploadCommonUniforms } from "../sceneCommon.ts";
import { NUM_BANDS } from "../../audio/types.ts";
import {
  createFluidSim,
  detectSimFormat,
  simIoGlsl,
  simResolutionFor,
  sameSimSize,
  MIRROR_OFF,
  type FluidSim,
  type SimFormat,
  type Splat,
} from "./skyFluidSim.ts";

// Sky: a real 2D fluid sim driving cloud cover, with three vision
// illusions layered on top — blue field entoptic phenomenon, floaters (in
// waves), and Haidinger's brush. Picked from the "Open Sky Illusions"
// preview artifact as the first three of seven candidate illusions;
// vection, Troxler fading, afterimage, the autokinetic effect and
// pareidolia are deliberately NOT built here, not even as disabled
// settings — a later pass's scope, not this one's.
//
// The fluid sim (skyFluidSim.ts) is a verbatim copy of
// origin/worktree-neon-fluid's fluidSim.ts, the stable-fluids solver that
// branch built for Neon Fluid — copied rather than imported because that
// branch isn't on main, and renamed (not "fluidSim.ts") so the two copies
// are free to diverge, the same per-scene-copy pattern ink.ts/moire.ts/
// kaleido/glsl.ts already use for their own noise helpers. This scene runs
// it in MIRROR_OFF mode only — full screen, no kaleidoscope fold — the one
// path that needs no adaptation. Cloud drift is deliberately NOT
// audio-reactive: two slow, gently meandering ambient splats (driftCenter,
// a real-time clock, never warped by anim.flowPhase or frame.energy — the
// sim step below always passes energy: 0) keep the sky moving on its own;
// the three illusions are what carry the music connection, matching the
// brief's own framing. Free-slip walls are kept as-is (no wrap boundary) —
// a possible follow-up, not a v1 blocker, since the drift is slow enough
// that a wall never reads as one in a normal viewing session.
//
// Display is one hand-rolled pass (not createFullscreenScene, which only
// supports a single pass with no texture of its own to sample) reading the
// sim's dyeTexture() through skyFluidSim's own simIoGlsl(format) codec —
// the same reason petri.ts hand-rolls its display pass. Compositing order,
// sky gradient at the bottom, illusions on top:
//   sky gradient -> cloud (extinction blend off dye density, plus a cheap
//   lit-top/shadowed-bottom shade from the density gradient — a thin slab,
//   not Storm's Gas-mode raymarch, which is private to storm.ts) ->
//   Haidinger's brush (faint, blended into the sky+cloud) -> blue-field
//   dots (drawn last, brightest) -> floaters (also last, translucent).
// The sky/cloud sample the shared room-space canvas (roomUv) since the
// fluid is one world shared across a Panorama's devices, same as every
// other world-simulating scene; the three illusions instead centre on
// *this device's own* screen (vUv, not roomUv) — each is a viewer's own
// eye artifact, not shared room content, so it has to track the screen the
// viewer is actually looking at rather than a hypothetical shared-canvas
// centre that might sit off this device's own slice entirely.
//
// Blue-field dots and floaters are both small fixed-size loops in the
// display shader, evaluated per-fragment as pure functions of (uTime,
// seed) — no vertex buffers, no per-dot JS state, the "a handful of
// sin/cos per slot" budget the plan calls for. Loop bounds (DOT_SLOTS_MAX /
// FLOATER_AMBIENT_MAX / FLOATER_PER_BURST_MAX below) are sized for the
// highest quality tier and compiled once; how many of those slots are
// actually drawn is gated at runtime by uDetail (quality.ts's 0..1 density
// proxy, already uploaded) combined with the relevant setting, so a lower
// tier or TV hardware gets an explicit, bounded ceiling without a second
// shader variant.
//
// Floater waves reuse powder.ts's stateless chunk-pool idiom
// (createWavePool below): a small JS pool of (t0, strength, seed) slots,
// uploaded as flat uniform arrays (uBurstT0/uBurstAmp/uBurstSeed — named
// distinctly from the "Wave strength" *setting*'s own auto-generated
// uWaveStrength uniform, the collision ambience.ts's header flags), each
// slot's whole floater burst evaluated analytically from its age in the
// shader. A burst fires on anim.dropOnset (graded locally from
// anim.dropPulse/anim.sectionIntensity — the same local-grading spirit as
// powder.ts's createBigHitDetector, without needing that detector's own
// baseline/refractory logic, since dropOnset already comes pre-debounced
// out of sectionIntensity.ts). Because the brief wants floaters to arrive
// "sometimes a lot at once, not just a constant light drift" rather than
// only on a drop, a spontaneous wave also fires on its own between drops,
// at a rate the Wave frequency setting controls (waveFallbackIntervalSec).
//
// Haidinger's brush rotates on brushPhase, a plain per-frame accumulator
// (advanceBrushPhase) owned by this scene — never anim.barPhase, which
// wraps every bar and would make the brush visibly snap; storm.ts's own
// scene-local morphPhase/advanceMorphPhase is the precedent for owning a
// continuously-increasing accumulator instead of reading an unwrapped beat
// count (animClock.ts's beatClock keeps one internally, but doesn't expose
// it on AnimFrame). Rotation runs at a fixed real-time rate rather than
// tempo-locked — the plan's own explicitly-offered alternative, taken here
// as the simpler of the two: tempo-locking a slow, ambient rotation adds
// complexity (re-deriving a rate from bpm/tempoLock, handling the unlocked
// case) for a difference that's unlikely to read as anything but "slightly
// different speed" at this speed (implementer's call, not eye-verified
// against the tempo-locked alternative).
const ID = "sky";

// --- Quality-scaled illusion budgets (compile-time loop bounds in the
// display shader) — see the file header on how uDetail gates actual use. ---
const DOT_SLOTS_MAX = 16;
const FLOATER_AMBIENT_MAX = 18;
const FLOATER_PER_BURST_MAX = 10;
export const MAX_WAVE_BURSTS = 3; // concurrent floater waves — mirrors powder.ts's MAX_BURSTS

// --- Fluid sim tuning. Fixed rather than exposed as settings — the plan's
// settings list is representative, not exhaustive, and these aren't part of
// any of the three illusions. ---
const SIM_VISCOSITY = 0.3;
const DYE_DISSIPATION = 0.35;
const SIM_DT_MAX = 1 / 30; // clamps a slow-frame dt so the sim never destabilises

// --- Ambient cloud drift (not audio-reactive — see file header). ---
const DRIFTER_SEEDS: readonly number[] = [1.7, 5.3];
const DRIFT_TANGENT_EPS = 0.08; // finite-difference step used only to find the drift's own heading
const DRIFTER_SIGMA = 0.16; // splat radius, sim uv
const DRIFTER_FORCE = 5; // texels/s^2 at FORCE_REF_ROWS — see skyFluidSim.ts's header
const DRIFTER_DYE_RATE = 0.55; // density/s at the splat centre, before Cloud cover scales it

// --- Floater waves. ---
export const WAVE_LIFE_SEC = 3.5;
export const WAVE_DEAD_T0 = -1e9;
const WAVE_FADE_IN_SEC = 0.5;
const WAVE_FADE_OUT_SEC = 1.2;
const SPONTANEOUS_WAVE_STRENGTH = 0.5;
const WAVE_FALLBACK_MIN_SEC = 6; // shortest spontaneous-wave gap, at Wave frequency = 1
const WAVE_FALLBACK_MAX_SEC = 22; // longest gap, at Wave frequency = 0

// --- Haidinger's brush. ---
const BRUSH_TURNS_PER_SEC = 0.045; // one full turn every ~22s

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** How hard a wave burst hits, from the drop's own pulse and the section's
 *  loudness trend at the moment it fired — same local-grading spirit as
 *  powder.ts's createBigHitDetector, without needing that machinery: unlike
 *  a bass hit, anim.dropOnset already comes pre-debounced by
 *  sectionIntensity.ts, so there's no baseline/refractory logic to redo
 *  here, only how hard this particular drop reads. */
export function waveStrengthFromDrop(dropPulse: number, sectionIntensity: number): number {
  const p = Number.isFinite(dropPulse) ? clamp01(dropPulse) : 0;
  const s = Number.isFinite(sectionIntensity) ? clamp01(sectionIntensity) : 0;
  return clamp01((0.5 + 0.5 * p) * (0.6 + 0.4 * s));
}

/** Seconds between spontaneous waves (no drop needed) at a given Wave
 *  frequency setting — 0 is the longest gap, 1 the shortest. A section drop
 *  always fires its own wave regardless of this timer (see render()). */
export function waveFallbackIntervalSec(frequency: number): number {
  const f = Number.isFinite(frequency) ? clamp01(frequency) : 0;
  return WAVE_FALLBACK_MAX_SEC - (WAVE_FALLBACK_MAX_SEC - WAVE_FALLBACK_MIN_SEC) * f;
}

/** Haidinger's brush's own accumulator: a plain, continuously increasing
 *  phase (never anim.barPhase — see file header) so the bowtie glides
 *  instead of snapping every bar. */
export function advanceBrushPhase(prev: number, dtSec: number): number {
  const from = Number.isFinite(prev) ? prev : 0;
  const dt = Number.isFinite(dtSec) ? Math.max(0, dtSec) : 0;
  return from + dt * BRUSH_TURNS_PER_SEC * Math.PI * 2;
}

/** The ambient drift's own slow meander, in sim uv space: a Lissajous-ish
 *  wander from two low, seed-offset frequencies, pure and deterministic so
 *  it's testable without a GL context. render() also samples this at
 *  `tSec + DRIFT_TANGENT_EPS` to get a finite-difference heading for the
 *  splat's push direction. Kept well clear of the domain's own edges
 *  (never past [0.20, 0.80] x [0.28, 0.72]) so the ambient splat itself is
 *  never what makes a free-slip wall visible. */
export function driftCenter(seed: number, tSec: number): [number, number] {
  const s = Number.isFinite(seed) ? seed : 0;
  const t = Number.isFinite(tSec) ? tSec : 0;
  const a1 = 0.05 + (Math.abs(s * 0.017) % 0.02);
  const a2 = 0.07 + (Math.abs(s * 0.013) % 0.02);
  const x = 0.5 + 0.3 * Math.sin(t * a1 + s * 2.1) * Math.cos(t * a2 * 0.6 + s);
  const y = 0.5 + 0.22 * Math.cos(t * a2 + s * 1.3);
  return [x, y];
}

/** One live floater wave: when it started, how hard (0..1, from
 *  waveStrengthFromDrop or the spontaneous trigger) and the seed its
 *  floaters' positions hash from. Same stateless-pool idiom as powder.ts's
 *  createChunkPool — see this file's header. */
export interface WaveBurst {
  t0: number;
  strength: number;
  seed: number;
}

export interface WavePool {
  /** Starts a wave, reusing a dead slot or displacing the oldest live one. */
  trigger(nowSec: number, strength: number, seed: number): void;
  /** Retires every wave older than WAVE_LIFE_SEC. */
  tick(nowSec: number): void;
  /** How many waves are currently live. */
  alive(): number;
  /** Uploads the pool as uBurstT0/uBurstAmp/uBurstSeed. */
  upload(prog: GLProgram): void;
  /** The raw slots, for tests. */
  readonly bursts: readonly WaveBurst[];
}

export function createWavePool(): WavePool {
  const bursts: WaveBurst[] = [];
  for (let i = 0; i < MAX_WAVE_BURSTS; i++) bursts.push({ t0: WAVE_DEAD_T0, strength: 0, seed: 0 });
  const t0Buf = new Float32Array(MAX_WAVE_BURSTS);
  const ampBuf = new Float32Array(MAX_WAVE_BURSTS);
  const seedBuf = new Float32Array(MAX_WAVE_BURSTS);

  return {
    bursts,
    trigger(nowSec, strength, seed): void {
      let slot = 0;
      let oldest = Infinity;
      for (let i = 0; i < bursts.length; i++) {
        if (bursts[i].t0 === WAVE_DEAD_T0) {
          slot = i;
          oldest = -Infinity;
          break;
        }
        if (bursts[i].t0 < oldest) {
          oldest = bursts[i].t0;
          slot = i;
        }
      }
      const b = bursts[slot];
      b.t0 = Number.isFinite(nowSec) ? nowSec : 0;
      b.strength = clamp01(Number.isFinite(strength) ? strength : 0);
      b.seed = seed;
    },
    tick(nowSec): void {
      for (const b of bursts) {
        if (b.t0 !== WAVE_DEAD_T0 && nowSec - b.t0 > WAVE_LIFE_SEC) {
          b.t0 = WAVE_DEAD_T0;
          b.strength = 0;
        }
      }
    },
    alive(): number {
      let n = 0;
      for (const b of bursts) if (b.t0 !== WAVE_DEAD_T0) n++;
      return n;
    },
    upload(prog): void {
      for (let i = 0; i < bursts.length; i++) {
        const b = bursts[i];
        t0Buf[i] = b.t0;
        ampBuf[i] = b.strength;
        seedBuf[i] = b.seed;
      }
      prog.setFv("uBurstT0", t0Buf);
      prog.setFv("uBurstAmp", ampBuf);
      prog.setFv("uBurstSeed", seedBuf);
    },
  };
}

// Every auto table below reproduces its plain `default` when all dials sit
// at NEUTRAL (musicProfile.ts) — nothing hand-biased; see
// tests/sky.test.ts. Weights follow autoTune.ts's convention (|weight| in
// ~0.15..0.5, per-setting sum under ~0.8).
const SETTINGS: SceneSetting[] = [
  // Form
  {
    key: "cloudCover",
    label: "Cloud cover",
    description: "How much dye the ambient drift injects into the sky — thin wisps at the low end, a fuller cover at the high end",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { density: 0.3 },
  },
  // Motion
  {
    key: "flowSpeed",
    label: "Flow speed",
    description: "How fast the whole fluid evolves — a slow drift at the low end, a brisker roll at the high end",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { tempo: 0.25 },
  },
  {
    key: "turbulence",
    label: "Turbulence",
    description: "How readily the drift curls into swirls and tendrils instead of a smooth roll",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.45,
    auto: { density: 0.2, tempo: 0.2 },
  },
  {
    key: "floaterDensity",
    label: "Floaters",
    description: "How many floaters drift in the visual field at rest, before a wave adds more",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { density: 0.2, dynamics: 0.15 },
  },
  {
    key: "waveStrength",
    label: "Wave strength",
    description: "How many extra floaters a wave brings in on top of the resting count",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    auto: { dynamics: 0.3, attack: 0.2 },
    reads: ["anim.dropOnset"],
  },
  {
    key: "waveFrequency",
    label: "Wave frequency",
    description: "How often floaters arrive in a wave — on every section drop regardless, and spontaneously in between at this rate",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.4,
    auto: { dynamics: 0.2 },
    reads: ["anim.dropOnset"],
  },
  // Look
  {
    key: "skyTint",
    label: "Sky tint",
    description: "Walks the sky and cloud colour from a cool blue toward a warm dusk",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.25,
    auto: { brightness: 0.2 },
  },
  {
    key: "cloudBrightness",
    label: "Cloud brightness",
    description: "How brightly lit the cloud tops read against the sky",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    auto: { loudness: 0.2 },
  },
  {
    key: "dotsDensity",
    label: "Dot density",
    description: "How many blue-field entoptic dots are darting at once",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.55,
    auto: { pulse: 0.3 },
    reads: ["feature.onset"],
  },
  {
    key: "dotsBrightness",
    label: "Dot brightness",
    description: "How bright the darting dots read against the sky",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    auto: { pulse: 0.2, brightness: 0.15 },
    reads: ["feature.onset"],
  },
  {
    key: "brushOpacity",
    label: "Brush opacity",
    description: "Faintness of Haidinger's brush, the bowtie afterimage that turns slowly over the centre of view",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.35,
    auto: { density: -0.2 },
  },
];

function settingFor(key: string): SceneSetting {
  const s = SETTINGS.find((x) => x.key === key);
  if (!s) throw new Error(`sky: unknown setting ${key}`);
  return s;
}

const SETTINGS_UNIFORMS_GLSL = SETTINGS.map((s) => `uniform float ${settingUniformName(s.key)};`).join("\n");

function buildDisplayFrag(format: SimFormat): string {
  return `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
${COMMON_UNIFORMS_GLSL}
${SETTINGS_UNIFORMS_GLSL}
${ROOM_UV_GLSL}
${simIoGlsl(format)}
uniform sampler2D uDye;
uniform float uBrushPhase;
uniform float uBurstT0[${MAX_WAVE_BURSTS}];
uniform float uBurstAmp[${MAX_WAVE_BURSTS}];
uniform float uBurstSeed[${MAX_WAVE_BURSTS}];

const int DOT_SLOTS_MAX = ${DOT_SLOTS_MAX};
const int FLOATER_AMBIENT_MAX = ${FLOATER_AMBIENT_MAX};
const int FLOATER_PER_BURST_MAX = ${FLOATER_PER_BURST_MAX};
const int MAX_WAVE_BURSTS_C = ${MAX_WAVE_BURSTS};
const float WAVE_LIFE_SEC_C = ${WAVE_LIFE_SEC.toFixed(3)};
const float WAVE_FADE_IN = ${WAVE_FADE_IN_SEC.toFixed(3)};
const float WAVE_FADE_OUT = ${WAVE_FADE_OUT_SEC.toFixed(3)};

const float CLOUD_THICKNESS = 1.1;
const float BRUSH_R_CORE = 0.03;
const float BRUSH_R_IN = 0.22;
const float BRUSH_R_OUT = 0.34;
const float BRUSH_BASE = 0.4;
const float DOT_SPAN = 1.15;
const float DOT_CURVE = 0.35;
const float DOT_CYCLE_MIN = 0.6;
const float DOT_CYCLE_MAX = 1.6;
const float DOT_RADIUS = 0.007;
const vec3 DOT_COLOR = vec3(0.86, 0.93, 1.0);
const float FLOATER_SPAN = 1.3;
const float FLOATER_DRIFT_R = 0.05;
const float FLOATER_JUMP_MIN = 2.0;
const float FLOATER_JUMP_MAX = 5.0;
const float FLOATER_JUMP_EASE = 0.35;
const float FLOATER_RADIUS = 0.011;
const vec3 FLOATER_COLOR = vec3(0.72, 0.75, 0.7);
const float FLOATER_ALPHA = 0.55;

// This scene's own small hash/noise family — independently written (the
// same fract/dot idiom every other scene's hash21 uses, CLAUDE.md's
// standing rule against porting), not shared with any other scene's.
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

vec2 hash22(vec2 p) {
  return vec2(hash21(p), hash21(p + 19.19));
}

// Smooth drift around a slowly re-anchored point — the saccade-lag jitter
// the floater illusions want: a new anchor every FLOATER_JUMP_MIN..MAX
// seconds (per-seed), eased in over FLOATER_JUMP_EASE rather than
// teleporting, with a small continuous wander on top. Shared by the ambient
// baseline and the wave bursts below — they differ only in which seeds and
// which age-gated envelope call it.
vec2 floaterPos(float seed, float t) {
  float jumpPeriod = FLOATER_JUMP_MIN + hash21(vec2(seed, 2.7)) * (FLOATER_JUMP_MAX - FLOATER_JUMP_MIN);
  float k = floor(t / jumpPeriod);
  float localT = t - k * jumpPeriod;
  vec2 anchor = (hash22(vec2(seed * 3.1 + 1.0, k)) - 0.5) * FLOATER_SPAN;
  vec2 prevAnchor = (hash22(vec2(seed * 3.1 + 1.0, k - 1.0)) - 0.5) * FLOATER_SPAN;
  float ease = smoothstep(0.0, FLOATER_JUMP_EASE, localT);
  vec2 base = mix(prevAnchor, anchor, ease);
  vec2 drift = vec2(sin(localT * 0.7 + seed), cos(localT * 0.55 + seed * 1.6)) * FLOATER_DRIFT_R;
  return base + drift;
}

void main() {
  vec2 uv = roomUv(vUv);
  // The three illusions live in this device's own screen space, not the
  // shared room canvas — see the file header on why.
  float devAspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 p = (vUv - 0.5) * vec2(devAspect, 1.0);

  // 1. Sky: a vertical gradient, Sky tint walking it from cool blue toward
  // a warm dusk.
  vec3 zenithCool = vec3(0.09, 0.22, 0.50);
  vec3 zenithWarm = vec3(0.28, 0.18, 0.27);
  vec3 horizonCool = vec3(0.55, 0.68, 0.86);
  vec3 horizonWarm = vec3(0.76, 0.55, 0.47);
  vec3 zenith = mix(zenithCool, zenithWarm, uSkyTint);
  vec3 horizon = mix(horizonCool, horizonWarm, uSkyTint);
  vec3 color = mix(horizon, zenith, smoothstep(-0.1, 0.9, uv.y));

  // 2. Cloud cover: extinction blend off the sim's own dye density, plus a
  // cheap directional shade from the density gradient (lit tops, shadowed
  // undersides) — a thin slab, not a raymarch (see file header).
  vec2 dyeTexel = 1.0 / vec2(textureSize(uDye, 0));
  float density = max(decodeDye(texture(uDye, uv)).x, 0.0);
  float densityUp = max(decodeDye(texture(uDye, uv + vec2(0.0, dyeTexel.y))).x, 0.0);
  float densityDown = max(decodeDye(texture(uDye, uv - vec2(0.0, dyeTexel.y))).x, 0.0);
  float lit = clamp(0.5 + (densityDown - densityUp) * 2.2, 0.15, 1.0);
  float cloudAlpha = clamp(1.0 - exp(-density * CLOUD_THICKNESS), 0.0, 1.0);
  vec3 cloudShadow = vec3(0.42, 0.47, 0.56);
  vec3 cloudLit = vec3(0.99, 0.98, 1.0);
  vec3 cloudColor = mix(cloudShadow, cloudLit, lit) * (0.55 + 0.65 * uCloudBrightness);
  color = mix(color, cloudColor, cloudAlpha);

  // 3. Haidinger's brush: a faint bowtie centred on the fixation point,
  // rotating on uBrushPhase — under/with the sky+cloud, per the file
  // header's compositing order, so it never sits on top of the dots.
  float r = length(p);
  float ang = atan(p.y, p.x) - uBrushPhase;
  float lobe = cos(2.0 * ang);
  float radial = smoothstep(0.0, BRUSH_R_CORE, r) * smoothstep(BRUSH_R_OUT, BRUSH_R_IN, r);
  vec3 brushTint = mix(vec3(0.82, 0.85, 1.05), vec3(1.05, 0.98, 0.82), lobe * 0.5 + 0.5);
  float brushAmt = clamp(uBrushOpacity * BRUSH_BASE * radial * abs(lobe) * (1.0 - 0.4 * uEnergy), 0.0, 1.0);
  color = mix(color, color * brushTint, brushAmt);

  // 4. Blue-field entoptic phenomenon: DOT_SLOTS_MAX analytic dart paths,
  // each a pure function of (uTime, seed) — a quadratic bezier between two
  // hashed waypoints, continuous and staggered with no JS-side state.
  int dotCap = int(clamp(mix(3.0, float(DOT_SLOTS_MAX), uDetail), 1.0, float(DOT_SLOTS_MAX)) + 0.5);
  int dotActive = int(float(dotCap) * clamp(uDotsDensity, 0.0, 1.0) + 0.5);
  float dotAccum = 0.0;
  for (int i = 0; i < DOT_SLOTS_MAX; i++) {
    if (i >= dotActive) break;
    float seed = float(i) * 11.7 + 3.1;
    float cycleLen = DOT_CYCLE_MIN + hash21(vec2(seed, 4.0)) * (DOT_CYCLE_MAX - DOT_CYCLE_MIN);
    float tCycle = uTime / cycleLen + seed * 0.53;
    float k = floor(tCycle);
    float localT = fract(tCycle);
    vec2 a = (hash22(vec2(seed, k)) - 0.5) * DOT_SPAN;
    vec2 b = (hash22(vec2(seed, k + 1.0)) - 0.5) * DOT_SPAN;
    vec2 mid = (a + b) * 0.5;
    vec2 dir = b - a;
    vec2 perp = normalize(vec2(-dir.y, dir.x) + 1e-5);
    float curveAmt = (hash21(vec2(seed, k + 0.5)) - 0.5) * DOT_CURVE;
    vec2 ctrl = mid + perp * curveAmt;
    vec2 pos = mix(mix(a, ctrl, localT), mix(ctrl, b, localT), localT);
    float opacity = sin(3.14159265 * localT) * (0.55 + 0.45 * uBeatPulse);
    float d = length(p - pos);
    float core = smoothstep(DOT_RADIUS, DOT_RADIUS * 0.25, d);
    dotAccum += core * max(opacity, 0.0);
  }
  float energyGate = smoothstep(0.0, 0.35, uEnergy);
  color = mix(color, DOT_COLOR, clamp(dotAccum, 0.0, 1.0) * uDotsBrightness * energyGate);

  // 5. Floaters: an always-on ambient baseline plus wave bursts on top
  // (see createWavePool in sky.ts) — both drawn from floaterPos, the
  // bursts additionally gated by their own age envelope.
  int ambientCap = int(clamp(mix(3.0, float(FLOATER_AMBIENT_MAX), uDetail), 1.0, float(FLOATER_AMBIENT_MAX)) + 0.5);
  float ambientGate = clamp(uFloaterDensity * (0.7 + 0.3 * uSectionIntensity), 0.0, 1.0);
  int ambientActive = int(float(ambientCap) * ambientGate + 0.5);
  float floatAccum = 0.0;
  for (int i = 0; i < FLOATER_AMBIENT_MAX; i++) {
    if (i >= ambientActive) break;
    float seed = float(i) * 7.9 + 1.0;
    vec2 pos = floaterPos(seed, uTime);
    float d = length(p - pos);
    floatAccum += smoothstep(FLOATER_RADIUS, FLOATER_RADIUS * 0.2, d);
  }
  int perBurstCap = int(clamp(mix(2.0, float(FLOATER_PER_BURST_MAX), uDetail), 1.0, float(FLOATER_PER_BURST_MAX)) + 0.5);
  for (int b = 0; b < MAX_WAVE_BURSTS_C; b++) {
    float age = uTime - uBurstT0[b];
    if (age < 0.0 || age > WAVE_LIFE_SEC_C) continue;
    int subActive = int(float(perBurstCap) * clamp(uBurstAmp[b], 0.0, 1.0) * clamp(uWaveStrength, 0.0, 1.0) + 0.5);
    float envelope = smoothstep(0.0, WAVE_FADE_IN, age) * (1.0 - smoothstep(WAVE_LIFE_SEC_C - WAVE_FADE_OUT, WAVE_LIFE_SEC_C, age));
    for (int j = 0; j < FLOATER_PER_BURST_MAX; j++) {
      if (j >= subActive) break;
      float seed = uBurstSeed[b] * 31.7 + float(j) * 9.3 + 5.0;
      vec2 pos = floaterPos(seed, uTime);
      float d = length(p - pos);
      floatAccum += smoothstep(FLOATER_RADIUS, FLOATER_RADIUS * 0.2, d) * envelope;
    }
  }
  color = mix(color, FLOATER_COLOR, clamp(floatAccum, 0.0, 1.0) * FLOATER_ALPHA);

  outColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;
}

function createSkyScene(): Scene {
  let displayProg: GLProgram | null = null;
  let quadVao: WebGLVertexArrayObject | null = null;
  let sim: FluidSim | null = null;
  let dyeLoc: WebGLUniformLocation | null = null;
  let wavePool: WavePool | null = null;
  const bandsBuf = new Float32Array(NUM_BANDS);
  const drifterSplats: Splat[] = DRIFTER_SEEDS.map(() => ({
    x: 0.5,
    y: 0.5,
    sigma: DRIFTER_SIGMA,
    fx: 0,
    fy: 0,
    dye: 0,
    tag: 0,
    ring: 0,
  }));

  let ambientT = 0;
  let brushPhase = 0;
  let timeSinceWave = WAVE_FALLBACK_MAX_SEC * 10; // clear of the fallback on the very first frame
  let waveSeedCounter = 0;
  let lastFrameTime: number | null = null;

  return {
    id: ID,
    name: "Sky",
    settings: SETTINGS,

    init(ctx: SceneContext) {
      const { gl } = ctx;
      quadVao = createFullscreenQuad(gl);
      const format = detectSimFormat(gl);
      const initSize = simResolutionFor(
        ctx.quality.detail,
        Math.max(1, gl.drawingBufferWidth),
        Math.max(1, gl.drawingBufferHeight),
        MIRROR_OFF,
      );
      sim = createFluidSim(gl, quadVao, initSize, format);
      displayProg = createProgram(gl, buildDisplayFrag(format));
      dyeLoc = gl.getUniformLocation(displayProg.program, "uDye");
      wavePool = createWavePool();

      ambientT = 0;
      brushPhase = 0;
      timeSinceWave = WAVE_FALLBACK_MAX_SEC * 10;
      waveSeedCounter = 0;
      lastFrameTime = null;
    },

    render(ctx, frame, viewport, palette, anim) {
      if (!displayProg || !quadVao || !sim || !wavePool) return;
      const { gl } = ctx;

      const dt = lastFrameTime === null ? 1 / 60 : Math.max(0, Math.min(0.1, frame.time - lastFrameTime));
      lastFrameTime = frame.time;

      // Rebuild the sim whenever the drawing buffer (or the quality
      // governor's detail) changes — same pattern as powder.ts's glow
      // targets.
      const wantSize = simResolutionFor(
        ctx.quality.detail,
        Math.max(1, gl.drawingBufferWidth),
        Math.max(1, gl.drawingBufferHeight),
        MIRROR_OFF,
      );
      if (!sameSimSize(wantSize, sim.size)) sim.resize(wantSize);

      const cloudCoverAmount = resolveSceneSetting(ID, settingFor("cloudCover"));
      const flowSpeedAmount = resolveSceneSetting(ID, settingFor("flowSpeed"));
      const turbulenceAmount = resolveSceneSetting(ID, settingFor("turbulence"));
      const waveFrequencyAmount = resolveSceneSetting(ID, settingFor("waveFrequency"));

      // Ambient cloud drift — a real-time clock, deliberately not
      // audio-reactive (see file header).
      ambientT += dt;
      for (let i = 0; i < DRIFTER_SEEDS.length; i++) {
        const seed = DRIFTER_SEEDS[i];
        const [x0, y0] = driftCenter(seed, ambientT);
        const [x1, y1] = driftCenter(seed, ambientT + DRIFT_TANGENT_EPS);
        const dx = x1 - x0;
        const dy = y1 - y0;
        const len = Math.hypot(dx, dy) || 1;
        const s = drifterSplats[i];
        s.x = x0;
        s.y = y0;
        s.fx = (dx / len) * DRIFTER_FORCE * (0.5 + flowSpeedAmount);
        s.fy = (dy / len) * DRIFTER_FORCE * (0.5 + flowSpeedAmount);
        s.dye = DRIFTER_DYE_RATE * (0.25 + 0.75 * cloudCoverAmount);
      }

      const simDt = Math.min(SIM_DT_MAX, dt * (0.5 + 1.5 * flowSpeedAmount));
      sim.step({
        dt: simDt,
        curl: turbulenceAmount,
        dissipation: DYE_DISSIPATION,
        energy: 0, // cloud drift is not audio-reactive in v1 — see file header
        viscosity: SIM_VISCOSITY,
        splats: drifterSplats,
      });

      // Floater waves — a section drop always fires one; a spontaneous one
      // fires on its own between drops at a rate Wave frequency controls,
      // so floaters arrive in waves rather than only on a drop (see file
      // header).
      timeSinceWave += dt;
      if (anim.dropOnset) {
        wavePool.trigger(anim.timeSec, waveStrengthFromDrop(anim.dropPulse, anim.sectionIntensity), waveSeedCounter++);
        timeSinceWave = 0;
      } else if (timeSinceWave > waveFallbackIntervalSec(waveFrequencyAmount)) {
        wavePool.trigger(anim.timeSec, SPONTANEOUS_WAVE_STRENGTH, waveSeedCounter++);
        timeSinceWave = 0;
      }
      wavePool.tick(anim.timeSec);

      // Haidinger's brush — a continuously increasing accumulator, never
      // anim.barPhase (see file header).
      brushPhase = advanceBrushPhase(brushPhase, dt);

      gl.disable(gl.BLEND);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      displayProg.use();
      uploadCommonUniforms(displayProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf);
      displayProg.setF("uBrushPhase", brushPhase);
      wavePool.upload(displayProg);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sim.dyeTexture());
      gl.uniform1i(dyeLoc, 0);
      drawFullscreenQuad(gl, quadVao);

      // The gallery renders every scene into one shared context each tick —
      // must not leak a bound texture onto the next tile.
      gl.bindTexture(gl.TEXTURE_2D, null);
    },

    dispose(ctx: SceneContext) {
      const { gl } = ctx;
      sim?.dispose();
      displayProg?.dispose();
      if (quadVao) gl.deleteVertexArray(quadVao);
      sim = null;
      displayProg = null;
      quadVao = null;
      dyeLoc = null;
      wavePool = null;
      lastFrameTime = null;
    },
  };
}

export const skyScene = createSkyScene();
