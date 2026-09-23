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

// Sky: a real 2D fluid sim driving cloud cover, with two vision illusions
// layered on top — floaters (in waves) and Haidinger's brush. Picked from
// the "Open Sky Illusions" preview artifact; the blue field entoptic
// phenomenon was in the first pass but cut after a live look at real
// screenshots (small darting dots read as noise rather than an atmospheric
// illusion once the cloud itself was worth looking at). Vection, Troxler
// fading, afterimage, the autokinetic effect and pareidolia are
// deliberately NOT built here either, not even as disabled settings — a
// later pass's scope, not this one's.
//
// The fluid sim (skyFluidSim.ts) is a verbatim copy of
// origin/worktree-neon-fluid's fluidSim.ts, the stable-fluids solver that
// branch built for Neon Fluid — copied rather than imported because that
// branch isn't on main, and renamed (not "fluidSim.ts") so the two copies
// are free to diverge, the same per-scene-copy pattern ink.ts/moire.ts/
// kaleido/glsl.ts already use for their own noise helpers. This scene runs
// it in MIRROR_OFF mode only — full screen, no kaleidoscope fold — the one
// path that needs no adaptation. Cloud drift is deliberately NOT
// audio-reactive: DRIFTER_SEEDS.length slow, gently meandering ambient
// splats (driftCenter, a real-time clock, never warped by anim.flowPhase or
// frame.energy — the sim step below always passes energy: 0) keep the sky
// moving on its own; the two illusions are what carry the music connection,
// matching the brief's own framing. Free-slip walls are kept as-is (no wrap
// boundary) —
// a possible follow-up, not a v1 blocker, since the drift is slow enough
// that a wall never reads as one in a normal viewing session.
//
// Display is one hand-rolled pass (not createFullscreenScene, which only
// supports a single pass with no texture of its own to sample) reading the
// sim's dyeTexture() through skyFluidSim's own simIoGlsl(format) codec —
// the same reason petri.ts hand-rolls its display pass. Compositing order,
// sky gradient at the bottom, illusions on top:
//   sky gradient -> cloud (contrast-shaped extinction blend off dye
//   density, cross-eroded by a self-written fbm bump for cauliflower
//   texture and continuous morphing, plus a cheap lit-top/shadowed-bottom
//   shade from the density gradient — a thin slab, not Storm's Gas-mode
//   raymarch, which is private to storm.ts) -> Haidinger's brush (faint,
//   blended into the sky+cloud) -> floaters (drawn last, on top of
//   everything, since they're the viewer's own eye artifact).
// The sky/cloud sample the shared room-space canvas (roomUv) since the
// fluid is one world shared across a Panorama's devices, same as every
// other world-simulating scene; the two illusions instead centre on *this
// device's own* screen (vUv, not roomUv) — each is a viewer's own eye
// artifact, not shared room content, so it has to track the screen the
// viewer is actually looking at rather than a hypothetical shared-canvas
// centre that might sit off this device's own slice entirely.
//
// Floaters are drawn as hollow, near-transparent refractive tubes
// (floaterShape), not a solid painted stroke or a soft glowing dot — a real
// floater is a strand of vitreous gel refracting the sky behind it: a faint
// bright rim on its edge, a thin dark fringe just outside that rim, and a
// barely-lifted see-through interior (floaterProfile turns the signed
// distance to the tube's own edge into that rim/fringe/interior brightness
// delta). The path itself comes from floaterPath, which integrates a
// heading forward at a fixed step rather than offsetting each point
// sideways by an independent function of t, so the strand's arc length
// always comes out exactly right and a sharp corner can't form — see
// floaterPath's own comment. floaterShape's dot branch (FLOATER_DOT_CHANCE
// of seeds) reads the identical profile around a filled disk instead of a
// tube — a measured real floater dot turned out to have the same rim/fringe
// shape, just circular. The shape itself is fixed per seed (no time
// dependency in floaterShape), only its anchor position drifts (floaterPos);
// both the ambient baseline and the wave bursts below draw from the same
// floaterShape/floaterPos pair, evaluated per-fragment as pure functions of
// (uTime, seed) — no vertex buffers, no per-floater JS state, in the spirit
// of the plan's "a handful of trig/hash per slot" budget. A bounding-circle
// early-out in floaterShape skips the per-segment distance loop for
// fragments nowhere near a given floater. Loop bounds (FLOATER_AMBIENT_MAX /
// FLOATER_PER_BURST_MAX below) are sized for the highest quality tier and
// compiled once; how many of those slots are actually drawn is gated at
// runtime by uDetail (quality.ts's 0..1 density proxy, already uploaded)
// combined with the relevant setting, so a lower tier or TV hardware gets an
// explicit, bounded ceiling without a second shader variant.
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
const FLOATER_AMBIENT_MAX = 10; // lowered from v3's 18 — strands are now 3-4x longer (FLOATER_LEN_MIN/MAX below), so the same count reads as a crowded frame
const FLOATER_PER_BURST_MAX = 10;
export const MAX_WAVE_BURSTS = 3; // concurrent floater waves — mirrors powder.ts's MAX_BURSTS

