import { NUM_BANDS } from "../../audio/types.ts";
import { MIN_HZ, MAX_HZ_CAP } from "../../audio/bandScale.ts";
import { createProgram, createFullscreenQuad, drawFullscreenQuad, type GLProgram } from "../gl.ts";
import { PALETTE_GLSL } from "../palette.ts";
import type { SceneSetting } from "../sceneSettings.ts";
import { resolveSceneSetting } from "../autoTune.ts";
import type { Scene, SceneContext } from "../scene.ts";
import { COMMON_UNIFORMS_GLSL, ROOM_UV_GLSL, settingUniformName, uploadCommonUniforms } from "../sceneCommon.ts";

// A Chladni plate, simulated rather than painted: a plate whose resonant
// modes are each driven by the music's energy at that mode's own resonant
// frequency, with a bed of sand grains that get kicked wherever the plate
// moves (the antinodes) and come to rest where it doesn't (the nodal
// lines). The classic figures aren't drawn anywhere in this file — they
// *emerge* from grain motion, and re-form grain by grain when a different
// mode takes over. Contrast cymatics.ts, which is an analytic circular-plate
// sum rendered per pixel; this one has state.
//
// The plate. Plate space is p in [-1,1]^2. The mode shape is the standard
// square-plate approximation
//     chladni(p; n, m, s) = cos(n pi x) cos(m pi y) + s cos(m pi x) cos(n pi y)
// with s = +/-1 picking one of the two symmetry families (the mixing of the
// two degenerate modes is real physics — it's where the diagonal symmetry
// of square-plate figures comes from). n == m with s = -1 is identically
// zero, so buildModeTable only holds pairs with n < m, sorted by n^2 + m^2,
// which is also each mode's resonant frequency relative to the fundamental.
//
// The response. A real plate under broadband music answers as a sum of
// every mode near any energy in the signal, each ringing with its own
// damping — a pure tone gives one clean figure, a chord blurs neighbours
// together. createPlateResponse models exactly that: each table mode has a
// resonant frequency f1 * (n^2 + m^2) / 5 (Pattern complexity sets f1 —
// physically the plate's size), is excited by the band energy under a
// resonance window at that frequency (Resonance sets the window's
// sharpness), and rings with a fast attack and a Ring-controlled release.
// The strongest few modes by response are summed in the shader, weighted
// by that response, so mode changes are the plate's own dynamics rather
// than a scripted crossfade.
//
// The sand. Grain positions live in a ping-pong pair of RGBA8 textures,
// 16-bit fixed point per axis (R,G = x, B,A = y). RGBA8 is renderable on
// every WebGL2 device with no EXT_color_buffer_float dependency (the
// webOS/Tizen targets vite.config.ts builds for), and 1/65535 of the plate
// is sub-pixel even at 4K; half-float would be *too coarse* for positions,
// so the packing is the design, not a fallback. Per rendered frame the sim
// fragment shader steps every grain the way a real grain moves. The plate's
// local acceleration is the amplitude a = |field|/2 times how hard the music
// drives the plate. Below the lift threshold a grain only rattles in place,
// in proportion to that acceleration; above it the grain bounces a random
// distance that grows with the excess (a soft knee, not a wall — quiet
// plates shimmer, loud ones throw the sand). Migration toward the nodal
// lines is a second-order effect of the bouncing, as on a real plate: each
// bounce lands a small fraction of its length downhill of |field| (the
// analytic gradient), and that fraction itself fades to nothing where the
// plate barely moves. So sand in the quiet zones beside a line jiggles but
// never migrates — the sand lying between the figures on a real plate —
// while sand on the antinodes dances its way to the lines over seconds. A
// louder drive narrows the quiet zones into crisp lines. Nothing slides:
// every move is a bounce. A grain that bounces off the plate edge respawns
// at a random spot — a real plate spills sand; refilling keeps the count
// constant. Silence drives nothing, so the figure freezes in place.
//
// Grains never interact — the sim has no notion of a grain's radius, so
// nothing stops two from occupying the same spot. Rendered at a fixed count,
// a big Grain size therefore just paints over itself: covered area grows
// with size^2 while the sand drawn stays fixed, so past MAX_BED_COVERAGE
// every pixel is whichever grain landed on top last, and both the grain
// texture and the figure underneath stop reading. drawnGrainCount treats the
// bed as a fixed amount of sand instead — bigger grains, fewer of them drawn
// — while the sim keeps stepping every grain regardless, so the drawn subset
// is a stable prefix rather than a re-seeded bed each time the slider moves.
//
// dt for the sim comes from frame.time deltas, not anim.dtSec: the anim
// clock advances every rAF tick while render() is frame-pace-capped, so
// dtSec under-counts the wall time a rendered frame actually covers.
const ID = "chladni";

/** One plate mode: the (n, m) orders and the symmetry-family sign. */
export interface PlateMode {
  n: number;
  m: number;
  sign: 1 | -1;
}

/** Highest mode order the table reaches. (8, 9) is already a fine lattice
 *  at TV distance; past that the nodal cells fall below grain size. */
