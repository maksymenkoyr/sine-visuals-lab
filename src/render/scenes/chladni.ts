import { NUM_BANDS } from "../../audio/types.ts";
import { createProgram, createFullscreenQuad, drawFullscreenQuad, type GLProgram } from "../gl.ts";
import { PALETTE_GLSL } from "../palette.ts";
import type { SceneSetting } from "../sceneSettings.ts";
import { resolveSceneSetting } from "../autoTune.ts";
import type { Scene, SceneContext } from "../scene.ts";
import { COMMON_UNIFORMS_GLSL, ROOM_UV_GLSL, settingUniformName, uploadCommonUniforms } from "../sceneCommon.ts";

// A Chladni plate, simulated rather than painted: a square free plate driven
// at one resonant mode at a time, with a bed of sand grains that each get
// kicked wherever the plate moves (the antinodes) and come to rest where it
// doesn't (the nodal lines). The classic figures aren't drawn anywhere in
// this file — they *emerge* from grain motion, and re-emerge grain by grain
// when the music moves the plate to a new mode. Contrast cymatics.ts, which
// is an analytic circular-plate sum rendered per pixel; this one has state.
//
// The plate. Plate space is p in [-1,1]^2. The mode shape is the standard
// free-square-plate approximation
//     chladni(p; n, m, s) = cos(n pi x) cos(m pi y) + s cos(m pi x) cos(n pi y)
// with s = +/-1 picking one of the two symmetry families. n == m with
// s = -1 is identically zero, so buildModeTable only holds pairs with
// n < m, sorted by n^2 + m^2 — the eigenfrequency proxy — so walking the
// table is "sweeping the driving frequency up". Music picks a table index
// (createModeSelector: spectral centroid -> index, with a hold time and a
// beat-gated switch so the figure holds and then *jumps*, the way a real
// plate flips between figures as the frequency sweeps through resonance),
// and the shader crossfades chladni(A) -> chladni(B) over the Morph setting
// so grains migrate to the new lines instead of teleporting.
//
// The sand. Grain positions live in a ping-pong pair of RGBA8 textures,
// 16-bit fixed point per axis (R,G = x, B,A = y). RGBA8 is renderable on
// every WebGL2 device with no EXT_color_buffer_float dependency (the
// webOS/Tizen targets vite.config.ts builds for), and 1/65535 of the plate
// is sub-pixel even at 4K; half-float would be *too coarse* for positions,
// so the packing is the design, not a fallback. Per rendered frame the sim
// fragment shader steps every grain: a random hop scaled by the local
// amplitude a = |field|/2 (a grain on an antinode gets thrown, a grain on a
// node stays put), a settling pull down the analytic gradient of |field|,
// and a respawn at a random spot for any grain that hops off the plate
// edge — a real plate spills sand; refilling keeps the count constant and
// the "rain" of fresh grains onto antinodes reads as alive. Both hop and
// pull are scaled by how hard the plate is being driven (energy, plus a
// bass-onset kick), so silence freezes the figure in place.
//
// dt for the sim comes from frame.time deltas, not anim.dtSec: the anim
// clock advances every rAF tick while render() is frame-pace-capped, so
// dtSec under-counts the wall time a rendered frame actually covers.
const ID = "chladni";

/** One free-plate mode: the (n, m) orders and the symmetry-family sign. */
export interface PlateMode {
  n: number;
  m: number;
  sign: 1 | -1;
}

/** Highest mode order the table reaches. (9, 8) is already a fine lattice
 *  at TV distance; past that the nodal cells fall below grain size. */
export const MAX_ORDER = 9;

/** Every (n, m) with 1 <= n < m <= maxOrder, ascending by n^2 + m^2 (the
 *  square plate's eigenfrequency proxy), signs alternating so a sweep up
 *  the table visits both symmetry families. See the file header for why
 *  n == m is excluded. */
