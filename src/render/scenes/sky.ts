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
// dependency in floaterShape).
//
// Floaters only exist inside waves — there is no always-on baseline — and
// they don't move like real floaters (no saccade jumps). Each wave is a
// *swarm*: many tiny floaters laid out in a few hashed clumps (floaterOffset),
// drifting together on a slow wind and gently churning in place, so the whole
// wave reads as a small cloud made of floaters. Swarms keep off the real
// clouds twice over: render() spawns each one at the clearest of a handful of
// candidate spots (pickSwarmCenter, scored against the cloud drifters'
// current centres), and in the shader any floater whose own centre sits over
// cloud (cloudBumpedAt, the exact field the cloud pass thresholds) fades
// out, with a per-pixel cloudAlpha backstop. Everything is evaluated
// per-fragment as pure functions of (uTime, burst) — no vertex buffers, no
// per-floater JS state. A swarm-level bounding circle skips whole waves for
// fragments nowhere near them, and floaterShape's own bounding circle skips
// the per-segment distance loop for fragments nowhere near a given floater.
// The loop bound (FLOATER_PER_BURST_MAX below) is sized for the highest
// quality tier and compiled once; how many of those slots are actually drawn
// is gated at runtime by uDetail (quality.ts's 0..1 density proxy) combined
// with the Floaters setting, so a lower tier gets an explicit, bounded
// ceiling without a second shader variant.
//
// Floater waves reuse powder.ts's stateless chunk-pool idiom
// (createWavePool below): a small JS pool of (t0, strength, seed, x, y)
// slots, uploaded as flat uniform arrays (uBurstT0/uBurstAmp/uBurstSeed/
// uBurstX/uBurstY — named distinctly from the "Wave strength" *setting*'s
// own auto-generated uWaveStrength uniform, the collision ambience.ts's
// header flags), each slot's whole swarm evaluated analytically from its age
// in the shader. A burst fires on anim.dropOnset (graded locally from
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
const FLOATER_PER_BURST_MAX = 32; // floaters in one wave's swarm at the top tier
export const MAX_WAVE_BURSTS = 3; // concurrent floater waves — mirrors powder.ts's MAX_BURSTS

// --- Fluid sim tuning. Fixed rather than exposed as settings — the plan's
// settings list is representative, not exhaustive, and these aren't part of
// either illusion. Dye rate raised and dissipation lowered from the first
// pass, which built up too thin and too slowly to read as real cloud cover
// against a real-sky reference (a still frame of open sky runs 40-50% cloud
// coverage with a near-white core, not the soft low-alpha wash the first
// pass produced). ---
const SIM_VISCOSITY = 0.3;
const DYE_DISSIPATION = 0.34; // high enough that old puffs thin out instead of piling into one mass
const SIM_DT_MAX = 1 / 30; // clamps a slow-frame dt so the sim never destabilises

// --- Ambient cloud drift (not audio-reactive — see file header). Many small
// sources, each wandering around its own home spot spread across the whole
// frame (driftCenter) and puffing on and off (drifterPuff), so the cover
// reads as separate airy puffs scattered over the sky. Three big sources
// orbiting the centre, fed continuously, merged into one central blob. ---
const DRIFTER_SEEDS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const DRIFT_TANGENT_EPS = 0.08; // finite-difference step used only to find the drift's own heading
const DRIFTER_SIGMA_MIN = 0.045; // splat radius range, sim uv — varied per seed so puffs aren't all one size
const DRIFTER_SIGMA_MAX = 0.085;
const DRIFTER_FORCE = 10; // texels/s^2 at FORCE_REF_ROWS — see skyFluidSim.ts's header; strong enough that the flow shears puffs into drifting shapes rather than leaving round balls where they were laid
const DRIFTER_DYE_RATE = 1.05; // density/s at the splat centre while puffing, before Cloud cover scales it
const DRIFTER_PUFF_RATE = 0.45; // rad/s of each source's on/off cycle (~14s per puff) — a long "on" phase grows one puff into a big blob

