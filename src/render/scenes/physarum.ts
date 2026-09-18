import { NUM_BANDS } from "../../audio/types.ts";
import { createProgram, createFullscreenQuad, drawFullscreenQuad, type GLProgram } from "../gl.ts";
import { PALETTE_GLSL } from "../palette.ts";
import type { SceneSetting } from "../sceneSettings.ts";
import type { Scene, SceneContext } from "../scene.ts";
import { COMMON_UNIFORMS_GLSL, ROOM_UV_GLSL, settingUniformName, uploadCommonUniforms } from "../sceneCommon.ts";
import { grainTextureSide } from "./chladni.ts";

// Physarum: an agent-based slime-mould transport network. Each agent senses
// a chemical trail a short distance ahead — dead ahead and to each side —
// steers toward the strongest reading, steps forward, and deposits more
// trail behind it;
// the trail then diffuses and evaporates between deposits. Nothing here is
// drawn — the network is *grown*, frame by frame, out of that
// sense/steer/move/deposit/diffuse/evaporate loop, written from the
// published description of Jones's multi-agent slime-mould model rather than
// ported from any implementation (CLAUDE.md's standing rule — the same
// spirit as powder.ts writing its own curl noise). A route that keeps
// getting crossed thickens; one that doesn't fades back to nothing over a
// few seconds and the agents that were on it strike out fresh elsewhere.
// This is the gallery's only scene whose structure visibly reorganises
// itself over seconds rather than an instant: contrast powder.ts, whose
// particles carry real momentum but never remember a place they've been,
// and chladni.ts, whose sand chases a field with no memory of its own at
// all — the trail map here *is* memory, laid down by the agents that cross
// it and erased only by time.
//
// Packing. Two independent ping-pong pairs, both RGBA8 — see chladni.ts's
// header for why this repo never relies on EXT_color_buffer_float. Agent
// state is `side x side` (grainTextureSide(agentCount), reused from
// chladni.ts, read once at init as powder.ts reads its own particle count),
// two colour attachments via gl.drawBuffers:
//   attachment 0 (uAgentPos): R,G = x, B,A = y — 16-bit fixed point each
//     over the unit square.
//   attachment 1 (uAgentDir): R,G = heading — 16-bit over [0, TWO_PI) — B =
//     species, A = a per-agent speed jitter fixed at seed time.
// packUnit/unpackUnit generalise chladni's/powder's packAxis pair from a
// range symmetric about zero to a one-sided [0, range) span, so position
// (range 1) and heading (range TWO_PI) share one round trip instead of a
// second one. Heading needs the full 16 bits: at 8 bits a turn step would
// quantise onto a lattice of headings and the whole field would drift into
// axis-aligned streaks instead of curving freely. Species is fixed per
// agent at seed time, round-robin over GROUP_COUNT, and never changes — a
// network's colour is a property of the agent that grew it, not of where it
// currently stands.
//
// The trail map is a second, square texture, one channel per band group: R
// the low group's trail, G the mid group's, B the high group's, A unused.
// This is the scene's whole link to the music: a bassline thickens the red
// network, the hats thicken the blue one, and the picture shows which
// frequency group owns which branch, with Band braid deciding whether the
// groups read each other's trail at all or grow in isolation. The map's
// side comes from agent density, not screen size — trailSide keeps agents
// per texel roughly constant across the quality presets (see its own
// comment), because whether a network reads as a network or dissolves into
// unconnected worms depends on how many agents share a texel, not on how
// many pixels the window happens to have. It is rebuilt, and reseeded to
// zero, only when that size actually changes (the quality governor moves
// renderScale at runtime, so the stored size is compared every frame like
// powder.ts's ensureGlowTargets).
//
// The map samples LINEAR, because the composite and the sensors both tap
// between texels — and REPEAT on both axes, because the field is a torus
// and every one of those taps can straddle the wrap. Under CLAMP_TO_EDGE a
// straddling bilinear tap clamps instead of wrapping, which lays a hard
// seam line along the wrap in the picture (the relief gradient reads across
// it) and hands an agent crossing it a false sensor reading. WebGL2 honours
// REPEAT on the non-power-of-two sides trailSide produces, unlike WebGL1,
// so the fract() every sampler already applies is belt-and-braces rather
// than the thing keeping the field seamless.
//
// Passes, once per rendered frame: diffuse/evaporate/attract the trail
// (read -> write), sense-steer-move the agents against the trail that pass
// just produced, deposit the moved agents' new positions additively into
// that same write target, then swap both pairs. A deposit is therefore
// never blurred in the frame it was laid — the diffuse pass that would blur
// it already ran, against the *previous* frame's trail, before these agents
// moved or deposited anything.
//
// Evaporation is multiply-then-subtract-a-floor, never a bare multiply:
// `trail = max(0, trail * decayMul - floor)`. UNORM8 rounds to nearest on
// write, so a bare multiplicative decay stalls the moment a channel is low
// enough that round(v * decayMul) == v, and an abandoned route leaves a
// permanent grey ghost that never clears — the same class of precision bug
// as caustics' unbounded hash phase (see that file's header). Subtracting a
// small per-second floor (scaled by dt like every rate below) guarantees
// the decay is monotone all the way to exactly zero.
//
// dt comes from frame.time deltas, clamped to a sane maximum, never
// anim.dtSec — chladni.ts's and powder.ts's headers cover why. Every rate
// here — diffusing, decaying, evaporating, turning, crawling, depositing,
// the attractor pull — is a per-second quantity multiplied by that dt, so
// the look holds steady across frame rates and rendered-frame gaps. That
// matters for more than smoothness: ink laid per *frame* rather than per
// second would make the trail's resting level, and so the scene's whole
// exposure, drift with the frame rate. The beat-seeding epoch that
// relocates a slice of agents to fresh ground fires on a *rise* in the
// decaying beat pulse, with the one-shot onset flag folded in as a bonus —
// never on the one-shot flag alone, which render()'s frame-pace cap
// silently drops on a fast display (src/render/renderLatch.ts; powder.ts's
// header covers the same reasoning for its own triggers). The reseed itself
// only ever fires on the exact tick the epoch steps, not for as long as it
// holds that value — otherwise the same hash-selected slice of agents would
// keep re-teleporting every rendered frame until the next beat instead of
// sprouting once and then growing.
//
// The composite maps the square trail across room space with a cover fit —
// scaling the field up until it fully covers the room and cropping whichever
// axis the room is proportionally shorter on, using the same roomAspect()
// powder.ts computes so a Panorama pairing keeps every device sampling the
// same field. Cropping a torus is seamless, so cover-fit costs nothing and
// keeps the network isotropic regardless of the window's own aspect. Relief
// shades the filaments as lit tubes from the trail's own gradient against a
// fixed light, and is an exact no-op at zero.
const ID = "physarum";

