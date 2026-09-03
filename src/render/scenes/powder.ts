import { createProgram, createFullscreenQuad, drawFullscreenQuad, type GLProgram } from "../gl.ts";
import { PALETTE_GLSL } from "../palette.ts";
import type { SceneSetting } from "../sceneSettings.ts";
import { resolveSceneSetting } from "../autoTune.ts";
import type { Scene, SceneContext } from "../scene.ts";
import { COMMON_UNIFORMS_GLSL, ROOM_UV_GLSL, settingUniformName, uploadCommonUniforms } from "../sceneCommon.ts";
import { NUM_BANDS } from "../../audio/types.ts";
import { grainTextureSide, REFERENCE_GRAINS } from "./chladni.ts";

// Coloured powder thrown into a dark room: one dense cloud of very fine
// particles that contracts to a compact blob when the music is quiet,
// breathes and bursts outward on every bass hit, and throws a handful of
// chunky red cubes on the biggest hits. Blue-white for the bulk, coral red
// for the "hot" fraction, and nothing else in the frame but the box room's
// faint walls. Contrast chladni.ts, the repo's other GPU particle sim: that
// one is a 2D bed of sand on a driven plate, this one is a 3D volume with a
// perspective camera and no plate at all — the shape is a spring toward a
// per-particle home position plus curl-noise turbulence, so the "cloud" is
// never drawn anywhere, it's just where the springs put things.
//
// Packing. Particle state lives in a ping-pong pair of *two-attachment*
// RGBA8 render targets, MRT via gl.drawBuffers (WebGL2 core, no extension).
// RGBA8 is the only renderable format this repo will rely on — see
// chladni.ts's header for why EXT_color_buffer_float is deliberately unused
// — and one RGBA8 texel can't hold a 3D position at a useful precision, so
// the state is split across two:
//   attachment 0 (uPosXY): R,G = x, B,A = y   (16-bit fixed point each)
//   attachment 1 (uPosZW): R,G = z, B = heat (8-bit), A = 1
// with every axis a 16-bit fixed point over [-POS_RANGE, POS_RANGE]. The
// packAxis/unpackAxis pair lives in POWDER_GLSL, shared by the sim and both
// point programs, so the two ends of the round trip can't drift.
//
// Chunks are stateless. The cubes a big hit throws are not simulated: a JS
// pool holds only the (t0, strength, seed) of the last few bursts, and the
// vertex shader evaluates each cube's whole ballistic arc analytically from
// its age — drag-damped launch plus gravity. Hundreds of cubes with no
// second simulation texture, no per-cube readback, and an exact fade-out at
// CHUNK_LIFE_SEC. The pool is pure JS and tested; the pass is skipped
// entirely while no burst is alive.
//
// Triggers are rises, not one-shots. anim.lowOnset/dropOnset are true for
// exactly one rAF tick, and render() is frame-pace-capped, so on a 120Hz
// display roughly half of them never reach a scene at all — see
// src/render/renderLatch.ts for the full story. Everything discrete here
// (the shove impulse, the big-hit detector) fires on a *rise* in the
// corresponding decaying pulse instead, with the one-shot flag folded in as
// a bonus rather than the sole source. Same reason dt comes from frame.time
// deltas rather than anim.dtSec (chladni.ts's header covers that one).
//
// The noise is ours. hash31/hash33 are the 3D extension of chladni.ts's own
// hash21/hash22 (the same fract/dot family, same constants); vnoise is a
// plain trilinear value noise over eight hashed lattice corners; curl() is
// the curl of a three-channel vector potential built from vnoise, by central
// differences. Nothing here is ported from Ashima/Gustavson simplex or from
// any Shadertoy curl-noise implementation — see CLAUDE.md's standing rule.
const ID = "powder";

/** Half-width of the packed world range: every axis is 16-bit fixed point
 *  over [-POS_RANGE, POS_RANGE]. Comfortably contains the containment cage
 *  below, so a particle can never wrap. */
const POS_RANGE = 2.0;

// The containment cage the sim clamps particles into — well inside the room
// box so powder never pokes through a wall. Nothing respawns; the spring
// brings escapees home on its own.
const CAGE_HALF_X = 1.7;
const CAGE_FLOOR_Y = -1.1;
const CAGE_CEIL_Y = 1.7;
const CAGE_HALF_Z = 1.7;

// The room box, in world units. Deliberately larger than the cage and open
// past the camera in +z (ROOM_FRONT_Z sits behind the eye) so every ray from
// the eye exits through an interior face and every pixel gets painted.
const ROOM_HALF_X = 2.4;
const ROOM_FLOOR_Y = -1.6;
const ROOM_CEIL_Y = 2.2;
const ROOM_BACK_Z = -2.0;
const ROOM_FRONT_Z = 4.2;

// Camera: static, slightly above centre, looking into the room. The slow
// orbit in the reference is done by spinning the *cloud* about Y instead of
// the eye (see spin() in POWDER_GLSL) — the room then stays put, which is
// what the reference footage actually shows.
const EYE_Y = 0.25;
const EYE_Z = 3.4;
const FOV_DEG = 48;
const FOV_TAN = Math.tan(((FOV_DEG / 2) * Math.PI) / 180);
/** curl() sums two octaves of finite-differenced value noise, whose raw
 *  magnitude is an accident of the lattice spacing and the difference step;
 *  this scales it so the turbulence term reads as world units per second and
 *  can be balanced against SETTLE_RATE by eye. */
const CURL_NORM = 0.15;
/** How far vnoiseW spreads value noise about its midpoint — see vnoiseW. */
const VNOISE_WIDEN = 2.4;

/** Distance the point-size slider is calibrated at — a grain at the cloud's
 *  centre is `grainPx` pixels across, nearer ones bigger, farther smaller. */
const SIZE_DEPTH_REF = 3.4;

// Spring toward the particle's home position, per second. Scaled down right
// after a kick (uSettleScale = 1 / (1 + SHOVE_SETTLE_DRAG * shove)) so thrown
// particles coast before the spring takes over again. The two are a matched
// pair: a weaker spring or a stronger drag and each beat's shell outruns the
// recovery, so the cloud ratchets outward until it hits the cage.
const SETTLE_RATE = 0.9;
const SHOVE_SETTLE_DRAG = 1.5;
/** Distance from home, as a fraction of the cloud radius, at which the
 *  spring reaches full strength. Inside it the pull tapers to nothing, so a
 *  particle near home is free to be carried by the curl field and the cloud
 *  gets its structure from the flow rather than from the spring. */
const SETTLE_FREE_FRACTION = 0.35;

/** Impulse a single bass rise adds to the outward-shove envelope, its decay
 *  rate per second, and the ceiling repeated hits can stack it to. */
export const SHOVE_IMPULSE = 1.1;
export const SHOVE_DECAY = 6.0;
export const SHOVE_CAP = 2.5;

/** Cube burst pool geometry — see the file header for why the cubes are
 *  evaluated analytically rather than simulated. */
export const MAX_CHUNK_BURSTS = 4;
export const CHUNKS_PER_BURST = 96;
export const CHUNK_LIFE_SEC = 1.6;
/** t0 of a dead slot: far enough in the past that `uTime - t0` is way past
 *  CHUNK_LIFE_SEC for any clock the scene will ever see. */