export function buildModeTable(maxOrder: number = MAX_ORDER): PlateMode[] {
  const pairs: { n: number; m: number }[] = [];
  for (let n = 1; n < maxOrder; n++) {
    for (let m = n + 1; m <= maxOrder; m++) pairs.push({ n, m });
  }
  pairs.sort((a, b) => a.n * a.n + a.m * a.m - (b.n * b.n + b.m * b.m) || a.n - b.n);
  return pairs.map((p, i) => ({ ...p, sign: i % 2 === 0 ? -1 : 1 }));
}

export const MODE_TABLE: readonly PlateMode[] = buildModeTable();

/** Energy-weighted mean band index, normalised to [0,1] (0 = all bass,
 *  1 = all treble). Returns 0 for silence rather than NaN. */
export function spectralCentroid(bands: ArrayLike<number>): number {
  const count = bands.length;
  if (count < 2) return 0;
  let sum = 0;
  let weighted = 0;
  for (let i = 0; i < count; i++) {
    const b = Math.max(0, bands[i]);
    sum += b;
    weighted += b * i;
  }
  if (sum < 1e-6) return 0;
  return weighted / sum / (count - 1);
}

/** Side of the square position texture that holds `count` grains. */
export function grainTextureSide(count: number): number {
  return Math.max(1, Math.ceil(Math.sqrt(Math.max(1, count))));
}

export interface ModeSelectorInputs {
  /** Spectral centroid this tick, [0,1]. */
  centroid: number;
  /** FeatureFrame.energy — below ENERGY_GATE no new switch starts. */
  energy: number;
  /** True on the tick an onset/beat fired. */
  beat: boolean;
  /** Whether a tempo is currently held (beat gating only applies then). */
  tempoLocked: boolean;
  /** True on the tick a section change/drop fired — forces a leap. */
  dropOnset: boolean;
  /** Pattern complexity setting, [0,1]: how far up the table music can reach. */
  complexity: number;
  /** Minimum seconds a figure holds before it may switch. */
  holdSec: number;
  /** Seconds the A -> B crossfade takes. */
  morphSec: number;
}

export interface ModeState {
  a: PlateMode;
  b: PlateMode;
  /** 0 = fully A, 1 = fully B. */
  blend: number;
  /** Table index of the mode being shown (A while morphing). */
  index: number;
}

/** Energy below which the plate isn't being driven enough to re-tune. */
export const ENERGY_GATE = 0.03;
/** Seconds the centroid eases over before it's read as a target. */
const CENTROID_EASE_SEC = 0.5;
/** Centroid -> table position curve; < 1 lifts the mid-range so ordinary
 *  music (centroid near 0.4) doesn't sit on the simplest few modes. */
const CENTROID_GAMMA = 0.8;
/** Most table entries one ordinary switch may move — keeps a sweep feeling
 *  like a sweep instead of a random jump. */
const MAX_STEP = 3;
/** Entries a drop leaps, ignoring MAX_STEP and the hold. */
const DROP_LEAP = 4;
/** After this many hold periods without a beat, switch anyway — a tempo
 *  lock whose beats stop arriving must not pin the figure forever. */
const BEAT_WAIT_HOLDS = 2;
const MIN_MORPH_SEC = 0.05;

export interface ModeSelector {
  advance(dtSec: number, inputs: ModeSelectorInputs): ModeState;
  readonly state: ModeState;
}

