import { createProgram, createFullscreenQuad, drawFullscreenQuad, type GLProgram } from "../gl.ts";
import type { QualityPreset, QualitySettings } from "../quality.ts";

// A ripple tank: a real 2D wave simulation for Caustics' Beat ripple
// (caustics.ts), replacing an earlier pool of analytic gaussian rings each
// launched by a yes/no trigger. The trigger-and-shape approach reads fine
// for one clean, isolated beat, but has no good answer for a driver that
// keeps moving — a busy zigzag of hits, a sustained level, a drawn
// frequency line — because there's no sensible place to "launch a new
// ring" on every one of those ticks, and no fixed ring shape stands in for
// a continuously changing push. A simulated surface has no such problem:
// it just carries whatever disturbs it, the way an actual shallow tray of
// water does, so a busy driver reads as a busy, interfering surface
// instead of a machine-gun of identical rings.
//
// The update rule is the standard explicit leapfrog discretisation of the
// 2D wave equation over a 5-point Laplacian, independently derived from
// the textbook equation (not ported from any existing ripple-tank/Falstad-
// style implementation — CLAUDE.md's standing rule):
//   next = (2*h - prev + c2*lap(h)) * (1 - damp)
//   lap(h) = hL + hR + hU + hD - 4*h
// `c2` (WAVE_C2 below) is the squared wave speed in cells²/step², fixed at
// a value inside this stencil's stability bound (c2 <= 0.5 for a 5-point
// explicit leapfrog on a unit grid — see e.g. any derivation of the 2D CFL
// condition for this stencil); the wave's actual speed is sqrt(c2) cells
// per simulation step. `damp` is `baseDamp` (a small, uniform per-step loss
// so a travelling ring visibly fades over a long crossing — see
// decayPerSecFor) plus an edge sponge that ramps up over the outer band of
// cells (SPONGE_FRACTION, spongeDampAt) and is itself scaled down to zero
// by Edge reflection (edgeReflect): at edgeReflect=0 (open water, the
// default) the sponge absorbs a ring before it reaches the actual border,
// so it simply appears to run off the frame, matching the old ring pool's
// look; at edgeReflect=1 the sponge is off entirely and the border is a
// hard wall, so ripples bounce back and interfere like a real bounded
// ripple tank.
//
// The wall itself (not the sponge) is a Neumann boundary: a neighbour off
// the grid is clamped to the nearest edge cell instead of being read as
// zero, which is a full, energy-conserving reflection (a zero-gradient
// mirror) baked into the stencil rather than a special case — see fetchH
// in SIM_FRAG and the matching clamp in stepTankCPU. This is what
// edgeReflect=1 actually bounces off; the sponge decides how much energy
// survives to reach it, not whether the wall itself reflects.
//
// The source: a gaussian blob at the grid's centre, radius `sourceRadius`
// cells (from the Drop size setting, sourceRadiusCellsFor), pushed by the
// *change* in this frame's driver reading rather than its raw value —
// caustics.ts already keeps its own slow average of the driver and feeds
// this the deviation from it (its own high-pass), and RippleTank further
// differences that deviation frame-to-frame (`input.drive`'s delta,
// spread evenly over however many sim steps this frame runs) before adding
// it to the field. That's a displacement source, not a forcing source: a
// steady, unchanging driver (a synth pad held at one loudness) produces no
// delta and therefore no wave, which is exactly the ripple tank's own
// physical behaviour — a finger held still in the water doesn't ring it,
// only a finger that moves does. `input.kick` is a second, independent
// one-shot addition to that same per-frame total (caustics.ts's drop
// strike) that is *not* folded into the tracked driver value, so it never
// produces a matching reverse kick on the following frame the way baking
// it into the tracked driver would.
//
// Encoding: RGBA8 (the only render-target format this repo relies on
// across every device it ships to — see powder.ts's and petri.ts's own
// headers), NEAREST, CLAMP_TO_EDGE. Each texel packs *two* scalars as
// 16-bit fixed point across its four 8-bit channels, the same idea
// chladni.ts's packPos/unpackPos use for a position pair: R,G is this
// texel's current height (hi byte, lo byte), B,A is this same texel's
// previous height, both signed over ±H_RANGE via encodeH/decodeH below.
// Packing both into one texel (rather than two full ping-pong states, one
// per field) is what lets a plain two-texture ping-pong carry a leapfrog
// scheme that needs a cell's OWN previous value as well as its neighbours'
// current ones: each step reads the full old texel (current -> local
// `hC`/`hPrev`decode) but only the R,G half of every neighbour (their
// current height, via fetchH), and writes the new texel with R,G = the
// just-computed next height and B,A = the *old* current height — the old
// "current" slides down into "previous" for the following step, a
// shift-register in two channels. texelFetch (not texture()) is used
// throughout, on both the sim and the display side, because hardware
// bilinear filtering would blend the packed *bytes*, not the physical
// height they encode, corrupting the field; RIPPLE_TANK_SAMPLE_GLSL's
// tankHeight() does its own manual bilinear over four decoded texelFetches
// instead.
//
// The CPU reference (stepTankCPU) and the GLSL sim shader below implement
// the *identical* rule — same Laplacian, same damp/sponge formula, same
// Neumann clamp, same gaussian source — deliberately kept in step so
// tests/rippleTank.test.ts can pin the physics on plain Float32Arrays
// (stepTankCPU never encodes/decodes at all) while trusting that the GPU
// path reproduces the same behaviour. A change to one side's formula
// without the matching change on the other silently breaks that trust.
//
// Grid sizing: the long side is fixed per QualityPreset (GRID_LONG_SIDE,
// the same keyed-by-preset idiom as petri.ts's GRID_SIDE — the governor
// mutates renderScale/detail at runtime but never preset, so keying grid
// resolution to preset alone is stable across a session); the short side
// is derived from the drawing buffer's own aspect so the tank always spans
// a square-ish patch of screen regardless of window shape. Reallocated
// (and re-cleared to encoded-zero, i.e. calm water) only when that
// computed integer size actually changes, so an ordinary sub-pixel resize
// doesn't reset the field.
//
// Stepping runs at a fixed rate (stepsPerSecFor, from the Wave speed
// setting) via a carry accumulator, capped at MAX_STEPS_PER_RENDER steps
// per render call; any elapsed time beyond what the cap can consume is
// dropped rather than carried forward, so a stall (a dropped frame, a tab
// coming back from background) can't unleash a burst of catch-up steps —
// the tank simply falls a little behind wall-clock time instead.