export const CHUNK_DEAD_T0 = -1e9;

// Big-hit detector shape. The level-vs-baseline test alone has a dead zone
// on exactly the music the cubes are for: a slow baseline of `low` tracks
// the kicks themselves, so on a steady bass-heavy track `low` never gets far
// enough above its own average to fire (bandEnergy.ts's header warns about
// this). The onset pulse and the phrase-level loudness trend don't have that
// problem — a kick's lowPulse spikes regardless of how loud the last bar
// was, and sectionIntensity says whether we're in a chorus — so a loud
// section plus a strong pulse is the primary route and the level-vs-baseline
// test stays as a second one, for a track whose sections never resolve.
/** Time constant of the slow bass baseline the second route compares against. */
export const BIG_HIT_BASE_TAU = 2.0;
/** Minimum gap between two bass-triggered bursts. Long: in a loud section
 *  the cubes should fly on roughly every other bar, not every beat — and a
 *  bar is about 1.7 s at the tempo this was checked against, so anything
 *  near CHUNK_LIFE_SEC leaves cubes on screen continuously. */
export const BIG_HIT_REFRACTORY_SEC = 2.6;
/** How hard the kick itself has to hit, on the low-band onset pulse. */
export const BIG_HIT_PULSE_MIN = 0.55;
/** Phrase-level loudness at or above which a strong kick is enough on its own. */
export const BIG_HIT_SECTION_MIN = 0.75;
/** Second route: how far clear of its own slow baseline the bass level has
 *  to reach for a hit to count as big without a loud section behind it. */
export const BIG_HIT_MARGIN = 1.25;
export const BIG_HIT_FLOOR = 0.06;

/** Cloud radius bounds, in world units. */
export const CLOUD_RADIUS_MIN = 0.12;
export const CLOUD_RADIUS_MAX = 1.5;
/** Rest radius across the Cloud size slider. */
const CLOUD_REST_MIN = 0.15;
const CLOUD_REST_MAX = 0.50;
/** One-pole time constant the radius is slewed with, so a section change
 *  swells the blob rather than popping it. */
const CLOUD_SLEW_TAU = 0.25;

/** Per-grain additive brightness scale. Additive blending over a couple of
 *  hundred thousand overlapping points blows out fast, so this is the one
 *  constant to move if the compact blob clips to flat white or the expanded
 *  cloud fades out. */
const POWDER_GAIN = 0.13;
/** Point-size multiplier for a sparse bed.
 *
 *  A floor-tier cloud is a fiftieth of a high-tier one, and at the high
 *  tier's point size that reads as a scatter of discrete dots rather than as
 *  powder. What decides whether sprites merge into smoke is *coverage* —
 *  count times sprite area — so holding the look across tiers means scaling
 *  the diameter as 1/sqrt(count): fewer, fatter, fainter puffs carrying the
 *  same total smoke. A fixed pixel boost can't do it; at 4k grains no
 *  addition small enough to leave the high tier alone is ever large enough
 *  to make the sprites overlap.
 *
 *  Because this already holds coverage constant, the powder pass does *not*
 *  also apply chladni's grainGain() — that compensates a sparse bed by
 *  brightening each grain instead, and doing both would blow the floor tier
 *  out to white. Capped, since a bed sparse enough to want more than this is
 *  going to look coarse whatever we do. */
export const SPARSE_SIZE_SCALE_CAP = 7;
export function sparseSizeScale(grainCount: number): number {
  return Math.min(SPARSE_SIZE_SCALE_CAP, Math.sqrt(REFERENCE_GRAINS / Math.max(1, grainCount)));
}

/** On-screen point diameter across the Grain size slider, at the reference
 *  resolution and the cloud's own depth, plus the ceiling a near particle
 *  may grow to. */
const GRAIN_PX_MIN = 2.0;
const GRAIN_PX_MAX = 4.5;
const POINT_PX_CAP = 6.0;
/** Resolution the sizes above are quoted at, and the floor the resolution
 *  scale is allowed to reach. It has to go well below the governor's own
 *  0.3 renderScale: the gallery renders every scene into a preview buffer
 *  smaller still, and pointSizing's own one-pixel clamp already stops the
 *  size going degenerate — the floor only exists to keep the arithmetic
 *  away from zero. */
const REFERENCE_HEIGHT_PX = 720;
const MIN_RES_SCALE = 0.1;

export interface PointSizing {
  /** gl_PointSize for a particle at the cloud's centre, in buffer pixels. */
  sizePx: number;
  /** Ceiling gl_PointSize clamps to, so a near particle can still grow. */
  maxPx: number;
  /** Brightness multiplier that holds accumulated coverage constant. */
  gain: number;
}

/** Point size and the brightness correction that goes with it.
 *
 *  A fixed particle count drawn at a fixed pixel size into a *smaller* buffer
 *  piles the same powder into fewer pixels, so a scene like this blows out to
 *  flat white the moment the quality governor drops renderScale — which it
 *  does, to 0.3, well before it drops the preset. Sizes therefore scale with
 *  the buffer; where the one-pixel floor stops them from shrinking any
 *  further, `gain` gives back exactly the coverage the clamp added, as the
 *  square of how far the size was held above nominal. At the reference
 *  resolution nothing clamps and `gain` is exactly 1. */