export const MAX_ORDER = 9;

/** Every (n, m) with 1 <= n < m <= maxOrder, ascending by n^2 + m^2 (the
 *  square plate's eigenfrequency proxy), signs alternating so neighbouring
 *  resonances come from both symmetry families. See the file header for
 *  why n == m is excluded. */
export function buildModeTable(maxOrder: number = MAX_ORDER): PlateMode[] {
  const pairs: { n: number; m: number }[] = [];
  for (let n = 1; n < maxOrder; n++) {
    for (let m = n + 1; m <= maxOrder; m++) pairs.push({ n, m });
  }
  pairs.sort((a, b) => a.n * a.n + a.m * a.m - (b.n * b.n + b.m * b.m) || a.n - b.n);
  return pairs.map((p, i) => ({ ...p, sign: i % 2 === 0 ? -1 : 1 }));
}

export const MODE_TABLE: readonly PlateMode[] = buildModeTable();

/** Side of the square position texture that holds `count` grains. */
export function grainTextureSide(count: number): number {
  return Math.max(1, Math.ceil(Math.sqrt(Math.max(1, count))));
}

// The plate's fundamental — the (1, 2) mode's resonance — across the
// Pattern complexity slider. Every mode sits at (n^2 + m^2) / FUNDAMENTAL_ORDER
// times the fundamental, so complexity slides the whole table across the band
// ladder: a small stiff plate (0) needs treble to reach even its low modes,
// a big plate (1) has its finest lattices ringing already in the mids.
export const FUNDAMENTAL_HZ_SMALL = 560;
export const FUNDAMENTAL_HZ_LARGE = MIN_HZ;
/** n^2 + m^2 of the fundamental (1, 2) mode. */
const FUNDAMENTAL_ORDER = 5;

/** Resonant frequency of `mode` on a plate at `complexity` (0..1). */
export function modeFrequencyHz(mode: PlateMode, complexity: number): number {
  const c = Math.max(0, Math.min(1, complexity));
  const f1 = FUNDAMENTAL_HZ_SMALL * Math.pow(FUNDAMENTAL_HZ_LARGE / FUNDAMENTAL_HZ_SMALL, c);
  return (f1 * (mode.n * mode.n + mode.m * mode.m)) / FUNDAMENTAL_ORDER;
}

/** Where `hz` falls on the band ladder, in band units: MIN_HZ -> 0,
 *  MAX_HZ_CAP -> NUM_BANDS, band i's centre at i + 0.5. Unclamped. */
export function bandPosition(hz: number): number {
  return (NUM_BANDS * Math.log(Math.max(1e-3, hz) / MIN_HZ)) / Math.log(MAX_HZ_CAP / MIN_HZ);
}

export interface PlateResponseInputs {
  /** Pattern complexity setting, [0,1] — sets the fundamental, see above. */
  complexity: number;
  /** Resonance setting, [0,1]: 0 = damped plate (wide window, neighbours
   *  blur together), 1 = high Q (one mode wins cleanly). */
  resonance: number;
  /** Ring setting, [0,1]: how long a mode keeps ringing after its tone stops. */
  ring: number;
}

export interface ActiveMode extends PlateMode {
  /** This mode's share of the plate's motion; the active set sums to 1. */
  weight: number;
}

/** How many modes the shader sums. The response is sharpened enough that
 *  the rest carry a negligible share. */
export const ACTIVE_MODES = 4;

/** Resonance window width in band units across the Resonance slider. */
const WINDOW_BANDS_DAMPED = 1.6;
const WINDOW_BANDS_SHARP = 0.35;
/** Response-sharpening exponent across the Resonance slider — a high-Q
 *  plate's dominant mode wins by a wide margin. */
const SHARPEN_DAMPED = 1;
const SHARPEN_SHARP = 4;
/** Ring slider -> release seconds; attack is a fixed fraction of it. */
const RING_SEC_MIN = 0.1;
const RING_SEC_MAX = 1.5;
const ATTACK_FRACTION = 0.15;
const ATTACK_SEC_MIN = 0.03;
/** Below this summed response the plate isn't being excited at all: the
 *  last active set holds, so silence freezes the figure rather than
 *  collapsing it to nothing. */
const RESPONSE_FLOOR = 1e-9;

export function ringSeconds(ring: number): number {
  return RING_SEC_MIN + Math.max(0, Math.min(1, ring)) * (RING_SEC_MAX - RING_SEC_MIN);
}

export interface PlateResponse {
  /** Steps every mode's ringing amplitude by this frame's band energies and
   *  returns the ACTIVE_MODES strongest, weights normalised to sum 1,
   *  strongest first. The returned array is reused between calls. */
  advance(dtSec: number, bands: ArrayLike<number>, inputs: PlateResponseInputs): readonly ActiveMode[];
  /** Per-table-mode ringing amplitude, for tests and the probe. */
  readonly amplitudes: Float32Array;
}