const GRID_LONG_SIDE: Record<QualityPreset, number> = { high: 512, mid: 384, low: 256, floor: 192 };
const GRID_SHORT_MIN = 64;

// The 5-point explicit leapfrog's own CFL stability bound is c2 <= 0.5;
// 0.4 sits comfortably inside it while still giving a brisk wave speed
// (sqrt(0.4) ≈ 0.632 cells/step).
export const WAVE_C2 = 0.4;
export const WAVE_SPEED_CELLS_PER_STEP = Math.sqrt(WAVE_C2);

// Signed 16-bit fixed-point encode range for a packed height — see the
// file header's Encoding paragraph. Wide enough that a strong drop kick
// (well above a typical hit's delta) never clips.
export const H_RANGE = 4.0;

const STEPS_PER_SEC_MIN = 60;
const STEPS_PER_SEC_MAX = 300;
const MAX_STEPS_PER_RENDER = 8;

// Wave fade's reach, in real seconds of exponential decay — a per-second
// rate rather than a raw per-step fraction so it reads the same regardless
// of Wave speed's own steps/sec. Default (see caustics.ts's `waveFade`
// setting) targets roughly the old ring pool's own visible falloff
// (RIPPLE_DECAY_PER_SEC was 0.45/sec there).
const DECAY_PER_SEC_MIN = 0.05; // waveFade=0: waves ring the tank almost losslessly
const DECAY_PER_SEC_MAX = 3.0; // waveFade=1: dies out within a fraction of a second

