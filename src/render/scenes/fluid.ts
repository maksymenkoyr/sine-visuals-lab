import { createProgram, createFullscreenQuad, drawFullscreenQuad, type GLProgram } from "../gl.ts";
import { PALETTE_GLSL } from "../palette.ts";
import type { SceneSetting } from "../sceneSettings.ts";
import { resolveSceneSetting } from "../autoTune.ts";
import type { Scene, SceneContext } from "../scene.ts";
import { COMMON_UNIFORMS_GLSL, ROOM_UV_GLSL, settingUniformName, uploadCommonUniforms } from "../sceneCommon.ts";
import { NUM_BANDS } from "../../audio/types.ts";
import {
  createFluidSim,
  detectSimFormat,
  sameSimSize,
  simIoGlsl,
  simResolutionFor,
  SPLAT_SLOTS,
  type FluidSim,
  type MirrorMode,
  type SimFormat,
  type Splat,
} from "./fluidSim.ts";

// Neon Fluid: a 2D incompressible dye sim (Stam 1999 stable-fluids scheme;
// vorticity confinement per Fedkiw et al. — textbook GPU Gems ch.38 math,
// written independently here, not ported from any third-party fluid-sim
// codebase — see CLAUDE.md's "independent work" rule) rendered as a thin
// neon edge line over near-black, mirrored four ways so one simulated
// quadrant becomes a full-screen symmetric plume. The heavy lifting — the
// advect/curl/force/divergence/jacobi/gradient/dye/edge passes, the ping-pong
// targets, the half/byte format fallback — lives in fluidSim.ts, which knows
// nothing about scenes or settings; this file owns everything that turns
// music into a moving fluid: the emitter/splat schedule (splatEnvelope,
// emitterState), the SETTINGS the device menu shows, and the display shader
// that colours the sim by *screen* x (blue -> cyan -> yellow -> orange ->
// red) with a purple emitter tag blended in and a Sobel-edge neon line with
// a mip-sampled glow on top.
//
// Audio wiring: most of the emitter's punch now comes from a **puff clock**
// (createPuffState/advancePuff below) rather than a continuous push — it
// fires on a bass/broadband onset (or, once tempo-locked, on the beat-phase
// wrap), decays through puffEnv (the same short-attack/exponential-decay
// shape as caustics' rippleEnvelope), and drives both the centre emitter's
// force/dye spike and the secondary splats' per-slot delay, so each beat
// reads as one ring that detaches and stretches into a filament rather than
// a steady jet. A free-running fallback phase keeps the puffs (and the
// secondary splats' old sawtooth envelope, blended underneath) going in
// silence. `energy` still drives a small continuous base and, via the
// `warp` setting (see warpedDt), the sim's own timestep — loud passages run
// the whole flow faster. The display shader adds a beat-synced brightening
// of the edge line (`uBeatPulse`) and tints the screen-position colour ramp
// by the live spectral centroid, on top of the manual hue shift. The
// Swirl/Dye fade/Viscosity settings are themselves music-reactive via `auto`
// weights, same as every other scene's SETTINGS. Only the display program
// goes through uploadCommonUniforms — the sim's own programs (fluidSim.ts)
// take a narrower, JS-computed set of per-step uniforms that have nothing to
// do with a scene's settings.
//
// dt: as chladni.ts, computed from frame.time deltas rather than
// anim.dtSec — the anim clock advances every rAF tick while render() is
// itself frame-pace-capped, so dtSec under-counts the wall time a rendered
// frame actually covers, and a stable fluid sim needs the real one.
const ID = "fluid";

// ---------------------------------------------------------------------------
// Emitter / splat schedule
// ---------------------------------------------------------------------------

export interface EmitterInputs {
  flowPhase: number;
  energy: number;
  lowPulse: number;
  beatPulse: number;
  emitStrength: number;
  beatKick: number;
  dyeFlow: number;
  mirror: MirrorMode;
  /** This frame's puff envelope value (puffEnv(puff.age)), 0..1 — see the
   *  puff clock below. Scales the centre emitter's extra force and dye. */
  puff: number;
  /** Seconds since the puff clock last fired — feeds each secondary splat's
   *  own delayed puffEnv (see the SPLAT_DELAY loop in emitterState). */
  puffAge: number;
  /** Decaying flash on a detected section change — adds a one-off launch to
   *  the emitter force on top of the beat puff. */
  dropPulse: number;
}