export function createPlateResponse(table: readonly PlateMode[] = MODE_TABLE): PlateResponse {
  const amplitudes = new Float32Array(table.length);
  const sharpened = new Float32Array(table.length);
  const order = table.map((_, i) => i);
  const active: ActiveMode[] = [];
  for (let k = 0; k < ACTIVE_MODES; k++) {
    const mode = table[Math.min(k, table.length - 1)];
    active.push({ ...mode, weight: k === 0 ? 1 : 0 });
  }

  return {
    amplitudes,
    advance(dtSec, bands, inputs) {
      const dt = Number.isFinite(dtSec) && dtSec > 0 ? dtSec : 0;
      const resonance = Math.max(0, Math.min(1, inputs.resonance));
      const sigma = WINDOW_BANDS_DAMPED + (WINDOW_BANDS_SHARP - WINDOW_BANDS_DAMPED) * resonance;
      const sharpen = SHARPEN_DAMPED + (SHARPEN_SHARP - SHARPEN_DAMPED) * resonance;
      const release = ringSeconds(inputs.ring);
      const attack = Math.max(ATTACK_SEC_MIN, release * ATTACK_FRACTION);
      const bandCount = Math.min(bands.length, NUM_BANDS);

      for (let k = 0; k < table.length; k++) {
        const pos = bandPosition(modeFrequencyHz(table[k], inputs.complexity));
        // Excitation: band energy under a normalised Gaussian window at
        // this mode's resonance. A mode past the top of the ladder sees
        // only the tail of the last band.
        let num = 0;
        // Normalised by the window's full mass, not the in-range sum, so a
        // resonance off the end of the ladder only sees the tail of the
        // last band instead of being renormalised up to full strength.
        const den = sigma * Math.sqrt(2 * Math.PI);
        for (let i = 0; i < bandCount; i++) {
          const d = (i + 0.5 - pos) / sigma;
          const w = Math.exp(-0.5 * d * d);
          num += w * Math.max(0, bands[i]);
        }
        const excitation = num / den;
        const tau = excitation > amplitudes[k] ? attack : release;
        amplitudes[k] += (excitation - amplitudes[k]) * (1 - Math.exp(-dt / tau));
        sharpened[k] = Math.pow(amplitudes[k], sharpen);
      }

      order.sort((a, b) => sharpened[b] - sharpened[a]);
      let sum = 0;
      for (let k = 0; k < ACTIVE_MODES; k++) sum += sharpened[order[k]];
      if (sum < RESPONSE_FLOOR) return active;

      for (let k = 0; k < ACTIVE_MODES; k++) {
        const mode = table[order[k]];
        const slot = active[k];
        slot.n = mode.n;
        slot.m = mode.m;
        slot.sign = mode.sign;
        slot.weight = sharpened[order[k]] / sum;
      }
      return active;
    },
  };
}

/** Per-grain brightness gain so a sparse floor-quality bed reads about as
 *  bright as a dense high-quality one. Anchored at the top quality tier's
 *  grain count = gain 1, so no preset renders dimmer than the best one. */
export const REFERENCE_GRAINS = 200_000;
export function grainGain(count: number): number {
  return Math.max(0.5, Math.min(6, Math.sqrt(REFERENCE_GRAINS / Math.max(1, count))));
}

/** The bed may cover at most this fraction of the plate. Past it, every
 *  pixel is the topmost grain and both the sand and the figure stop
 *  reading — see the file header. */
export const MAX_BED_COVERAGE = 0.55;

/** E[(0.75 + 0.5u)^2] for u ~ Uniform(0,1): the size-jitter POINT_VERT
 *  applies per grain, folded into the average covered area per grain. */
const SIZE_JITTER_M2 = 1 + 0.5 ** 2 / 12;

/** How many of `count` grains to draw so the bed stays under
 *  MAX_BED_COVERAGE: bigger grains mean fewer of them, as with a fixed
 *  amount of real sand rather than a fixed grain count. `grainPx` is the
 *  on-screen grain diameter (Grain size after the resolution scale
 *  POINT_VERT applies, before the shard-area and halo growth also applied
 *  there — both roughly wash out between the shard and the disc it
 *  replaced), `platePx2` the plate's area in pixels. */
export function drawnGrainCount(count: number, grainPx: number, platePx2: number): number {
  const areaPerGrain = (Math.PI / 4) * grainPx * grainPx * SIZE_JITTER_M2;
  const fits = Math.floor((MAX_BED_COVERAGE * platePx2) / Math.max(1e-6, areaPerGrain));
  return Math.max(1, Math.min(count, fits));
}