// The outer band a wave crosses before the (always-hard) wall, and how hard
// that band damps at its outermost edge — see the file header's Edges
// paragraph. Scaled by (1 - edgeReflect) so 1 disables the sponge entirely.
const SPONGE_FRACTION = 0.12;
const SPONGE_MAX_DAMP_PER_STEP = 0.08;

// Drop size's reach, in cells — a small blob at the low end (a tight,
// pin-prick source) to a wide one at the high end.
const SOURCE_RADIUS_MIN_CELLS = 1.2;
const SOURCE_RADIUS_MAX_CELLS = 9;

// Overall gain on the gaussian source term — how many height units a unit
// of the (already high-passed, already strength-scaled) driver's per-step
// delta pushes the surface by. Screenshot-tuned against caustics.ts's own
// display-side scale (RIPPLE_REFRACT_K/RIPPLE_CREST_GAIN there), not
// measured — see this scene's docs/scenes/caustics.md entry.
const SOURCE_GAIN = 5;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Wave speed (0..1) -> simulation steps per second. */
export function stepsPerSecFor(waveSpeed: number): number {
  return STEPS_PER_SEC_MIN + (STEPS_PER_SEC_MAX - STEPS_PER_SEC_MIN) * clamp01(waveSpeed);
}

/** Wave fade (0..1) -> exponential decay rate, per real second — see
 *  DECAY_PER_SEC_MIN/MAX's own comment. */
export function decayPerSecFor(waveFade: number): number {
  return DECAY_PER_SEC_MIN + (DECAY_PER_SEC_MAX - DECAY_PER_SEC_MIN) * clamp01(waveFade);
}

/** Drop size (0..1) -> the gaussian source's own radius, in cells. */
export function sourceRadiusCellsFor(dropSize: number): number {
  return SOURCE_RADIUS_MIN_CELLS + (SOURCE_RADIUS_MAX_CELLS - SOURCE_RADIUS_MIN_CELLS) * clamp01(dropSize);
}

/** The tank's own grid dimensions for this quality preset and drawing-
 *  buffer aspect (width/height) — long side fixed per preset, short side
 *  derived from aspect so the tank always spans a square-ish patch of
 *  screen. Exported for tests/rippleTank.test.ts. */
export function computeGridSize(preset: QualityPreset, aspect: number): { w: number; h: number } {
  const long = GRID_LONG_SIDE[preset];
  if (!(aspect > 0) || !Number.isFinite(aspect)) aspect = 1;
  if (aspect >= 1) {
    return { w: long, h: Math.max(GRID_SHORT_MIN, Math.round(long / aspect)) };
  }
  return { w: Math.max(GRID_SHORT_MIN, Math.round(long * aspect)), h: long };
}

/** The extra per-step damping the outer sponge band applies at cell (x,y)
 *  of a w x h grid — 0 in the interior, ramping smoothly up to
 *  SPONGE_MAX_DAMP_PER_STEP right at the border, scaled by
 *  (1 - edgeReflect) so edgeReflect=1 disables it entirely (the field then
 *  loses energy only to `baseDampPerStep`, and bounces losslessly off the
 *  Neumann wall). Exported for tests/rippleTank.test.ts. */
export function spongeDampAt(x: number, y: number, w: number, h: number, edgeReflect: number): number {
  const dx = Math.min(x, w - 1 - x) / w;
  const dy = Math.min(y, h - 1 - y) / h;
  const dEdge = Math.min(dx, dy);
  const t = clamp01(1 - dEdge / SPONGE_FRACTION);
  const s = t * t * (3 - 2 * t); // smoothstep
  return s * SPONGE_MAX_DAMP_PER_STEP * (1 - clamp01(edgeReflect));
}