const TWO_PI = Math.PI * 2;

/** How many band groups the trail channels, the species assignment and the
 *  wandering attractors are keyed to — see the file header. */
export const GROUP_COUNT = 3;

/** Cap on the square trail map's side, and the floor trailSide clamps to
 *  for a degenerate agent count — see trailSide's own comment. */
export const TRAIL_SIDE_CAP = 1024;
export const TRAIL_SIDE_MIN = 32;

/** Agents per trail texel the map is sized to hold — the density that
 *  decides whether the network reads as a network at all (see the file
 *  header) rather than a screen-size-driven map. */
export const AGENTS_PER_TEXEL = 0.25;

/** Side of the square trail map for `agentCount` agents, clamped to
 *  [TRAIL_SIDE_MIN, maxSide]. Pure and tested so the sizing holds at every
 *  quality preset without a GL context. */
export function trailSide(agentCount: number, maxSide: number): number {
  const count = Number.isFinite(agentCount) && agentCount > 0 ? agentCount : 0;
  const cap = Number.isFinite(maxSide) && maxSide > 0 ? Math.floor(maxSide) : TRAIL_SIDE_MIN;
  const raw = Math.round(Math.sqrt(count / AGENTS_PER_TEXEL));
  return Math.max(1, Math.min(cap, Math.max(TRAIL_SIDE_MIN, raw)));
}

/** Shortest gap between two epoch steps, so one beat can't advance the seed
 *  epoch twice — see the file header. */
const SEED_RISE_REFRACTORY_SEC = 0.1;

export interface BeatSeeder {
  /** How many times the epoch has stepped — folded into the reseed hash so
   *  a different slice of agents is picked each beat. */
  readonly epoch: number;
  /** Advances the clock; returns true on exactly the tick the epoch
   *  stepped, so the caller can gate the one-shot reseed to that tick. */
  advance(dt: number, beatPulse: number, onset: boolean): boolean;
}

/** Fires on a *rise* in the decaying beat pulse (onset folded in as a
 *  bonus, never as the sole source) rather than the one-shot boolean alone
 *  — see the file header and src/render/renderLatch.ts. */
export function createBeatSeeder(): BeatSeeder {
  let epoch = 0;
  let prevPulse = 0;
  let sinceRise = SEED_RISE_REFRACTORY_SEC * 10;
  return {
    get epoch() {
      return epoch;
    },
    advance(dt, beatPulse, onset): boolean {
      const d = Number.isFinite(dt) && dt > 0 ? dt : 0;
      const pulse = Number.isFinite(beatPulse) ? beatPulse : 0;
      sinceRise += d;
      const rose = pulse > prevPulse + 1e-3 || onset === true;
      prevPulse = pulse;
      if (rose && sinceRise >= SEED_RISE_REFRACTORY_SEC) {
        epoch++;
        sinceRise = 0;
        return true;
      }
      return false;
    },
  };
}

// The rings the wandering attractors circle: centred, and each on its own
// radius, so every point stays well inside the unit square regardless of
// phase. Different rates alone eventually bring any pair's *angle* into
// alignment (unequal constant rates on a shared circle sweep through every
// relative phase sooner or later) — giving each attractor its own radius
// too means an angle-aligned pair still sits |radius_i - radius_j| apart,
// a hard floor on separation rather than a probabilistic one.
const RING_CENTER = 0.5;
const RING_RADII = [0.22, 0.3, 0.38];
// Slow, mutually irrational-ish angular rates (rad/s) — powder.ts's
// ATTRACTOR_RATES reasoning, so the orbits never lock into one repeating
// figure.
const RING_RATES = [0.05, 0.07, 0.09];

/** Writes each band group's attractor position at time `tSec` into `out` as
 *  packed (x, y) pairs in the unit square. Pure and exported so the
 *  wandering shape is testable without a GL context — powder.ts's
 *  attractorPositions in the same shape. */
export function attractorPositions(tSec: number, out: Float32Array): Float32Array {
  const t = Number.isFinite(tSec) ? tSec : 0;
  for (let i = 0; i < GROUP_COUNT; i++) {
    const ph = t * RING_RATES[i] + (i * TWO_PI) / GROUP_COUNT;
    out[i * 2] = RING_CENTER + Math.cos(ph) * RING_RADII[i];
    out[i * 2 + 1] = RING_CENTER + Math.sin(ph) * RING_RADII[i];
  }
  return out;
}

/** 16-bit fixed point over [0, range) — the one-sided generalisation of
 *  chladni's/powder's packAxis pair (their range is symmetric about zero;
 *  this scene's position and heading both start at zero) so both share one
 *  round trip. The GLSL in PHYSARUM_GLSL mirrors this exactly; exported here
 *  so the round trip is checkable without a GL context. */
export function packUnit(v: number, range: number): [number, number] {
  const clamped = Math.max(0, Math.min(range, Number.isFinite(v) ? v : 0));
  const u = Math.round((clamped / range) * 65535);
  return [u >> 8, u & 255];
}

export function unpackUnit(hi: number, lo: number, range: number): number {
  return ((hi * 256 + lo) / 65535) * range;
}

function writeUnit(out: Uint8Array, off: number, v: number, range: number): void {
  const [hi, lo] = packUnit(v, range);
  out[off] = hi;
  out[off + 1] = lo;
}

// --- Sensor/step geometry across the Network scale slider. ---
const SENSOR_DIST_BASE = 0.025;
const SCALE_FACTOR_MIN = 0.55;
const SCALE_FACTOR_MAX = 1.9;

