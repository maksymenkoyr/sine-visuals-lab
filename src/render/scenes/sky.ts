import { createProgram, createFullscreenQuad, drawFullscreenQuad, type GLProgram } from "../gl.ts";
import type { SceneSetting } from "../sceneSettings.ts";
import { resolveSceneSetting } from "../autoTune.ts";
import type { Scene, SceneContext } from "../scene.ts";
import { COMMON_UNIFORMS_GLSL, ROOM_UV_GLSL, settingUniformName, uploadCommonUniforms } from "../sceneCommon.ts";
import { NUM_BANDS } from "../../audio/types.ts";
import { createBeatListener, type BeatListenerSpec, type HoldBeats } from "../beatListener.ts";
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
// Floaters are hollow, near-transparent refractive tubes: a real floater is
// a strand of vitreous gel refracting the sky behind it, so floaterProfile
// turns the signed distance to a floater's own edge into a faint bright rim,
// a thin dark fringe just outside it and a barely-lifted see-through
// interior, applied as a multiplicative modulation of whatever is behind.
// Strand paths come from floaterPath, which integrates a heading forward at
// a fixed step, so a strand's arc length always comes out exactly right and
// a sharp corner can't form. Dots read the same profile around a disk.
//
// They arrive in short-lived waves, and each wave is laid out like the
// user's two text-grid references: a streak of cells on a fixed grid
// (FLOATER_CELL), where the reference's ">" body becomes aligned strands
// (all following the streak's slant), its "_" fringe becomes short flat
// strands low in the cell, and its "o" hotspot becomes dots. A streak is a
// slanted ellipse of density (streakDensity), frayed row by row so each
// row's run starts and ends at its own column, the references'
// stair-stepped rows. Every pixel of a cell reads the density at the cell's
// centre and the cell's own hash fixes its floater's shape, so a drifting
// streak moves by floaters switching on and off across the grid. Its
// envelope is subtracted from the density rather than multiplied in, so a
// streak pops in fringe-first and dissolves cell by cell (body strand to
// fringe strand to nothing). FLOATER_CELL is sized so a floater plus its
// fringe fits in one cell, since a pixel only evaluates its own cell.
//
// Streaks keep off the real clouds twice over: render() spawns each one at
// the clearest of a handful of candidate spots (pickSwarmCenter, scored
// against the cloud drifters' current centres), and in the shader a cell
// over cloud (cloudBumpedAt, the exact field the cloud pass thresholds)
// draws nothing, with a per-pixel cloudAlpha backstop. Per pixel the cost is
// one density evaluation per live wave (MAX_WAVE_BURSTS, each skipped
// outright when the cell is out of its reach) plus one floater, so no
// quality-tier gating is needed.
//
// Floater waves reuse powder.ts's stateless chunk-pool idiom
// (createWavePool below): a small JS pool of (t0, strength, seed, x, y)
// slots, uploaded as flat uniform arrays (uBurstT0/uBurstAmp/uBurstSeed/
// uBurstX/uBurstY — named distinctly from the "Wave strength" *setting*'s
// own auto-generated uWaveStrength uniform, the collision ambience.ts's
// header flags), each slot's whole streak evaluated analytically from its
// age in the shader. Waves come and go quickly on the treble: a
// beatListener.ts listener on the "high" source fires one per treble hit,
// held off by waveHoldBeats (tempo-aware, from the Wave frequency setting)
// and sized by the high band's own pulse (waveStrengthFromTreble). A
// section drop (anim.dropOnset, graded by waveStrengthFromDrop) always fires
// a bigger one on top.
//
// On each beat (a "beat" beatListener, one sweep per beat into a ring of
// MAX_SWEEPS slots, sweepSlot) a wavy band of shifting rainbow light
// crosses the frame, but it lights only the floaters' own tubes: the sky and
// clouds around them never change, so the wave is only seen where it
// passes through a streak.
//
// The sky runs on its own 24-hour clock. Time of day sets where it sits,
// Day drift how fast it moves on from there (advanceDayOffset, a scene-owned
// accumulator like brushPhase, so moving Time of day never resets the
// drift). The shader lights everything off the sun's elevation (sin of the
// day angle): sky gradient, sun colour and cloud lit/shade tones all blend
// between keys at night, blue hour, horizon glow, golden hour, early
// evening and midday (DAY_KEY_E), mornings warmed toward peach where
// evenings run pink. A soft sun halo tracks across the frame (rising left,
// setting right), the horizon warms on the sun's side around sunrise and
// sunset, the clouds' shadow taps point toward the sun by day and the moon
// by night, stars come out past blue hour, Haidinger's brush fades with the
// daylight it depends on, and floaters modulate a brightness floor at night
// so they don't vanish into the dark. The default Time of day lands on the
// early-evening key, which is exactly the fixed look the scene had before
// the day cycle existed.
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

// --- Floater-wave budget (a compile-time loop bound in the display shader). ---
export const MAX_WAVE_BURSTS = 6; // concurrent floater streaks — treble fires them often and each is short-lived, so several overlap

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

// --- Floater waves (streaks of floaters on a grid — see the
// file header). Short-lived and fired by treble, so they come and go
// quickly. ---
export const WAVE_LIFE_SEC = 1.8;
export const WAVE_DEAD_T0 = -1e9;
const WAVE_FADE_IN_SEC = 0.15; // the streak's density ramps up this fast — floaters pop in, fringe first
const WAVE_FADE_OUT_SEC = 0.9; // and ramps back down over this long, so it dissolves ">" -> "_" -> gone
const WAVE_HOLD_MIN_BEATS = 0.5; // gap between treble waves at Wave frequency = 1
const WAVE_HOLD_MAX_BEATS = 2; // at Wave frequency = 0
const WAVE_HOLD_FALLBACK_SEC_PER_BEAT = 0.45; // beatListener's no-tempo-lock fallback, per beat of hold
const WAVE_REFRACTORY_SEC = 0.12; // hard floor between treble waves, whatever the hold
const SWARM_CANDIDATES = 12; // spawn spots pickSwarmCenter scores against the cloud drifters