export interface TankPhysicsParams {
  /** Squared wave speed, cells²/step² — WAVE_C2 in production, exposed here
   *  so a test can probe other values without touching the constant. */
  c2: number;
  /** Uniform per-step loss everywhere on the grid — decayPerSecFor()
   *  converted to a per-step fraction at the sim's own step rate. */
  baseDampPerStep: number;
  /** 0 = open water (full sponge), 1 = hard-walled tank (no sponge) — see
   *  spongeDampAt. */
  edgeReflect: number;
  /** The gaussian source's radius, in cells (sourceRadiusCellsFor). */
  sourceRadiusCells: number;
  /** Gain on the source term — SOURCE_GAIN in production. */
  sourceGain: number;
}

/** One leapfrog step of the wave equation over plain Float32Arrays, no
 *  encoding — the CPU twin of SIM_FRAG below (see the file header's own
 *  paragraph on why the two must stay in lockstep). `h`/`prev` are this
 *  cell's current and previous height, row-major, `w*h` long each;
 *  `srcDelta` is this step's already-divided share of the frame's total
 *  source delta (see the file header's Source paragraph) added as a
 *  gaussian at the grid's centre. Reuses `out` when given (driftFlows'
 *  own convention) so a caller stepping thousands of times doesn't
 *  allocate per step. */
export function stepTankCPU(
  h: Float32Array,
  prev: Float32Array,
  w: number,
  hgt: number,
  params: TankPhysicsParams,
  srcDelta: number,
  out: Float32Array = new Float32Array(w * hgt),
): Float32Array {
  const cx = (w - 1) / 2;
  const cy = (hgt - 1) / 2;
  const sigma2 = params.sourceRadiusCells * params.sourceRadiusCells;
  for (let y = 0; y < hgt; y++) {
    const yd = y > 0 ? y - 1 : y;
    const yu = y < hgt - 1 ? y + 1 : y;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const xl = x > 0 ? x - 1 : x;
      const xr = x < w - 1 ? x + 1 : x;
      const lap = h[y * w + xl]! + h[y * w + xr]! + h[yd * w + x]! + h[yu * w + x]! - 4 * h[i]!;
      const damp = params.baseDampPerStep + spongeDampAt(x, y, w, hgt, params.edgeReflect);
      let next = (2 * h[i]! - prev[i]! + params.c2 * lap) * (1 - damp);
      const dx = x - cx;
      const dy = y - cy;
      const d2 = dx * dx + dy * dy;
      next += params.sourceGain * srcDelta * Math.exp(-d2 / (2 * sigma2));
      out[i] = next;
    }
  }
  return out;
}

// ---- GPU path -------------------------------------------------------------

// 16-bit fixed point over ±H_RANGE, packed the same way chladni.ts's
// packPos/unpackPos pack a position pair — see the file header's Encoding
// paragraph. `floor(t*65535+0.5)` (round-to-nearest, not floor-of-scaled)
// so an exact 0 height round-trips through hi/lo without the off-by-one
// channel overflow a plain floor() hits exactly at the pack midpoint.
const PACK_GLSL = `
vec2 encodeH(float v) {
  float t = clamp((v + ${H_RANGE.toFixed(1)}) / (2.0 * ${H_RANGE.toFixed(1)}), 0.0, 1.0);
  float vv = floor(t * 65535.0 + 0.5);
  float hi = floor(vv / 256.0);
  float lo = vv - hi * 256.0;
  return vec2(hi, lo) / 255.0;
}
float decodeH(vec2 hiLo) {
  vec2 b = floor(hiLo * 255.0 + 0.5);
  float vv = b.x * 256.0 + b.y;
  return (vv / 65535.0) * (2.0 * ${H_RANGE.toFixed(1)}) - ${H_RANGE.toFixed(1)};
}
`;