// --- Fan angle across the Fan angle slider (radians), plus how far the
// live spectral centroid nudges it either side. ---
const FAN_MIN = 0.16;
const FAN_MAX = 1.05;
const FAN_MIN_SAFE = 0.05;
const CENTROID_FAN_GAIN = 0.22;

// --- Turn rate across the Turn rate slider, rad/s. What decides whether
// agents aggregate at all is not this rate on its own but how far an agent
// can turn per *step* it takes: steer too little over the distance between
// sensor readings and nothing ever commits to a trail, so the deposits stay
// an even wash instead of thickening into routes. These are paired with
// SPEED_* below to land near half a radian per step. ---
const TURN_RATE_MIN = 8.0;
const TURN_RATE_MAX = 70.0;

// --- Base crawl speed across the Crawl speed slider, unit-square units/s
// (the field spans [0,1), so 1.0 crosses it once a second), the per-agent
// jitter band it's drawn from, and how hard a beat surge multiplies it. ---
const SPEED_MIN = 0.05;
const SPEED_MAX = 0.28;
const JITTER_SPEED_MIN = 0.7;
const JITTER_SPEED_SPAN = 0.6;
const SURGE_GAIN = 2.2;

// --- Trail diffusion: how fast a deposit spreads into its neighbours, per
// second. A rate, not "blur the whole field once per frame": a full 3x3 box
// blur every frame spreads a deposit far faster than a quarter-agent-per-
// texel population can reinforce it — the network never gets past speckle —
// and it would make the look frame-rate dependent, which nothing else here
// is. ---
const DIFFUSE_RATE = 60.0;

// --- Trail decay: time constant across the Trail decay slider (seconds),
// the per-second floor subtracted after the multiply, and the dither that
// lets that floor stay small — see the file header for why a bare multiply
// stalls. ---
// The trail's resting level is set by nothing more than how much ink lands
// per texel per second times this time constant, so these two and the
// deposit rates below are one budget and have to be picked together: the
// field holds AGENTS_PER_TEXEL agents per texel, so at equilibrium the mean
// trail is (AGENTS_PER_TEXEL * deposit rate * tau). Keep that mean low — the
// bright network is agents *concentrating*, many deposits into one texel,
// not a high resting level — or every channel saturates and the picture goes
// to flat white. The structure outlives tau by far, because the agents keep
// reinforcing it; tau only sets how fast an *abandoned* route clears.
const DECAY_TAU_MAX = 0.45;
const DECAY_TAU_MIN = 0.05;
const EVAP_FLOOR_RATE = 0.04;
/** Dither amplitude on the trail write, in quantisation steps. */
const EVAP_DITHER = 1.0;

// --- Attractors: gaussian pull radius in field units, and how much harder
// the low group's attractor pulls right on a bass hit (see Band pull's
// `reads` in SETTINGS below — this is what makes that claim true). ---
const ATTRACTOR_SIGMA = 0.12;
const LOW_PULSE_BOOST = 1.5;

// --- Deposit, in trail units per second (multiplied by dt in the deposit
// pass, like every other rate here — a fixed amount per *frame* would make
// the resting trail level, and so the whole exposure, depend on the frame
// rate). A floor every agent lays down regardless of level, plus how much
// its own band group's current level adds on top, so a loud band's network
// genuinely reads thicker. Sized against DECAY_TAU_* above — see the budget
// note there. ---
const DEPOSIT_FLOOR_RATE = 0.7;
const DEPOSIT_GAIN_RATE = 1.2;

// --- Relief shading: gradient-to-normal strength and the fixed light it's
// lit against (normalized once, in JS, rather than in every fragment). ---
const RELIEF_GRAD_SCALE = 6.0;
const RELIEF_LIGHT = normalize3(0.45, 0.62, 0.6);
const RELIEF_GAIN = 1.6;

/** Composite smoothing kernel: how much of the colour comes from the centre
 *  texel versus each of its four neighbours. Sums to one, so it changes the
 *  grain and nothing about the exposure. */
const SMOOTH_CENTER = 0.44;
const SMOOTH_SIDE = 0.14;

const GLOW_BASE = 2.0;
const GLOW_SPAN = 8.0;
const FLASH_GAIN = 1.6;

function normalize3(x: number, y: number, z: number): [number, number, number] {
  const m = Math.hypot(x, y, z) || 1;
  return [x / m, y / m, z / m];
}

const SETTINGS: SceneSetting[] = [
  // --- Form ---
  {
    key: "scale",
    label: "Network scale",
    description: "Sensor distance and step length together — how coarse or fine the whole structure grows",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    // A busy, bright mix reads better on a finer network.
    auto: { density: -0.25, brightness: -0.15 },
  },
  {
    key: "fan",
    label: "Fan angle",
    description: "How wide the side sensors sit from the centre one — narrow grows long filaments, wide grows a reticulated mesh",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    reads: ["anim.centroid"],
    auto: { brightness: 0.2, density: 0.2 },
  },
  {
    key: "turn",
    label: "Turn rate",
    description: "How sharply an agent steers onto a trail it finds",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { attack: 0.2 },
  },
  {
    key: "wander",
    label: "Wander",
    description: "Random component in the turn — 0 grows a crystalline lattice, 1 a fuzzy one",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.35,
    auto: { dynamics: 0.15 },
  },
  {
    key: "decay",
    label: "Trail decay",
    description: "How fast an unused route evaporates — long memory, or a network that keeps rerouting",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { density: 0.2, tempo: 0.15 },
  },
  {
    key: "braid",
    label: "Band braid",
    description: "0 keeps the band groups' networks separate and braided; 1 merges them into a shared structure",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.2,
    auto: { density: 0.2 },
  },
  // --- Motion ---
  {
    key: "speed",
    label: "Crawl speed",
    description: "Base agent speed across the field",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { tempo: 0.3, pulse: 0.15 },
  },
  {
    key: "beatSurge",
    label: "Beat surge",
    description: "How hard each beat kicks the crawl, throwing new branches",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    reads: ["feature.onset"],
    auto: { pulse: 0.25, attack: 0.2 },
  },
  {
    key: "seed",
    label: "Beat seeding",
    description: "Share of agents a beat relocates to a fresh spawn point, starting growth somewhere new",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.3,
    reads: ["feature.onset"],
    auto: { attack: 0.25, dynamics: 0.15 },
  },
  {
    key: "reach",
    label: "Band pull",
    description: "How strongly each band group's attractor pulls its own network toward it",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    reads: ["anim.lowOnset"],
    auto: { density: 0.2 },
  },
  // --- Look ---
  {
    key: "glow",
    label: "Glow",
    description: "Brightness of the network",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { loudness: 0.2 },
  },
  {
    key: "relief",
    label: "Relief",
    description: "Shades the filaments as lit tubes instead of flat ink",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.4,
  },
  {
    key: "paletteMix",
    label: "Palette tint",
    description: "0 keeps the network's own band colours; 1 recolours it with the app palette",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0,
    advanced: true,
  },
  // --- Post ---
  {
    key: "flash",
    label: "Beat flash",
    description: "Brightness punch on each beat",
    group: "Post",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.3,
    reads: ["feature.onset"],
    // Same convention powder.ts and chladni.ts share for this control.
    auto: { attack: 0.3, pulse: 0.2, density: -0.15 },
  },
];