export function createModeSelector(table: readonly PlateMode[] = MODE_TABLE, startIndex = 2): ModeSelector {
  const last = table.length - 1;
  let index = Math.max(0, Math.min(last, startIndex));
  let target = index;
  let blend = 1;
  let sinceSwitch = 0;
  let pitch: number | null = null;

  const state: ModeState = { a: table[index], b: table[index], blend, index };

  function begin(next: number): void {
    target = Math.max(0, Math.min(last, next));
    if (target === index) return;
    state.b = table[target];
    blend = 0;
    sinceSwitch = 0;
  }

  return {
    state,
    advance(dtSec, inputs) {
      const dt = Number.isFinite(dtSec) && dtSec > 0 ? dtSec : 0;
      const c = Math.max(0, Math.min(1, inputs.centroid));
      if (pitch === null) pitch = c;
      else pitch += (c - pitch) * (1 - Math.exp(-dt / CENTROID_EASE_SEC));

      sinceSwitch += dt;

      if (blend < 1) {
        const morph = Math.max(MIN_MORPH_SEC, inputs.morphSec);
        blend = Math.min(1, blend + dt / morph);
        if (blend >= 1) {
          index = target;
          state.a = table[index];
        }
      } else {
        const complexity = Math.max(0, Math.min(1, inputs.complexity));
        const desired = Math.round(Math.pow(pitch, CENTROID_GAMMA) * complexity * last);
        const driven = inputs.energy >= ENERGY_GATE;
        if (driven && inputs.dropOnset) {
          begin(index + (desired >= index ? DROP_LEAP : -DROP_LEAP));
        } else if (driven && desired !== index && sinceSwitch >= inputs.holdSec) {
          const beatOk = !inputs.tempoLocked || inputs.beat || sinceSwitch >= inputs.holdSec * BEAT_WAIT_HOLDS;
          if (beatOk) {
            const step = Math.max(-MAX_STEP, Math.min(MAX_STEP, desired - index));
            begin(index + step);
          }
        }
      }

      state.blend = blend;
      state.index = index;
      return state;
    },
  };
}

/** Pattern hold setting [0,1] -> seconds a figure holds before switching. */
export function holdSeconds(hold: number): number {
  return 0.5 + Math.max(0, Math.min(1, hold)) * 7.5;
}

/** Morph speed setting [0,1] -> seconds the crossfade takes (0 = slow drift,
 *  1 = near-instant snap). */
export function morphSeconds(morph: number): number {
  return 3.0 * Math.pow(0.033, Math.max(0, Math.min(1, morph)));
}

/** Per-grain brightness gain so a sparse floor-quality bed and a dense
 *  high-quality one land near the same overall exposure under additive
 *  blending. Anchored at REFERENCE_GRAINS = gain 1. */
export const REFERENCE_GRAINS = 50_000;
export function grainGain(count: number): number {
  return Math.max(0.5, Math.min(3, Math.sqrt(REFERENCE_GRAINS / Math.max(1, count))));
}