// --- Fluid sim tuning. Fixed rather than exposed as settings — the plan's
// settings list is representative, not exhaustive, and these aren't part of
// either illusion. Dye rate raised and dissipation lowered from the first
// pass, which built up too thin and too slowly to read as real cloud cover
// against a real-sky reference (a still frame of open sky runs 40-50% cloud
// coverage with a near-white core, not the soft low-alpha wash the first
// pass produced). ---
const SIM_VISCOSITY = 0.3;
const DYE_DISSIPATION = 0.22;
const SIM_DT_MAX = 1 / 30; // clamps a slow-frame dt so the sim never destabilises

// --- Ambient cloud drift (not audio-reactive — see file header). A third
// seed (was two) so the cover reads as a few distinct masses rather than
// one blob orbiting the centre. ---
const DRIFTER_SEEDS: readonly number[] = [1.7, 5.3, 9.1];
const DRIFT_TANGENT_EPS = 0.08; // finite-difference step used only to find the drift's own heading
const DRIFTER_SIGMA = 0.16; // splat radius, sim uv
const DRIFTER_FORCE = 5; // texels/s^2 at FORCE_REF_ROWS — see skyFluidSim.ts's header
const DRIFTER_DYE_RATE = 0.85; // density/s at the splat centre, before Cloud cover scales it

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

const int FLOATER_AMBIENT_MAX = ${FLOATER_AMBIENT_MAX};
const int FLOATER_PER_BURST_MAX = ${FLOATER_PER_BURST_MAX};
const int MAX_WAVE_BURSTS_C = ${MAX_WAVE_BURSTS};
const float WAVE_LIFE_SEC_C = ${WAVE_LIFE_SEC.toFixed(3)};
const float WAVE_FADE_IN = ${WAVE_FADE_IN_SEC.toFixed(3)};
const float WAVE_FADE_OUT = ${WAVE_FADE_OUT_SEC.toFixed(3)};