export function pointSizing(grainPx: number, resScale: number, sizeScale: number): PointSizing {
  const nominal = grainPx * sizeScale * resScale;
  const maxPx = Math.max(1, POINT_PX_CAP * sizeScale * resScale);
  const sizePx = Math.min(Math.max(nominal, 1), maxPx);
  return { sizePx, maxPx, gain: (nominal / sizePx) ** 2 };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Outward impulse envelope: bass rises push it up, it decays exponentially.
 *  What makes a kick throw a shell of powder outward and then let it coast. */
export interface Shove {
  /** Adds an impulse, saturating at SHOVE_CAP. Negative amounts are ignored. */
  trigger(amount: number): void;
  /** Decays by `dt` seconds and returns the new value. */
  advance(dt: number): number;
  /** Current value, without advancing. */
  readonly value: number;
}

export function createShove(): Shove {
  let v = 0;
  return {
    get value() {
      return v;
    },
    trigger(amount: number): void {
      if (!Number.isFinite(amount) || amount <= 0) return;
      v = Math.min(v + amount, SHOVE_CAP);
    },
    advance(dt: number): number {
      const d = Number.isFinite(dt) && dt > 0 ? dt : 0;
      v *= Math.exp(-SHOVE_DECAY * d);
      return v;
    },
  };
}

/** Fires on the hits worth throwing cubes for: any detected drop, or a bass
 *  hit well clear of its own slow baseline and outside the refractory
 *  window. */
export interface BigHitDetector {
  /** Steps the baseline and returns the burst strength in (0, 1] when this
   *  frame should fire, or 0 when it shouldn't. (A number rather than a bare
   *  boolean: the caller needs the strength anyway, and 0 is an unambiguous
   *  "didn't fire".) */
  advance(
    dt: number,
    low: number,
    lowPulse: number,
    sectionIntensity: number,
    lowRose: boolean,
    dropRose: boolean,
  ): number;
  /** The slow bass baseline, for tests and the probe. */
  readonly baseline: number;
}

export function createBigHitDetector(): BigHitDetector {
  let base = 0;
  // Start clear of the refractory window so the very first hit can fire.
  let sinceFire = BIG_HIT_REFRACTORY_SEC * 10;
  return {
    get baseline() {
      return base;
    },
    advance(dt, low, lowPulse, sectionIntensity, lowRose, dropRose): number {
      const d = Number.isFinite(dt) && dt > 0 ? dt : 0;
      const level = Number.isFinite(low) ? low : 0;
      const pulse = Number.isFinite(lowPulse) ? lowPulse : 0;
      const section = Number.isFinite(sectionIntensity) ? sectionIntensity : 0;
      base += (level - base) * (1 - Math.exp(-d / BIG_HIT_BASE_TAU));
      sinceFire += d;
      if (dropRose) {
        sinceFire = 0;
        return 1;
      }
      const loudSection = section >= BIG_HIT_SECTION_MIN;
      const clearOfBaseline = level > base * BIG_HIT_MARGIN + BIG_HIT_FLOOR;
      if (
        lowRose &&
        sinceFire >= BIG_HIT_REFRACTORY_SEC &&
        pulse >= BIG_HIT_PULSE_MIN &&
        (loudSection || clearOfBaseline)
      ) {
        sinceFire = 0;
        return Math.max(0.45, Math.min(1, 0.45 + 0.55 * pulse));
      }
      return 0;
    },
  };
}

/** One live cube burst: when it started, how hard, and the hash seed that
 *  decides its cubes' directions. */
export interface ChunkBurst {
  t0: number;
  strength: number;
  seed: number;
}

export interface ChunkPool {
  /** Starts a burst, reusing a dead slot or displacing the oldest live one. */
  trigger(nowSec: number, strength: number, seed: number): void;
  /** Retires every burst older than CHUNK_LIFE_SEC. */
  tick(nowSec: number): void;
  /** How many bursts are currently live. */
  alive(): number;
  /** Uploads the pool as uChunkT0/uChunkStrength/uChunkSeed. */
  upload(prog: GLProgram): void;
  /** The raw slots, for tests and the probe. */
  readonly bursts: readonly ChunkBurst[];
}

export function createChunkPool(): ChunkPool {
  const bursts: ChunkBurst[] = [];
  for (let i = 0; i < MAX_CHUNK_BURSTS; i++) bursts.push({ t0: CHUNK_DEAD_T0, strength: 0, seed: 0 });
  const t0Buf = new Float32Array(MAX_CHUNK_BURSTS);
  const strengthBuf = new Float32Array(MAX_CHUNK_BURSTS);
  const seedBuf = new Float32Array(MAX_CHUNK_BURSTS);

  return {
    bursts,
    trigger(nowSec, strength, seed): void {
      let slot = 0;
      let oldest = Infinity;
      for (let i = 0; i < bursts.length; i++) {
        if (bursts[i].t0 === CHUNK_DEAD_T0) {
          slot = i;
          oldest = -Infinity;
          break;
        }
        if (bursts[i].t0 < oldest) {
          oldest = bursts[i].t0;
          slot = i;
        }
      }
      bursts[slot].t0 = nowSec;
      bursts[slot].strength = Math.max(0, strength);
      bursts[slot].seed = seed;
    },
    tick(nowSec): void {
      for (const b of bursts) {
        if (b.t0 !== CHUNK_DEAD_T0 && nowSec - b.t0 > CHUNK_LIFE_SEC) {
          b.t0 = CHUNK_DEAD_T0;
          b.strength = 0;
        }
      }
    },
    alive(): number {
      let n = 0;
      for (const b of bursts) if (b.t0 !== CHUNK_DEAD_T0) n++;
      return n;
    },
    upload(prog): void {
      for (let i = 0; i < bursts.length; i++) {
        t0Buf[i] = bursts[i].t0;
        strengthBuf[i] = bursts[i].strength;
        seedBuf[i] = bursts[i].seed;
      }
      prog.setFv("uChunkT0", t0Buf);
      prog.setFv("uChunkStrength", strengthBuf);
      prog.setFv("uChunkSeed", seedBuf);
    },
  };
}

/** Where the cloud's springs want every particle, in world units: a rest
 *  size from the Cloud size slider, swelled by the phrase-level loudness
 *  trend (how much is Loud swell's job), nudged by the live bass level and
 *  punched on each kick. Slewed by the caller — see CLOUD_SLEW_TAU. */
export function cloudRadius(
  size: number,
  breathe: number,
  sectionIntensity: number,
  low: number,
  lowPulse: number,
  kick: number,
): number {
  const rest = CLOUD_REST_MIN + (CLOUD_REST_MAX - CLOUD_REST_MIN) * clamp01(size);
  const section = 0.5 + clamp01(breathe) * (clamp01(sectionIntensity) - 0.5);
  const r =
    rest *
    (0.55 + 0.9 * section) *
    (1 + 0.25 * Math.max(0, low)) *
    (1 + 0.2 * clamp01(kick) * Math.max(0, lowPulse));
  return Math.max(CLOUD_RADIUS_MIN, Math.min(CLOUD_RADIUS_MAX, r));
}

const SETTINGS: SceneSetting[] = [
  {
    key: "size",
    label: "Cloud size",
    description: "How much of the room the powder fills when it's at rest",
    group: "Cloud",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    // A loud, busy room fills the frame.
    auto: { loudness: 0.3, density: 0.15 },
  },
  {
    key: "breathe",
    label: "Loud swell",
    description: "How far the cloud contracts in the quiet parts and expands in the loud ones",
    group: "Cloud",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    // Quiet-verse / loud-chorus tracks are the ones worth breathing on.
    auto: { dynamics: 0.35 },
  },
  {
    key: "turbulence",
    label: "Turbulence",
    description: "How hard the air churns the powder — swirls, tendrils and wisps peeling off the mass",
    group: "Cloud",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    // Busy, fast mixes churn more.
    auto: { density: 0.25, tempo: 0.2 },
  },
  {
    key: "swirl",
    label: "Swirl",
    description: "How fast the whole cloud turns on its axis",
    group: "Cloud",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.3,
    // The turn follows the tempo.
    auto: { tempo: 0.3 },
  },
  {
    key: "kick",
    label: "Bass kick",
    description: "Every bass hit shoves a shell of powder outward; it coasts, then settles back",
    group: "Beat",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    // Dark, bass-heavy mixes carry more kick presence to throw on.
    auto: { attack: 0.3, brightness: -0.2 },
  },
  {
    key: "chunks",
    label: "Chunk burst",
    description: "The hardest hits throw a spray of chunky red cubes out of the mass",
    group: "Beat",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    // Cubes read best on punchy, dynamic music.
    auto: { attack: 0.25, dynamics: 0.2 },
  },
  {
    key: "flash",
    label: "Beat flash",
    description: "Brightness punch on each beat",
    group: "Beat",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.3,
    // Same reasoning as chladni's and caustics' flash: punches read on
    // punchy, uncluttered material.
    auto: { attack: 0.3, pulse: 0.2, density: -0.15 },
  },
  {
    key: "heat",
    label: "Red heat",
    description: "How much of the powder glows hot red instead of ice blue",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.4,
    // The red fraction grows with loud, dark mixes.
    auto: { loudness: 0.2, brightness: -0.2 },
  },
  {
    key: "glow",
    label: "Glow",
    description: "How bright each speck of powder is; overlapping specks add up",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    // As chladni's grain brightness.
    auto: { loudness: 0.2 },
  },
  {
    key: "grain",
    label: "Grain size",
    description: "Size of each speck on screen — fine dust or coarse chalk",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
  },
  {
    key: "room",
    label: "Room",
    description: "How visible the dark box room behind the powder is",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
  },
  {
    key: "paletteMix",
    label: "Palette tint",
    description: "0 keeps the powder's own ice-blue and coral; 1 recolours it with the app palette",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0,
    advanced: true,
  },
];

function settingFor(key: string): SceneSetting {
  const s = SETTINGS.find((x) => x.key === key);
  if (!s) throw new Error(`powder: unknown setting ${key}`);
  return s;
}

const SETTINGS_UNIFORMS_GLSL = SETTINGS.map((s) => `uniform float ${settingUniformName(s.key)};`).join("\n");

// Shared by the sim, room, powder and chunk programs so the packing, the
// noise and the camera can't drift apart between them.
const POWDER_GLSL = `
const float POS_RANGE = ${POS_RANGE.toFixed(4)};
const float CAGE_HALF_X = ${CAGE_HALF_X.toFixed(4)};
const float CAGE_FLOOR_Y = ${CAGE_FLOOR_Y.toFixed(4)};
const float CAGE_CEIL_Y = ${CAGE_CEIL_Y.toFixed(4)};
const float CAGE_HALF_Z = ${CAGE_HALF_Z.toFixed(4)};
const vec3 ROOM_MIN = vec3(${(-ROOM_HALF_X).toFixed(4)}, ${ROOM_FLOOR_Y.toFixed(4)}, ${ROOM_BACK_Z.toFixed(4)});
const vec3 ROOM_MAX = vec3(${ROOM_HALF_X.toFixed(4)}, ${ROOM_CEIL_Y.toFixed(4)}, ${ROOM_FRONT_Z.toFixed(4)});
const vec3 EYE = vec3(0.0, ${EYE_Y.toFixed(4)}, ${EYE_Z.toFixed(4)});
const float FOV_TAN = ${FOV_TAN.toFixed(6)};
const float SIZE_DEPTH_REF = ${SIZE_DEPTH_REF.toFixed(4)};
const float CURL_NORM = ${CURL_NORM.toFixed(4)};

uniform float uYaw;         // cloud spin about Y, radians
uniform float uCloudRadius; // slewed rest radius of the cloud, world units

// --- 16-bit fixed point per axis over [-POS_RANGE, POS_RANGE] ---
float unpackAxis(vec2 c) {
  vec2 b = floor(c * 255.0 + 0.5);
  float v = (b.x * 256.0 + b.y) / 65535.0;
  return (v * 2.0 - 1.0) * POS_RANGE;
}

vec2 packAxis(float p) {
  float v = clamp(p / POS_RANGE * 0.5 + 0.5, 0.0, 1.0) * 65535.0;
  float hi = floor(v / 256.0);
  float lo = floor(v - hi * 256.0 + 0.5);
  return vec2(hi, lo) / 255.0;
}

// --- hashes: the 3D extension of chladni.ts's hash21/hash22 ---
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float hash31(vec3 p) {
  p = fract(p * vec3(123.34, 456.21, 789.13));
  p += dot(p, p.yzx + 45.32);
  return fract((p.x + p.y) * p.z);
}

vec3 hash33(vec3 p) {
  return vec3(hash31(p), hash31(p + 19.19), hash31(p + 37.71));
}

// --- value noise: trilinear over 8 hashed lattice corners ---
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = p - i;
  vec3 w = f * f * (3.0 - 2.0 * f);
  float n000 = hash31(i);
  float n100 = hash31(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash31(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash31(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash31(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash31(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash31(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash31(i + vec3(1.0, 1.0, 1.0));
  return mix(mix(mix(n000, n100, w.x), mix(n010, n110, w.x), w.y),
             mix(mix(n001, n101, w.x), mix(n011, n111, w.x), w.y), w.z);
}

// Trilinear value noise averages eight independent uniforms, so vnoise's own
// distribution is bunched hard around 0.5 (sigma is well under 0.2). Anything
// that wants noise as a *shape* — the cloud's lobes, the red field's patches
// — needs it spread back out or the result is visually flat, so this widens
// it about the midpoint and clips the tails.
float vnoiseW(vec3 p) {
  return clamp((vnoise(p) - 0.5) * ${VNOISE_WIDEN.toFixed(2)} + 0.5, 0.0, 1.0);
}

// A three-channel vector potential; its curl is divergence-free, which is
// what makes the flow read as air rather than as a source/sink field.
vec3 psi(vec3 p) {
  return vec3(vnoise(p + vec3(11.3, 5.1, 2.7)),
              vnoise(p + vec3(3.9, 17.4, 8.2)),
              vnoise(p + vec3(6.6, 1.2, 23.5))) - 0.5;
}

vec3 curlOnce(vec3 p) {
  const float e = 0.05;
  vec3 dx = (psi(p + vec3(e, 0.0, 0.0)) - psi(p - vec3(e, 0.0, 0.0))) / (2.0 * e);
  vec3 dy = (psi(p + vec3(0.0, e, 0.0)) - psi(p - vec3(0.0, e, 0.0))) / (2.0 * e);
  vec3 dz = (psi(p + vec3(0.0, 0.0, e)) - psi(p - vec3(0.0, 0.0, e))) / (2.0 * e);
  return vec3(dy.z - dz.y, dz.x - dx.z, dx.y - dy.x);
}

// Two octaves: the base swirl plus a finer one at 40% for the tendrils.
vec3 curl(vec3 p) {
  return (curlOnce(p) + 0.4 * curlOnce(p * 2.3 + 13.7)) * CURL_NORM;
}

// --- camera ---
void cameraBasis(out vec3 eye, out vec3 right, out vec3 up, out vec3 fwd) {
  eye = EYE;
  fwd = normalize(-eye);
  right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
  up = cross(right, fwd);
}

// Aspect of the whole room-space canvas, not of this device's slice — at the
// full viewport {0,0,1,1} this is exactly uResolution.x / uResolution.y, and
// under Panorama it keeps every device projecting the same room.
float roomAspect() {
  return (uResolution.x * uViewport.w) / max(uResolution.y * uViewport.z, 1e-4);
}

/** World point -> (right, up, depth-in-front-of-eye). */
vec3 worldToView(vec3 p) {
  vec3 eye, right, up, fwd;
  cameraBasis(eye, right, up, fwd);
  vec3 d = p - eye;
  return vec3(dot(d, right), dot(d, up), dot(d, fwd));
}

/** View point -> room-space NDC in [-1,1]. Caller must reject v.z <= 0. */
vec2 viewToNdc(vec3 v) {
  return vec2(v.x / (FOV_TAN * roomAspect()), v.y / FOV_TAN) / max(v.z, 1e-3);
}

/** Camera ray for a room-space uv. */
vec3 roomRay(vec2 ruv) {
  vec3 eye, right, up, fwd;
  cameraBasis(eye, right, up, fwd);
  vec2 ndc = ruv * 2.0 - 1.0;
  return normalize(right * (ndc.x * FOV_TAN * roomAspect()) + up * (ndc.y * FOV_TAN) + fwd);
}

/** The slow orbit, applied to the cloud rather than to the eye. */
vec3 spin(vec3 p) {
  float c = cos(uYaw), s = sin(uYaw);
  return vec3(c * p.x + s * p.z, p.y, c * p.z - s * p.x);
}
`;

const SIM_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
layout(location = 0) out vec4 outPosXY;
layout(location = 1) out vec4 outPosZW;
${COMMON_UNIFORMS_GLSL}
${SETTINGS_UNIFORMS_GLSL}
uniform sampler2D uPosXY;
uniform sampler2D uPosZW;
uniform float uSimDt;
uniform float uShove;
uniform float uSettleScale;
${POWDER_GLSL}

void main() {
  ivec2 texel = ivec2(gl_FragCoord.xy);
  vec4 cxy = texelFetch(uPosXY, texel, 0);
  vec4 czw = texelFetch(uPosZW, texel, 0);
  vec3 p = vec3(unpackAxis(cxy.rg), unpackAxis(cxy.ba), unpackAxis(czw.rg));
  float heat = czw.b;

  vec2 seed = vec2(texel) * 0.173 + 7.31;
  float dt = uSimDt;

  // Where this particle belongs: a fixed direction and a radius biased
  // toward the core (pow < 1 on a uniform is denser at the middle).
  vec3 homeDir = normalize(hash33(vec3(seed, 1.7)) * 2.0 - 1.0 + 1e-4);
  float homeRadius = pow(hash21(seed + 1.3), 0.6);
  // An eighth of the powder belongs to a diffuse outer halo, so the mass has
  // a soft, wispy edge instead of a billiard-ball silhouette.
  homeRadius *= mix(1.0, 1.75, step(0.88, hash21(seed + 8.8)));
  // The cloud is not a ball: a slow, low-frequency noise over the home
  // *direction* bulges some sides out and hollows others in, and drifts, so
  // the silhouette keeps changing lobes the way a real thrown mass does.
  float lobe = 0.55 + 0.9 * vnoiseW(homeDir * 1.6 + vec3(0.0, uTime * 0.05, 0.0) + 31.0);
  vec3 rest = homeDir * homeRadius * uCloudRadius * lobe;

  // Spring home, tapered: a particle within SETTLE_FREE_FRACTION of its home
  // is barely held at all (the curl field owns it, which is where the swirls
  // and tendrils come from) while a far stray is reeled back hard.
  vec3 toHome = rest - p;
  float stray = smoothstep(0.0, ${SETTLE_FREE_FRACTION.toFixed(3)}, length(toHome) / max(uCloudRadius, 0.05));
  p += toHome * (1.0 - exp(-${SETTLE_RATE.toFixed(3)} * uSettleScale * dt)) * stray;

  // Everything that pushes powder *away* from the middle fades out past a
  // couple of cloud radii, so a hard drop throws a ragged sphere that the
  // spring then recovers instead of pinning the whole bed against the
  // containment cage — which reads as a box-shaped haze, the one silhouette
  // the scene must never show.
  float far = 1.0 - smoothstep(2.0 * uCloudRadius, 3.5 * uCloudRadius, length(p));

  // Turbulence, the dominant term: curl noise whose texture scales with the
  // cloud, so a compact blob churns at the same visual scale as an expanded
  // one. uFlowPhase warps with the audio, uTime keeps the field evolving
  // through a flat passage where uFlowPhase barely moves.
  float turbAmp = uTurbulence * (0.6 + 1.6 * uEnergy) * uCloudRadius * 2.2;
  float turbFreq = 0.9 / max(uCloudRadius, 0.15);
  // The audio-warped drift is a straight translation in y; the uTime term
  // circles instead, because a second translation would advect the whole
  // cloud off-centre over a long track rather than just evolving the field.
  vec3 flow = curl(p * turbFreq
    + vec3(sin(uTime * 0.12) * 0.45, uFlowPhase * 0.15, cos(uTime * 0.12) * 0.45));
  p += flow * turbAmp * far * dt;

  // Kick: a shell pushed outward, but steered partly along the flow, so a
  // hit throws tendrils out of the mass instead of an even sphere. The
  // per-particle random gain keeps the shell ragged.
  vec3 dirOut = normalize(p + homeDir * 0.05 + 1e-5);
  vec3 curlDir = normalize(flow + 1e-5);
  dirOut = normalize(mix(dirOut, curlDir, 0.35));
  p += dirOut * uShove * (0.4 + 0.9 * hash21(seed + 2.7)) * far * dt;

  // Hot powder sags a little.
  p.y -= 0.05 * dt * heat;

  // Heat: decays away, topped up by whatever the current shove throws, and
  // a fixed random fraction of the cloud stays hot for the red core.
  heat = max(heat * exp(-1.2 * dt), min(1.0, uShove * 0.35 * hash21(seed + 4.1)));
  // The innate red. A per-particle coin flip gives salt-and-pepper speckle;
  // a low-frequency field over the home *direction* gives coherent red
  // regions inside and on the leading edges of the blue mass, which is what
  // the reference actually shows. It drifts slowly, so the red patches move
  // around the cloud rather than being baked in.
  float coreBias = 1.0 - smoothstep(0.1, 0.8, homeRadius);
  float hotField = vnoiseW(homeDir * 1.3 + vec3(uTime * 0.03, 0.0, 0.0) + 57.0);
  if (hotField > 1.0 - uHeat * 0.75 * (0.75 + 0.5 * coreBias)) heat = max(heat, 0.65);

  // Containment. Nothing respawns — the spring brings everything home.
  p = clamp(p, vec3(-CAGE_HALF_X + 0.05, CAGE_FLOOR_Y + 0.05, -CAGE_HALF_Z + 0.05),
               vec3(CAGE_HALF_X - 0.05, CAGE_CEIL_Y - 0.05, CAGE_HALF_Z - 0.05));

  vec2 px = packAxis(p.x);
  vec2 py = packAxis(p.y);
  vec2 pz = packAxis(p.z);
  outPosXY = vec4(px, py);
  outPosZW = vec4(pz, clamp(heat, 0.0, 1.0), 1.0);
}
`;

const ROOM_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
${COMMON_UNIFORMS_GLSL}
${SETTINGS_UNIFORMS_GLSL}
${PALETTE_GLSL}
${ROOM_UV_GLSL}
${POWDER_GLSL}

void main() {
  vec2 ruv = roomUv(vUv);
  vec3 ro = EYE;
  vec3 rd = roomRay(ruv);
  // Guard the slab test against an exactly axis-aligned ray.
  vec3 rdSafe = rd + vec3(lessThan(abs(rd), vec3(1e-5))) * 1e-5;
  vec3 inv = 1.0 / rdSafe;
  vec3 ta = (ROOM_MIN - ro) * inv;
  vec3 tb = (ROOM_MAX - ro) * inv;
  vec3 tFar = max(ta, tb);
  float tExit = min(min(tFar.x, tFar.y), tFar.z);
  vec3 hit = ro + rd * tExit;

  // Which of the six interior faces the ray leaves through.
  vec3 face = step(tFar, vec3(tExit + 1e-4));
  float onFloor = face.y * step(hit.y, ROOM_MIN.y + 0.01);

  // Back wall reads slightly lighter than the side walls; the floor is the
  // darkest surface in the room.
  float tone = mix(0.72, 1.0, face.z);
  tone = mix(tone, 0.60, face.y);
  tone = mix(tone, 0.42, onFloor);
  // A soft vertical gradient — light spills from the ceiling corner.
  tone *= 0.65 + 0.75 * smoothstep(ROOM_MIN.y, ROOM_MAX.y, hit.y);

  vec3 col = vec3(0.028, 0.036, 0.062) * tone;

  // Grainy wall texture at two scales.
  float grain = mix(vnoise(hit * 7.0), vnoise(hit * 29.0), 0.4);
  col *= mix(1.0, 0.4 + 1.2 * grain, 0.12);

  // A faint rim where two faces meet: the box's own corners, nothing else.
  vec3 toEdge = min(hit - ROOM_MIN, ROOM_MAX - hit) + face * 1e3;
  float edge = min(min(toEdge.x, toEdge.y), toEdge.z);
  col += vec3(0.030, 0.038, 0.055) * (1.0 - smoothstep(0.0, 0.08, edge));

  // Distance fog toward black, and a vignette on the shared room canvas
  // (not on vUv, so a Panorama slice doesn't get its own dark corners).
  col *= 1.0 - 0.75 * smoothstep(2.5, 9.0, tExit);
  vec2 vc = (ruv - 0.5) * vec2(2.0, 1.6);
  col *= 1.0 - 0.55 * dot(vc, vc);

  col = max(col, vec3(0.0));
  col *= 0.15 + uRoom;
  col *= 1.0 + uFlash * uBeatPulse * 0.25;
  outColor = vec4(col, 1.0);
}
`;

const POINT_VERT = `#version 300 es
precision highp float;
${COMMON_UNIFORMS_GLSL}
${SETTINGS_UNIFORMS_GLSL}
uniform sampler2D uPosXY;
uniform sampler2D uPosZW;
uniform float uSide;
uniform float uGrainPx;   // point diameter at SIZE_DEPTH_REF, buffer pixels
uniform float uMaxPointPx;
${POWDER_GLSL}
out float vHeat;
out float vDepthFade;
out float vSeed;

void main() {
  int side = int(uSide);
  ivec2 texel = ivec2(gl_VertexID % side, gl_VertexID / side);
  vec4 cxy = texelFetch(uPosXY, texel, 0);
  vec4 czw = texelFetch(uPosZW, texel, 0);
  vec3 p = spin(vec3(unpackAxis(cxy.rg), unpackAxis(cxy.ba), unpackAxis(czw.rg)));
  vHeat = czw.b;

  vec3 v = worldToView(p);
  if (v.z <= 0.05) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vDepthFade = 0.0;
    vSeed = 0.0;
    return;
  }

  vec2 ndc = viewToNdc(v);
  vec2 room = ndc * 0.5 + 0.5;
  vec2 dev = (room - uViewport.xy) / uViewport.zw;
  gl_Position = vec4(dev * 2.0 - 1.0, 0.0, 1.0);

  // No two specks alike: a fixed per-particle brightness jitter.
  vSeed = 0.85 + 0.3 * hash21(vec2(texel) * 0.731 + 3.17);
  vDepthFade = mix(1.0, 0.35, smoothstep(2.0, 5.2, v.z));

  // Size comes from JS (see pointSizing) so the brightness correction that
  // pairs with it can be computed from the same numbers.
  gl_PointSize = clamp(uGrainPx * SIZE_DEPTH_REF / max(v.z, 0.5), 1.0, uMaxPointPx);
}
`;

const POINT_FRAG = `#version 300 es
precision highp float;
in float vHeat;
in float vDepthFade;
in float vSeed;
out vec4 outColor;
${COMMON_UNIFORMS_GLSL}
${SETTINGS_UNIFORMS_GLSL}
uniform float uGrainGain;
${PALETTE_GLSL}

void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d);
  if (r2 > 0.25) discard;
  // A gaussian-ish falloff rather than a hard-edged blob: overlapping
  // sprites then sum into smoke instead of into speckle.
  float soft = exp(-r2 * 10.0);

  // A real ice blue, not a pale one: additive summing walks every colour
  // toward white, so the resting hue has to start well clear of it.
  vec3 cool = vec3(0.30, 0.55, 1.00);
  vec3 hot = vec3(1.00, 0.24, 0.16);
  float hotness = smoothstep(0.15, 0.7, vHeat);
  vec3 col = mix(cool, hot, hotness);
  col = mix(col, palette(0.3 + 0.5 * vHeat, uPalA, uPalB, uPalC, uPalD), uPaletteMix);

  // The coral is much darker than the ice blue at equal brightness; lift it
  // so a red core reads as hot rather than as a hole in the cloud.
  float bright = uGrainGain * (0.35 + 0.9 * uGlow) * vSeed * vDepthFade
               * (1.0 + 0.5 * hotness) * (1.0 + uFlash * uBeatPulse * 0.6);
  outColor = vec4(col * bright * soft, 1.0);
}
`;

const CHUNK_VERT = `#version 300 es
precision highp float;
${COMMON_UNIFORMS_GLSL}
${SETTINGS_UNIFORMS_GLSL}
uniform float uChunkT0[${MAX_CHUNK_BURSTS}];
uniform float uChunkStrength[${MAX_CHUNK_BURSTS}];
uniform float uChunkSeed[${MAX_CHUNK_BURSTS}];
${POWDER_GLSL}
uniform float uResScale;
out float vRot;
out float vFade;

const int PER_BURST = ${CHUNKS_PER_BURST};
const float LIFE = ${CHUNK_LIFE_SEC.toFixed(3)};
const float DRAG = 1.6;

void main() {
  int burst = gl_VertexID / PER_BURST;
  int idx = gl_VertexID - burst * PER_BURST;
  float age = uTime - uChunkT0[burst];
  if (age < 0.0 || age > LIFE) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vRot = 0.0;
    vFade = 0.0;
    return;
  }

  float strength = uChunkStrength[burst];
  vec3 h = hash33(vec3(float(idx), uChunkSeed[burst], 1.7));
  vec3 dir = normalize(h * 2.0 - 1.0 + 1e-4);
  // Launch speed and gravity both scale with the cloud, so the cubes always
  // fly a few cloud radii and read as debris thrown out of *this* mass. Held
  // in world units instead, a burst off a compact cloud shoots clean out of
  // the room and reads as an unrelated ring of red squares.
  float v0 = (2.5 + 5.5 * h.x) * strength * uCloudRadius;
  // Drag-damped launch plus gravity, evaluated in closed form — see the
  // file header for why the cubes carry no state.
  vec3 pos = dir * 0.15 * uCloudRadius
           + dir * v0 * (1.0 - exp(-DRAG * age)) / DRAG
           + vec3(0.0, -0.9 * uCloudRadius * age * age, 0.0);

  vec3 v = worldToView(pos);
  if (v.z <= 0.05) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vRot = 0.0;
    vFade = 0.0;
    return;
  }

  vec2 ndc = viewToNdc(v);
  vec2 room = ndc * 0.5 + 0.5;
  vec2 dev = (room - uViewport.xy) / uViewport.zw;
  gl_Position = vec4(dev * 2.0 - 1.0, 0.0, 1.0);

  vFade = 1.0 - smoothstep(0.6 * LIFE, LIFE, age);
  vRot = age * (3.0 + 4.0 * h.y);
  gl_PointSize = mix(9.0, 18.0, h.z) * uResScale * SIZE_DEPTH_REF / max(v.z, 0.5) * vFade;
}
`;

const CHUNK_FRAG = `#version 300 es
precision highp float;
in float vRot;
in float vFade;
out vec4 outColor;
${COMMON_UNIFORMS_GLSL}
${SETTINGS_UNIFORMS_GLSL}
${PALETTE_GLSL}

void main() {
  vec2 d = gl_PointCoord - 0.5;
  float c = cos(vRot), s = sin(vRot);
  vec2 q = vec2(c * d.x - s * d.y, s * d.x + c * d.y);
  float box = max(abs(q.x), abs(q.y));
  if (box > 0.36) discard;
  // Two-tone "cube": opposite quadrants read as a lit and an unlit face,
  // with a darker rim so the chunk has an edge rather than a glow.
  float shade = 0.7 + 0.5 * step(0.0, q.x * q.y);
  shade *= 1.0 - 0.35 * smoothstep(0.28, 0.36, box);
  vec3 hot = vec3(1.00, 0.22, 0.16);
  vec3 col = mix(hot, palette(0.72, uPalA, uPalB, uPalC, uPalD), uPaletteMix);
  outColor = vec4(col * 1.3 * shade * vFade * 0.9, 1.0);
}
`;

/** Packs one axis into two bytes of `out` at `off`, matching packAxis(). */
function writeAxis(out: Uint8Array, off: number, v: number): void {
  const clamped = Math.max(-POS_RANGE, Math.min(POS_RANGE, v));
  const u = Math.round(((clamped / POS_RANGE) * 0.5 + 0.5) * 65535);
  out[off] = u >> 8;
  out[off + 1] = u & 255;
}

/** Seeds the pair of state textures with a small ball of powder, so the very
 *  first frame already reads as a cloud rather than as a cube of static that
 *  the spring then has to collapse. */
function seedPositions(side: number): { xy: Uint8Array; zw: Uint8Array } {
  const n = side * side;
  const xy = new Uint8Array(n * 4);
  const zw = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    let x = 0;
    let y = 0;
    let z = 0;
    let d2 = 2;
    while (d2 > 1 || d2 < 1e-6) {
      x = Math.random() * 2 - 1;
      y = Math.random() * 2 - 1;
      z = Math.random() * 2 - 1;
      d2 = x * x + y * y + z * z;
    }
    const r = 0.25;
    writeAxis(xy, i * 4, x * r);
    writeAxis(xy, i * 4 + 2, y * r);
    writeAxis(zw, i * 4, z * r);
    zw[i * 4 + 2] = 0;
    zw[i * 4 + 3] = 255;
  }
  return { xy, zw };
}