const SETTINGS: SceneSetting[] = [
  {
    key: "complexity",
    label: "Pattern complexity",
    description: "In effect the plate's size: a bigger plate's resonances sit lower, so the music reaches finer figures",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    // Bright, busy mixes reach the plate's finer modes.
    auto: { brightness: 0.35, density: 0.2 },
  },
  {
    key: "resonance",
    label: "Resonance",
    description: "How sharply the plate picks one figure: high = one clean mode wins, low = a damped plate blurs neighbouring modes together",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    // A dense mix needs a sharper plate to stay legible.
    auto: { density: 0.2, pulse: 0.15 },
  },
  {
    key: "ring",
    label: "Ring",
    description: "How long a figure keeps ringing after its tone stops",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.4,
    // Fast, percussive music wants a quicker-decaying plate.
    auto: { tempo: -0.25, attack: -0.15 },
  },
  {
    key: "squarePlate",
    label: "Square plate",
    description: "On: the classic square plate, centered. Off: the plate is the whole screen",
    group: "Form",
    min: 0,
    max: 1,
    step: 1,
    default: 0,
    type: "boolean",
  },
  {
    key: "settle",
    label: "Settling pull",
    description: "How readily bouncing sand finds the still lines — sand the plate barely moves never migrates",
    // Form, not Motion — it's how crisply the figure ultimately resolves
    // (paired with Resonance above), not something you watch move in
    // real time the way Vibration or Bass kick are.
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    // A steady beat reads best with figures that lock in crisply.
    auto: { pulse: 0.2 },
  },
  {
    key: "grainSize",
    label: "Grain size",
    description: "Size of each sand grain on screen",
    group: "Form",
    min: 0.5,
    max: 3,
    step: 0.1,
    default: 1.8,
  },
  {
    key: "shake",
    label: "Vibration",
    description: "How hard the music shakes the plate — a quiet plate shimmers its sand, a loud one throws it",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    // A loud, dynamic room drives the plate harder.
    auto: { loudness: 0.3, dynamics: 0.15 },
  },
  {
    key: "kick",
    label: "Bass kick",
    description: "A bass hit throws the sand off its lines; the figure re-forms as it settles",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    // Dark, bass-heavy mixes carry more kick presence to throw on.
    auto: { brightness: -0.3, attack: 0.25 },
  },
  {
    key: "fieldGlow",
    label: "Plate glow",
    description: "A faint glow where the plate is moving, under the sand",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.25,
    // A louder room lights the plate a little more.
    auto: { loudness: 0.2 },
  },
  {
    key: "grainGlow",
    label: "Grain brightness",
    description: "How bright the sand is; piles on the lines add up",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    auto: { loudness: 0.15 },
  },
  {
    key: "highGlow",
    label: "Treble glow",
    description: "Hats and cymbals make the sand glow — each grain blooms with a soft halo",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    // Directly the hats/cymbals dial, as caustics' sparkle.
    auto: { brightness: 0.35, attack: 0.15 },
  },
  {
    key: "beatFlash",
    label: "Beat flash",
    description: "Brightness punch on each beat",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.3,
    // Same reasoning as caustics' flash: punches read on punchy, uncluttered material.
    auto: { attack: 0.3, pulse: 0.2, density: -0.15 },
  },
];

function settingFor(key: string): SceneSetting {
  const s = SETTINGS.find((x) => x.key === key);
  if (!s) throw new Error(`chladni: unknown setting ${key}`);
  return s;
}

const SETTINGS_UNIFORMS_GLSL = SETTINGS.map((s) => `uniform float ${settingUniformName(s.key)};`).join("\n");

/** Fraction of the room's shorter axis the square plate's half-side spans. */
const SQUARE_PLATE_HALF = 0.46;

// Shared by all three programs so the plate function, its gradient, the
// plate-to-room mapping and the position packing can't drift apart.
const CHLADNI_GLSL = `
const int ACTIVE_MODES = ${ACTIVE_MODES};
uniform vec4 uModes[ACTIVE_MODES]; // n, m, sign, weight
const float PI = 3.14159265;

float chladni(vec2 p, vec4 mode) {
  float n = mode.x, m = mode.y;
  return cos(n * PI * p.x) * cos(m * PI * p.y) + mode.z * cos(m * PI * p.x) * cos(n * PI * p.y);
}

vec2 chladniGrad(vec2 p, vec4 mode) {
  float n = mode.x, m = mode.y;
  vec2 g1 = vec2(-n * PI * sin(n * PI * p.x) * cos(m * PI * p.y),
                 -m * PI * cos(n * PI * p.x) * sin(m * PI * p.y));
  vec2 g2 = vec2(-m * PI * sin(m * PI * p.x) * cos(n * PI * p.y),
                 -n * PI * cos(m * PI * p.x) * sin(n * PI * p.y));
  return g1 + mode.z * g2;
}

// The plate's motion: the active modes summed by their share of the
// response. Weights sum to 1, so |field| <= 2 and amp() stays in [0,1].
float field(vec2 p) {
  float f = 0.0;
  for (int k = 0; k < ACTIVE_MODES; k++) f += uModes[k].w * chladni(p, uModes[k]);
  return f;
}
vec2 fieldGrad(vec2 p) {
  vec2 g = vec2(0.0);
  for (int k = 0; k < ACTIVE_MODES; k++) g += uModes[k].w * chladniGrad(p, uModes[k]);
  return g;
}
float amp(vec2 p) { return abs(field(p)) * 0.5; }

// Half-extent of the plate in room uv. Square: fits the shorter axis with
// a margin. Otherwise the plate is the whole frame.
vec2 plateHalf() {
  float aspect = uResolution.x / uResolution.y;
  float h = ${SQUARE_PLATE_HALF.toFixed(2)};
  vec2 square = aspect >= 1.0 ? vec2(h / aspect, h) : vec2(h, h * aspect);
  return uSquarePlate > 0.5 ? square : vec2(0.5);
}

// 16-bit fixed point per axis across RGBA8 — see file header.
vec2 unpackPos(vec4 c) {
  vec4 b = floor(c * 255.0 + 0.5);
  vec2 v = vec2(b.r * 256.0 + b.g, b.b * 256.0 + b.a) / 65535.0;
  return v * 2.0 - 1.0;
}

vec4 packPos(vec2 p) {
  vec2 v = clamp(p * 0.5 + 0.5, 0.0, 1.0) * 65535.0;
  vec2 hi = floor(v / 256.0);
  vec2 lo = floor(v - hi * 256.0 + 0.5);
  return vec4(hi.x, lo.x, hi.y, lo.y) / 255.0;
}

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

vec2 hash22(vec2 p) {
  return vec2(hash21(p), hash21(p + 17.13));
}
`;