const SIM_FRAG = `#version 300 es
precision highp float;
out vec4 outColor;
uniform sampler2D uPrev;
uniform float uGridSizeX;
uniform float uGridSizeY;
uniform float uC2;
uniform float uBaseDamp;
uniform float uEdgeReflect;
uniform float uSourceRadius;
uniform float uSourceGain;
uniform float uSrcDelta;
${PACK_GLSL}

// A neighbour off the grid is clamped to the nearest edge cell instead of
// read as zero — a Neumann (zero-gradient) wall, a full energy-conserving
// reflection baked into the stencil itself (see the file header). Only the
// current-height half (rg) of a neighbour is ever needed for the
// Laplacian; the centre cell's own previous height is read directly in
// main() instead.
float fetchH(ivec2 p, ivec2 size) {
  ivec2 cp = clamp(p, ivec2(0), size - ivec2(1));
  return decodeH(texelFetch(uPrev, cp, 0).rg);
}

float spongeDamp(ivec2 p, ivec2 size) {
  vec2 fp = vec2(p);
  vec2 sz = vec2(size);
  float dx = min(fp.x, sz.x - 1.0 - fp.x) / sz.x;
  float dy = min(fp.y, sz.y - 1.0 - fp.y) / sz.y;
  float dEdge = min(dx, dy);
  float t = clamp(1.0 - dEdge / ${SPONGE_FRACTION.toFixed(3)}, 0.0, 1.0);
  float s = t * t * (3.0 - 2.0 * t);
  return s * ${SPONGE_MAX_DAMP_PER_STEP.toFixed(3)} * (1.0 - uEdgeReflect);
}

void main() {
  ivec2 size = ivec2(uGridSizeX + 0.5, uGridSizeY + 0.5);
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 c = texelFetch(uPrev, p, 0);
  float hC = decodeH(c.rg);
  float hPrev = decodeH(c.ba);

  float hL = fetchH(p + ivec2(-1, 0), size);
  float hR = fetchH(p + ivec2(1, 0), size);
  float hD = fetchH(p + ivec2(0, -1), size);
  float hU = fetchH(p + ivec2(0, 1), size);
  float lap = hL + hR + hU + hD - 4.0 * hC;

  float damp = uBaseDamp + spongeDamp(p, size);
  float hNext = (2.0 * hC - hPrev + uC2 * lap) * (1.0 - damp);

  vec2 centre = vec2(size) * 0.5;
  vec2 d = vec2(p) - centre;
  float sigma2 = uSourceRadius * uSourceRadius;
  hNext += uSourceGain * uSrcDelta * exp(-dot(d, d) / (2.0 * sigma2));

  outColor = vec4(encodeH(hNext), encodeH(hC));
}
`;

/** Spliced into a display shader (caustics.ts's FRAG) to read the tank's
 *  current height smoothly at an arbitrary UV — see the file header for why
 *  this is a manual bilinear over four decoded texelFetches rather than
 *  hardware-filtered texture(). Declares its own `uRippleTexelX`/
 *  `uRippleTexelY` (plain floats — createFullscreenScene's extraUniforms
 *  has no vec2 upload path) rather than taking texel size as a parameter,
 *  so a caller's own central-difference gradient (`tankHeight` sampled at
 *  uv +/- one texel) never has to thread it through by hand. */