const float CLOUD_LOW = 0.22; // bumped density below this reads as clear sky
const float CLOUD_HIGH = 0.38; // bumped density above this reads as a solid, opaque cloud body
const float CLOUD_BUMP_SCALE = 11.0; // fbm frequency, room-uv units — the cauliflower texture
const float CLOUD_BUMP_MORPH = 0.05; // fbm domain drift per second — churn beyond plain advection
const float CLOUD_BUMP_AMOUNT = 0.65; // how hard the bump noise erodes/thickens the edge
// A fixed 2D "sun" direction and two shadow taps along it — storm.ts's Gas
// mode's own two-tap technique (SUN_DIR + densityCheap/shape at 0.18/0.5,
// exp(-1.9*s1-1.15*s2), mixed as a colour ramp not a brightness scalar),
// ported from its 3D raymarch to a plain 2D density lookup. A single
// adjacent-texel check (the first pass's own shadeAmt) only ever sees
// edges; a wide cloud's flat interior has no local gradient at that scale,
// which is why v1 read as one flat tone instead of a folded mass.
const vec2 CLOUD_LIGHT_DIR = vec2(0.53, 0.848);
const float CLOUD_SHADOW_TAP1 = 0.045;
const float CLOUD_SHADOW_TAP2 = 0.095;
// Calibrated against this scene's own measured density range (median ~0.8,
// p90 ~1.65 inside the cloud silhouette — much higher than storm.ts's own
// 3D density scale, which is why its 1.9/1.15 weights collapsed shadow to
// ~0 almost everywhere here on the first try, read directly off a debug
// render rather than re-guessed blind).
const float CLOUD_SHADOW_K1 = 0.85;
const float CLOUD_SHADOW_K2 = 0.52;
const float BRUSH_R_CORE = 0.03;
const float BRUSH_R_IN = 0.22;
const float BRUSH_R_OUT = 0.34;
const float BRUSH_BASE = 0.4;
const int FLOATER_SEGMENTS = 14; // path points per floater's curved body (head at index 0) — see floaterPath; raised from v3's 9 for a smoother heading-integrated curve
const float FLOATER_SPAN = 1.3;
const float FLOATER_DRIFT_R = 0.05;
const float FLOATER_JUMP_MIN = 2.0;
const float FLOATER_JUMP_MAX = 5.0;
const float FLOATER_JUMP_EASE = 0.35;
const float FLOATER_LEN_MIN = 0.18; // strand arc length, screen p-units, hashed per seed — measured against the reference at ~0.25-0.35; v3's fixed 0.085 read 3-4x too short
const float FLOATER_LEN_MAX = 0.32;
// floaterPath's heading theta(t) = theta0 + B1*sin(2*pi*f1*t+p1) +
// B2*sin(2*pi*f2*t+p2): a dominant gentle bend (B1/f1) plus a much smaller,
// faster wobble (B2/f2), all hashed once per seed. Because heading is
// integrated forward rather than offsetting each point sideways by an
// independent function of t, arc length always comes out to exactly the
// strand's own FLOATER_LEN_* and the bend rate stays bounded — a real
// side-by-side against the reference showed v2/v3's per-point-independent
// kinks read as an angular zigzag, not the reference's smooth curve; this
// can't produce a corner at all.
const float FLOATER_B1_MIN = 0.6; // dominant bend swing, radians (random sign per seed)
const float FLOATER_B1_MAX = 1.3;
const float FLOATER_F1_MIN = 0.5; // dominant bend's cycles over the strand
const float FLOATER_F1_MAX = 1.0;
const float FLOATER_B2_MIN = 0.1; // secondary wobble, radians — kept subtle; texture, not a second kink
const float FLOATER_B2_MAX = 0.2;
const float FLOATER_F2_MIN = 3.0;
const float FLOATER_F2_MAX = 5.0;
// The refractive-tube profile (floaterProfile below), measured off a
// brightness cross-section of the reference at sky luminance ~172: a thin
// dark fringe just outside the edge, a brighter rim just inside it, and a
// barely-lifted see-through interior, everything within about +-10% of the
// background — never a solid painted line.
const float FLOATER_R = 0.011; // squiggle tube half-width, screen p-units — sized so rim-to-rim spacing matches the reference (~0.017 of screen height between the two bright rims)
const float FLOATER_RIM_W = 0.005; // bright-rim band width, just inside the edge
const float FLOATER_FRINGE_W = 0.008; // dark-fringe band width, just outside the edge
const float FLOATER_INTERIOR = 0.02; // relative lum delta well inside the edge
const float FLOATER_RIM = 0.07; // relative lum delta at the rim's peak
const float FLOATER_FRINGE = 0.10; // relative lum delta (negative) at the fringe's peak
const float FLOATER_DOT_CHANCE = 0.4; // fraction of floaters that render as a filled disk instead of a squiggle (was FLOATER_RING_CHANCE — a measured dot turned out to be a filled disk, not an annulus, under the same rim/fringe profile)
const float FLOATER_DOT_R_MIN = 0.015; // dot radius, screen p-units — reference rim radius ~0.021
const float FLOATER_DOT_R_MAX = 0.026;
const vec3 FLOATER_COOL_TINT = vec3(0.94, 0.99, 1.06); // faint cool bias applied only to the rim's brightening (see main()) — a hint of refraction's blue-white; the fringe's darkening stays neutral

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

// Value-noise fbm for the cloud's bump texture only — this scene's own,
// independently written (not shared with ink.ts/moire.ts/kaleido's own fbm
// functions; see the file header on the per-scene-copy pattern this repo
// already uses for noise).
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm2(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 3; i++) {
    sum += amp * vnoise(p);
    p *= 2.02;
    amp *= 0.5;
  }
  return sum;
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