// Plate acceleration (amplitude x drive, g-ish units) at the knee between a
// grain rattling in place and bouncing free. This is what leaves sand lying
// between the lines at a moderate drive.
const LIFT_THRESHOLD = 0.05;
// Plate-space units per second of bounce displacement per unit bounce, at
// the 60 fps reference step.
const HOP_RATE = 1.0;
// On a fully lifted antinode, each bounce lands this fraction of its own
// length downhill of |field| at Settling pull 1 — the bias of the random
// walk. It fades to zero toward the lift knee, so quiet sand never migrates.
const PULL_BIAS = 0.3;
// A step may never cross more than this fraction of one nodal cell, so high
// modes can't overshoot a line and oscillate.
const STEP_CELL_FRACTION = 0.25;
// Treble glow (see POINT_VERT / POINT_FRAG): hats make the sand glint. One
// grain in GLINT_ONE_IN carries a halo of HALO_PX pixels (at 720p) — a
// fixed pixel radius, not a multiple of the grain size, so the halo is a
// bloom around the grain and never a bigger grain. Spreading the light over
// a few grains instead of all of them keeps each halo above the 8-bit
// framebuffer's quantisation floor and the fill-rate cost down.
const HALO_PX = 10.0;
const GLINT_ONE_IN = 8;
// Bloom a fully glowing line reaches, summed over its glinting grains.
const HALO_GAIN = 11.0;

const SIM_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
${COMMON_UNIFORMS_GLSL}
${SETTINGS_UNIFORMS_GLSL}
uniform sampler2D uPosTex;
uniform float uSimDt;
uniform float uSeed;
uniform float uMaxOrder; // highest m among the active modes, for the step cap
${CHLADNI_GLSL}

void main() {
  ivec2 texel = ivec2(gl_FragCoord.xy);
  vec2 p = unpackPos(texelFetch(uPosTex, texel, 0));
  vec2 seed = gl_FragCoord.xy * 0.173 + uSeed;

  // How hard the plate is being driven right now: sustained energy plus a
  // bass-onset kick. Silence -> ~0 -> the figure freezes.
  // Vibration on a sub-linear curve so the low half of the slider is a usable
  // whisper while the top of the slider still throws sand hard.
  float shake = pow(uShake, 1.5) * 2.0;
  float drive = shake * (0.25 + 2.4 * uEnergy) + uKick * uLowPulse * 1.5;

  float f = field(p);
  float a = abs(f) * 0.5;

  // Local plate acceleration, and a soft lift: accel^2 / T below the knee
  // (a rattle in place), accel - T above it (a free bounce).
  float accel = a * drive;
  float bounce = accel * accel / (accel + ${LIFT_THRESHOLD.toFixed(2)});

  // Random bounce. sqrt(dt) so the random walk diffuses at the same rate at
  // any frame pace; the step is HOP_RATE-sized at the 60 fps reference.
  float step = ${HOP_RATE.toFixed(2)} * bounce * sqrt(uSimDt * 60.0) / 60.0;
  vec2 hop = (hash22(seed) - 0.5) * 2.0 * step;

  // Drift toward the line, second-order in the bounce: nothing where the
  // plate barely moves, a small fraction of the bounce on an antinode. A
  // velocity, so it scales with dt. Capped per step so a high mode can't
  // overshoot a line.
  vec2 g = fieldGrad(p);
  vec2 dir = g / (length(g) + 1e-4) * sign(f);
  float stepCap = ${STEP_CELL_FRACTION.toFixed(2)} * 2.0 / max(uMaxOrder, 1.0);
  float bias = ${PULL_BIAS.toFixed(2)} * uSettle * smoothstep(0.0, 3.0 * ${LIFT_THRESHOLD.toFixed(2)}, accel);
  float pull = min(stepCap, ${HOP_RATE.toFixed(2)} * bounce * bias * uSimDt);

  p += hop - dir * pull;

  // Off the edge: spilled. Respawn somewhere on the plate.
  if (abs(p.x) > 1.0 || abs(p.y) > 1.0) {
    p = hash22(seed + 7.31) * 2.0 - 1.0;
  }

  outColor = packPos(p);
}
`;

const BG_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
${COMMON_UNIFORMS_GLSL}
${SETTINGS_UNIFORMS_GLSL}
${PALETTE_GLSL}
${ROOM_UV_GLSL}
${CHLADNI_GLSL}

void main() {
  vec2 uv = roomUv(vUv);
  vec2 ph = plateHalf();
  vec2 p = (uv - 0.5) / ph;
  float border = max(abs(p.x), abs(p.y));
  float aa = fwidth(border) * 1.5 + 1e-4;
  float inside = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, border);

  float a = amp(p);
  vec3 plate = vec3(0.030, 0.031, 0.036);
  vec3 glow = palette(0.55 + 0.2 * a, uPalA, uPalB, uPalC, uPalD) * a * a * uFieldGlow * 0.75 * (0.3 + uEnergy);
  // The rim only exists on the square plate; the full-frame plate has no edge to show.
  float rim = (1.0 - smoothstep(0.0, 0.012, 1.0 - border)) * uSquarePlate;
  vec3 col = (plate + glow + rim * 0.10) * inside;
  col *= 1.0 + uBeatFlash * uBeatPulse * 0.3;
  outColor = vec4(col, 1.0);
}
`;