const SETTINGS: SceneSetting[] = [
  {
    key: "complexity",
    label: "Pattern complexity",
    description: "How fine a figure the music can reach — low keeps a few bold lines, high allows a dense lattice",
    group: "Plate",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    // Bright, busy mixes push the plate up to finer modes.
    auto: { brightness: 0.35, density: 0.2 },
  },
  {
    key: "hold",
    label: "Pattern hold",
    description: "How long a figure holds before the plate may flip to the next one",
    group: "Plate",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.4,
    // Fast, steady music flips sooner; slow material holds a figure longer.
    auto: { tempo: -0.25, pulse: -0.15 },
  },
  {
    key: "morph",
    label: "Morph speed",
    description: "How fast the plate re-tunes between figures — low drifts the grains across, high snaps",
    group: "Plate",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    // Sharp, percussive material wants a snappier re-tune.
    auto: { attack: 0.3 },
  },
  {
    key: "squarePlate",
    label: "Square plate",
    description: "On: the classic square plate, centered. Off: the plate stretches to fill the screen",
    group: "Plate",
    min: 0,
    max: 1,
    step: 1,
    default: 1,
    type: "boolean",
  },
  {
    key: "shake",
    label: "Vibration",
    description: "How hard the music shakes the plate — grains hop further on the antinodes",
    group: "Sand",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    // A loud, dynamic room drives the plate harder.
    auto: { loudness: 0.3, dynamics: 0.15 },
  },
  {
    key: "settle",
    label: "Settling pull",
    description: "How strongly grains slide toward the still lines while the plate is driven",
    group: "Sand",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    // A steady beat reads best with figures that lock in crisply.
    auto: { pulse: 0.2 },
  },
  {
    key: "kick",
    label: "Bass kick",
    description: "A bass hit throws the sand off its lines; the figure re-forms as it settles",
    group: "Sand",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    // Dark, bass-heavy mixes carry more kick presence to throw on.
    auto: { brightness: -0.3, attack: 0.25 },
  },
  {
    key: "grainSize",
    label: "Grain size",
    description: "Size of each sand grain on screen",
    group: "Sand",
    min: 0.5,
    max: 3,
    step: 0.1,
    default: 1.4,
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
const PLATE_HALF = 0.46;

// Shared by all three programs so the plate function, its gradient, the
// plate-to-room mapping and the position packing can't drift apart.
const CHLADNI_GLSL = `
uniform vec4 uModeA; // n, m, sign, unused
uniform vec4 uModeB;
uniform float uModeBlend;
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

float field(vec2 p) { return mix(chladni(p, uModeA), chladni(p, uModeB), uModeBlend); }
vec2 fieldGrad(vec2 p) { return mix(chladniGrad(p, uModeA), chladniGrad(p, uModeB), uModeBlend); }
float amp(vec2 p) { return abs(field(p)) * 0.5; }

// Half-extent of the plate in room uv. Square: fits the shorter axis.
// Stretched: fills the frame with a small margin.
vec2 plateHalf() {
  float aspect = uResolution.x / uResolution.y;
  vec2 square = aspect >= 1.0 ? vec2(${PLATE_HALF.toFixed(2)} / aspect, ${PLATE_HALF.toFixed(2)})
                              : vec2(${PLATE_HALF.toFixed(2)}, ${PLATE_HALF.toFixed(2)} * aspect);
  return uSquarePlate > 0.5 ? square : vec2(${PLATE_HALF.toFixed(2)});
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

// A grain never quite stops: this floor on the hop keeps settled grains
// jittering around a line so it has a fuzzy sand width instead of a
// hairline — the settling pull below balances it.
const HOP_FLOOR = 0.3;
// Plate-space units per second a fully driven grain hops at Vibration 1.
const HOP_RATE = 0.8;
// Plate-space units per second the settling pull moves a grain on an
// antinode at Settling pull 1, fully driven.
const PULL_RATE = 1.5;
// A step may never cross more than this fraction of one nodal cell, so high
// modes can't overshoot a line and oscillate.
const STEP_CELL_FRACTION = 0.25;

const SIM_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
${COMMON_UNIFORMS_GLSL}
${SETTINGS_UNIFORMS_GLSL}
uniform sampler2D uPosTex;
uniform float uSimDt;
uniform float uSeed;
${CHLADNI_GLSL}

void main() {
  ivec2 texel = ivec2(gl_FragCoord.xy);
  vec2 p = unpackPos(texelFetch(uPosTex, texel, 0));
  vec2 seed = gl_FragCoord.xy * 0.173 + uSeed;

  // How hard the plate is being driven right now: sustained energy plus a
  // bass-onset kick. Silence -> ~0 -> the figure freezes.
  float drive = uShake * (0.15 + 1.6 * uEnergy) + uKick * uLowPulse * 1.5;

  float f = field(p);
  float a = abs(f) * 0.5;

  // Random hop, largest on the antinodes.
  vec2 hop = (hash22(seed) - 0.5) * 2.0 * ${HOP_RATE.toFixed(2)} * drive * (${HOP_FLOOR.toFixed(2)} + pow(a, 1.5)) * uSimDt;

  // Settling pull: down the gradient of |field|, capped per step so a high
  // mode can't overshoot a line.
  vec2 g = fieldGrad(p);
  vec2 dir = g / (length(g) + 1e-4) * sign(f);
  float maxOrder = max(max(uModeA.y, uModeB.y), 1.0);
  float stepCap = ${STEP_CELL_FRACTION.toFixed(2)} * 2.0 / maxOrder;
  float pull = min(stepCap, uSettle * (0.3 + drive) * (0.02 + a) * ${PULL_RATE.toFixed(2)} * uSimDt);

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
  vec3 glow = palette(0.55 + 0.2 * a, uPalA, uPalB, uPalC, uPalD) * a * a * uFieldGlow * 0.4 * (0.3 + uEnergy);
  float rim = 1.0 - smoothstep(0.0, 0.012, 1.0 - border);
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

void main() {
  int side = int(uSide);
  ivec2 texel = ivec2(gl_VertexID % side, gl_VertexID / side);
  vec2 p = unpackPos(texelFetch(uPosTex, texel, 0));
  vAmp = amp(p);
  vec2 room = 0.5 + p * plateHalf();
  vec2 dev = (room - uViewport.xy) / uViewport.zw;
  gl_Position = vec4(dev * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = uGrainSize * max(1.0, uResolution.y / 720.0);
}
`;

const POINT_FRAG = `#version 300 es
precision highp float;
in float vAmp;
out vec4 outColor;
${COMMON_UNIFORMS_GLSL}
${SETTINGS_UNIFORMS_GLSL}
uniform float uGrainGain;
${PALETTE_GLSL}

void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d);
  if (r2 > 0.25) discard;
  float soft = 1.0 - smoothstep(0.08, 0.25, r2);
  // Settled grains sit on the base tone; thrown grains run up the palette.
  vec3 col = palette(0.1 + 0.4 * vAmp, uPalA, uPalB, uPalC, uPalD);
  // Settled sand is chalkier than the palette; thrown grains keep its full hue.
  col = mix(col, vec3(dot(col, vec3(0.299, 0.587, 0.114))), 0.3 * (1.0 - vAmp));
  float bright = (0.1 + 0.55 * uGrainGlow) * uGrainGain * (1.0 + uBeatFlash * uBeatPulse * 1.2);
  outColor = vec4(col * bright * soft, 1.0);
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
  let selector: ModeSelector | null = null;
  let lastFrameTime: number | null = null;
  const bandsBuf = new Float32Array(NUM_BANDS);

  function setMode(prog: GLProgram, state: ModeState): void {
    prog.setV4("uModeA", state.a.n, state.a.m, state.a.sign, 0);
    prog.setV4("uModeB", state.b.n, state.b.m, state.b.sign, 0);
    prog.setF("uModeBlend", state.blend);
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
      selector = createModeSelector();
      lastFrameTime = null;
    },

    render(ctx, frame, viewport, palette, anim) {
      if (!simProg || !bgProg || !pointProg || !quadVao || !pointVao || !selector) return;
      const { gl } = ctx;

      // See file header for why frame.time and not anim.dtSec.
      const dt = lastFrameTime === null ? 1 / 60 : Math.max(0, Math.min(0.1, frame.time - lastFrameTime));
      lastFrameTime = frame.time;

      const state = selector.advance(dt, {
        centroid: spectralCentroid(frame.bands),
        energy: frame.energy,
        beat: frame.beat || anim.lowOnset,
        tempoLocked: anim.tempoLock > 0.5,
        dropOnset: anim.dropOnset,
        complexity: resolveSceneSetting(ID, settingFor("complexity")),
        holdSec: holdSeconds(resolveSceneSetting(ID, settingFor("hold"))),
        morphSec: morphSeconds(resolveSceneSetting(ID, settingFor("morph"))),
      });

      gl.disable(gl.BLEND);

      // Sim pass: step every grain from posTex[read] into posTex[write].
      const write = 1 - read;
      gl.bindFramebuffer(gl.FRAMEBUFFER, posFbo[write]);
      gl.viewport(0, 0, side, side);
      simProg.use();
      uploadCommonUniforms(simProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf);
      setMode(simProg, state);
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
      setMode(bgProg, state);
      drawFullscreenQuad(gl, quadVao);

      // Sand: one point per grain, additive so piles on the lines add up.
      pointProg.use();
      uploadCommonUniforms(pointProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf);
      setMode(pointProg, state);
      pointProg.setF("uSide", side);
      pointProg.setF("uGrainGain", grainGain(grainCount));
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, posTex[read]);
      gl.uniform1i(pointPosLoc, 0);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.bindVertexArray(pointVao);
      gl.drawArrays(gl.POINTS, 0, grainCount);
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
      selector = null;
      lastFrameTime = null;
    },
  };
}

export const chladniScene = createChladniScene();