const SETTINGS_UNIFORMS_GLSL = SETTINGS.map((s) => `uniform float ${settingUniformName(s.key)};`).join("\n");

// Shared by every pass so the packing, the hashes, the species split and the
// room mapping can't drift apart between them.
const PHYSARUM_GLSL = `
const int GROUP_COUNT = ${GROUP_COUNT};
const float TWO_PI = ${TWO_PI.toFixed(6)};

// --- 16-bit fixed point over [0, range) — see the file header. ---
vec2 packUnitR(float v, float range) {
  float u = floor(clamp(v / range, 0.0, 1.0) * 65535.0 + 0.5);
  float hi = floor(u / 256.0);
  return vec2(hi, u - hi * 256.0) / 255.0;
}
float unpackUnitR(vec2 c, float range) {
  vec2 b = floor(c * 255.0 + 0.5);
  return (b.x * 256.0 + b.y) / 65535.0 * range;
}

// --- hashes: chladni.ts's own family, same fract/dot shape and constants. ---
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
vec2 hash22(vec2 p) {
  return vec2(hash21(p), hash21(p + 17.13));
}

// Which trail channel is this agent's own, as a one-hot mask; species is
// 0.0/0.5/1.0 across the GROUP_COUNT groups.
vec3 speciesMask(float species) {
  float idx = species * 2.0;
  if (idx < 0.5) return vec3(1.0, 0.0, 0.0);
  if (idx < 1.5) return vec3(0.0, 1.0, 0.0);
  return vec3(0.0, 0.0, 1.0);
}

// Own channel plus uBraid's share of the other two — see Band braid.
float sense(vec3 trailSample, vec3 mask, float braid) {
  float own = dot(trailSample, mask);
  float other = dot(trailSample, vec3(1.0) - mask);
  return own + braid * other;
}

ivec2 wrapTexel(ivec2 t, int side) {
  return ivec2(mod(vec2(t), vec2(float(side))));
}

// Aspect of the whole room-space canvas — powder.ts's roomAspect(), reused
// so a Panorama pairing keeps every device sampling the same field.
float roomAspect() {
  return (uResolution.x * uViewport.w) / max(uResolution.y * uViewport.z, 1e-4);
}

// Cover-fit of the square trail field across a roomAspect()-shaped room:
// scales the field up until it fully covers the room, cropping whichever
// axis the room is proportionally shorter on. See the file header for why
// that crop is free on a torus.
vec2 coverUv(vec2 ruv) {
  float aspect = roomAspect();
  float s = max(aspect, 1.0);
  vec2 rectSize = vec2(aspect, 1.0);
  return (ruv * rectSize + (vec2(s) - rectSize) * 0.5) / s;
}

`;

const DIFFUSE_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
${COMMON_UNIFORMS_GLSL}
${SETTINGS_UNIFORMS_GLSL}
uniform sampler2D uTrailIn;
uniform float uTrailSide;
uniform float uDiffuseDt;
uniform float uNoiseSeed;
uniform vec2 uAttractorPos[${GROUP_COUNT}];
${PHYSARUM_GLSL}

const float DIFFUSE_RATE = ${DIFFUSE_RATE.toFixed(4)};
const float DECAY_TAU_MAX = ${DECAY_TAU_MAX.toFixed(4)};
const float DECAY_TAU_MIN = ${DECAY_TAU_MIN.toFixed(4)};
const float EVAP_FLOOR_RATE = ${EVAP_FLOOR_RATE.toFixed(5)};
const float EVAP_DITHER = ${EVAP_DITHER.toFixed(4)};
const float ATTRACTOR_SIGMA = ${ATTRACTOR_SIGMA.toFixed(4)};
const float LOW_PULSE_BOOST = ${LOW_PULSE_BOOST.toFixed(4)};