const POINT_VERT = `#version 300 es
precision highp float;
${COMMON_UNIFORMS_GLSL}
${SETTINGS_UNIFORMS_GLSL}
uniform sampler2D uPosTex;
uniform float uSide;
${CHLADNI_GLSL}
out float vAmp;
out float vGlow;
out float vSizePx;
out float vScale;
out float vShade;
out float vFacets;
out float vRot;

void main() {
  int side = int(uSide);
  ivec2 texel = ivec2(gl_VertexID % side, gl_VertexID / side);
  vec2 p = unpackPos(texelFetch(uPosTex, texel, 0));
  vAmp = amp(p);
  vec2 room = 0.5 + p * plateHalf();
  vec2 dev = (room - uViewport.xy) / uViewport.zw;
  gl_Position = vec4(dev * 2.0 - 1.0, 0.0, 1.0);
  // No two grains of sand are alike: a fixed per-grain size and shade so a
  // pile reads as grains rather than a smooth blob.
  vec2 jitter = hash22(vec2(texel) * 0.731 + 3.17);
  vShade = 0.8 + 0.4 * jitter.y;
  // Each grain is a faceted shard (3 or 4 sides, POINT_FRAG), not a disc —
  // real sand is angular. Random facet count and rotation per grain, same
  // hash family as the size/shade jitter above.
  vec2 shard = hash22(vec2(texel) * 0.911 + 5.7);
  vFacets = shard.x < 0.5 ? 3.0 : 4.0;
  vRot = shard.y * 6.2832;
  // Treble glow: the sprite grows by a fixed pixel margin to make room for
  // a halo (see POINT_FRAG), mostly on the hat/cymbal onset pulse so it
  // flashes rather than fogs.
  float glint = step(1.0 - 1.0 / ${GLINT_ONE_IN.toFixed(1)}, hash21(vec2(texel) * 0.517 + 9.1));
  vGlow = glint * clamp(uHighGlow * (0.8 * uHigh + 1.4 * uHighPulse), 0.0, 1.0);
  float resScale = max(1.0, uResolution.y / 720.0);
  // A shard inscribed in the old disc covers less area than it (a triangle
  // 0.41x, a square 0.64x); grow the size by the matching factor so a faceted
  // bed reads as bright as the round one it replaced.
  float shardGrow = vFacets < 3.5 ? 1.556 : 1.253;
  float size = uGrainSize * shardGrow * (0.75 + 0.5 * jitter.x) * resScale;
  vSizePx = size + 2.0 * ${HALO_PX.toFixed(1)} * resScale * vGlow;
  vScale = vSizePx / size;
  gl_PointSize = vSizePx;
}
`;