/** Splat 0 is the always-on centre emitter, in sim space (the simulated
 *  quadrant/half/full domain, per mirror mode). */
export const EMIT_SIGMA = 0.07;
/** Ring injection: when > 0, slot 0's dye/force weight is a gaussian shell
 *  of this radius (sim uv) instead of a blob — see fluidSim.ts's Splat.ring
 *  for the shell math. EMIT_RING_SIGMA is the shell's own thickness (plays
 *  the role EMIT_SIGMA plays for a blob). A ring stretches into a thin
 *  filament as the flow carries it outward, instead of a blob's soft plume. */
export const EMIT_RING = 0.25;
export const EMIT_RING_SIGMA = 0.012;
export const EMIT_FORCE_BASE = 15;
export const EMIT_FORCE_ENERGY = 260;
export const EMIT_KICK_LOW = 500;
export const EMIT_KICK_BEAT = 250;
export const EMIT_SWAY = 0.6;
export const EMIT_SWAY_RATE = 0.35;
/** Extra emitter force from a beat puff / a drop, gated by beatKick. */
export const PUFF_FORCE = 700;
export const DROP_FORCE = 1500;
/** Continuous (always-on) and puff-driven dye injection at the emitter. */
export const DYE_BASE_CONT = 0.05;
export const DYE_ENERGY_CONT = 0.3;
export const PUFF_DYE = 8;

/** Beat puff clock: fires an emitter/splat spike on a bass or broadband
 *  onset (or, once tempo-locked, on the beat-phase wrap), with a
 *  free-running fallback so puffs — and the striations they create — keep
 *  happening in silence. Envelope shape mirrors caustics' rippleEnvelope
 *  (src/render/scenes/caustics.ts): a short attack so a puff reads as a
 *  ring, not a step, then an exponential decay. */
export const PUFF_ATTACK = 0.03;
export const PUFF_DECAY = 6;
export const PUFF_FALLBACK_AFTER = 1.5;
export const PUFF_FALLBACK_RATE = 1.6;
/** Which live signal fires a puff when not falling back to silence: an
 *  onset edge, or (once tempo-locked) the beat-phase wrap. A constant, not a
 *  setting — for sweeping from the screenshot script, not the device menu. */
export const PUFF_TRIGGER: "onset" | "beatPhase" = "onset";

export function puffEnv(ageSec: number): number {
  if (ageSec < 0) return 0;
  return (1 - Math.exp(-ageSec / PUFF_ATTACK)) * Math.exp(-ageSec * PUFF_DECAY);
}

export interface PuffState {
  /** Seconds since the puff last fired. */
  age: number;
  /** Seconds since the last onset-caused fire (drives the silence fallback). */
  sinceOnset: number;
  /** Previous frame's fract(flowPhase * PUFF_FALLBACK_RATE) — lets the
   *  fallback detect a wrap without storing the raw phase. */
  fallbackPhase: number;
  /** Previous frame's beatPhase — lets the beatPhase trigger detect a wrap. */
  lastBeatPhase: number;
}

export function createPuffState(): PuffState {
  return { age: 0, sinceOnset: 0, fallbackPhase: 0, lastBeatPhase: 0 };
}

/** Advances the puff clock in place by one frame and returns whether a puff
 *  fired this frame. `fired` is the caller's onset edge (anim.lowOnset ||
 *  anim.onset). Firing order: PUFF_TRIGGER === "beatPhase" and tempo-locked
 *  fires on the beatPhase wrap; otherwise (or as a fallback when tempo isn't
 *  locked) an onset edge fires; failing both, a silence fallback fires once
 *  the free-running fallback phase wraps after PUFF_FALLBACK_AFTER seconds
 *  with no onset. */
export function advancePuff(
  st: PuffState,
  dtSec: number,
  fired: boolean,
  beatPhase: number,
  tempoLock: number,
  flowPhase: number,
): boolean {
  st.age += dtSec;
  st.sinceOnset += dtSec;

  let firedNow = false;

  if (PUFF_TRIGGER === "beatPhase" && tempoLock > 0.5) {
    if (beatPhase < st.lastBeatPhase) firedNow = true;
  }
  if (!firedNow && fired) firedNow = true;

  if (firedNow) {
    st.age = 0;
    st.sinceOnset = 0;
  } else if (st.sinceOnset > PUFF_FALLBACK_AFTER) {
    const phase = flowPhase * PUFF_FALLBACK_RATE;
    const frac = phase - Math.floor(phase);
    if (frac < st.fallbackPhase) {
      st.age = 0;
      firedNow = true;
    }
    st.fallbackPhase = frac;
  }

  st.lastBeatPhase = beatPhase;
  return firedNow;
}