void main() {
  ivec2 texel = ivec2(gl_FragCoord.xy);
  int side = int(uTrailSide);

  // 3x3 box blur, one texel apart, wrapped — the field is a torus.
  vec3 sum = vec3(0.0);
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      ivec2 nt = wrapTexel(texel + ivec2(dx, dy), side);
      sum += texelFetch(uTrailIn, nt, 0).rgb;
    }
  }
  vec3 blurred = sum / 9.0;
  vec3 center = texelFetch(uTrailIn, texel, 0).rgb;

  // Diffuse at a rate, rather than replacing the field with its own blur
  // every frame — see DIFFUSE_RATE.
  vec3 spread = mix(center, blurred, clamp(DIFFUSE_RATE * uDiffuseDt, 0.0, 1.0));

  // Evaporate: multiply, then subtract a floor — see the file header for
  // why a bare multiply stalls in 8-bit.
  float decayTau = mix(DECAY_TAU_MAX, DECAY_TAU_MIN, uDecay);
  float decayMul = exp(-uDiffuseDt / decayTau);
  vec3 trail = max(vec3(0.0), spread * decayMul - EVAP_FLOOR_RATE * uDiffuseDt);

  // Attract: each band group's wandering point adds into its own channel
  // only, so the network visibly reaches toward whichever group is loud.
  vec2 fuv = (vec2(texel) + 0.5) / uTrailSide;
  for (int i = 0; i < ${GROUP_COUNT}; i++) {
    vec2 d = fract(fuv - uAttractorPos[i] + 0.5) - 0.5;
    float g = exp(-dot(d, d) / (2.0 * ATTRACTOR_SIGMA * ATTRACTOR_SIGMA));
    float level = i == 0 ? uLow : (i == 1 ? uMid : uHigh);
    // Band pull's "reads" claims the low attractor pulses on a bass hit —
    // this is what makes that literally true.
    float lowBoost = i == 0 ? (1.0 + LOW_PULSE_BOOST * uLowPulse) : 1.0;
    trail[i] += level * uReach * lowBoost * g * uDiffuseDt;
  }

  // Dither the write by up to half a quantisation step. One frame of decay
  // is smaller than a step for any trail that isn't already bright, and
  // UNORM8 rounds to nearest, so without this the multiply rounds back to
  // where it started and stalls (the file header covers the stall). The
  // subtracted floor above guarantees monotonicity on its own; the dither
  // is what lets that floor stay small enough to be a precision guard
  // rather than the dominant decay term.
  float dither = (hash21(fuv * uTrailSide + uNoiseSeed) - 0.5) * EVAP_DITHER / 255.0;
  outColor = vec4(max(vec3(0.0), trail + dither), 1.0);
}
`;

const SIM_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
layout(location = 0) out vec4 outPos;
layout(location = 1) out vec4 outDir;
${COMMON_UNIFORMS_GLSL}
${SETTINGS_UNIFORMS_GLSL}
uniform sampler2D uAgentPos;
uniform sampler2D uAgentDir;
uniform sampler2D uTrail;
uniform float uSimDt;
uniform float uSeedEpoch;
uniform float uSeedFresh;
uniform float uNoiseSeed;
${PHYSARUM_GLSL}

const float SENSOR_DIST_BASE = ${SENSOR_DIST_BASE.toFixed(5)};
const float SCALE_FACTOR_MIN = ${SCALE_FACTOR_MIN.toFixed(4)};
const float SCALE_FACTOR_MAX = ${SCALE_FACTOR_MAX.toFixed(4)};
const float FAN_MIN = ${FAN_MIN.toFixed(5)};
const float FAN_MAX = ${FAN_MAX.toFixed(5)};
const float FAN_MIN_SAFE = ${FAN_MIN_SAFE.toFixed(5)};
const float CENTROID_FAN_GAIN = ${CENTROID_FAN_GAIN.toFixed(5)};
const float TURN_RATE_MIN = ${TURN_RATE_MIN.toFixed(4)};
const float TURN_RATE_MAX = ${TURN_RATE_MAX.toFixed(4)};
const float SPEED_MIN = ${SPEED_MIN.toFixed(5)};
const float SPEED_MAX = ${SPEED_MAX.toFixed(5)};
const float JITTER_SPEED_MIN = ${JITTER_SPEED_MIN.toFixed(4)};
const float JITTER_SPEED_SPAN = ${JITTER_SPEED_SPAN.toFixed(4)};
const float SURGE_GAIN = ${SURGE_GAIN.toFixed(4)};

void main() {
  ivec2 texel = ivec2(gl_FragCoord.xy);
  vec4 cp = texelFetch(uAgentPos, texel, 0);
  vec4 cd = texelFetch(uAgentDir, texel, 0);
  vec2 pos = vec2(unpackUnitR(cp.rg, 1.0), unpackUnitR(cp.ba, 1.0));
  float heading = unpackUnitR(cd.rg, TWO_PI);
  float species = cd.b;
  float jitter = cd.a;
  vec3 mask = speciesMask(species);

  float scaleFactor = mix(SCALE_FACTOR_MIN, SCALE_FACTOR_MAX, uScale);
  float sensorDist = SENSOR_DIST_BASE * scaleFactor;
  // Fan angle also nudges live with the spectral centroid — see Fan
  // angle's "reads" in SETTINGS.
  float fanAngle = max(FAN_MIN_SAFE, mix(FAN_MIN, FAN_MAX, uFan) + CENTROID_FAN_GAIN * (uCentroid - 0.5));

  vec2 dirC = vec2(cos(heading), sin(heading));
  vec2 dirL = vec2(cos(heading - fanAngle), sin(heading - fanAngle));
  vec2 dirR = vec2(cos(heading + fanAngle), sin(heading + fanAngle));

  // Sample with texture() (LINEAR): averaging four texels lifts the
  // reading above 8-bit quantisation for free.
  float sC = sense(texture(uTrail, fract(pos + dirC * sensorDist)).rgb, mask, uBraid);
  float sL = sense(texture(uTrail, fract(pos + dirL * sensorDist)).rgb, mask, uBraid);
  float sR = sense(texture(uTrail, fract(pos + dirR * sensorDist)).rgb, mask, uBraid);

  vec2 seed = vec2(texel) * 0.173 + uNoiseSeed;
  float turnRate = mix(TURN_RATE_MIN, TURN_RATE_MAX, uTurn);
  float wanderJitter = 1.0 + uWander * (hash21(seed) - 0.5) * 2.0;
  float turnAmount = turnRate * uSimDt * wanderJitter;

  // Centre strongest: hold. One side strongest: turn that way. Both sides
  // beating the centre: turn one way at random.
  if (sC >= sL && sC >= sR) {
    // hold
  } else if (sL > sR) {
    heading -= turnAmount;
  } else if (sR > sL) {
    heading += turnAmount;
  } else {
    heading += (hash21(seed + 5.17) < 0.5 ? -1.0 : 1.0) * turnAmount;
  }
  heading = mod(mod(heading, TWO_PI) + TWO_PI, TWO_PI);

  float speedBase = mix(SPEED_MIN, SPEED_MAX, uSpeed) * scaleFactor
                   * (JITTER_SPEED_MIN + JITTER_SPEED_SPAN * jitter);
  float surge = 1.0 + uBeatSurge * uBeatPulse * SURGE_GAIN;
  float speed = speedBase * surge;
  pos = fract(pos + vec2(cos(heading), sin(heading)) * speed * uSimDt);

  // Seed on the beat: only on the exact tick uSeedFresh says the epoch
  // stepped — see the file header for why this can't run every frame the
  // epoch merely holds a value.
  if (uSeedFresh > 0.5) {
    float draw = hash21(seed + uSeedEpoch * 7.919 + 11.3);
    if (draw < uSeed) {
      vec2 seed2 = seed + uNoiseSeed * 3.13 + 91.7;
      pos = hash22(seed2);
      heading = hash21(seed2 + 4.71) * TWO_PI;
      jitter = hash21(seed2 + 8.33);
    }
  }

  outPos = vec4(packUnitR(pos.x, 1.0), packUnitR(pos.y, 1.0));
  outDir = vec4(packUnitR(heading, TWO_PI), species, jitter);
}
`;