const POINT_FRAG = `#version 300 es
precision highp float;
in float vAmp;
in float vGlow;
in float vSizePx;
in float vScale;
in float vShade;
in float vFacets;
in float vRot;
out vec4 outColor;
${COMMON_UNIFORMS_GLSL}
${SETTINGS_UNIFORMS_GLSL}
uniform float uGrainGain;
${PALETTE_GLSL}
const float PI = 3.14159265;

void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d);
  if (r2 > 0.25) discard;
  // The sprite was enlarged by vScale for the halo; the grain itself keeps
  // its own size at the centre, so measure the core in grain radii.
  float r = sqrt(r2) * vScale;
  // A hard-edged faceted shard (3 or 4 sides, random rotation, see
  // POINT_VERT): a regular-polygon distance field, radius in the facet's own
  // direction rather than the disc's. rn >= r always (the polygon is
  // inscribed in the disc, touching it only at the corners), so the shard
  // sits inside the disc's r2 > 0.25 discard above and never gets clipped by it.
  float ang = atan(d.y, d.x) + vRot;
  float k = PI / vFacets;
  float rn = r * cos(mod(ang + k, 2.0 * k) - k) / cos(k);
  // The anti-aliased rim is one pixel wide on a big grain (so a big grain is
  // a grain, not a blur) and never more than a fraction of the radius on a
  // small one, which keeps a one-pixel grain's centre bright. Divided by
  // cos(k) to match rn's steeper gradient (vs. the disc's r), so a triangle's
  // facets don't come out aliased relative to a square's.
  float edge = min(vScale / (cos(k) * max(vSizePx, 1.0)), 0.22);
  float core = 1.0 - smoothstep(0.5 - edge, 0.5, rn);
  // Settled grains sit on the base tone; thrown grains run up the palette.
  vec3 col = palette(0.1 + 0.4 * vAmp, uPalA, uPalB, uPalC, uPalD);
  // Settled sand is chalkier than the palette; thrown grains keep its full hue.
  col = mix(col, vec3(dot(col, vec3(0.299, 0.587, 0.114))), 0.15 * (1.0 - vAmp));
  // At Grain size's chunky end, overlapping grains of the same hue would
  // merge into one flat patch (no grain-grain collision keeps them from
  // spreading apart — see file header): shade each facet distinctly and
  // darken a rim just inside the edge, so a big shard reads as a chunk of
  // grit rather than a paint blob. A one- or two-pixel grain stays flat
  // (chunky -> 0) so it doesn't dither away.
  float grainPx = vSizePx / vScale;
  float chunky = smoothstep(3.0, 7.0, grainPx);
  float facetIndex = floor(mod(ang + PI, 2.0 * PI) / (2.0 * k));
  float facetShade = 0.75 + 0.45 * fract(sin(facetIndex * 12.9898 + vRot * 78.233) * 43758.5453);
  float rim = smoothstep(0.5 - edge * 4.0, 0.5 - edge * 0.6, rn) * chunky;
  float chunkShade = mix(1.0, facetShade, chunky) * (1.0 - 0.35 * rim);
  vec3 grainCol = col * chunkShade;
  float bright = (0.8 + 1.7 * uGrainGlow) * uGrainGain * vShade * (1.0 + uBeatFlash * uBeatPulse * 0.8);
  // Treble glow: a soft halo across the enlarged sprite, tinted toward
  // white, falling to zero at the sprite edge. Normalised by sprite area
  // (in 720p pixels) so the bloom a line reaches depends on how many grains
  // glint there, not on grain size or resolution.
  float halo = 1.0 - 4.0 * r2;
  halo = halo * halo * vGlow;
  float resScale = max(1.0, uResolution.y / 720.0);
  float haloNorm = ${HALO_GAIN.toFixed(1)} * resScale * resScale / (vSizePx * vSizePx);
  vec3 haloCol = mix(col, vec3(1.0), 0.45) * halo * haloNorm * bright;
  // Premultiplied alpha: the grain is opaque (alpha = core) and occludes
  // whatever lies under it, like real sand; the halo carries no alpha, so
  // it adds. Overlapping big grains stay hard-edged instead of summing
  // into a smear.
  outColor = vec4(grainCol * bright * core + haloCol, core);
}
`;

function seedPositions(side: number): Uint8Array {
  const data = new Uint8Array(side * side * 4);
  for (let i = 0; i < side * side; i++) {
    const x = Math.floor(Math.random() * 65536);
    const y = Math.floor(Math.random() * 65536);
    data[i * 4] = x >> 8;
    data[i * 4 + 1] = x & 255;
    data[i * 4 + 2] = y >> 8;
    data[i * 4 + 3] = y & 255;
  }
  return data;
}