// Signed relative-luminance delta for a point at true signed distance s from
// a floater's own edge (negative inside, screen p-units) — the
// refractive-tube profile the constants above are measured against: a small
// lift deep inside (FLOATER_INTERIOR), rising through a bright rim just
// inside the edge (FLOATER_RIM, peaking at s = -FLOATER_RIM_W/2) into a dark
// fringe just outside it (FLOATER_FRINGE, peaking at s = FLOATER_FRINGE_W/2),
// fading smoothly to exactly 0 by s = FLOATER_FRINGE_W*2.0. Shared by
// floaterShape's squiggle and dot branches — they differ only in how s is
// computed. Built as a sum of two Gaussian-like bumps (rim, fringe) plus an
// interior term that's flat for s well below -FLOATER_RIM_W and fades out
// smoothly as s approaches the edge, not as separate hard-edged bands — the
// reference itself is a little soft, not a vector outline.
float floaterProfile(float s) {
  float interior = FLOATER_INTERIOR * (1.0 - smoothstep(-FLOATER_RIM_W, 0.0, s));
  float rimD = (s + FLOATER_RIM_W * 0.5) / (FLOATER_RIM_W * 0.5);
  float rim = FLOATER_RIM * exp(-rimD * rimD);
  float fringeD = (s - FLOATER_FRINGE_W * 0.5) / (FLOATER_FRINGE_W * 0.5);
  float fringe = -FLOATER_FRINGE * exp(-fringeD * fringeD);
  float cutoff = 1.0 - smoothstep(FLOATER_FRINGE_W, FLOATER_FRINGE_W * 2.0, s);
  return (interior + rim + fringe) * cutoff;
}

// This floater's own strand length, hashed once per seed — split out from
// floaterPath so floaterShape can bound-check a fragment against it before
// paying for the FLOATER_SEGMENTS-point path build and distance loop (see
// floaterShape's own comment).
float floaterLen(float seed) {
  return mix(FLOATER_LEN_MIN, FLOATER_LEN_MAX, hash21(vec2(seed, 25.0)));
}

// Builds this floater's whole curved path into 'pts' (head at index 0,
// FLOATER_SEGMENTS points), by integrating a heading forward at a fixed step
// rather than offsetting each point sideways by an independent function of
// t — see the FLOATER_B1_MIN..FLOATER_F2_MAX comment above for why. 'pts' is
// then re-centred on its own average so the strand's MIDDLE sits at the
// local origin: floaterShape adds basePos (floaterPos's anchor) straight
// onto these points, so the anchor drifts the strand's centre, not its head.
void floaterPath(float seed, out vec2 pts[FLOATER_SEGMENTS]) {
  float len = floaterLen(seed);
  float thetaSign = hash21(vec2(seed, 26.0)) < 0.5 ? -1.0 : 1.0;
  float b1 = thetaSign * mix(FLOATER_B1_MIN, FLOATER_B1_MAX, hash21(vec2(seed, 21.0)));
  float f1 = mix(FLOATER_F1_MIN, FLOATER_F1_MAX, hash21(vec2(seed, 27.0)));
  float p1 = hash21(vec2(seed, 22.0)) * 6.28318;
  float b2 = mix(FLOATER_B2_MIN, FLOATER_B2_MAX, hash21(vec2(seed, 28.0)));
  float f2 = mix(FLOATER_F2_MIN, FLOATER_F2_MAX, hash21(vec2(seed, 23.0)));
  float p2 = hash21(vec2(seed, 24.0)) * 6.28318;
  float theta0 = hash21(vec2(seed, 8.0)) * 6.28318;
  float stepLen = len / float(FLOATER_SEGMENTS - 1);
  pts[0] = vec2(0.0);
  for (int i = 1; i < FLOATER_SEGMENTS; i++) {
    // Heading sampled at the segment's own midpoint t — a midpoint-rule
    // integration of theta(t), not just its start or end.
    float tMid = (float(i) - 0.5) / float(FLOATER_SEGMENTS - 1);
    float theta = theta0 + b1 * sin(6.28318 * f1 * tMid + p1) + b2 * sin(6.28318 * f2 * tMid + p2);
    pts[i] = pts[i - 1] + stepLen * vec2(cos(theta), sin(theta));
  }
  vec2 sum = vec2(0.0);
  for (int i = 0; i < FLOATER_SEGMENTS; i++) sum += pts[i];
  vec2 mid = sum / float(FLOATER_SEGMENTS);
  for (int i = 0; i < FLOATER_SEGMENTS; i++) pts[i] -= mid;
}