const DEPOSIT_VERT = `#version 300 es
precision highp float;
${COMMON_UNIFORMS_GLSL}
${SETTINGS_UNIFORMS_GLSL}
uniform sampler2D uAgentPos;
uniform sampler2D uAgentDir;
uniform float uAgentSide;
uniform float uDepositDt;
${PHYSARUM_GLSL}
out vec3 vDepositColor;

const float DEPOSIT_FLOOR_RATE = ${DEPOSIT_FLOOR_RATE.toFixed(4)};
const float DEPOSIT_GAIN_RATE = ${DEPOSIT_GAIN_RATE.toFixed(4)};

// No vertex attributes at all — every agent is addressed by gl_VertexID
// into the position/direction textures (chladni's and powder's trick), so
// this draws from an empty VAO.
void main() {
  int side = int(uAgentSide);
  ivec2 texel = ivec2(gl_VertexID % side, gl_VertexID / side);
  vec4 cp = texelFetch(uAgentPos, texel, 0);
  vec4 cd = texelFetch(uAgentDir, texel, 0);
  vec2 pos = vec2(unpackUnitR(cp.rg, 1.0), unpackUnitR(cp.ba, 1.0));
  vec3 mask = speciesMask(cd.b);
  float level = mask.r > 0.5 ? uLow : (mask.g > 0.5 ? uMid : uHigh);
  // A loud band's own agents genuinely lay down more of its trail. Per
  // second, not per frame — see DEPOSIT_FLOOR_RATE.
  vDepositColor = mask * (DEPOSIT_FLOOR_RATE + DEPOSIT_GAIN_RATE * level) * uDepositDt;
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
  // The only point size WebGL guarantees, and the mechanic itself: a
  // one-texel deposit.
  gl_PointSize = 1.0;
}
`;

const DEPOSIT_FRAG = `#version 300 es
precision highp float;
in vec3 vDepositColor;
out vec4 outColor;
${COMMON_UNIFORMS_GLSL}
${SETTINGS_UNIFORMS_GLSL}

void main() {
  outColor = vec4(vDepositColor, 1.0);
}
`;

const COMPOSITE_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
${COMMON_UNIFORMS_GLSL}
${SETTINGS_UNIFORMS_GLSL}
uniform sampler2D uTrail;
uniform float uTrailTexel;
${PALETTE_GLSL}
${ROOM_UV_GLSL}
${PHYSARUM_GLSL}

// Fixed species colours — a warm low, a green-gold mid, a cold high —
// chosen to stay distinct when they overlap additively.
const vec3 COLOR_LOW = vec3(0.95, 0.32, 0.18);
const vec3 COLOR_MID = vec3(0.55, 0.85, 0.25);
const vec3 COLOR_HIGH = vec3(0.30, 0.55, 1.00);
const float RELIEF_GRAD_SCALE = ${RELIEF_GRAD_SCALE.toFixed(4)};
const vec3 RELIEF_LIGHT = vec3(${RELIEF_LIGHT[0].toFixed(4)}, ${RELIEF_LIGHT[1].toFixed(4)}, ${RELIEF_LIGHT[2].toFixed(4)});
const float RELIEF_GAIN = ${RELIEF_GAIN.toFixed(4)};
const float SMOOTH_CENTER = ${SMOOTH_CENTER.toFixed(4)};
const float SMOOTH_SIDE = ${SMOOTH_SIDE.toFixed(4)};
const float GLOW_BASE = ${GLOW_BASE.toFixed(4)};
const float GLOW_SPAN = ${GLOW_SPAN.toFixed(4)};
const float FLASH_GAIN = ${FLASH_GAIN.toFixed(4)};