// --- Floater waves. ---
export const WAVE_LIFE_SEC = 16; // long enough for a swarm to visibly drift across part of the sky
export const WAVE_DEAD_T0 = -1e9;
const WAVE_FADE_IN_SEC = 1.2; // one floater's own fade-in, from its staggered birth (see the swarm loop in the shader)
const WAVE_FADE_OUT_SEC = 1.8; // one floater's own fade-out, ending at its staggered death
const SPONTANEOUS_WAVE_STRENGTH = 0.5;
const WAVE_FALLBACK_MIN_SEC = 8; // shortest spontaneous-wave gap, at Wave frequency = 1
const WAVE_FALLBACK_MAX_SEC = 26; // longest gap, at Wave frequency = 0 — the sky is sometimes empty of floaters between waves
const SWARM_CANDIDATES = 12; // spawn spots pickSwarmCenter scores against the cloud drifters

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

/** The ambient drift's own slow meander, in sim uv space: each seed owns a
 *  home spot (golden-ratio / sqrt(2) low-discrepancy sequences, so
 *  consecutive integer seeds land evenly spread over the whole frame rather
 *  than clumped) and wanders a small
 *  Lissajous-ish loop around it. Pure and deterministic so it's testable
 *  without a GL context. render() also samples this at
 *  `tSec + DRIFT_TANGENT_EPS` to get a finite-difference heading for the
 *  splat's push direction. Stays within [0.04, 0.96] x [0.06, 0.94] — near
 *  enough to the edges that the sides of the frame get cloud too. */
export function driftCenter(seed: number, tSec: number): [number, number] {
  const s = Number.isFinite(seed) ? seed : 0;
  const t = Number.isFinite(tSec) ? tSec : 0;
  const fract = (v: number) => v - Math.floor(v);
  const hx = 0.1 + 0.8 * fract(0.1 + s * 0.6180339887);
  const hy = 0.12 + 0.76 * fract(0.35 + s * 0.4142135624);
  const a1 = 0.05 + (Math.abs(s * 0.017) % 0.02);
  const a2 = 0.07 + (Math.abs(s * 0.013) % 0.02);
  const x = hx + 0.06 * Math.sin(t * a1 + s * 2.1) * Math.cos(t * a2 * 0.6 + s);
  const y = hy + 0.06 * Math.cos(t * a2 + s * 1.3);
  return [x, y];
}

/** 0..1 dye gate for one source at time t: each seed breathes on and off on
 *  its own phase, so a source lays down separate puffs that drift apart
 *  instead of one continuous stream. */
export function drifterPuff(seed: number, tSec: number): number {
  const s = Number.isFinite(seed) ? seed : 0;
  const t = Number.isFinite(tSec) ? tSec : 0;
  const w = 0.5 + 0.5 * Math.sin(t * DRIFTER_PUFF_RATE * (0.8 + 0.07 * s) + s * 3.7);
  const e = clamp01((w - 0.35) / 0.4);
  return e * e * (3 - 2 * e);
}

/** Where a new floater swarm spawns, in screen uv: the clearest of
 *  SWARM_CANDIDATES hashed spots, i.e. the one farthest from every obstacle
 *  (the cloud drifters' current centres — clouds form around them). Pure
 *  and deterministic per seed, so it's testable without a GL context. The
 *  shader's per-floater cloud fade covers whatever this heuristic misses. */
export function pickSwarmCenter(seed: number, obstacles: readonly (readonly [number, number])[]): [number, number] {
  const s = Number.isFinite(seed) ? seed : 0;
  const fract = (v: number) => v - Math.floor(v);
  let best: [number, number] = [0.5, 0.5];
  let bestScore = -Infinity;
  for (let i = 0; i < SWARM_CANDIDATES; i++) {
    const x = 0.15 + 0.7 * fract(Math.sin(s * 12.9898 + i * 78.233) * 43758.5453);
    const y = 0.2 + 0.6 * fract(Math.sin(s * 39.3468 + i * 11.135) * 24634.6345);
    let score = Infinity;
    for (const [ox, oy] of obstacles) score = Math.min(score, Math.hypot(x - ox, y - oy));
    if (score > bestScore) {
      bestScore = score;
      best = [x, y];
    }
  }
  return best;
}