export const RIPPLE_TANK_SAMPLE_GLSL = `
uniform float uRippleTexelX;
uniform float uRippleTexelY;
float rippleTankDecodeH(vec4 c) {
  vec2 b = floor(c.rg * 255.0 + 0.5);
  float vv = b.x * 256.0 + b.y;
  return (vv / 65535.0) * (2.0 * ${H_RANGE.toFixed(1)}) - ${H_RANGE.toFixed(1)};
}
float tankHeight(sampler2D t, vec2 uv) {
  vec2 texel = vec2(uRippleTexelX, uRippleTexelY);
  vec2 gridSize = 1.0 / texel;
  ivec2 size = ivec2(gridSize + 0.5);
  vec2 tc = uv * gridSize - 0.5;
  vec2 f = fract(tc);
  ivec2 i0 = ivec2(floor(tc));
  ivec2 i00 = clamp(i0, ivec2(0), size - 1);
  ivec2 i10 = clamp(i0 + ivec2(1, 0), ivec2(0), size - 1);
  ivec2 i01 = clamp(i0 + ivec2(0, 1), ivec2(0), size - 1);
  ivec2 i11 = clamp(i0 + ivec2(1, 1), ivec2(0), size - 1);
  float h00 = rippleTankDecodeH(texelFetch(t, i00, 0));
  float h10 = rippleTankDecodeH(texelFetch(t, i10, 0));
  float h01 = rippleTankDecodeH(texelFetch(t, i01, 0));
  float h11 = rippleTankDecodeH(texelFetch(t, i11, 0));
  return mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
}
`;

export interface RippleTankInput {
  /** This frame's already high-passed, already strength-scaled driver
   *  reading (caustics.ts's own `signal - slowAverage`, times the Ripple
   *  slider) — RippleTank differences this frame-to-frame itself and
   *  spreads the delta over however many sim steps this frame runs. */
  drive: number;
  /** A one-shot addition to this frame's total source delta, on top of
   *  `drive`'s own frame-to-frame change — a drop's strike. Never folded
   *  into the tracked `drive` value, so it can't produce a matching
   *  reverse kick next frame the way baking it into the tracked value
   *  would (see the file header's Source paragraph). Defaults to 0. */
  kick?: number;
  /** Wave speed setting, 0..1 — stepsPerSecFor. */
  speed: number;
  /** Wave fade setting, 0..1 — decayPerSecFor. */
  fade: number;
  /** Edge reflection setting, 0..1 — spongeDampAt's own scale. */
  edgeReflect: number;
  /** Drop size setting, 0..1 — sourceRadiusCellsFor. */
  dropSize: number;
}

export interface RippleTank {
  /** [1/gridWidth, 1/gridHeight] of the tank's current grid — feed both
   *  halves to the display shader's uRippleTexelX/uRippleTexelY (see
   *  RIPPLE_TANK_SAMPLE_GLSL). Changes when the grid reallocates (a quality
   *  or aspect change). */
  readonly texel: readonly [number, number];
  init(gl: WebGL2RenderingContext, quality: QualitySettings): void;
  /** Advances the tank by however many fixed-rate sim steps `dtSec` (plus
   *  any carried-over remainder) works out to, capped at
   *  MAX_STEPS_PER_RENDER, and returns the texture holding the resulting
   *  state (current height in .rg, previous in .ba — decode with
   *  RIPPLE_TANK_SAMPLE_GLSL's tankHeight, not raw texture() sampling). */
  step(gl: WebGL2RenderingContext, input: RippleTankInput, dtSec: number): WebGLTexture;
  dispose(gl: WebGL2RenderingContext): void;
}