// One floater's signed relative-luminance delta at p: a hollow refractive
// tube along a curved path (floaterPath), or — FLOATER_DOT_CHANCE of seeds —
// a filled disk, both read through floaterProfile off their own signed
// distance to the edge (squiggle: distance to the path's capsule SDF, minus
// FLOATER_R; dot: distance to basePos, minus its own hashed radius). A
// measured real reference showed two floater families side by side,
// elongated squiggles AND round dots (aspect ratios ~1.6-1.9 vs ~1.0), both
// sharing the exact same rim/fringe brightness shape. A bounding-circle
// early-out (basePos +/- half the strand's own length, since floaterPath
// centres its points on it) skips the FLOATER_SEGMENTS-point path build and
// distance loop for fragments nowhere near this floater — see the file
// header's per-slot budget.
float floaterShape(vec2 p, float seed, float t) {
  vec2 basePos = floaterPos(seed, t);
  if (hash21(vec2(seed, 13.0)) < FLOATER_DOT_CHANCE) {
    float dotR = mix(FLOATER_DOT_R_MIN, FLOATER_DOT_R_MAX, hash21(vec2(seed, 15.0)));
    float s = length(p - basePos) - dotR;
    if (s > FLOATER_FRINGE_W * 2.0) return 0.0;
    return floaterProfile(s);
  }
  float len = floaterLen(seed);
  if (length(p - basePos) > len * 0.5 + FLOATER_R + FLOATER_FRINGE_W * 2.0) return 0.0;
  vec2 pts[FLOATER_SEGMENTS];
  floaterPath(seed, pts);
  vec2 pLocal = p - basePos;
  float dMin = 1.0e6;
  for (int i = 1; i < FLOATER_SEGMENTS; i++) {
    vec2 pa = pLocal - pts[i - 1];
    vec2 ba = pts[i] - pts[i - 1];
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1.0e-6), 0.0, 1.0);
    float d = length(pa - ba * h);
    dMin = min(dMin, d);
  }
  return floaterProfile(dMin - FLOATER_R);
}