/** Per-slot delay between the centre emitter's puff and each secondary
 *  splat's own puff-driven spike — a beat's ripple visibly reaching each
 *  splat point in turn rather than every slot firing at once. */
export const SPLAT_DELAY = 0.08;
/** How much of the old free-running sawtooth (splatEnvelope) still blends
 *  under the puff-driven envelope, so secondary splats keep stirring the
 *  plume in silence rather than going fully dark between puffs. */
export const SPLAT_FALLBACK_MIX = 0.35;

/** Secondary periodic splats: rate of the [0,1] envelope cycle per second of
 *  flowPhase, its exponential decay shape, and per-slot force/dye/sigma. */
export const SPLAT_RATE = 0.18;
export const SPLAT_DECAY = 0.12;
export const SPLAT_FORCE = 260;
export const SPLAT_DYE = 0.4;
export const SPLAT_SIGMA = 0.12;

export const SIM_DT_MAX = 1 / 30;
export const SIM_DT_DEFAULT = 1 / 60;
/** warpedDt's clamp floor/gain — see its own comment below. */
export const WARP_MIN = 0.7;
export const WARP_GAIN = 0.9;

/** Tempo warp: scales the sim's own timestep by loudness and the `warp`
 *  setting, so louder passages visibly speed the whole flow up (clamped to
 *  SIM_DT_MAX *after* warping, same cap as an unwarped frame). At warp=0,
 *  energy=0 this is just WARP_MIN * dt; at warp=1 the energy term can double
 *  it before the clamp. Pure and exported for tests/fluid.test.ts. */
export function warpedDt(dt: number, energy: number, warp: number): number {
  const mul = WARP_MIN + WARP_GAIN * energy * (0.5 + warp);
  return Math.min(SIM_DT_MAX, dt * mul);
}

/** Quadrant-space (mirror = Kaleidoscope) uv for the SPLAT_SLOTS-1 secondary
 *  splat points, one per non-emitter slot. Remapped for the other mirror
 *  modes by remapSplatPoint below. */
const SPLAT_POINTS: readonly [number, number][] = [
  [0.3, 0.45],
  [0.6, 0.8],
  [0.25, 0.85],
];

/** Maps a quadrant-space splat point into the domain actually simulated at
 *  `mirror` — Off simulates the full [-1,1]-ish square (here [0,1] centred
 *  at 0.5), Left-right only folds x, Kaleidoscope folds both. The quadrant
 *  point already lives in [0,1]^2 with (0,0) at the shared seam corner, so:
 *  Kaleidoscope keeps it as-is; Left-right also keeps x (still folded) and
 *  maps y from [0,1] (half domain, seam at y=0.5) around the centre;
 *  Off unfolds both axes around the centre. */
function remapSplatPoint(x: number, y: number, mirror: MirrorMode): [number, number] {
  if (mirror === 2) return [x, y];
  if (mirror === 1) return [x, 0.5 + (y - 0.5) * 0.5];
  return [0.5 + (x - 0.5) * 0.5, 0.5 + (y - 0.5) * 0.5];
}

/** Slot 0's position (the centre emitter) for each mirror mode — sits on the
 *  shared vertical seam, at the point that maps to screen centre once the
 *  display's mirror unfolds it. */
function emitterPosition(mirror: MirrorMode): [number, number] {
  if (mirror === 2) return [0, 0];
  if (mirror === 1) return [0, 0.5];
  return [0.5, 0.5];
}

/** [0,1] periodic envelope for secondary splat `i` (0-indexed among the
 *  SPLAT_SLOTS-1 secondary slots): a sawtooth-triggered exponential decay,
 *  phase-offset by i/3 of a cycle so the slots don't all fire together. */
export function splatEnvelope(flowPhase: number, i: number): number {
  const phase = flowPhase * SPLAT_RATE + i / 3;
  const frac = phase - Math.floor(phase);
  return Math.exp(-frac / SPLAT_DECAY);
}