export function createRippleTank(): RippleTank {
  let quality: QualitySettings | null = null;
  let simProg: GLProgram | null = null;
  let prevLoc: WebGLUniformLocation | null = null;
  let quadVao: WebGLVertexArrayObject | null = null;

  const stateTex: (WebGLTexture | null)[] = [null, null];
  const stateFbo: (WebGLFramebuffer | null)[] = [null, null];
  let read = 0;
  let gridW = 0;
  let gridH = 0;
  let texel: [number, number] = [1, 1];

  let prevDrive = 0;
  let carrySec = 0;

  function deallocate(gl: WebGL2RenderingContext): void {
    for (let i = 0; i < 2; i++) {
      if (stateFbo[i]) gl.deleteFramebuffer(stateFbo[i]);
      if (stateTex[i]) gl.deleteTexture(stateTex[i]);
      stateFbo[i] = null;
      stateTex[i] = null;
    }
  }

  function allocate(gl: WebGL2RenderingContext, w: number, h: number): void {
    deallocate(gl);
    // Encoded zero (calm water: current = previous = 0) for both channel
    // pairs — see PACK_GLSL's own rounding note for why this lands exactly
    // on hi=128, lo=0 rather than overflowing a channel byte.
    const zero = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      zero[i * 4] = 128; // R: current hi
      zero[i * 4 + 1] = 0; // G: current lo
      zero[i * 4 + 2] = 128; // B: previous hi
      zero[i * 4 + 3] = 0; // A: previous lo
    }
    for (let i = 0; i < 2; i++) {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, zero);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      stateTex[i] = tex;
      stateFbo[i] = fbo;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gridW = w;
    gridH = h;
    texel = [1 / w, 1 / h];
    read = 0;
    // A fresh field has no history to carry a source delta against —
    // otherwise the very first frame after a reallocation (a resize, a
    // quality change) would read as one huge delta from whatever `drive`
    // last was.
    prevDrive = 0;
    carrySec = 0;
  }

  return {
    get texel() {
      return texel;
    },

    init(gl, q) {
      quality = q;
      simProg = createProgram(gl, SIM_FRAG);
      prevLoc = gl.getUniformLocation(simProg.program, "uPrev");
      quadVao = createFullscreenQuad(gl);
    },

    step(gl, input, dtSec) {
      if (!simProg || !quadVao || !quality) return stateTex[read]!;

      const aspect = gl.drawingBufferWidth / Math.max(1, gl.drawingBufferHeight);
      const wanted = computeGridSize(quality.preset, aspect);
      if (wanted.w !== gridW || wanted.h !== gridH) allocate(gl, wanted.w, wanted.h);

      const stepsPerSec = stepsPerSecFor(input.speed);
      const stepDurSec = 1 / stepsPerSec;
      carrySec += Math.max(0, dtSec);
      const desiredSteps = Math.floor(carrySec / stepDurSec);
      const steps = Math.min(desiredSteps, MAX_STEPS_PER_RENDER);
      // Drop whatever the cap couldn't consume — a stall must not queue up
      // a burst of catch-up steps on some later frame (see the file
      // header's Stepping paragraph).
      carrySec -= desiredSteps * stepDurSec;

      const deltaContinuous = input.drive - prevDrive;
      prevDrive = input.drive;
      const totalDelta = deltaContinuous + (input.kick ?? 0);
      const perStepDelta = steps > 0 ? totalDelta / steps : 0;

      const decayPerSec = decayPerSecFor(input.fade);
      const baseDampPerStep = 1 - Math.exp(-decayPerSec * stepDurSec);
      const sourceRadius = sourceRadiusCellsFor(input.dropSize);

      if (steps > 0) {
        gl.disable(gl.BLEND);
        gl.viewport(0, 0, gridW, gridH);
        simProg.use();
        simProg.setF("uGridSizeX", gridW);
        simProg.setF("uGridSizeY", gridH);
        simProg.setF("uC2", WAVE_C2);
        simProg.setF("uBaseDamp", baseDampPerStep);
        simProg.setF("uEdgeReflect", clamp01(input.edgeReflect));
        simProg.setF("uSourceRadius", sourceRadius);
        simProg.setF("uSourceGain", SOURCE_GAIN);
        for (let i = 0; i < steps; i++) {
          const write = 1 - read;
          gl.bindFramebuffer(gl.FRAMEBUFFER, stateFbo[write]);
          simProg.setF("uSrcDelta", perStepDelta);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, stateTex[read]);
          gl.uniform1i(prevLoc, 0);
          drawFullscreenQuad(gl, quadVao);
          read = write;
        }
        gl.bindTexture(gl.TEXTURE_2D, null);
      }

      return stateTex[read]!;
    },

    dispose(gl) {
      simProg?.dispose();
      if (quadVao) gl.deleteVertexArray(quadVao);
      deallocate(gl);
      simProg = null;
      quadVao = null;
      prevLoc = null;
    },
  };
}