// --- Beat light waves: a wavy band of shifting rainbow light sweeping
// across the whole sky on each beat. A plain ring of slots — the oldest
// is always the one overwritten, and the shader retires any sweep older
// than SWEEP_SEC on its own, so nothing needs expiring here. ---
export const MAX_SWEEPS = 3; // a sweep outlives a beat at most tempos, so a few overlap
export const SWEEP_SEC = 1.3;
const SWEEP_HOLD: HoldBeats = { beats: 1, fallbackSec: 0.4 }; // at most one sweep per beat

/** Which ring slot the next sweep goes in, given how many have fired so
 *  far — always the oldest one. */
export function sweepSlot(fired: number): number {
  const n = Number.isFinite(fired) ? Math.max(0, Math.floor(fired)) : 0;
  return n % MAX_SWEEPS;
}

// --- Day cycle: the sky's own 24-hour clock (see the file header). ---
const DAY_PERIOD_FAST_SEC = 60; // one whole day per minute at Day drift = 1
const DAY_PERIOD_RANGE = 30; // ...and 30x slower (half an hour per day) just above Day drift = 0

/** Days per second at a Day drift setting: 0 holds the sky still at Time of
 *  day; above that, exponential from a half-hour day up to a one-minute day,
 *  so the low end of the slider still has fine control over slow drifts. */
export function dayRatePerSec(drift: number): number {
  const d = Number.isFinite(drift) ? clamp01(drift) : 0;
  if (d <= 0) return 0;
  return 1 / (DAY_PERIOD_FAST_SEC * Math.pow(DAY_PERIOD_RANGE, 1 - d));
}

/** The day cycle's own accumulator — how far the sky has drifted past Time
 *  of day, in days, wrapped to [0, 1). Owned by the scene like brushPhase,
 *  so Time of day can move under it without the drift resetting. */
export function advanceDayOffset(prev: number, dtSec: number, drift: number): number {
  const from = Number.isFinite(prev) ? prev : 0;
  const dt = Number.isFinite(dtSec) ? Math.max(0, dtSec) : 0;
  const next = from + dt * dayRatePerSec(drift);
  return next - Math.floor(next);
}

/** Sun elevation, -1..1, at a day phase (0 midnight, 0.25 sunrise, 0.5
 *  noon, 0.75 sunset) — the same curve the display shader lights the sky by. */
export function sunElevation(dayPhase: number): number {
  const t = Number.isFinite(dayPhase) ? dayPhase : 0;
  return Math.sin(2 * Math.PI * (t - 0.25));
}

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

/** How many beats a treble wave holds off the next one, at a given Wave
 *  frequency setting — 0 is the longest hold, 1 the shortest. Fed to the
 *  treble beatListener as a HoldBeats spec, so it follows the live tempo once
 *  the tracker locks. A section drop always fires its own wave regardless
 *  (see render()). */
export function waveHoldBeats(frequency: number): number {
  const f = Number.isFinite(frequency) ? clamp01(frequency) : 0;
  return WAVE_HOLD_MAX_BEATS - (WAVE_HOLD_MAX_BEATS - WAVE_HOLD_MIN_BEATS) * f;
}

/** How big a treble wave's streak is, from the high band's own pulse at the
 *  moment it fired: a light tick draws a small streak, a hard crash a big
 *  one. Never zero, so every wave that fires is visible. */