void main() {
  vec2 uv = roomUv(vUv);
  // The two illusions live in this device's own screen space, not the
  // shared room canvas — see the file header on why.
  float devAspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 p = (vUv - 0.5) * vec2(devAspect, 1.0);

  // 1. Sky: a vertical gradient, Sky tint walking it from cool blue toward
  // a warm dusk. Lightened and desaturated against a measured real-sky
  // photo whose open-sky patch came out a very pale, low-saturation blue
  // (hue~179/255, sat~14/255) — the first pass's zenith was a fairly deep,
  // saturated navy, nothing like that hazy, high-key look.
  vec3 zenithCool = vec3(0.42, 0.56, 0.74);
  vec3 zenithWarm = vec3(0.55, 0.42, 0.48);
  vec3 horizonCool = vec3(0.74, 0.82, 0.92);
  vec3 horizonWarm = vec3(0.88, 0.74, 0.64);
  vec3 zenith = mix(zenithCool, zenithWarm, uSkyTint);
  vec3 horizon = mix(horizonCool, horizonWarm, uSkyTint);
  vec3 color = mix(horizon, zenith, smoothstep(-0.1, 0.9, uv.y));

  // 2. Cloud cover: the sim's own dye density thresholded (CLOUD_LOW/HIGH)
  // rather than blended with a plain extinction curve — a gain/gamma remap
  // on a smooth density field stays smooth no matter how it's curved, so it
  // never grows a real edge; only an actual threshold does. A slowly
  // time-drifting fbm (CLOUD_BUMP_*) eats into the density's own edge for
  // the cauliflower bump texture and keeps the shape visibly morphing
  // beyond plain advection, the same "erode a silhouette with noise" idea
  // as Storm's Gas mode (storm.ts), independently written per the file
  // header.
  //
  // Shading is Storm's own two-tap sun-shadow technique (CLOUD_LIGHT_DIR/
  // CLOUD_SHADOW_TAP1-2/CLOUD_SHADOW_K1-2 above), ported from its 3D
  // raymarch to a plain 2D density lookup: sample density toward a fixed
  // light direction at two distances, run it through Beer's law, and use
  // the result to pick a point on a colour ramp (mix), not as a brightness
  // multiplier. The first pass's shading only compared immediate neighbour
  // texels, which sees an edge but nothing in a wide cloud's flat interior —
  // this reaches far enough across the body to shade actual folds.
  float density = max(decodeDye(texture(uDye, uv)).x, 0.0);
  float bump = fbm2(uv * CLOUD_BUMP_SCALE + vec2(uTime * CLOUD_BUMP_MORPH, uTime * CLOUD_BUMP_MORPH * 0.6));
  float bumped = density * mix(1.0 - CLOUD_BUMP_AMOUNT, 1.0 + CLOUD_BUMP_AMOUNT, bump);
  float cloudAlpha = smoothstep(CLOUD_LOW, CLOUD_HIGH, bumped);
  float sunNear = max(decodeDye(texture(uDye, uv + CLOUD_LIGHT_DIR * CLOUD_SHADOW_TAP1)).x, 0.0);
  float sunFar = max(decodeDye(texture(uDye, uv + CLOUD_LIGHT_DIR * CLOUD_SHADOW_TAP2)).x, 0.0);
  float shadow = exp(-CLOUD_SHADOW_K1 * sunNear - CLOUD_SHADOW_K2 * sunFar);
  // Pale cool lavender-grey to warm white — measured off a real hazy-cumulus
  // photo (shadow-fold RGB≈(156,151,172)/255, highlight RGB≈(255,255,254)/255)
  // rather than the first pass's guessed, noticeably darker shadow tone.
  vec3 cloudShadow = vec3(0.6, 0.59, 0.67);
  vec3 cloudLit = vec3(1.0, 0.99, 0.96);
  vec3 cloudColor = mix(cloudShadow, cloudLit, shadow) * (0.85 + 0.3 * uCloudBrightness);
  color = mix(color, cloudColor, cloudAlpha);

  // 3. Haidinger's brush: a faint bowtie centred on the fixation point,
  // rotating on uBrushPhase — under/with the sky+cloud, per the file
  // header's compositing order, so it never sits on top of the floaters.
  float r = length(p);
  float ang = atan(p.y, p.x) - uBrushPhase;
  float lobe = cos(2.0 * ang);
  float radial = smoothstep(0.0, BRUSH_R_CORE, r) * smoothstep(BRUSH_R_OUT, BRUSH_R_IN, r);
  vec3 brushTint = mix(vec3(0.82, 0.85, 1.05), vec3(1.05, 0.98, 0.82), lobe * 0.5 + 0.5);
  float brushAmt = clamp(uBrushOpacity * BRUSH_BASE * radial * abs(lobe) * (1.0 - 0.4 * uEnergy), 0.0, 1.0);
  color = mix(color, color * brushTint, brushAmt);

  // 4. Floaters: an always-on ambient baseline plus wave bursts on top (see
  // createWavePool in sky.ts), both drawn from floaterShape as one signed
  // relative-luminance delta per slot (dark fringe negative, bright rim
  // positive, interior a small positive lift — see floaterProfile), the
  // bursts additionally gated by their own age envelope. Every slot's delta
  // sums into floatDelta, clamped, then applied as a multiplicative
  // modulation of whatever's already in 'color' rather than mixed toward a
  // fixed tint or added as glow, so a floater reads as a refraction of the
  // sky/cloud behind it and never becomes the brightest thing in frame.
  int ambientCap = int(clamp(mix(3.0, float(FLOATER_AMBIENT_MAX), uDetail), 1.0, float(FLOATER_AMBIENT_MAX)) + 0.5);
  float ambientGate = clamp(uFloaterDensity * (0.7 + 0.3 * uSectionIntensity), 0.0, 1.0);
  int ambientActive = int(float(ambientCap) * ambientGate + 0.5);
  float floatDelta = 0.0;
  for (int i = 0; i < FLOATER_AMBIENT_MAX; i++) {
    if (i >= ambientActive) break;
    float seed = float(i) * 7.9 + 1.0;
    floatDelta += floaterShape(p, seed, uTime);
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
      floatDelta += floaterShape(p, seed, uTime) * envelope;
    }
  }
  floatDelta = clamp(floatDelta, -0.2, 0.2);
  float floatPos = max(floatDelta, 0.0);
  color *= 1.0 + min(floatDelta, 0.0) + floatPos * FLOATER_COOL_TINT;

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