/** Fills and returns `out` (length SPLAT_SLOTS, reused buffer) with this
 *  frame's splats: slot 0 is the always-on centre emitter (tag 1, force
 *  along the mirror seam rotated by a slow sway, spiked by the puff clock),
 *  slots 1..SPLAT_SLOTS-1 are periodic secondary splats (tag 0) from
 *  SPLAT_POINTS, each fired from the same puff clock with a per-slot delay
 *  (falling back to the old free sawtooth in silence). */
export function emitterState(inp: EmitterInputs, out: Splat[]): Splat[] {
  const [ex, ey] = emitterPosition(inp.mirror);
  const sway = EMIT_SWAY * Math.sin(inp.flowPhase * EMIT_SWAY_RATE);
  const cos = Math.cos(sway);
  const sin = Math.sin(sway);
  // Base direction is +y (along the vertical seam), rotated by `sway`.
  const fxDir = -sin;
  const fyDir = cos;
  const force =
    inp.emitStrength * (EMIT_FORCE_BASE + EMIT_FORCE_ENERGY * inp.energy) +
    inp.beatKick * (EMIT_KICK_LOW * inp.lowPulse + EMIT_KICK_BEAT * inp.beatPulse) +
    inp.beatKick * (PUFF_FORCE * inp.puff + DROP_FORCE * inp.dropPulse);
  const dye = inp.dyeFlow * (DYE_BASE_CONT + DYE_ENERGY_CONT * inp.energy + PUFF_DYE * inp.puff * (0.5 + inp.beatKick));

  const slot0 = out[0] ?? (out[0] = { x: 0, y: 0, sigma: 0, ring: 0, fx: 0, fy: 0, dye: 0, tag: 0 });
  slot0.x = ex;
  slot0.y = ey;
  // Sizes are specified in quadrant space; the unfolded modes' domains span
  // twice the screen per uv, so halve them there to keep the same on-screen
  // emitter (remapSplatPoint does the same to the splat points).
  const sizeScale = inp.mirror === 2 ? 1 : 0.5;
  if (EMIT_RING > 0) {
    slot0.ring = EMIT_RING * sizeScale;
    slot0.sigma = EMIT_RING_SIGMA * sizeScale;
  } else {
    slot0.ring = 0;
    slot0.sigma = EMIT_SIGMA * sizeScale;
  }
  slot0.fx = fxDir * force;
  slot0.fy = fyDir * force;
  slot0.dye = dye;
  slot0.tag = 1;
  out[0] = slot0;

  for (let i = 1; i < SPLAT_SLOTS; i++) {
    const point = SPLAT_POINTS[(i - 1) % SPLAT_POINTS.length];
    const [px, py] = remapSplatPoint(point[0], point[1], inp.mirror);
    const puffBased = puffEnv(inp.puffAge - (i - 1) * SPLAT_DELAY);
    const env = Math.max(puffBased, SPLAT_FALLBACK_MIX * splatEnvelope(inp.flowPhase, i - 1));
    const slot = out[i] ?? (out[i] = { x: 0, y: 0, sigma: 0, ring: 0, fx: 0, fy: 0, dye: 0, tag: 0 });
    slot.x = px;
    slot.y = py;
    slot.sigma = SPLAT_SIGMA;
    slot.ring = 0;
    // Splats push *tangentially* around the emitter (alternating sense per
    // slot), scaled by the envelope — stirring the plume into side vortices
    // rather than blowing detached puffs outward.
    const dx = px - ex;
    const dy = py - ey;
    const len = Math.hypot(dx, dy) || 1;
    const f = SPLAT_FORCE * env * inp.emitStrength * (i % 2 === 0 ? 1 : -1);
    slot.fx = (-dy / len) * f;
    slot.fy = (dx / len) * f;
    slot.dye = SPLAT_DYE * env * inp.dyeFlow;
    slot.tag = 0;
    out[i] = slot;
  }

  out.length = SPLAT_SLOTS;
  return out;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const SETTINGS: SceneSetting[] = [
  {
    key: "emitStrength",
    label: "Emitter push",
    description: "Continuous push from the centre emitter (the beat puffs add to it)",
    group: "Flow",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { loudness: 0.3, attack: 0.2 },
  },
  {
    key: "beatKick",
    label: "Beat puffs",
    description: "Force and dye of the puff fired on each beat",
    group: "Flow",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    auto: { attack: 0.3, pulse: 0.2, density: -0.15 },
    reads: ["anim.lowOnset", "feature.onset", "anim.dropOnset"],
  },
  {
    key: "curl",
    label: "Swirl",
    description: "Vorticity confinement — how curly the flow gets",
    group: "Flow",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.45,
    auto: { density: 0.25, tempo: 0.2 },
  },
  {
    key: "viscosity",
    label: "Viscosity",
    description: "How syrupy the flow is — high values give big smooth rolls",
    group: "Flow",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { tempo: -0.2, density: 0.15 },
  },
  {
    key: "dissipation",
    label: "Dye fade",
    description: "How quickly dye fades as it drifts",
    group: "Flow",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.3,
    auto: { tempo: 0.3, density: 0.2 },
  },
  {
    key: "dyeFlow",
    label: "Dye flow",
    description: "How much dye the emitter and splats inject",
    group: "Flow",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { loudness: 0.2, dynamics: 0.15 },
  },
  {
    key: "warp",
    label: "Tempo warp",
    description: "How much loud passages speed the whole flow up",
    group: "Flow",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { dynamics: 0.25, loudness: 0.15 },
  },
  {
    key: "edgeGlow",
    label: "Neon glow",
    description: "Brightness of the soft halo around each edge line",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { loudness: 0.25, brightness: 0.15 },
  },
  {
    key: "sparkle",
    label: "Treble sparkle",
    description: "Extra brightness on the edge line from hats and cymbals",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { brightness: 0.35, attack: 0.15 },
  },
  {
    key: "hueShift",
    label: "Hue shift",
    description: "Rotates the screen-position colour ramp",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.01,
    default: 0,
    reads: ["anim.centroid"],
  },
  {
    key: "mirror",
    label: "Mirror",
    description: "Off: full domain. Left-right: mirrored on x. Kaleidoscope: mirrored on x and y",
    group: "Look",
    min: 0,
    max: 2,
    step: 1,
    default: 2,
    type: "enum",
    options: ["Off", "Left-right", "Kaleidoscope"],
  },
];

function settingFor(key: string): SceneSetting {
  const s = SETTINGS.find((x) => x.key === key);
  if (!s) throw new Error(`fluid: unknown setting ${key}`);
  return s;
}

const SETTINGS_UNIFORMS_GLSL = SETTINGS.map((s) => `uniform float ${settingUniformName(s.key)};`).join("\n");

// ---------------------------------------------------------------------------
// Display shader
// ---------------------------------------------------------------------------

const LINE_GAIN = 3.0;
/** Extra brightening of the edge line on the beat, on top of LINE_GAIN — see
 *  uBeatPulse below. Halo (GLOW_GAIN) is left alone so the flash reads as
 *  the line snapping brighter, not a bloom. */
const LINE_BEAT = 0.35;
const GLOW_GAIN = 0.5;
const FILL_GAIN = 0.05;
const PALETTE_BLEND = 0.1;
const PURPLE_MIX = 0.9;
// Floor on the density the emitter-tag ratio divides by: below it the tag is
// quantisation noise (one 8-bit step of both channels reads as ratio 1 in
// byte mode and painted every faint filament purple).
const PURPLE_FLOOR = 0.15;
const EMIT_BLOB_RADIUS = 0.05;
const EMIT_BLOB_BASE = 0.25;
const EMIT_BLOB_PULSE = 0.9;
/** How far the live spectral centroid leans the hue ramp warm/cool on top of
 *  the manual hueShift setting — see uCentroid below. */
const CENTROID_HUE = 0.08;

function displayFragSrc(format: SimFormat): string {
  return `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
${COMMON_UNIFORMS_GLSL}
${SETTINGS_UNIFORMS_GLSL}
${PALETTE_GLSL}
${ROOM_UV_GLSL}
${simIoGlsl(format)}
uniform sampler2D uDye;
uniform sampler2D uEdge;
uniform float uDomainAspect;

const vec3 BG = vec3(0.012, 0.012, 0.02);
const vec3 NEON_BLUE = vec3(0.2, 0.4, 1.0);
const vec3 NEON_CYAN = vec3(0.15, 0.85, 1.0);
const vec3 NEON_YELLOW = vec3(1.0, 0.85, 0.2);
const vec3 NEON_ORANGE = vec3(1.0, 0.45, 0.1);
const vec3 NEON_RED = vec3(1.0, 0.18, 0.12);
const vec3 NEON_PURPLE = vec3(0.72, 0.3, 1.0);

// Colour is a function of SCREEN x (not sim space): blue far-left -> cyan ->
// yellow centre -> orange -> red far-right.
vec3 regionColour(float x) {
  vec3 c = mix(NEON_BLUE, NEON_CYAN, smoothstep(0.0, 0.3, x));
  c = mix(c, NEON_YELLOW, smoothstep(0.3, 0.5, x));
  c = mix(c, NEON_ORANGE, smoothstep(0.5, 0.7, x));
  return mix(c, NEON_RED, smoothstep(0.7, 1.0, x));
}

// YIQ-space hue rotation, so a hue shift keeps luma untouched. GLSL mat3
// constructors are column-major: each group of three below is one COLUMN.
vec3 hueRotate(vec3 col, float radians_) {
  const mat3 rgb2yiq = mat3(
    0.299, 0.596, 0.211,
    0.587, -0.274, -0.523,
    0.114, -0.322, 0.312
  );
  const mat3 yiq2rgb = mat3(
    1.0, 1.0, 1.0,
    0.956, -0.272, -1.106,
    0.621, -0.647, 1.703
  );
  vec3 yiq = rgb2yiq * col;
  float s = sin(radians_);
  float c = cos(radians_);
  vec2 iq = mat2(c, s, -s, c) * yiq.yz;
  return yiq2rgb * vec3(yiq.x, iq.x, iq.y);
}

void main() {
  vec2 uv = roomUv(vUv);
  vec2 s = uMirror > 1.5 ? abs(uv * 2.0 - 1.0) : uMirror > 0.5 ? vec2(abs(uv.x * 2.0 - 1.0), uv.y) : uv;

  vec2 dye = decodeDye(texture(uDye, s));
  float edge = texture(uEdge, s).r;
  float glow = 0.55 * textureLod(uEdge, s, 2.0).r + 0.45 * textureLod(uEdge, s, 3.5).r;

  // Bright passages lean the ramp warm, dark ones cool, on top of the manual
  // hue shift.
  float hue = uHueShift + ${CENTROID_HUE.toFixed(3)} * (uCentroid - 0.5);
  vec3 c = hueRotate(regionColour(uv.x), hue * 6.28318);
  c = mix(c, palette(0.2 + 0.6 * uv.x + hue, uPalA, uPalB, uPalC, uPalD), ${PALETTE_BLEND.toFixed(2)});
  c = mix(c, NEON_PURPLE, ${PURPLE_MIX.toFixed(2)} * clamp(dye.g / max(dye.r, ${PURPLE_FLOOR.toFixed(2)}), 0.0, 1.0));

  float sparkle = 1.0 + uSparkle * (1.2 * uHigh + 1.5 * uHighPulse);
  float lineGain = ${LINE_GAIN.toFixed(2)} * (1.0 + ${LINE_BEAT.toFixed(2)} * uBeatPulse);
  vec3 col = BG + c * edge * lineGain * sparkle + c * glow * uEdgeGlow * ${GLOW_GAIN.toFixed(2)} + c * dye.r * ${FILL_GAIN.toFixed(2)};

  // Purple emitter blob at screen centre — the identity of the emitter,
  // kept visible even in Off (where there's nothing to mirror it from).
  vec2 d = (uv - 0.5) * vec2(uDomainAspect, 1.0);
  col += NEON_PURPLE * exp(-dot(d, d) / (${EMIT_BLOB_RADIUS.toFixed(3)} * ${EMIT_BLOB_RADIUS.toFixed(3)})) * (${EMIT_BLOB_BASE.toFixed(2)} + ${EMIT_BLOB_PULSE.toFixed(2)} * uLowPulse);

  outColor = vec4(1.0 - exp(-col), 1.0);
}
`;
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

function createFluidScene(): Scene {
  let displayProg: GLProgram | null = null;
  let quadVao: WebGLVertexArrayObject | null = null;
  let sim: FluidSim | null = null;
  let format: SimFormat | null = null;
  let dyeLoc: WebGLUniformLocation | null = null;
  let edgeLoc: WebGLUniformLocation | null = null;
  let lastFrameTime: number | null = null;
  const bandsBuf = new Float32Array(NUM_BANDS);
  const splats: Splat[] = [];
  let puff = createPuffState();

  return {
    id: ID,
    name: "Neon Fluid",
    settings: SETTINGS,

    init(ctx: SceneContext) {
      const { gl } = ctx;
      quadVao = createFullscreenQuad(gl);
      format = detectSimFormat(gl);
      displayProg = createProgram(gl, displayFragSrc(format));
      dyeLoc = gl.getUniformLocation(displayProg.program, "uDye");
      edgeLoc = gl.getUniformLocation(displayProg.program, "uEdge");

      const mirror = Math.round(SETTINGS.find((s) => s.key === "mirror")!.default) as MirrorMode;
      const size = simResolutionFor(ctx.quality.detail, gl.drawingBufferWidth, gl.drawingBufferHeight, mirror);
      sim = createFluidSim(gl, quadVao, size, format);
      lastFrameTime = null;
      puff = createPuffState();
    },

    render(ctx, frame, viewport, palette, anim) {
      if (!displayProg || !quadVao || !sim || !format) return;
      const { gl } = ctx;

      // See file header for why frame.time and not anim.dtSec.
      const dt =
        lastFrameTime === null ? SIM_DT_DEFAULT : Math.max(0, Math.min(SIM_DT_MAX, frame.time - lastFrameTime));
      lastFrameTime = frame.time;

      const mirror = Math.round(resolveSceneSetting(ID, settingFor("mirror"))) as MirrorMode;
      const curl = resolveSceneSetting(ID, settingFor("curl"));
      const viscosity = resolveSceneSetting(ID, settingFor("viscosity"));
      const dissipation = resolveSceneSetting(ID, settingFor("dissipation"));
      const emitStrength = resolveSceneSetting(ID, settingFor("emitStrength"));
      const beatKick = resolveSceneSetting(ID, settingFor("beatKick"));
      const dyeFlow = resolveSceneSetting(ID, settingFor("dyeFlow"));
      const warp = resolveSceneSetting(ID, settingFor("warp"));

      const want = simResolutionFor(ctx.quality.detail, gl.drawingBufferWidth, gl.drawingBufferHeight, mirror);
      if (!sameSimSize(want, sim.size)) sim.resize(want);

      // advancePuff's boolean return is the discrete "fired this frame" edge
      // for a caller that wants it; this scene only needs the envelope it
      // leaves in puff.age (puffVal below), so the return value itself is
      // unused here.
      advancePuff(puff, dt, anim.lowOnset || anim.onset, anim.beatPhase, anim.tempoLock, anim.flowPhase);
      const puffVal = puffEnv(puff.age);

      emitterState(
        {
          flowPhase: anim.flowPhase,
          energy: frame.energy,
          lowPulse: anim.lowPulse,
          beatPulse: anim.beatPulse,
          emitStrength,
          beatKick,
          dyeFlow,
          mirror,
          puff: puffVal,
          puffAge: puff.age,
          dropPulse: anim.dropPulse,
        },
        splats,
      );

      gl.disable(gl.BLEND);
      gl.disable(gl.DEPTH_TEST);

      const dtSim = warpedDt(dt, frame.energy, warp);
      sim.step({ dt: dtSim, curl, dissipation, viscosity, energy: frame.energy, splats });

      displayProg.use();
      uploadCommonUniforms(displayProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf);
      displayProg.setF("uDomainAspect", gl.drawingBufferWidth / gl.drawingBufferHeight);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sim.dyeTexture());
      gl.uniform1i(dyeLoc, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, sim.edgeTexture());
      gl.uniform1i(edgeLoc, 1);
      drawFullscreenQuad(gl, quadVao);

      // The gallery renders every scene into one shared context each tick —
      // must not leak a bound texture unit onto the next tile.
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.disable(gl.BLEND);
    },

    dispose(ctx: SceneContext) {
      const { gl } = ctx;
      displayProg?.dispose();
      if (quadVao) gl.deleteVertexArray(quadVao);
      sim?.dispose();
      displayProg = null;
      quadVao = null;
      sim = null;
      format = null;
      dyeLoc = null;
      edgeLoc = null;
      lastFrameTime = null;
      puff = createPuffState();
    },
  };
}

export const fluidScene: Scene = createFluidScene();