export function waveStrengthFromTreble(highPulse: number): number {
  const p = Number.isFinite(highPulse) ? clamp01(highPulse) : 0;
  return 0.3 + 0.55 * p;
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
    description: "How big each wave's streak of floaters is — a few at the low end, a wide block of them at the high end",
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
    description: "How much a hard treble hit or a section drop swells its streak compared with a light tick",
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
    description: "How closely treble waves may follow each other — one every couple of beats at the low end, every half beat at the high end; a section drop always fires one",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.4,
    auto: { dynamics: 0.2 },
    reads: ["anim.dropOnset"],
  },
  {
    key: "dayDrift",
    label: "Day drift",
    description:
      "How fast the sky moves through its day — held still at 0, about half an hour per day just above it, a whole day every minute at 1",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.3,
  },
  // Look
  {
    key: "timeOfDay",
    label: "Time of day",
    description:
      "Where in a 24-hour day the sky sits — 0 and 1 are midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset. With Day drift above zero the sky keeps moving on from here",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.71,
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
  {
    key: "lightWaves",
    label: "Light waves",
    description: "How brightly the floaters light up in shifting rainbow colours as a wave of light passes through them on each beat",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
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
uniform float uSweepT0[${MAX_SWEEPS}];
uniform float uSweepSeed[${MAX_SWEEPS}];
uniform float uDayPhase; // 0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset (see advanceDayOffset)

const int MAX_WAVE_BURSTS_C = ${MAX_WAVE_BURSTS};
const float WAVE_LIFE_SEC_C = ${WAVE_LIFE_SEC.toFixed(3)};
const float WAVE_FADE_IN = ${WAVE_FADE_IN_SEC.toFixed(3)};
const float WAVE_FADE_OUT = ${WAVE_FADE_OUT_SEC.toFixed(3)};
const int MAX_SWEEPS_C = ${MAX_SWEEPS};
const float SWEEP_SEC_C = ${SWEEP_SEC.toFixed(3)};
// A beat light wave's band (see the sweep loop in main): SWEEP_WIDTH wide in
// screen p-units, its front rippled sideways by SWEEP_WOBBLE at
// SWEEP_WOBBLE_FREQ so it reads as a wave rather than a straight wipe, and
// screen-blended at up to SWEEP_ALPHA (times the Light waves setting).
const float SWEEP_WIDTH = 0.12;
const float SWEEP_WOBBLE = 0.05;
const float SWEEP_WOBBLE_FREQ = 7.0;
const float SWEEP_ALPHA = 0.9; // strong, since it only ever lights the floaters' own thin tubes

// The day cycle's light, keyed on sun elevation (sin of the day angle, -1 at
// midnight to +1 at noon) rather than on clock time, so dawn and dusk share
// one set of keys and only differ where main() warms mornings toward peach.
// Keys, low to high: deep night, blue hour, the glow right at the horizon,
// golden hour, early evening (the look this scene had before it had a day
// cycle, which the default Time of day lands on) and midday. Each colour
// blends between its two neighbouring keys (dayWeights).
const float DAY_KEY_E[6] = float[6](-0.40, -0.14, -0.02, 0.08, 0.25, 0.65);
const vec3 SKY_ZENITH[6] = vec3[6](
  vec3(0.012, 0.018, 0.050), vec3(0.070, 0.080, 0.220), vec3(0.200, 0.200, 0.420),
  vec3(0.300, 0.360, 0.600), vec3(0.370, 0.440, 0.650), vec3(0.260, 0.450, 0.780));
const vec3 SKY_HORIZON[6] = vec3[6](
  vec3(0.035, 0.045, 0.100), vec3(0.300, 0.240, 0.420), vec3(0.900, 0.500, 0.460),
  vec3(0.950, 0.720, 0.580), vec3(0.710, 0.700, 0.840), vec3(0.700, 0.800, 0.930));
const vec3 CLOUD_LIT_KEY[6] = vec3[6](
  vec3(0.130, 0.150, 0.220), vec3(0.420, 0.360, 0.520), vec3(0.980, 0.620, 0.550),
  vec3(1.000, 0.820, 0.660), vec3(0.980, 0.930, 0.950), vec3(1.000, 0.990, 0.970));
const vec3 CLOUD_SHADE_KEY[6] = vec3[6](
  vec3(0.050, 0.060, 0.110), vec3(0.160, 0.150, 0.280), vec3(0.360, 0.260, 0.400),
  vec3(0.500, 0.420, 0.520), vec3(0.540, 0.500, 0.640), vec3(0.580, 0.620, 0.720));
const vec3 SUN_KEY[6] = vec3[6](
  vec3(0.0), vec3(0.550, 0.250, 0.350), vec3(1.000, 0.450, 0.250),
  vec3(1.000, 0.700, 0.400), vec3(1.000, 0.880, 0.750), vec3(1.000, 0.970, 0.900));
const vec3 MORNING_WARMTH = vec3(1.04, 1.0, 0.86); // mornings lean peach/gold where evenings lean pink
// The sun's place in the frame: it rises at the left, sets at the right, and
// is near the top of the frame at noon, horizon at the bottom edge. Its glow
// is a wide soft halo plus a tighter core (no hard disc), and around sunrise
// and sunset the horizon warms most on the sun's own side.
const float SUN_X_SPAN = 0.62; // fraction of the frame's width the sun's path spans either side of centre
const float SUN_HALO = 0.30;
const float SUN_CORE = 0.22;
const float HORIZON_WARM = 0.35;
// Night stars: one candidate per STAR_CELL (screen p-units), STAR_CHANCE of
// them lit, most faint and a few bright, each twinkling on its own rate,
// hidden behind cloud, faded in as the sky darkens past blue hour.
const float STAR_CELL = 0.022;
const float STAR_CHANCE = 0.2;
// Floaters barely show against a night sky, since they only modulate what's
// behind them; below this brightness they modulate this floor instead.
const float FLOATER_NIGHT_FLOOR = 0.1;

const float CLOUD_LOW = 0.16; // bumped density below this reads as clear sky
const float CLOUD_HIGH = 0.55; // bumped density above this reads as a solid, opaque cloud body — a wide band, so edges fade through semi-transparent wisps (airy) rather than a hard cut-out
const float CLOUD_WISP_SCALE = 2.9; // second, finer bump octave, relative to CLOUD_BUMP_SCALE — frays the edges into wisps
const float CLOUD_WISP_AMOUNT = 0.35;
const float CLOUD_BUMP_SCALE = 11.0; // fbm frequency, room-uv units — the cauliflower texture
const float CLOUD_BUMP_MORPH = 0.05; // fbm domain drift per second — churn beyond plain advection
const float CLOUD_BUMP_AMOUNT = 0.65; // how hard the bump noise erodes/thickens the edge
// Two shadow taps toward the light (the sun by day, the moon by night, from
// whichever side of the frame it sits on; see main) — storm.ts's Gas
// mode's own two-tap technique (SUN_DIR + densityCheap/shape at 0.18/0.5,
// exp(-1.9*s1-1.15*s2), mixed as a colour ramp not a brightness scalar),
// ported from its 3D raymarch to a plain 2D density lookup. A single
// adjacent-texel check (the first pass's own shadeAmt) only ever sees
// edges; a wide cloud's flat interior has no local gradient at that scale,
// which is why v1 read as one flat tone instead of a folded mass.
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
// Floater waves (see the file header): each wave is a streak of the small
// refractive-tube floaters laid out on a fixed grid, arranged like the
// user's text-grid references, where ">" fills a streak's body, "_" runs
// along its ragged fringe and an "o" sits inside some. Here a body cell
// holds an aligned strand, a fringe cell a short flat strand low in the
// cell, and a hotspot cell a round floater dot. FLOATER_CELL is sized so the
// longest strand plus its fringe fits inside one cell, since a pixel only
// ever evaluates the floater in its own cell.
// Every floater size below (and the grid cell with them) is multiplied by
// FLOATER_SCALE: the user asked for floaters 2.5x smaller than the
// reference-matched sizes, then 20% bigger again, with the grid scaling
// alongside so a streak keeps
// its extent and just holds more, finer floaters. At this scale the tube is
// only a few pixels across, so floaterProfile floors its bands at
// FLOATER_MIN_PX screen pixels rather than letting the rim alias away.
const float FLOATER_SCALE = 0.48;
const float FLOATER_MIN_PX = 0.8;
const vec2 FLOATER_CELL = vec2(0.06, 0.045) * FLOATER_SCALE;
const float CELL_T_BODY = 0.42; // streak density above this puts an aligned strand in the cell (the reference's ">")
const float CELL_T_FRINGE = 0.12; // between this and CELL_T_BODY, a short flat strand (the reference's "_"); below, nothing
const float CELL_T_HOT = 0.25; // hotspot field above this, inside the body, puts a dot there instead (the reference's "o")
const float FRINGE_DROP = -0.011 * FLOATER_SCALE; // the fringe strand sits this far below the cell centre, like "_" under ">"
// Streak shape, screen p-units: an ellipse of half-extent between
// STREAK_L_MIN and STREAK_L_MAX (by the wave's size), tilted up to the right
// by a hashed slant, frayed row by row by STREAK_RAG noise so each row's run
// starts and ends at its own column, the references' stair-stepped rows.
const vec2 STREAK_L_MIN = vec2(0.14, 0.04);
const vec2 STREAK_L_MAX = vec2(0.6, 0.13); // the long, thin reference streak runs ~1.0 x 0.2 of screen height
const float STREAK_SLANT_MIN = 0.12;
const float STREAK_SLANT_MAX = 0.45; // radians up to the right; the reference rises ~20 degrees
const float STREAK_RAG = 0.45;
const float STREAK_HOT_CHANCE = 0.5; // fraction of streaks with a dot hotspot (one reference has one, the other none)
const vec2 STREAK_DRIFT = vec2(0.09, 0.012); // p-units/s, scaled by Flow speed; quick, since a streak only lives WAVE_LIFE_SEC
const int FLOATER_SEGMENTS = 10; // path points per strand (head at index 0), see floaterPath
const float BODY_LEN_MIN = 0.036 * FLOATER_SCALE; // body strand arc length, screen p-units, hashed per cell
const float BODY_LEN_MAX = 0.048 * FLOATER_SCALE;
const float FRINGE_LEN_MIN = 0.02 * FLOATER_SCALE; // fringe strands are short
const float FRINGE_LEN_MAX = 0.03 * FLOATER_SCALE;
const float BODY_HEADING_JITTER = 0.16; // radians around the streak's own slant, so body strands read as aligned
// floaterPath's heading theta(t) = B1*sin(2*pi*f1*t+p1) + B2*sin(2*pi*f2*t+p2):
// a dominant gentle bend (B1/f1) plus a much smaller, faster wobble (B2/f2),
// all hashed once per seed. Because heading is integrated forward rather
// than offsetting each point sideways by an independent function of t, arc
// length always comes out exactly right and the bend rate stays bounded; a
// real side-by-side against a floater reference showed per-point-independent
// kinks read as an angular zigzag, not the reference's smooth curve.
const float FLOATER_B1_MIN = 0.3; // dominant bend swing, radians (random sign per seed)
const float FLOATER_B1_MAX = 0.6;
const float FLOATER_F1_MIN = 0.5; // dominant bend's cycles over the strand
const float FLOATER_F1_MAX = 1.0;
const float FLOATER_B2_MIN = 0.1; // secondary wobble, radians; texture, not a second kink
const float FLOATER_B2_MAX = 0.2;
const float FLOATER_F2_MIN = 3.0;
const float FLOATER_F2_MAX = 5.0;
// The refractive-tube profile (floaterProfile below), measured off a
// brightness cross-section of a floater reference at sky luminance ~172: a
// thin dark fringe just outside the edge, a brighter rim just inside it, and
// a barely-lifted see-through interior, everything within about +-10% of the
// background, never a solid painted line.
const float FLOATER_R = 0.0028 * FLOATER_SCALE; // strand tube half-width, screen p-units
const float FLOATER_RIM_W = 0.0014 * FLOATER_SCALE; // bright-rim band width, just inside the edge
const float FLOATER_FRINGE_W = 0.0022 * FLOATER_SCALE; // dark-fringe band width, just outside the edge
const float FLOATER_INTERIOR = 0.02; // relative lum delta well inside the edge
const float FLOATER_RIM = 0.17; // relative lum delta at the rim peak — raised well past the measured 0.07 for contrast at the small size
const float FLOATER_FRINGE = 0.23; // relative lum delta (negative) at the fringe peak — raised from the measured 0.10 likewise
const float FLOATER_DOT_R_MIN = 0.005 * FLOATER_SCALE; // dot radius, screen p-units
const float FLOATER_DOT_R_MAX = 0.0068 * FLOATER_SCALE;
const vec3 FLOATER_COOL_TINT = vec3(0.94, 0.99, 1.06); // faint cool bias applied only to the rim's brightening (see main()); the fringe's darkening stays neutral

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

// Signed relative-luminance delta for a point at true signed distance s from
// a floater's own edge (negative inside, screen p-units): a small lift deep
// inside (FLOATER_INTERIOR), rising through a bright rim just inside the edge
// (FLOATER_RIM, peaking at s = -FLOATER_RIM_W/2) into a dark fringe just
// outside it (FLOATER_FRINGE, peaking at s = FLOATER_FRINGE_W/2), fading
// smoothly to exactly 0 by s = FLOATER_FRINGE_W*2.0. Shared by strands and
// dots; they differ only in how s is computed. Built from smooth bumps, not
// hard-edged bands, since the reference itself is a little soft.
float floaterProfile(float s) {
  float px = FLOATER_MIN_PX / max(uResolution.y, 1.0);
  float rimW = max(FLOATER_RIM_W, px);
  float fringeW = max(FLOATER_FRINGE_W, px);
  float interior = FLOATER_INTERIOR * (1.0 - smoothstep(-rimW, 0.0, s));
  float rimD = (s + rimW * 0.5) / (rimW * 0.5);
  float rim = FLOATER_RIM * exp(-rimD * rimD);
  float fringeD = (s - fringeW * 0.5) / (fringeW * 0.5);
  float fringe = -FLOATER_FRINGE * exp(-fringeD * fringeD);
  float cutoff = 1.0 - smoothstep(fringeW, fringeW * 2.0, s);
  return (interior + rim + fringe) * cutoff;
}

// Builds a strand's curved path of arc length 'len' into 'pts' (head at
// index 0, FLOATER_SEGMENTS points) by integrating a heading forward at a
// fixed step (see the FLOATER_B1_MIN..FLOATER_F2_MAX comment above), then
// re-centres it on its own average and rotates it so its chord (head to
// tail) points along 'heading', which is what lines strands up in parallel
// however each one curls along the way.
void floaterPath(float seed, float heading, float len, out vec2 pts[FLOATER_SEGMENTS]) {
  float thetaSign = hash21(vec2(seed, 26.0)) < 0.5 ? -1.0 : 1.0;
  float b1 = thetaSign * mix(FLOATER_B1_MIN, FLOATER_B1_MAX, hash21(vec2(seed, 21.0)));
  float f1 = mix(FLOATER_F1_MIN, FLOATER_F1_MAX, hash21(vec2(seed, 27.0)));
  float p1 = hash21(vec2(seed, 22.0)) * 6.28318;
  float b2 = mix(FLOATER_B2_MIN, FLOATER_B2_MAX, hash21(vec2(seed, 28.0)));
  float f2 = mix(FLOATER_F2_MIN, FLOATER_F2_MAX, hash21(vec2(seed, 23.0)));
  float p2 = hash21(vec2(seed, 24.0)) * 6.28318;
  float stepLen = len / float(FLOATER_SEGMENTS - 1);
  pts[0] = vec2(0.0);
  for (int i = 1; i < FLOATER_SEGMENTS; i++) {
    // Heading sampled at the segment's own midpoint t (midpoint-rule
    // integration of theta(t)).
    float tMid = (float(i) - 0.5) / float(FLOATER_SEGMENTS - 1);
    float theta = b1 * sin(6.28318 * f1 * tMid + p1) + b2 * sin(6.28318 * f2 * tMid + p2);
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

// A strand floater's signed distance at p (negative inside the tube): a
// hollow refractive tube of half-width FLOATER_R around the path
// floaterPath builds, centred on basePos. main() turns it into the tube's
// brightness (floaterProfile) and into where a light wave lights it.
float floaterStrand(vec2 p, vec2 basePos, float seed, float heading, float len) {
  vec2 pts[FLOATER_SEGMENTS];
  floaterPath(seed, heading, len, pts);
  vec2 pLocal = p - basePos;
  float dMin = 1.0e6;
  for (int i = 1; i < FLOATER_SEGMENTS; i++) {
    vec2 pa = pLocal - pts[i - 1];
    vec2 ba = pts[i] - pts[i - 1];
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1.0e-6), 0.0, 1.0);
    dMin = min(dMin, length(pa - ba * h));
  }
  return dMin - max(FLOATER_R, FLOATER_MIN_PX / max(uResolution.y, 1.0));
}

// Blend weights for the six day keys at sun elevation e: only the two keys
// either side of e carry weight, eased between (smoothstep) so the sky never
// shows a kink in its colour as it passes a key.
void dayWeights(float e, out float w[6]) {
  for (int i = 0; i < 6; i++) w[i] = 0.0;
  float ec = clamp(e, DAY_KEY_E[0], DAY_KEY_E[5]);
  for (int i = 0; i < 5; i++) {
    if (ec <= DAY_KEY_E[i + 1]) {
      float f = smoothstep(DAY_KEY_E[i], DAY_KEY_E[i + 1], ec);
      w[i] = 1.0 - f;
      w[i + 1] = f;
      return;
    }
  }
  w[5] = 1.0;
}

vec3 dayMix(float w[6], vec3 k[6]) {
  return w[0] * k[0] + w[1] * k[1] + w[2] * k[2] + w[3] * k[3] + w[4] * k[4] + w[5] * k[5];
}

// Brightness of the night star field at p (screen p-units; px is one
// screen pixel): at most one star per STAR_CELL, placed within its cell,
// most faint and a few bright (magnitude cubed), each twinkling at its own
// rate, drawn as a pixel-sized gaussian so it never aliases into a square.
float starField(vec2 p, float px) {
  vec2 g = p / STAR_CELL;
  vec2 id = floor(g);
  float h = hash21(id + 91.7);
  if (h > STAR_CHANCE) return 0.0;
  vec2 pos = 0.15 + 0.7 * hash22(id + 13.1);
  float d = length((fract(g) - pos) * STAR_CELL);
  float mag = pow(hash21(id + 5.3), 3.0);
  float size = px * mix(0.7, 1.7, mag);
  float twinkle = 0.72 + 0.28 * sin(uTime * mix(1.3, 4.1, hash21(id + 2.2)) + h * 40.0);
  return exp(-d * d / (size * size)) * mix(0.28, 1.0, mag) * twinkle;
}

// One wave's streak density at cell centre c (screen p-units), its slant in
// 'slant', and its dot hotspot field in 'hot'. The envelope is subtracted
// from the density rather than multiplied into it, so a streak pops in
// fringe-first and dissolves cell by cell: each body strand gives way to a
// fringe strand, then each fringe strand to empty sky, not the whole streak
// fading at once.
float streakDensity(vec2 c, vec2 centre, float seed, float amp, float age, out float slant, out float hot) {
  float size = clamp(uFloaterDensity * 1.3, 0.1, 1.0) * mix(1.0 - clamp(uWaveStrength, 0.0, 1.0), 1.0, clamp(amp, 0.0, 1.0));
  vec2 L = mix(STREAK_L_MIN, STREAK_L_MAX, size);
  slant = mix(STREAK_SLANT_MIN, STREAK_SLANT_MAX, hash21(vec2(seed, 51.0)));
  vec2 d = c - centre;
  float cs = cos(slant);
  float sn = sin(slant);
  vec2 q = vec2(cs * d.x + sn * d.y, -sn * d.x + cs * d.y);
  // Row fray: noise keyed on the grid row (and only coarsely on position
  // along the streak), so a whole row's run shifts together.
  float row = floor(c.y / FLOATER_CELL.y);
  float rag = (vnoise(vec2(row * 0.9 * FLOATER_SCALE + seed * 7.1, q.x / L.x * 2.2 + seed)) - 0.5) * STREAK_RAG;
  vec2 e = q / L;
  float env = smoothstep(0.0, WAVE_FADE_IN, age) * (1.0 - smoothstep(WAVE_LIFE_SEC_C - WAVE_FADE_OUT, WAVE_LIFE_SEC_C, age));
  hot = 0.0;
  if (hash21(vec2(seed, 52.0)) < STREAK_HOT_CHANCE) {
    vec2 hc = (hash22(vec2(seed, 53.0)) - 0.5) * vec2(0.9, 0.5) * L;
    vec2 he = (q - hc) / (L * vec2(0.3, 0.45));
    hot = (1.0 - dot(he, he)) * env;
  }
  return 1.0 - dot(e, e) + rag - (1.0 - env) * 1.1;
}

void main() {
  vec2 uv = roomUv(vUv);
  // The two illusions live in this device's own screen space, not the
  // shared room canvas — see the file header on why.
  float devAspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 p = (vUv - 0.5) * vec2(devAspect, 1.0);

  // 1. Sky, lit by the day cycle (see the DAY_KEY_E comment): a vertical
  // gradient between the keyed zenith and horizon colours for this sun
  // elevation, mornings warmed toward peach around the horizon glow, a
  // soft sun halo wherever the sun sits in the frame, horizon warmth pooled
  // on the sun's side around sunrise and sunset, and stars once the sky
  // darkens past blue hour. The early-evening key is the earlier fixed look,
  // itself measured against a real hazy sky and then taken a step darker
  // with a faint pink-purple cast at the user's request.
  float px = 1.0 / max(uResolution.y, 1.0);
  float dayAngle = 6.28318 * (uDayPhase - 0.25);
  float sunE = sin(dayAngle);
  float dw[6];
  dayWeights(sunE, dw);
  vec3 zenith = dayMix(dw, SKY_ZENITH);
  vec3 horizon = dayMix(dw, SKY_HORIZON);
  vec3 sunCol = dayMix(dw, SUN_KEY);
  float glowHour = 1.0 - smoothstep(0.05, 0.3, abs(sunE)); // 1 around sunrise/sunset, 0 by mid-morning
  float morning = uDayPhase < 0.5 ? 1.0 : 0.0;
  horizon = mix(horizon, horizon * MORNING_WARMTH, morning * glowHour);
  sunCol = mix(sunCol, sunCol * MORNING_WARMTH, morning * glowHour);
  vec3 color = mix(horizon, zenith, smoothstep(-0.1, 0.9, uv.y));

  vec2 sunP = vec2(-cos(dayAngle) * SUN_X_SPAN * devAspect, -0.55 + 1.05 * sunE);
  float sunD = length(p - sunP);
  float sunUp = smoothstep(-0.25, 0.02, sunE);
  vec3 glow = sunCol * (SUN_HALO * exp(-sunD * 2.4) + SUN_CORE * exp(-sunD * 9.0)) * sunUp;
  float onSunSide = exp(-abs(p.x - sunP.x) / (0.8 * devAspect));
  float lowInSky = pow(1.0 - clamp(uv.y, 0.0, 1.0), 2.5);
  glow += sunCol * HORIZON_WARM * glowHour * onSunSide * lowInSky;
  color += glow;

  float starAmt = 1.0 - smoothstep(-0.25, -0.06, sunE);
  if (starAmt > 0.0) color += vec3(0.85, 0.9, 1.0) * starField(p, px) * starAmt;

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
  // Shading is Storm's own two-tap sun-shadow technique (lightDir below,
  // CLOUD_SHADOW_TAP1-2/CLOUD_SHADOW_K1-2 above), ported from its 3D
  // raymarch to a plain 2D density lookup: sample density toward a fixed
  // light direction at two distances, run it through Beer's law, and use
  // the result to pick a point on a colour ramp (mix), not as a brightness
  // multiplier. The first pass's shading only compared immediate neighbour
  // texels, which sees an edge but nothing in a wide cloud's flat interior —
  // this reaches far enough across the body to shade actual folds.
  float bumped = cloudBumpedAt(uv);
  float cloudAlpha = smoothstep(CLOUD_LOW, CLOUD_HIGH, bumped);
  // Light from the sun's side of the frame by day, the moon's (the opposite
  // side) by night, always from somewhat above. The hand-over eases through
  // light from straight above around sunrise and sunset rather than flipping
  // sides in one frame, which would jump every cloud's shading with Day
  // drift running.
  float lightSide = smoothstep(-0.08, 0.08, sunE) * 2.0 - 1.0;
  vec2 lightDir = normalize(vec2(-cos(dayAngle) * lightSide * 0.8, 0.85));
  float sunNear = max(decodeDye(texture(uDye, uv + lightDir * CLOUD_SHADOW_TAP1)).x, 0.0);
  float sunFar = max(decodeDye(texture(uDye, uv + lightDir * CLOUD_SHADOW_TAP2)).x, 0.0);
  float shadow = exp(-CLOUD_SHADOW_K1 * sunNear - CLOUD_SHADOW_K2 * sunFar);
  // Keyed with the sky (CLOUD_LIT_KEY/CLOUD_SHADE_KEY), so clouds sit in the
  // same light: white at midday, gold and pink toward sunset, dim moonlit
  // grey at night. The midday pair was measured off a real hazy-cumulus
  // photo (shadow-fold RGB≈(156,151,172)/255, highlight RGB≈(255,255,254)/255).
  vec3 cloudShadow = dayMix(dw, CLOUD_SHADE_KEY);
  vec3 cloudLit = mix(dayMix(dw, CLOUD_LIT_KEY), dayMix(dw, CLOUD_LIT_KEY) * MORNING_WARMTH, morning * glowHour);
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
  // The brush is polarised skylight, so it fades out as the sky goes dark.
  float daylight = smoothstep(-0.1, 0.25, sunE);
  float brushAmt = clamp(uBrushOpacity * BRUSH_BASE * radial * abs(lobe) * (1.0 - 0.4 * uEnergy) * daylight, 0.0, 1.0);
  color = mix(color, color * brushTint, brushAmt);

  // 4. Floater waves (see the file header): snap this pixel to its grid
  // cell, take the densest live streak at the cell's centre, and from that
  // density decide what floater (if any) the cell holds: an aligned strand
  // in the body, a short flat strand on the fringe, a dot in a hotspot. Each
  // floater is a refractive tube (floaterProfile), applied as a modulation of
  // what's behind it rather than a painted colour. The cell's own hash fixes
  // its floater's shape, so a drifting streak moves by floaters switching on
  // and off across a fixed grid.
  vec2 cellId = floor(p / FLOATER_CELL);
  vec2 cellC = (cellId + 0.5) * FLOATER_CELL;
  vec2 wind = STREAK_DRIFT * (0.5 + uFlowSpeed);
  float dens = -1.0;
  float hot = 0.0;
  float slant = 0.0;
  for (int b = 0; b < MAX_WAVE_BURSTS_C; b++) {
    float age = uTime - uBurstT0[b];
    if (age < 0.0 || age > WAVE_LIFE_SEC_C) continue;
    vec2 centre = (vec2(uBurstX[b], uBurstY[b]) - 0.5) * vec2(devAspect, 1.0) + wind * age;
    // Rag can push density past the ellipse by at most ~5%, never further.
    if (length(cellC - centre) > STREAK_L_MAX.x * 1.1) continue;
    float h;
    float sl;
    float d = streakDensity(cellC, centre, uBurstSeed[b], uBurstAmp[b], age, sl, h);
    if (d > dens) {
      dens = d;
      hot = h;
      slant = sl;
    }
  }
  if (dens > CELL_T_FRINGE) {
    // Keep off the clouds: the cell's centre, looked up in the same field the
    // cloud pass thresholds, with a margin below CLOUD_LOW so a streak gives
    // way before a cloud's visible edge reaches it.
    float clear = 1.0 - smoothstep(CLOUD_LOW * 0.3, CLOUD_LOW * 0.85, cloudBumpedAt(roomUv(cellC / vec2(devAspect, 1.0) + 0.5)));
    float cellSeed = hash21(cellId * 0.731 + 17.3) * 97.0 + cellId.x * 0.013;
    float s;
    if (dens > CELL_T_BODY && hot > CELL_T_HOT) {
      float r = mix(FLOATER_DOT_R_MIN, FLOATER_DOT_R_MAX, hash21(vec2(cellSeed, 15.0)));
      s = length(p - cellC) - max(r, FLOATER_MIN_PX * px);
    } else if (dens > CELL_T_BODY) {
      float len = mix(BODY_LEN_MIN, BODY_LEN_MAX, hash21(vec2(cellSeed, 25.0)));
      float heading = slant + (hash21(vec2(cellSeed, 44.0)) - 0.5) * BODY_HEADING_JITTER;
      s = floaterStrand(p, cellC, cellSeed, heading, len);
    } else {
      float len = mix(FRINGE_LEN_MIN, FRINGE_LEN_MAX, hash21(vec2(cellSeed, 25.0)));
      s = floaterStrand(p, cellC + vec2(0.0, FRINGE_DROP), cellSeed, 0.0, len);
    }
    float vis = clear * (1.0 - cloudAlpha);
    float delta = clamp(floaterProfile(s), -0.4, 0.4) * vis;
    // Against a dark (night) sky, modulate a floor instead of the near-black
    // behind, so floaters don't vanish once the sun is down.
    vec3 base = max(color, vec3(FLOATER_NIGHT_FLOOR));
    color += base * (min(delta, 0.0) + max(delta, 0.0) * FLOATER_COOL_TINT);

    // Beat light waves pass through the floaters only: each live sweep is a
    // soft band travelling across the frame in its own hashed direction, its
    // front rippling, its colour a rainbow shifting across the band and along
    // it, and it lights just this floater's own tube (inside it and its rim),
    // screen-blended so a floater flashes that colour as the band crosses it
    // and the sky and clouds around it stay untouched.
    float tube = 1.0 - smoothstep(0.0, max(FLOATER_FRINGE_W, FLOATER_MIN_PX * px), s);
    if (tube > 0.0) {
      vec3 sweepGlow = vec3(0.0);
      for (int i = 0; i < MAX_SWEEPS_C; i++) {
        float age = uTime - uSweepT0[i];
        if (age < 0.0 || age > SWEEP_SEC_C) continue;
        float seed = uSweepSeed[i];
        float t = age / SWEEP_SEC_C;
        float ang = mix(-0.7, 0.7, hash21(vec2(seed, 61.0))) + (hash21(vec2(seed, 62.0)) < 0.5 ? 0.0 : 3.14159265);
        vec2 dir = vec2(cos(ang), sin(ang));
        vec2 perp = vec2(-dir.y, dir.x);
        float reach = 0.5 * (abs(dir.x) * devAspect + abs(dir.y)) + SWEEP_WIDTH * 2.0;
        float front = mix(-reach, reach, t);
        float across = dot(p, perp);
        float along = dot(p, dir) + SWEEP_WOBBLE * sin(across * SWEEP_WOBBLE_FREQ + uTime * 2.3 + seed);
        float x = (along - front) / SWEEP_WIDTH;
        // A sharper leading edge and a longer glowing tail behind it.
        float band = x > 0.0 ? exp(-x * x * 2.0) : exp(-x * x * 0.35);
        vec3 hue = 0.5 + 0.5 * cos(6.28318 * (fract(seed * 0.37) + x * 0.22 + across * 0.8 + vec3(0.0, 0.33, 0.67)));
        float fade = smoothstep(0.0, 0.12, t) * (1.0 - smoothstep(0.75, 1.0, t));
        sweepGlow += hue * band * fade;
      }
      vec3 lit = clamp(sweepGlow * SWEEP_ALPHA * uLightWaves * tube * vis, 0.0, 1.0);
      color = 1.0 - (1.0 - color) * (1.0 - lit);
    }
  }

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
  let dayOffset = 0;
  // The treble trigger for floater waves. Its hold is rewritten each tick from
  // the Wave frequency setting (the listener reads spec.hold live).
  const trebleSpec: BeatListenerSpec = { source: "high", refractorySec: WAVE_REFRACTORY_SEC, hold: 0 };
  const trebleListener = createBeatListener(trebleSpec);
  // Beat light waves: one sweep per beat into the oldest ring slot.
  const beatListener = createBeatListener({ source: "beat", hold: SWEEP_HOLD });
  const sweepT0 = new Float32Array(MAX_SWEEPS).fill(WAVE_DEAD_T0);
  const sweepSeed = new Float32Array(MAX_SWEEPS);
  let sweepsFired = 0;
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
      dayOffset = 0;
      trebleListener.reset();
      beatListener.reset();
      sweepT0.fill(WAVE_DEAD_T0);
      sweepsFired = 0;
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

      // Floater waves come and go on the treble (see file header): the high
      // band's listener fires one per hit, held off by Wave frequency; a
      // section drop always fires a bigger one on top. Each spawns in the
      // clearest open sky it can find, away from the cloud drifters and from
      // streaks still on screen (pickSwarmCenter).
      wavePool.tick(anim.timeSec);
      trebleSpec.hold = {
        beats: waveHoldBeats(waveFrequencyAmount),
        fallbackSec: waveHoldBeats(waveFrequencyAmount) * WAVE_HOLD_FALLBACK_SEC_PER_BEAT,
      };
      if (beatListener.advance(anim).fired) {
        const slot = sweepSlot(sweepsFired);
        sweepT0[slot] = anim.timeSec;
        sweepSeed[slot] = sweepsFired * 1.618 + 3.0;
        sweepsFired++;
      }
      const treble = trebleListener.advance(anim);
      const strengths: number[] = [];
      if (treble.fired) strengths.push(waveStrengthFromTreble(anim.highPulse));
      if (anim.dropOnset) strengths.push(waveStrengthFromDrop(anim.dropPulse, anim.sectionIntensity));
      for (const strength of strengths) {
        const obstacles: [number, number][] = [...drifterCentres];
        for (const b of wavePool.bursts) if (b.t0 !== WAVE_DEAD_T0) obstacles.push([b.x, b.y]);
        const seed = waveSeedCounter++;
        const [cx, cy] = pickSwarmCenter(seed, obstacles);
        wavePool.trigger(anim.timeSec, strength, seed, cx, cy);
      }

      // Haidinger's brush — a continuously increasing accumulator, never
      // anim.barPhase (see file header).
      brushPhase = advanceBrushPhase(brushPhase, dt);

      // Day cycle: Time of day is where the sky starts, Day drift how fast it
      // moves on from there (see file header).
      dayOffset = advanceDayOffset(dayOffset, dt, resolveSceneSetting(ID, settingFor("dayDrift")));
      const dayPhaseRaw = resolveSceneSetting(ID, settingFor("timeOfDay")) + dayOffset;
      const dayPhase = dayPhaseRaw - Math.floor(dayPhaseRaw);

      gl.disable(gl.BLEND);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      displayProg.use();
      uploadCommonUniforms(displayProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf);
      displayProg.setF("uBrushPhase", brushPhase);
      displayProg.setF("uDayPhase", dayPhase);
      wavePool.upload(displayProg);
      displayProg.setFv("uSweepT0", sweepT0);
      displayProg.setFv("uSweepSeed", sweepSeed);
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