function createChladniScene(): Scene {
  let simProg: GLProgram | null = null;
  let bgProg: GLProgram | null = null;
  let pointProg: GLProgram | null = null;
  let quadVao: WebGLVertexArrayObject | null = null;
  let pointVao: WebGLVertexArrayObject | null = null;
  const posTex: (WebGLTexture | null)[] = [null, null];
  const posFbo: (WebGLFramebuffer | null)[] = [null, null];
  let simPosLoc: WebGLUniformLocation | null = null;
  let pointPosLoc: WebGLUniformLocation | null = null;
  let read = 0;
  let side = 1;
  let grainCount = 0;
  let response: PlateResponse | null = null;
  let lastFrameTime: number | null = null;
  const bandsBuf = new Float32Array(NUM_BANDS);

  function setModes(prog: GLProgram, modes: readonly ActiveMode[]): void {
    for (let k = 0; k < ACTIVE_MODES; k++) {
      const mode = modes[k];
      prog.setV4(`uModes[${k}]`, mode.n, mode.m, mode.sign, mode.weight);
    }
  }

  return {
    id: ID,
    name: "Chladni",
    settings: SETTINGS,

    init(ctx: SceneContext) {
      const { gl } = ctx;
      simProg = createProgram(gl, SIM_FRAG);
      bgProg = createProgram(gl, BG_FRAG);
      pointProg = createProgram(gl, POINT_FRAG, POINT_VERT);
      simPosLoc = gl.getUniformLocation(simProg.program, "uPosTex");
      pointPosLoc = gl.getUniformLocation(pointProg.program, "uPosTex");
      quadVao = createFullscreenQuad(gl);
      // The point pass has no vertex attributes at all — every grain is
      // addressed by gl_VertexID into the position texture — so it draws
      // from an empty VAO rather than the quad's (whose 3-vertex buffer a
      // 200k-vertex draw would read past).
      pointVao = gl.createVertexArray();

      grainCount = Math.max(1, Math.floor(ctx.quality.maxParticles));
      side = grainTextureSide(grainCount);
      const seed = seedPositions(side);
      for (let i = 0; i < 2; i++) {
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, side, side, 0, gl.RGBA, gl.UNSIGNED_BYTE, seed);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        posTex[i] = tex;
        posFbo[i] = fbo;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, null);

      read = 0;
      response = createPlateResponse();
      lastFrameTime = null;
    },

    render(ctx, frame, viewport, palette, anim) {
      if (!simProg || !bgProg || !pointProg || !quadVao || !pointVao || !response) return;
      const { gl } = ctx;

      // See file header for why frame.time and not anim.dtSec.
      const dt = lastFrameTime === null ? 1 / 60 : Math.max(0, Math.min(0.1, frame.time - lastFrameTime));
      lastFrameTime = frame.time;

      const modes = response.advance(dt, frame.bands, {
        complexity: resolveSceneSetting(ID, settingFor("complexity")),
        resonance: resolveSceneSetting(ID, settingFor("resonance")),
        ring: resolveSceneSetting(ID, settingFor("ring")),
      });
      let maxOrder = 1;
      for (const mode of modes) if (mode.weight > 0.05) maxOrder = Math.max(maxOrder, mode.m);

      gl.disable(gl.BLEND);

      // Sim pass: step every grain from posTex[read] into posTex[write].
      const write = 1 - read;
      gl.bindFramebuffer(gl.FRAMEBUFFER, posFbo[write]);
      gl.viewport(0, 0, side, side);
      simProg.use();
      uploadCommonUniforms(simProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf);
      setModes(simProg, modes);
      simProg.setF("uMaxOrder", maxOrder);
      simProg.setF("uSimDt", dt);
      simProg.setF("uSeed", Math.random() * 100);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, posTex[read]);
      gl.uniform1i(simPosLoc, 0);
      drawFullscreenQuad(gl, quadVao);
      // Both hosts (app.ts / tv.ts) size the viewport to the drawing buffer
      // and only re-set it on resize; the gallery preview sets it per frame.
      // Either way the drawing buffer is the right thing to restore to.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      read = write;

      // Plate.
      bgProg.use();
      uploadCommonUniforms(bgProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf);
      setModes(bgProg, modes);
      drawFullscreenQuad(gl, quadVao);

      // Sand: one point per grain, up to drawnGrainCount — see file header
      // for why a fixed grain count can't just render bigger at Grain size.
      // Premultiplied blend — opaque grain cores occlude, halos add (see
      // POINT_FRAG).
      const resScale = Math.max(1, gl.drawingBufferHeight / 720);
      const grainPx = resolveSceneSetting(ID, settingFor("grainSize")) * resScale;
      const squarePlate = resolveSceneSetting(ID, settingFor("squarePlate")) > 0.5;
      const platePx2 = squarePlate
        ? (2 * SQUARE_PLATE_HALF * Math.min(gl.drawingBufferWidth, gl.drawingBufferHeight)) ** 2
        : gl.drawingBufferWidth * gl.drawingBufferHeight;
      const drawn = drawnGrainCount(grainCount, grainPx, platePx2);

      pointProg.use();
      uploadCommonUniforms(pointProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf);
      setModes(pointProg, modes);
      pointProg.setF("uSide", side);
      pointProg.setF("uGrainGain", grainGain(grainCount));
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, posTex[read]);
      gl.uniform1i(pointPosLoc, 0);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindVertexArray(pointVao);
      gl.drawArrays(gl.POINTS, 0, drawn);
      gl.bindVertexArray(null);

      // The gallery renders every scene into one shared context each tick —
      // must not leak blend state or a bound texture onto the next tile.
      gl.disable(gl.BLEND);
      gl.bindTexture(gl.TEXTURE_2D, null);
    },

    dispose(ctx: SceneContext) {
      const { gl } = ctx;
      simProg?.dispose();
      bgProg?.dispose();
      pointProg?.dispose();
      if (quadVao) gl.deleteVertexArray(quadVao);
      if (pointVao) gl.deleteVertexArray(pointVao);
      for (let i = 0; i < 2; i++) {
        if (posFbo[i]) gl.deleteFramebuffer(posFbo[i]);
        if (posTex[i]) gl.deleteTexture(posTex[i]);
        posFbo[i] = null;
        posTex[i] = null;
      }
      simProg = null;
      bgProg = null;
      pointProg = null;
      quadVao = null;
      pointVao = null;
      simPosLoc = null;
      pointPosLoc = null;
      response = null;
      lastFrameTime = null;
    },
  };
}

export const chladniScene = createChladniScene();