void main() {
  vec2 ruv = roomUv(vUv);
  vec2 fuv = fract(coverUv(ruv));

  // Five taps, shared by the colour and the relief gradient below. The
  // colour is their weighted mean rather than the centre texel alone: a
  // deposit lands after the diffuse pass (the pass order is deliberate —
  // see the file header), so on any given frame the newest ink is still one
  // sharp texel, which at this magnification reads as speckle over the
  // network. Averaging the neighbours costs nothing here, since the relief
  // shading needs the same four taps anyway.
  vec2 texel = vec2(uTrailTexel);
  vec3 tC = texture(uTrail, fuv).rgb;
  vec3 tL = texture(uTrail, fract(fuv - vec2(texel.x, 0.0))).rgb;
  vec3 tR = texture(uTrail, fract(fuv + vec2(texel.x, 0.0))).rgb;
  vec3 tD = texture(uTrail, fract(fuv - vec2(0.0, texel.y))).rgb;
  vec3 tU = texture(uTrail, fract(fuv + vec2(0.0, texel.y))).rgb;
  vec3 trail = tC * SMOOTH_CENTER + (tL + tR + tD + tU) * SMOOTH_SIDE;

  vec3 col = trail.r * COLOR_LOW + trail.g * COLOR_MID + trail.b * COLOR_HIGH;
  float total = trail.r + trail.g + trail.b;
  vec3 palCol = palette(0.15 + 0.5 * total, uPalA, uPalB, uPalC, uPalD) * total;
  col = mix(col, palCol, uPaletteMix);

  // Relief: shade the filaments as lit tubes from the trail's own gradient
  // (central differences) against a fixed light. Exactly a no-op at 0 —
  // the mix collapses to 1.0 regardless of what "shade" evaluates to.
  float hL = tL.r + tL.g + tL.b;
  float hR = tR.r + tR.g + tR.b;
  float hD = tD.r + tD.g + tD.b;
  float hU = tU.r + tU.g + tU.b;
  vec2 grad = vec2(hR - hL, hU - hD) * RELIEF_GRAD_SCALE;
  vec3 normal = normalize(vec3(-grad, 1.0));
  float shade = max(dot(normal, RELIEF_LIGHT), 0.0) * RELIEF_GAIN;
  col *= mix(1.0, shade, uRelief);

  col *= GLOW_BASE + GLOW_SPAN * uGlow;
  col *= 1.0 + uFlash * uBeatPulse * FLASH_GAIN;

  // Per-channel roll-off so a saturated overlap goes white rather than
  // shifting hue (powder.ts's Reinhard note).
  col = col / (1.0 + col);
  outColor = vec4(col, 1.0);
}
`;

interface AgentSeed {
  pos: Uint8Array;
  dir: Uint8Array;
}

/** Seeds every texel of a `side x side` agent texture pair: random position
 *  and heading, species round-robin over GROUP_COUNT so the groups start
 *  equal, and a random per-agent speed jitter. */
function seedAgents(side: number): AgentSeed {
  const n = side * side;
  const pos = new Uint8Array(n * 4);
  const dir = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    writeUnit(pos, i * 4, Math.random(), 1);
    writeUnit(pos, i * 4 + 2, Math.random(), 1);
    writeUnit(dir, i * 4, Math.random() * TWO_PI, TWO_PI);
    const species = (i % GROUP_COUNT) / (GROUP_COUNT - 1);
    dir[i * 4 + 2] = Math.round(species * 255);
    dir[i * 4 + 3] = Math.round(Math.random() * 255);
  }
  return { pos, dir };
}

function createPhysarumScene(): Scene {
  let diffuseProg: GLProgram | null = null;
  let simProg: GLProgram | null = null;
  let depositProg: GLProgram | null = null;
  let compositeProg: GLProgram | null = null;
  let quadVao: WebGLVertexArrayObject | null = null;
  let depositVao: WebGLVertexArrayObject | null = null;

  const agentPosTex: (WebGLTexture | null)[] = [null, null];
  const agentDirTex: (WebGLTexture | null)[] = [null, null];
  const agentFbo: (WebGLFramebuffer | null)[] = [null, null];
  const trailTex: (WebGLTexture | null)[] = [null, null];
  const trailFbo: (WebGLFramebuffer | null)[] = [null, null];

  const samplerLocs = new Map<string, WebGLUniformLocation | null>();
  let agentRead = 0;
  let trailReadIdx = 0;
  let agentSide = 1;
  let agentCount = 0;
  let trailSideCur = 0;
  let lastFrameTime: number | null = null;
  let beatSeeder: BeatSeeder | null = null;
  const bandsBuf = new Float32Array(NUM_BANDS);
  const attractorBuf = new Float32Array(GROUP_COUNT * 2);

  function samplerLoc(
    gl: WebGL2RenderingContext,
    prog: GLProgram,
    key: string,
    name: string,
  ): WebGLUniformLocation | null {
    let l = samplerLocs.get(key);
    if (l === undefined) {
      l = gl.getUniformLocation(prog.program, name);
      samplerLocs.set(key, l);
    }
    return l;
  }

  function makeAgentTexture(gl: WebGL2RenderingContext, side: number, data: Uint8Array): WebGLTexture | null {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, side, side, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  /** LINEAR — the composite and the sensors both tap between texels — and
   *  REPEAT, because the field is a torus (see the file header). */
  function makeTrailTexture(gl: WebGL2RenderingContext, side: number, data: Uint8Array): WebGLTexture | null {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, side, side, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    return tex;
  }

  function freeTrailTargets(gl: WebGL2RenderingContext): void {
    for (let i = 0; i < 2; i++) {
      if (trailFbo[i]) gl.deleteFramebuffer(trailFbo[i]);
      if (trailTex[i]) gl.deleteTexture(trailTex[i]);
      trailFbo[i] = null;
      trailTex[i] = null;
    }
  }

  /** Rebuilds the trail map, and reseeds it to zero, only when its size
   *  actually changes — see the file header. */
  function ensureTrailTargets(gl: WebGL2RenderingContext): void {
    const maxSide = Math.min(TRAIL_SIDE_CAP, Math.max(gl.drawingBufferWidth, gl.drawingBufferHeight));
    const side = trailSide(agentCount, maxSide);
    if (side === trailSideCur && trailFbo[0] && trailFbo[1]) return;
    freeTrailTargets(gl);
    trailSideCur = side;
    const zero = new Uint8Array(side * side * 4);
    for (let i = 0; i < 2; i++) {
      trailTex[i] = makeTrailTexture(gl, side, zero);
      const f = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, trailTex[i], 0);
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      if (status !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error(`physarum: trail framebuffer incomplete (0x${status.toString(16)})`);
      }
      trailFbo[i] = f;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    trailReadIdx = 0;
  }

  return {
    id: ID,
    name: "Physarum",
    settings: SETTINGS,

    init(ctx: SceneContext) {
      const { gl } = ctx;
      diffuseProg = createProgram(gl, DIFFUSE_FRAG);
      simProg = createProgram(gl, SIM_FRAG);
      depositProg = createProgram(gl, DEPOSIT_FRAG, DEPOSIT_VERT);
      compositeProg = createProgram(gl, COMPOSITE_FRAG);
      samplerLocs.clear();
      quadVao = createFullscreenQuad(gl);
      // No vertex attributes at all — every agent is addressed by
      // gl_VertexID — so this draws from an empty VAO rather than the
      // quad's 3-vertex buffer.
      depositVao = gl.createVertexArray();

      agentCount = Math.max(1, Math.floor(ctx.quality.maxParticles));
      agentSide = grainTextureSide(agentCount);
      const seed = seedAgents(agentSide);
      for (let i = 0; i < 2; i++) {
        agentPosTex[i] = makeAgentTexture(gl, agentSide, seed.pos);
        agentDirTex[i] = makeAgentTexture(gl, agentSide, seed.dir);
        const f = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, f);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, agentPosTex[i], 0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, agentDirTex[i], 0);
        gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        if (status !== gl.FRAMEBUFFER_COMPLETE) {
          throw new Error(`physarum: agent framebuffer incomplete (0x${status.toString(16)})`);
        }
        agentFbo[i] = f;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, null);

      trailSideCur = 0;
      ensureTrailTargets(gl);

      agentRead = 0;
      lastFrameTime = null;
      beatSeeder = createBeatSeeder();
    },

    render(ctx, frame, viewport, palette, anim) {
      if (!diffuseProg || !simProg || !depositProg || !compositeProg) return;
      if (!quadVao || !depositVao || !beatSeeder) return;
      const { gl } = ctx;
      ensureTrailTargets(gl);

      // See the file header (and chladni.ts's/powder.ts's) for why
      // frame.time and not anim.dtSec.
      const dt = lastFrameTime === null ? 1 / 60 : Math.max(0, Math.min(0.05, frame.time - lastFrameTime));
      lastFrameTime = frame.time;

      const seedFresh = beatSeeder.advance(dt, anim.beatPulse, anim.onset);
      attractorPositions(anim.timeSec, attractorBuf);

      gl.disable(gl.BLEND);

      // 1. Diffuse/evaporate/attract: trailRead -> trailWrite.
      const trailWrite = 1 - trailReadIdx;
      gl.bindFramebuffer(gl.FRAMEBUFFER, trailFbo[trailWrite]);
      gl.viewport(0, 0, trailSideCur, trailSideCur);
      diffuseProg.use();
      uploadCommonUniforms(diffuseProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf);
      diffuseProg.setF("uTrailSide", trailSideCur);
      diffuseProg.setF("uDiffuseDt", dt);
      diffuseProg.setF("uNoiseSeed", Math.random() * 100);
      for (let i = 0; i < GROUP_COUNT; i++) {
        diffuseProg.setV2(`uAttractorPos[${i}]`, attractorBuf[i * 2], attractorBuf[i * 2 + 1]);
      }
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, trailTex[trailReadIdx]);
      gl.uniform1i(samplerLoc(gl, diffuseProg, "diff.uTrailIn", "uTrailIn"), 0);
      drawFullscreenQuad(gl, quadVao);

      // 2. Agent sim: agentRead -> agentWrite, sensing the trail diffuse
      //    just produced.
      const agentWrite = 1 - agentRead;
      gl.bindFramebuffer(gl.FRAMEBUFFER, agentFbo[agentWrite]);
      gl.viewport(0, 0, agentSide, agentSide);
      simProg.use();
      uploadCommonUniforms(simProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf);
      simProg.setF("uSimDt", dt);
      simProg.setF("uSeedEpoch", beatSeeder.epoch);
      simProg.setF("uSeedFresh", seedFresh ? 1 : 0);
      simProg.setF("uNoiseSeed", Math.random() * 100);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, agentPosTex[agentRead]);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, agentDirTex[agentRead]);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, trailTex[trailWrite]);
      gl.uniform1i(samplerLoc(gl, simProg, "sim.uAgentPos", "uAgentPos"), 0);
      gl.uniform1i(samplerLoc(gl, simProg, "sim.uAgentDir", "uAgentDir"), 1);
      gl.uniform1i(samplerLoc(gl, simProg, "sim.uTrail", "uTrail"), 2);
      drawFullscreenQuad(gl, quadVao);
      agentRead = agentWrite;

      // 3. Deposit: additive points, sourced from the agent state sim just
      //    wrote, into the same trail write target diffuse just produced —
      //    never blurred in the frame it's laid (see the file header).
      gl.bindFramebuffer(gl.FRAMEBUFFER, trailFbo[trailWrite]);
      gl.viewport(0, 0, trailSideCur, trailSideCur);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      depositProg.use();
      uploadCommonUniforms(depositProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf);
      depositProg.setF("uAgentSide", agentSide);
      depositProg.setF("uDepositDt", dt);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, agentPosTex[agentRead]);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, agentDirTex[agentRead]);
      gl.uniform1i(samplerLoc(gl, depositProg, "dep.uAgentPos", "uAgentPos"), 0);
      gl.uniform1i(samplerLoc(gl, depositProg, "dep.uAgentDir", "uAgentDir"), 1);
      gl.bindVertexArray(depositVao);
      gl.drawArrays(gl.POINTS, 0, agentCount);
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);
      trailReadIdx = trailWrite;

      // 4. Composite to the default framebuffer.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      compositeProg.use();
      uploadCommonUniforms(compositeProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf);
      compositeProg.setF("uTrailTexel", 1 / trailSideCur);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, trailTex[trailReadIdx]);
      gl.uniform1i(samplerLoc(gl, compositeProg, "comp.uTrail", "uTrail"), 0);
      drawFullscreenQuad(gl, quadVao);

      // 5. The gallery renders every scene into one shared context each
      //    tick — must not leak blend state or a bound texture onto the
      //    next tile.
      gl.disable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ZERO);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      for (let unit = 2; unit >= 0; unit--) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, null);
      }
    },

    dispose(ctx: SceneContext) {
      const { gl } = ctx;
      diffuseProg?.dispose();
      simProg?.dispose();
      depositProg?.dispose();
      compositeProg?.dispose();
      if (quadVao) gl.deleteVertexArray(quadVao);
      if (depositVao) gl.deleteVertexArray(depositVao);
      for (let i = 0; i < 2; i++) {
        if (agentFbo[i]) gl.deleteFramebuffer(agentFbo[i]);
        if (agentPosTex[i]) gl.deleteTexture(agentPosTex[i]);
        if (agentDirTex[i]) gl.deleteTexture(agentDirTex[i]);
        agentFbo[i] = null;
        agentPosTex[i] = null;
        agentDirTex[i] = null;
      }
      freeTrailTargets(gl);
      samplerLocs.clear();
      diffuseProg = null;
      simProg = null;
      depositProg = null;
      compositeProg = null;
      quadVao = null;
      depositVao = null;
      lastFrameTime = null;
      beatSeeder = null;
      trailSideCur = 0;
    },
  };
}

export const physarumScene = createPhysarumScene();