/** One live floater wave: when it started, how hard (0..1, from
 *  waveStrengthFromDrop or the spontaneous trigger), the seed its swarm's
 *  layout hashes from, and where it spawned (screen uv, from
 *  pickSwarmCenter). Same stateless-pool idiom as powder.ts's
 *  createChunkPool — see this file's header. */
export interface WaveBurst {
  t0: number;
  strength: number;
  seed: number;
  x: number;
  y: number;
}

export interface WavePool {
  /** Starts a wave at screen uv (x, y), reusing a dead slot or displacing
   *  the oldest live one. */
  trigger(nowSec: number, strength: number, seed: number, x?: number, y?: number): void;
  /** Retires every wave older than WAVE_LIFE_SEC. */
  tick(nowSec: number): void;
  /** How many waves are currently live. */
  alive(): number;
  /** Uploads the pool as uBurstT0/uBurstAmp/uBurstSeed/uBurstX/uBurstY. */
  upload(prog: GLProgram): void;
  /** The raw slots, for tests. */
  readonly bursts: readonly WaveBurst[];
}

export function createWavePool(): WavePool {
  const bursts: WaveBurst[] = [];
  for (let i = 0; i < MAX_WAVE_BURSTS; i++) bursts.push({ t0: WAVE_DEAD_T0, strength: 0, seed: 0, x: 0.5, y: 0.5 });
  const t0Buf = new Float32Array(MAX_WAVE_BURSTS);
  const ampBuf = new Float32Array(MAX_WAVE_BURSTS);
  const seedBuf = new Float32Array(MAX_WAVE_BURSTS);
  const xBuf = new Float32Array(MAX_WAVE_BURSTS);
  const yBuf = new Float32Array(MAX_WAVE_BURSTS);

  return {
    bursts,
    trigger(nowSec, strength, seed, x = 0.5, y = 0.5): void {
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
      b.x = Number.isFinite(x) ? x : 0.5;
      b.y = Number.isFinite(y) ? y : 0.5;
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
        xBuf[i] = b.x;
        yBuf[i] = b.y;
      }
      prog.setFv("uBurstT0", t0Buf);
      prog.setFv("uBurstAmp", ampBuf);
      prog.setFv("uBurstSeed", seedBuf);
      prog.setFv("uBurstX", xBuf);
      prog.setFv("uBurstY", yBuf);
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
    description: "How many floaters make up each wave's swarm — a sparse drift at the low end, a thick cloud of them at the high end",
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
    description: "How much a hard section drop swells its wave's swarm compared with a quiet spontaneous wave",
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
uniform float uBurstX[${MAX_WAVE_BURSTS}];
uniform float uBurstY[${MAX_WAVE_BURSTS}];

const int FLOATER_PER_BURST_MAX = ${FLOATER_PER_BURST_MAX};
const int MAX_WAVE_BURSTS_C = ${MAX_WAVE_BURSTS};
const float WAVE_LIFE_SEC_C = ${WAVE_LIFE_SEC.toFixed(3)};
const float WAVE_FADE_IN = ${WAVE_FADE_IN_SEC.toFixed(3)};
const float WAVE_FADE_OUT = ${WAVE_FADE_OUT_SEC.toFixed(3)};

const float CLOUD_LOW = 0.16; // bumped density below this reads as clear sky
const float CLOUD_HIGH = 0.55; // bumped density above this reads as a solid, opaque cloud body — a wide band, so edges fade through semi-transparent wisps (airy) rather than a hard cut-out
const float CLOUD_WISP_SCALE = 2.9; // second, finer bump octave, relative to CLOUD_BUMP_SCALE — frays the edges into wisps
const float CLOUD_WISP_AMOUNT = 0.35;
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
const int FLOATER_SEGMENTS = 10; // path points per floater's curved body (head at index 0) — see floaterPath; plenty for a strand this short
const float FLOATER_LEN_MIN = 0.042; // strand arc length, screen p-units, hashed per seed — every size below is the reference-matched proportions scaled down (the user wanted them far smaller than the reference crop), so rim/fringe/length keep roughly their measured ratios
const float FLOATER_LEN_MAX = 0.075;
// A wave's swarm (see the file header): SWARM_LOBES clumps hashed per wave
// within SWARM_SPREAD of the swarm centre, each floater scattered within
// SWARM_LOBE_R of its clump, the whole layout stretched SWARM_STRETCH wide
// like a cumulus. It drifts on SWARM_WIND (p-units/s, scaled by Flow speed)
// and each floater churns SWARM_CHURN around its slot so the swarm slowly
// morphs instead of sliding as a rigid stamp.
const float SWARM_LOBES = 3.0;
const vec2 SWARM_SPREAD = vec2(0.13, 0.06);
const float SWARM_LOBE_R = 0.085;
const float SWARM_STRETCH = 1.45;
const vec2 SWARM_WIND = vec2(0.018, 0.003);
const float SWARM_CHURN = 0.014;
const float SWARM_BOUND = 0.34; // conservative swarm radius for the per-wave early-out: spread + lobe + churn + half a strand + fringe, stretched (at full grow)
const float SWARM_GROW_FROM = 0.7; // layout scale at birth, easing out to 1.0 by the end of the wave — the swarm spreads as it drifts
const float SWARM_STAGGER = 0.4; // fraction of the wave's life over which floaters trickle in (and, mirrored, trickle out)
const float SWARM_HEADING_VAR = 0.9; // radians of per-swarm heading spread around the wind direction
const float FLOATER_HEADING_JITTER = 0.16; // radians of per-floater spread around its swarm's heading — small, so the strands read as aligned
// floaterPath's heading theta(t) = theta0 + B1*sin(2*pi*f1*t+p1) +
// B2*sin(2*pi*f2*t+p2): a dominant gentle bend (B1/f1) plus a much smaller,
// faster wobble (B2/f2), all hashed once per seed. Because heading is
// integrated forward rather than offsetting each point sideways by an
// independent function of t, arc length always comes out to exactly the
// strand's own FLOATER_LEN_* and the bend rate stays bounded — a real
// side-by-side against the reference showed v2/v3's per-point-independent
// kinks read as an angular zigzag, not the reference's smooth curve; this
// can't produce a corner at all.
const float FLOATER_B1_MIN = 0.3; // dominant bend swing, radians (random sign per seed) — gentle, so a swarm's strands read as parallel
const float FLOATER_B1_MAX = 0.6;
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
const float FLOATER_R = 0.0028; // squiggle tube half-width, screen p-units
const float FLOATER_RIM_W = 0.0014; // bright-rim band width, just inside the edge
const float FLOATER_FRINGE_W = 0.0022; // dark-fringe band width, just outside the edge
const float FLOATER_INTERIOR = 0.02; // relative lum delta well inside the edge
const float FLOATER_RIM = 0.07; // relative lum delta at the rim's peak
const float FLOATER_FRINGE = 0.10; // relative lum delta (negative) at the fringe's peak
const float FLOATER_DOT_CHANCE = 0.4; // fraction of floaters that render as a filled disk instead of a squiggle (was FLOATER_RING_CHANCE — a measured dot turned out to be a filled disk, not an annulus, under the same rim/fringe profile)
const float FLOATER_DOT_R_MIN = 0.004; // dot radius, screen p-units
const float FLOATER_DOT_R_MAX = 0.0068;
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

// The cloud pass's own pre-threshold field at a room uv: dye density eroded
// by the two bump octaves. Shared by the cloud pass and the floaters' "keep
// off the clouds" fade, so both agree exactly on where cloud is.
float cloudBumpedAt(vec2 uv) {
  float density = max(decodeDye(texture(uDye, uv)).x, 0.0);
  float bump = fbm2(uv * CLOUD_BUMP_SCALE + vec2(uTime * CLOUD_BUMP_MORPH, uTime * CLOUD_BUMP_MORPH * 0.6));
  float wisp = fbm2(uv * CLOUD_BUMP_SCALE * CLOUD_WISP_SCALE - vec2(uTime * CLOUD_BUMP_MORPH * 1.7, 0.0));
  return density * mix(1.0 - CLOUD_BUMP_AMOUNT, 1.0 + CLOUD_BUMP_AMOUNT, bump) * mix(1.0 - CLOUD_WISP_AMOUNT, 1.0 + CLOUD_WISP_AMOUNT, wisp);
}

// One floater's offset from its swarm's centre (screen p-units): picks one
// of the wave's SWARM_LOBES clumps (hashed from waveSeed), scatters within
// it (sqrt for an even area fill, a squared falloff biasing toward the
// clump core so edges thin out like a cloud's), stretches wide, then churns
// slowly around that slot. No saccade jumps — the swarm moves as one body.
vec2 floaterOffset(float seed, float waveSeed, float t) {
  float lobe = floor(hash21(vec2(seed, 31.0)) * SWARM_LOBES);
  vec2 lobeC = (hash22(vec2(waveSeed * 5.3 + lobe, 17.0)) - 0.5) * 2.0 * SWARM_SPREAD;
  float u = hash21(vec2(seed, 32.0));
  float r = SWARM_LOBE_R * sqrt(u) * mix(0.55, 1.0, u);
  float a = hash21(vec2(seed, 33.0)) * 6.28318;
  vec2 o = lobeC + r * vec2(cos(a), sin(a));
  o.x *= SWARM_STRETCH;
  o += SWARM_CHURN * vec2(sin(t * 0.21 + seed * 1.3), cos(t * 0.17 + seed * 2.1));
  return o;
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
// local origin: floaterShape adds basePos (its slot in the swarm) straight
// onto these points, so basePos is the strand's centre, not its head. The
// whole strand is then rotated so its chord (head to tail) points along
// 'heading' — its swarm's shared direction — which is what lines a swarm's
// strands up in parallel however each one curls along the way.
void floaterPath(float seed, float heading, out vec2 pts[FLOATER_SEGMENTS]) {
  float len = floaterLen(seed);
  float thetaSign = hash21(vec2(seed, 26.0)) < 0.5 ? -1.0 : 1.0;
  float b1 = thetaSign * mix(FLOATER_B1_MIN, FLOATER_B1_MAX, hash21(vec2(seed, 21.0)));
  float f1 = mix(FLOATER_F1_MIN, FLOATER_F1_MAX, hash21(vec2(seed, 27.0)));
  float p1 = hash21(vec2(seed, 22.0)) * 6.28318;
  float b2 = mix(FLOATER_B2_MIN, FLOATER_B2_MAX, hash21(vec2(seed, 28.0)));
  float f2 = mix(FLOATER_F2_MIN, FLOATER_F2_MAX, hash21(vec2(seed, 23.0)));
  float p2 = hash21(vec2(seed, 24.0)) * 6.28318;
  float theta0 = 0.0;
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
  vec2 chord = pts[FLOATER_SEGMENTS - 1] - pts[0];
  float turn = heading - atan(chord.y, chord.x);
  mat2 rot = mat2(cos(turn), sin(turn), -sin(turn), cos(turn));
  for (int i = 0; i < FLOATER_SEGMENTS; i++) pts[i] = rot * (pts[i] - mid);
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
float floaterShape(vec2 p, float seed, vec2 basePos, float heading) {
  if (hash21(vec2(seed, 13.0)) < FLOATER_DOT_CHANCE) {
    float dotR = mix(FLOATER_DOT_R_MIN, FLOATER_DOT_R_MAX, hash21(vec2(seed, 15.0)));
    float s = length(p - basePos) - dotR;
    if (s > FLOATER_FRINGE_W * 2.0) return 0.0;
    return floaterProfile(s);
  }
  float len = floaterLen(seed);
  if (length(p - basePos) > len * 0.5 + FLOATER_R + FLOATER_FRINGE_W * 2.0) return 0.0;
  vec2 pts[FLOATER_SEGMENTS];
  floaterPath(seed, heading, pts);
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
  float bumped = cloudBumpedAt(uv);
  float cloudAlpha = smoothstep(CLOUD_LOW, CLOUD_HIGH, bumped);
  float sunNear = max(decodeDye(texture(uDye, uv + CLOUD_LIGHT_DIR * CLOUD_SHADOW_TAP1)).x, 0.0);
  float sunFar = max(decodeDye(texture(uDye, uv + CLOUD_LIGHT_DIR * CLOUD_SHADOW_TAP2)).x, 0.0);
  float shadow = exp(-CLOUD_SHADOW_K1 * sunNear - CLOUD_SHADOW_K2 * sunFar);
  // Pale cool lavender-grey to warm white — measured off a real hazy-cumulus
  // photo (shadow-fold RGB≈(156,151,172)/255, highlight RGB≈(255,255,254)/255)
  // rather than the first pass's guessed, noticeably darker shadow tone.
  vec3 cloudShadow = vec3(0.6, 0.59, 0.67);
  vec3 cloudLit = vec3(1.0, 0.99, 0.96);
  // Thin, barely-there cloud is sunlit through, never shadowed — without
  // this, half-faded puffs blend a shadow tone into the sky and read as
  // grey smudges instead of airy haze.
  shadow = mix(1.0, shadow, smoothstep(0.0, 0.8, cloudAlpha));
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

  // 4. Floaters: wave swarms only (see the file header and createWavePool),
  // each floater drawn from floaterShape as one signed relative-luminance
  // delta (dark fringe negative, bright rim positive, interior a small
  // positive lift — see floaterProfile), gated by its wave's age envelope and
  // faded out wherever its own centre sits over cloud. Every delta sums into
  // floatDelta, clamped, then applied as a multiplicative modulation of
  // whatever's already in 'color' rather than mixed toward a fixed tint or
  // added as glow, so a floater reads as a refraction of the sky behind it
  // and never becomes the brightest thing in frame.
  int perBurstCap = int(clamp(mix(8.0, float(FLOATER_PER_BURST_MAX), uDetail), 1.0, float(FLOATER_PER_BURST_MAX)) + 0.5);
  vec2 wind = SWARM_WIND * (0.5 + uFlowSpeed);
  float floatDelta = 0.0;
  for (int b = 0; b < MAX_WAVE_BURSTS_C; b++) {
    float age = uTime - uBurstT0[b];
    if (age < 0.0 || age > WAVE_LIFE_SEC_C) continue;
    vec2 swarmC = (vec2(uBurstX[b], uBurstY[b]) - 0.5) * vec2(devAspect, 1.0) + wind * age;
    if (length(p - swarmC) > SWARM_BOUND) continue;
    float swell = mix(1.0 - clamp(uWaveStrength, 0.0, 1.0), 1.0, clamp(uBurstAmp[b], 0.0, 1.0));
    int subActive = int(float(perBurstCap) * clamp(uFloaterDensity * 1.4, 0.15, 1.0) * mix(0.35, 1.0, swell) + 0.5);
    // The swarm condenses and disperses like a cloud: it spreads a little as
    // it ages, and each floater has its own staggered birth (early in the
    // wave) and death (late in it), so the group forms floater by floater
    // and thins out the same way rather than fading as one block.
    float grow = mix(SWARM_GROW_FROM, 1.0, age / WAVE_LIFE_SEC_C);
    // One shared heading per swarm (roughly along the wind, hashed per wave),
    // so its strands lie in parallel — see floaterPath.
    float swarmHeading = atan(SWARM_WIND.y, SWARM_WIND.x) + (hash21(vec2(uBurstSeed[b], 41.0)) - 0.5) * SWARM_HEADING_VAR;
    for (int j = 0; j < FLOATER_PER_BURST_MAX; j++) {
      if (j >= subActive) break;
      float seed = uBurstSeed[b] * 31.7 + float(j) * 9.3 + 5.0;
      float born = hash21(vec2(seed, 42.0)) * WAVE_LIFE_SEC_C * SWARM_STAGGER;
      float dies = WAVE_LIFE_SEC_C * (1.0 - hash21(vec2(seed, 43.0)) * SWARM_STAGGER);
      float life = smoothstep(born, born + WAVE_FADE_IN, age) * (1.0 - smoothstep(dies - WAVE_FADE_OUT, dies, age));
      if (life <= 0.0) continue;
      vec2 fc = swarmC + floaterOffset(seed, uBurstSeed[b], uTime) * grow;
      float heading = swarmHeading + (hash21(vec2(seed, 44.0)) - 0.5) * FLOATER_HEADING_JITTER;
      float d = floaterShape(p, seed, fc, heading);
      if (d == 0.0) continue;
      // Keep off the clouds: this floater's own centre, looked up in the same
      // field the cloud pass thresholds, with a margin below CLOUD_LOW so it
      // fades before a cloud's visible edge reaches it.
      vec2 fcUv = roomUv(fc / vec2(devAspect, 1.0) + 0.5);
      float clear = 1.0 - smoothstep(CLOUD_LOW * 0.3, CLOUD_LOW * 0.85, cloudBumpedAt(fcUv));
      floatDelta += d * life * clear;
    }
  }
  floatDelta = clamp(floatDelta, -0.2, 0.2) * (1.0 - cloudAlpha);
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
  const drifterSplats: Splat[] = DRIFTER_SEEDS.map((seed) => ({
    x: 0.5,
    y: 0.5,
    sigma: DRIFTER_SIGMA_MIN + (DRIFTER_SIGMA_MAX - DRIFTER_SIGMA_MIN) * ((seed * 0.618034) % 1),
    fx: 0,
    fy: 0,
    dye: 0,
    tag: 0,
    ring: 0,
  }));
  // The same drifters' current centres, reused as pickSwarmCenter's obstacles.
  const drifterCentres: [number, number][] = DRIFTER_SEEDS.map(() => [0.5, 0.5]);

  let ambientT = 0;
  let brushPhase = 0;
  // anim.timeSec of the last wave, on the same clock the shader ages waves
  // by — not an accumulated dt, which is capped per frame and so runs slow
  // at a low frame rate. null fires the first wave on the first frame.
  let lastWaveSec: number | null = null;
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
      lastWaveSec = null;
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
        s.dye = DRIFTER_DYE_RATE * drifterPuff(seed, ambientT) * (0.25 + 0.75 * cloudCoverAmount);
        drifterCentres[i][0] = x0;
        drifterCentres[i][1] = y0;
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
      // Each swarm spawns in the clearest open sky it can find, scored
      // against the cloud drifters' current centres (pickSwarmCenter).
      const dropWave = anim.dropOnset;
      const dueWave =
        lastWaveSec === null ||
        anim.timeSec < lastWaveSec || // clock reset (scene re-entered)
        anim.timeSec - lastWaveSec > waveFallbackIntervalSec(waveFrequencyAmount);
      if (dropWave || dueWave) {
        const strength = dropWave ? waveStrengthFromDrop(anim.dropPulse, anim.sectionIntensity) : SPONTANEOUS_WAVE_STRENGTH;
        const seed = waveSeedCounter++;
        const [cx, cy] = pickSwarmCenter(seed, drifterCentres);
        wavePool.trigger(anim.timeSec, strength, seed, cx, cy);
        lastWaveSec = anim.timeSec;
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