function createPowderScene(): Scene {
  let simProg: GLProgram | null = null;
  let roomProg: GLProgram | null = null;
  let pointProg: GLProgram | null = null;
  let chunkProg: GLProgram | null = null;
  let quadVao: WebGLVertexArrayObject | null = null;
  let pointVao: WebGLVertexArrayObject | null = null;
  // Two colour attachments per ping-pong slot — see the file header.
  const texXY: (WebGLTexture | null)[] = [null, null];
  const texZW: (WebGLTexture | null)[] = [null, null];
  const fbo: (WebGLFramebuffer | null)[] = [null, null];
  let simXYLoc: WebGLUniformLocation | null = null;
  let simZWLoc: WebGLUniformLocation | null = null;
  let pointXYLoc: WebGLUniformLocation | null = null;
  let pointZWLoc: WebGLUniformLocation | null = null;
  let read = 0;
  let side = 1;
  let grainCount = 0;
  let lastFrameTime: number | null = null;
  let prevLowPulse = 0;
  let prevDropPulse = 0;
  let yaw = 0;
  let radius = CLOUD_REST_MIN;
  let radiusSeeded = false;
  let shove: Shove | null = null;
  let bigHit: BigHitDetector | null = null;
  let chunks: ChunkPool | null = null;
  const bandsBuf = new Float32Array(NUM_BANDS);

  function makeTexture(gl: WebGL2RenderingContext, data: Uint8Array): WebGLTexture | null {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, side, side, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  return {
    id: ID,
    name: "Powder",
    settings: SETTINGS,

    init(ctx: SceneContext) {
      const { gl } = ctx;
      simProg = createProgram(gl, SIM_FRAG);
      roomProg = createProgram(gl, ROOM_FRAG);
      pointProg = createProgram(gl, POINT_FRAG, POINT_VERT);
      chunkProg = createProgram(gl, CHUNK_FRAG, CHUNK_VERT);
      simXYLoc = gl.getUniformLocation(simProg.program, "uPosXY");
      simZWLoc = gl.getUniformLocation(simProg.program, "uPosZW");
      pointXYLoc = gl.getUniformLocation(pointProg.program, "uPosXY");
      pointZWLoc = gl.getUniformLocation(pointProg.program, "uPosZW");
      quadVao = createFullscreenQuad(gl);
      // Both point passes address their data by gl_VertexID and have no
      // vertex attributes at all, so they draw from an empty VAO rather than
      // the quad's 3-vertex buffer (which they'd read far past).
      pointVao = gl.createVertexArray();

      grainCount = Math.max(1, Math.floor(ctx.quality.maxParticles));
      side = grainTextureSide(grainCount);
      const seed = seedPositions(side);
      for (let i = 0; i < 2; i++) {
        texXY[i] = makeTexture(gl, seed.xy);
        texZW[i] = makeTexture(gl, seed.zw);
        const f = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, f);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texXY[i], 0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, texZW[i], 0);
        // drawBuffers is per-framebuffer state, so setting it here sticks for
        // the life of the FBO — the default framebuffer keeps its own.
        gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
        fbo[i] = f;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, null);

      read = 0;
      lastFrameTime = null;
      prevLowPulse = 0;
      prevDropPulse = 0;
      yaw = 0;
      radius = CLOUD_REST_MIN;
      radiusSeeded = false;
      shove = createShove();
      bigHit = createBigHitDetector();
      chunks = createChunkPool();
    },

    render(ctx, frame, viewport, palette, anim) {
      if (!simProg || !roomProg || !pointProg || !chunkProg || !quadVao || !pointVao) return;
      if (!shove || !bigHit || !chunks) return;
      const { gl } = ctx;

      // See the file header (and chladni.ts's) for why frame.time and not
      // anim.dtSec.
      const dt = lastFrameTime === null ? 1 / 60 : Math.max(0, Math.min(0.1, frame.time - lastFrameTime));
      lastFrameTime = frame.time;

      // Rises, not one-shots — see the file header.
      const lowRose = anim.lowPulse > prevLowPulse + 1e-3 || anim.lowOnset;
      const dropRose = anim.dropPulse > prevDropPulse + 1e-3 || anim.dropOnset;
      prevLowPulse = anim.lowPulse;
      prevDropPulse = anim.dropPulse;

      const sizeS = resolveSceneSetting(ID, settingFor("size"));
      const breatheS = resolveSceneSetting(ID, settingFor("breathe"));
      const swirlS = resolveSceneSetting(ID, settingFor("swirl"));
      const kickS = resolveSceneSetting(ID, settingFor("kick"));
      const chunksS = resolveSceneSetting(ID, settingFor("chunks"));
      const grainS = resolveSceneSetting(ID, settingFor("grain"));
      // The governor scales the drawing buffer, not the particle count — see
      // pointSizing for why every on-screen size is measured against it.
      const resScale = Math.max(MIN_RES_SCALE, gl.drawingBufferHeight / REFERENCE_HEIGHT_PX);

      if (lowRose) shove.trigger(SHOVE_IMPULSE * kickS * (0.6 + 0.6 * anim.lowPulse));
      if (dropRose) shove.trigger(SHOVE_IMPULSE * 1.2 * kickS);
      const shoveV = shove.advance(dt);
      const settleScale = 1 / (1 + SHOVE_SETTLE_DRAG * shoveV);

      const targetRadius = cloudRadius(sizeS, breatheS, anim.sectionIntensity, anim.low, anim.lowPulse, kickS);
      if (!radiusSeeded) {
        radius = targetRadius;
        radiusSeeded = true;
      } else {
        radius += (targetRadius - radius) * (1 - Math.exp(-dt / CLOUD_SLEW_TAU));
      }

      yaw = (yaw + (0.04 + 0.35 * swirlS) * dt) % (Math.PI * 2);

      // The detector's baseline is stepped every frame regardless, so turning
      // the cubes back on doesn't fire a stale burst from a cold baseline.
      const hitStrength = bigHit.advance(dt, anim.low, anim.lowPulse, anim.sectionIntensity, lowRose, dropRose);
      chunks.tick(anim.timeSec);
      if (chunksS >= 0.05 && hitStrength > 0) {
        chunks.trigger(anim.timeSec, hitStrength * (0.5 + chunksS), Math.random() * 100);
      }

      gl.disable(gl.BLEND);

      // 1. Sim pass: step every particle from fbo[read] into fbo[write].
      const write = 1 - read;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo[write]);
      gl.viewport(0, 0, side, side);
      simProg.use();
      uploadCommonUniforms(simProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf);
      simProg.setF("uSimDt", dt);
      simProg.setF("uShove", shoveV);
      simProg.setF("uSettleScale", settleScale);
      simProg.setF("uCloudRadius", radius);
      simProg.setF("uYaw", yaw);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texXY[read]);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, texZW[read]);
      gl.uniform1i(simXYLoc, 0);
      gl.uniform1i(simZWLoc, 1);
      drawFullscreenQuad(gl, quadVao);
      // Both hosts size the viewport to the drawing buffer and only re-set it
      // on resize; the gallery preview sets it per frame. Either way the
      // drawing buffer is the right thing to restore to.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      read = write;

      // 2. Room.
      roomProg.use();
      uploadCommonUniforms(roomProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf);
      roomProg.setF("uCloudRadius", radius);
      roomProg.setF("uYaw", yaw);
      drawFullscreenQuad(gl, quadVao);

      // 3. Powder. Additive: the glow on the core is what many overlapping
      // specks add up to, which is also this repo's stand-in for a bloom pass.
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      pointProg.use();
      uploadCommonUniforms(pointProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf);
      pointProg.setF("uSide", side);
      pointProg.setF("uCloudRadius", radius);
      pointProg.setF("uYaw", yaw);
      const grainPx = GRAIN_PX_MIN + (GRAIN_PX_MAX - GRAIN_PX_MIN) * grainS;
      const sizing = pointSizing(grainPx, resScale, sparseSizeScale(grainCount));
      pointProg.setF("uGrainPx", sizing.sizePx);
      pointProg.setF("uMaxPointPx", sizing.maxPx);
      // No grainGain() here — sparseSizeScale already holds a sparse bed's
      // coverage constant by area; brightening it as well would double up.
      pointProg.setF("uGrainGain", POWDER_GAIN * sizing.gain);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texXY[read]);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, texZW[read]);
      gl.uniform1i(pointXYLoc, 0);
      gl.uniform1i(pointZWLoc, 1);
      gl.bindVertexArray(pointVao);
      gl.drawArrays(gl.POINTS, 0, grainCount);

      // 4. Chunks — skipped entirely while nothing is flying.
      if (chunks.alive() > 0) {
        chunkProg.use();
        uploadCommonUniforms(chunkProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf);
        chunkProg.setF("uCloudRadius", radius);
        chunkProg.setF("uYaw", yaw);
        chunkProg.setF("uResScale", resScale);
        chunks.upload(chunkProg);
        gl.drawArrays(gl.POINTS, 0, MAX_CHUNK_BURSTS * CHUNKS_PER_BURST);
      }
      gl.bindVertexArray(null);

      // 5. The gallery renders every scene into one shared context each tick
      // — must not leak blend state, a bound texture or a non-default active
      // texture unit onto the next tile.
      gl.disable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ZERO);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, null);
    },

    dispose(ctx: SceneContext) {
      const { gl } = ctx;
      simProg?.dispose();
      roomProg?.dispose();
      pointProg?.dispose();
      chunkProg?.dispose();
      if (quadVao) gl.deleteVertexArray(quadVao);
      if (pointVao) gl.deleteVertexArray(pointVao);
      for (let i = 0; i < 2; i++) {
        if (fbo[i]) gl.deleteFramebuffer(fbo[i]);
        if (texXY[i]) gl.deleteTexture(texXY[i]);
        if (texZW[i]) gl.deleteTexture(texZW[i]);
        fbo[i] = null;
        texXY[i] = null;
        texZW[i] = null;
      }
      simProg = null;
      roomProg = null;
      pointProg = null;
      chunkProg = null;
      quadVao = null;
      pointVao = null;
      simXYLoc = null;
      simZWLoc = null;
      pointXYLoc = null;
      pointZWLoc = null;
      lastFrameTime = null;
      prevLowPulse = 0;
      prevDropPulse = 0;
      yaw = 0;
      radiusSeeded = false;
      shove = null;
      bigHit = null;
      chunks = null;
    },
  };
}

export const powderScene = createPowderScene();
