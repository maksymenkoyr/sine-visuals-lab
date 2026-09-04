import { createProgram, drawFullscreenQuad, type GLProgram } from "../gl.ts";

// A 2D incompressible fluid sim (velocity + dye advection), simulated over
// one mirrored quadrant so the display can fold it into a four-way
// kaleidoscope. This file owns only the GL machinery: allocation, the
// shader passes, and the ghost-cell mirror seams. It knows nothing about
// scenes, settings, or audio — src/render/scenes/fluid.ts is the layer that
// turns music into Splat forces and renders the result; this module just
// steps the field forward each frame and hands back the dye/edge textures.
//
// The method is textbook stable fluids: semi-Lagrangian advection (Stam
// 1999, "Stable Fluids"), Jacobi-iterated pressure projection to remove
// divergence (GPU Gems ch. 38's writeup of the same algorithm), and Fedkiw's
// vorticity confinement to put the small-scale curl back in that numerical
// diffusion eats. It's written from that math, independently — no code was
// ported from PavelDoGreat/WebGL-Fluid-Simulation or any other fluid-sim
// repository (see CLAUDE.md's rule on independent work).
//
// Units. Velocity lives in velocity-grid texels/second (dx = 1 grid step),
// not uv/second — so advecting *any* field (including the finer-resolution
// dye grid) is `uv - velAt(uv) * dt * uVelTexel`, where uVelTexel converts a
// vel-grid texel offset into a uv delta. Forces (vorticity confinement, the
// splats in Splat.fx/fy) are specified as texels/s^2 at a reference
// resolution of FORCE_REF_ROWS rows; uForceScale = velH / FORCE_REF_ROWS
// rescales them so the sim looks the same whether it's running at the
// lowest SIM_TIERS entry or the highest.
//
// Boundaries. Sim uv (0,0) is screen centre; the sim only ever simulates uv
// in [0,1]^2 — one quadrant when the scene's mirror mode is Kaleidoscope or
// a Radial mode (Radial modes fold the screen into a wedge at display time
// and reuse the same quadrant the sim already has), a half when Left-right
// or Top-bottom (Top-bottom is a half of full width), the whole screen when
// Off (the mode only changes the domain's aspect, via simResolutionFor, and
// where fluid.ts puts the emitter). All four edges are free-slip walls
// handled by ghost cells: a stencil read that would cross an edge reflects
// the texel/uv coordinate back into range and negates the velocity
// component normal to that edge.
// At the mirror seams that is exactly what a mirror-symmetric flow looks
// like from this side; at the outer screen edges it is a wall the plume
// caps against and rolls off — the mushroom caps and side vortices of the
// look come from those walls. `velAt`/`velTexel` do the reflect-and-negate;
// `scalarTexel`/`dyeAt`/`dyeRedTexel` reflect the coordinate but leave the
// value alone (pressure, curl, divergence and dye are unsigned-under-
// reflection scalars). No wall row is pinned to zero velocity: the
// reflection alone keeps the boundary honest, and pinning traps dye into a
// bright streak along the wall.
//
// The byte fallback. `detectSimFormat` asks for EXT_color_buffer_float (or
// its half-float-only cousin) and test-renders to a 4x4 RG16F target; if
// that's unsupported (older TV runtimes — see vite.config.ts's webOS/Tizen
// target note) every target instead becomes RGBA8 with values packed
// through the encode/decode pairs `simIoGlsl` emits: signed quantities
// (velocity, pressure/curl/divergence) get a 0.5 bias so negative values
// have somewhere to go, dye (always >= 0) doesn't. Every shader pass is
// written once against `decodeX`/`encodeX` names, so the pass sources
// are identical text in both formats — only the codec functions simIoGlsl emits differ.
//
// Pass pipeline per step() (see the table in the design plan for the exact
// per-pass math): advectVel -> viscosity xN -> curl -> force (vorticity
// confinement + splats) -> divergence -> jacobi x N (pressure, warm-started
// — never cleared except on resize) -> gradient (subtract grad(p)) ->
// advectDye (MacCormack) -> edge (Sobel of dye.r, then a mipmap chain the
// display pass samples at a couple of LODs for the neon halo).
//
// Dye advection (ADVECT_DYE_BODY) runs a MacCormack step on top of the
// semi-Lagrangian base: a predictor-corrector with a clamp to the local
// min/max, so dye edges stay sharp instead of smearing every frame's
// bilinear resample. It's written from the textbook description of the
// scheme (Selle et al. 2008's BFECC/MacCormack idea), independently — same
// "no ported code" rule as the rest of this file. `DYE_MACCORMACK = false`
// restores the plain semi-Lagrangian step.

export type SimFormat = "half" | "byte";
/** Matches the Mirror enum setting's index — see MIRROR_OPTIONS for the
 *  ordered list of modes. */
export type MirrorMode = 0 | 1 | 2 | 3 | 4 | 5 | 6;

// Left untyped (not `: MirrorMode`) on purpose: keeping each constant's
// literal type lets the mirrorDomain switch below be checked exhaustively —
// widening to MirrorMode would hide a missing case.
export const MIRROR_OFF = 0;
export const MIRROR_LR = 1;
export const MIRROR_TB = 2;
export const MIRROR_KALEIDO = 3;
export const MIRROR_RADIAL6 = 4;
export const MIRROR_RADIAL8 = 5;
export const MIRROR_RADIAL12 = 6;

/** Mirror enum setting's options, index-matched to MirrorMode — fluid.ts's
 *  `mirror` SETTINGS entry uses this array directly so the device menu's
 *  labels and the enum's range can't drift apart. */
export const MIRROR_OPTIONS: readonly string[] = [
  "Off",
  "Left-right",
  "Top-bottom",
  "Kaleidoscope",
  "Radial 6",
  "Radial 8",
  "Radial 12",
];

/** What a mirror mode folds: `foldX`/`foldY` say whether the sim only ever
 *  covers half of that screen axis (the display pass mirrors the rest back
 *  in), `radial` is the wedge count for a Radial mode (0 for every
 *  non-radial mode). Radial modes fold both axes like Kaleidoscope — they
 *  simulate the same quadrant and only differ in how the display pass folds
 *  it (see simUv in fluid.ts). */
export function mirrorDomain(m: MirrorMode): { foldX: boolean; foldY: boolean; radial: number } {
  switch (m) {
    case MIRROR_OFF:
      return { foldX: false, foldY: false, radial: 0 };
    case MIRROR_LR:
      return { foldX: true, foldY: false, radial: 0 };
    case MIRROR_TB:
      return { foldX: false, foldY: true, radial: 0 };
    case MIRROR_KALEIDO:
      return { foldX: true, foldY: true, radial: 0 };
    case MIRROR_RADIAL6:
      return { foldX: true, foldY: true, radial: 6 };
    case MIRROR_RADIAL8:
      return { foldX: true, foldY: true, radial: 8 };
    case MIRROR_RADIAL12:
      return { foldX: true, foldY: true, radial: 12 };
  }
}

export interface SimSize {
  velW: number;
  velH: number;
  dyeW: number;
  dyeH: number;
  jacobiIters: number;
}

interface SimTier {
  minDetail: number;
  velRows: number;
  dyeRows: number;
  jacobi: number;
}

/** Keyed on QualitySettings.detail, highest first. */
export const SIM_TIERS: readonly SimTier[] = [
  // The velocity grid stays coarse at every tier and the dye grid runs near
  // screen resolution — the split is no longer standing in for a physical
  // property. Viscosity now lives in its own explicit pass (VISCOSITY_BODY,
  // driven by the viscosity setting) rather than being *implied* by a coarse
  // velocity grid's numerical diffusion, so the velocity grid can stay small
  // (cheap, and still coherent once VISCOSITY_BODY blurs it) while the dye
  // grid — which owns line sharpness — gets the resolution budget instead.
  { minDetail: 0.9, velRows: 128, dyeRows: 512, jacobi: 32 },
  { minDetail: 0.65, velRows: 112, dyeRows: 448, jacobi: 24 },
  { minDetail: 0.35, velRows: 96, dyeRows: 320, jacobi: 16 },
  { minDetail: 0, velRows: 80, dyeRows: 256, jacobi: 10 },
];

/** Sim widths are quantised to a multiple of this so a 1px canvas resize
 *  doesn't reallocate (and reset) the fluid every frame. */
export const WIDTH_QUANTUM = 8;

/**
 * Picks a tier from `detail` and derives grid sizes from the drawing
 * buffer's aspect and `mirror`, via mirrorDomain's foldX/foldY. A tier's row
 * counts are specified for the Kaleidoscope quadrant, i.e. per *half* screen
 * height; the sim only ever covers the domain that `mirror` leaves
 * unfolded, so an axis that isn't folded doubles its rows to keep the same
 * texel density per screen pixel — otherwise a mode that stretches the same
 * grid over more screen renders soft and blurry. Widths follow from the
 * domain's aspect the same way: a quadrant (both axes folded — Kaleidoscope
 * and every Radial mode, which simulate the same quadrant, see mirrorDomain)
 * has the full screen aspect, Left-right (x folded only) has half of it,
 * Top-bottom (y folded only) has twice it, and Off (neither folded) has it
 * as-is.
 */
export function simResolutionFor(
  detail: number,
  bufW: number,
  bufH: number,
  mirror: MirrorMode,
): SimSize {
  const tier = SIM_TIERS.find((t) => detail >= t.minDetail) ?? SIM_TIERS[SIM_TIERS.length - 1];

  const fullAspect = bufW > 0 && bufH > 0 && Number.isFinite(bufW) && Number.isFinite(bufH) ? bufW / bufH : 1;
  const { foldX, foldY } = mirrorDomain(mirror);
  const widthScale = foldX ? 0.5 : 1;
  const heightScale = foldY ? 0.5 : 1;
  let domainAspect = (fullAspect * widthScale) / heightScale;
  if (!Number.isFinite(domainAspect) || domainAspect <= 0) domainAspect = 1;
  const rowScale = foldY ? 1 : 2;

  const quantize = (rows: number) => Math.max(WIDTH_QUANTUM, Math.ceil((Math.round(rows * domainAspect)) / WIDTH_QUANTUM) * WIDTH_QUANTUM);
  const velH = tier.velRows * rowScale;
  const dyeH = tier.dyeRows * rowScale;

  return {
    velW: quantize(velH),
    velH,
    dyeW: quantize(dyeH),
    dyeH,
    jacobiIters: tier.jacobi,
  };
}

export function sameSimSize(a: SimSize, b: SimSize): boolean {
  return (
    a.velW === b.velW &&
    a.velH === b.velH &&
    a.dyeW === b.dyeW &&
    a.dyeH === b.dyeH &&
    a.jacobiIters === b.jacobiIters
  );
}

/** Reference row count `Splat` forces/dye rates are specified at; forces are
 *  rescaled by velH / FORCE_REF_ROWS so the look doesn't change with tier. */
export const FORCE_REF_ROWS = 192;
export const VEL_DAMP_PER_SEC = 0.15;
/** Viscosity (E2): VISCOSITY_BODY is a 5-tap blur run viscosityPasses(v).full
 *  times at k = VISC_K, plus one more pass at k = VISC_K * frac when a
 *  fractional pass remains, so the `viscosity` SimStepInputs setting is
 *  continuous rather than snapping between integer pass counts (see
 *  viscosityPasses and step()). This replaced the ad-hoc uSmooth blend that
 *  used to live inside ADVECT_VEL_BODY. */
export const VISC_MAX_PASSES = 4;
export const VISC_K = 0.05;
/** MacCormack dye advection (E1): see the file header and ADVECT_DYE_BODY.
 *  false restores the original plain semi-Lagrangian dye step. */
export const DYE_MACCORMACK = true;
/** Fraction of the 4-neighbour mean blended into dye every advection step —
 *  dye's own diffusion knob, independent of the velocity viscosity pass
 *  above. Zero by default: MacCormack advection is sharp enough on its own;
 *  the uniform (uSmooth — shared with VISCOSITY_BODY, which passes a
 *  different value per pass) and this blend stay wired so it can be swept
 *  back up if a look ever wants softer dye again. */
export const DYE_SMOOTH = 0;
export const DYE_FADE_MIN = 0.05;
export const DYE_FADE_MAX = 1.2;
export const DYE_MAX = 4;
export const CURL_EPS_BASE = 1.5;
export const CURL_EPS_ENERGY = 0.8;
/** Integer texel offset the curl (CURL_BODY) and confinement-gradient
 *  (FORCE_BODY) stencils sample at — emitted into the GLSL as a const int so
 *  it can be swept (e.g. to reach past texel-scale noise onto larger
 *  vortices) without editing shader text. */
export const CURL_STENCIL = 1;
/** The emitter tag (dye.g) fades this many times faster than density, so the
 *  purple only ever shows near the emitter and the plume beyond it takes the
 *  screen-position colour. */
export const TAG_FADE_MULT = 5;
export const EDGE_GAIN = 12;
/** Soft threshold on the normalised edge magnitude (see EDGE_BODY). */
export const EDGE_LO = 0.1;
export const EDGE_HI = 0.7;
/** Byte-mode codec ranges: the full-scale magnitude one 8-bit channel spans.
 *  Kept as tight as the flow allows — with 8 bits, a range of 600 would
 *  quantise typical velocities of tens of texels/s to a handful of steps
 *  and stall the flow. */
export const BYTE_VEL_RANGE = 200;
export const BYTE_SCALAR_RANGE = 50;
export const BYTE_DYE_RANGE = 4;

/** Slot 0 is always the centre emitter; slots 1..SPLAT_SLOTS-1 are the
 *  periodic accent splats. */
export const SPLAT_SLOTS = 4;

/** A single force/dye injection point, in sim uv with force in
 *  texels/s^2 at FORCE_REF_ROWS rows. `tag` marks the emitter (1) vs a
 *  plain accent splat (0) — it rides along in the dye's G channel so the
 *  display pass can render the emitter's plume a different colour. */
export interface Splat {
  x: number;
  y: number;
  sigma: number;
  fx: number;
  fy: number;
  dye: number;
  tag: number;
  /** E3b ring injection: 0 = gaussian blob centred on the splat (as before);
   *  > 0 = gaussian shell of this radius (sim uv), reusing `sigma` for the
   *  shell's thickness — see splatDyeWeight in simPrefix. Rides in the spare
   *  uSplatVel[i].w slot. */
  ring: number;
}

export interface SimStepInputs {
  dt: number;
  /** Swirl setting, 0..1 — scales vorticity-confinement strength. */
  curl: number;
  /** Dye-fade setting, 0..1 — mixed between DYE_FADE_MIN and DYE_FADE_MAX. */
  dissipation: number;
  /** Audio energy, 0..1 — adds to the vorticity-confinement strength. */
  energy: number;
  /** Viscosity setting, 0..1 — scales how many VISCOSITY_BODY blur passes
   *  run on velocity each step (see viscosityPasses). */
  viscosity: number;
  /** Exactly SPLAT_SLOTS entries (see fluid.ts's emitterState). */
  splats: readonly Splat[];
}

export interface FluidSim {
  readonly size: SimSize;
  readonly format: SimFormat;
  step(inputs: SimStepInputs): void;
  dyeTexture(): WebGLTexture | null;
  /** Current read velocity target's texture (vel-grid texels/second, decoded
   *  via decodeVel) — for a display pass that wants the live flow direction
   *  rather than just dye density (see fluid.ts's Currents sparkle style). */
  velTexture(): WebGLTexture | null;
  edgeTexture(): WebGLTexture | null;
  resize(size: SimSize): void;
  dispose(): void;
}

/**
 * Requests EXT_color_buffer_float (falling back to
 * EXT_color_buffer_half_float), then proves half-float render targets
 * actually work by test-allocating a 4x4 RG16F FBO and checking
 * completeness — some runtimes advertise the extension but can't complete
 * an RG16F target. Byte fallback (RGBA8 + fixed-point codecs) on any
 * failure.
 */
export function detectSimFormat(gl: WebGL2RenderingContext): SimFormat {
  try {
    const ext = gl.getExtension("EXT_color_buffer_float") ?? gl.getExtension("EXT_color_buffer_half_float");
    if (!ext) return "byte";

    const tex = gl.createTexture();
    if (!tex) return "byte";
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, 4, 4, 0, gl.RG, gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    const fbo = gl.createFramebuffer();
    if (!fbo) {
      gl.deleteTexture(tex);
      return "byte";
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(tex);

    return complete ? "half" : "byte";
  } catch {
    return "byte";
  }
}

/**
 * The six encode/decode functions every sim pass (and the display pass in
 * fluid.ts) reads/writes through, so pass/display GLSL never branches on
 * format itself. Half mode is a pass-through (RG16F/R16F store the signed
 * float directly); byte mode packs into RGBA8 with a 0.5 bias for signed
 * quantities (velocity, pressure/curl/divergence) and a plain [0,1] scale
 * for dye (always >= 0).
 */
export function simIoGlsl(format: SimFormat): string {
  if (format === "half") {
    return `
vec2 decodeVel(vec4 t) { return t.xy; }
vec4 encodeVel(vec2 v) { return vec4(v, 0.0, 0.0); }
float decodeScalar(vec4 t) { return t.x; }
vec4 encodeScalar(float s) { return vec4(s, 0.0, 0.0, 0.0); }
vec2 decodeDye(vec4 t) { return t.xy; }
vec4 encodeDye(vec2 d) { return vec4(d, 0.0, 0.0); }
`;
  }
  return `
const float BYTE_VEL_RANGE_C = ${BYTE_VEL_RANGE.toFixed(4)};
const float BYTE_SCALAR_RANGE_C = ${BYTE_SCALAR_RANGE.toFixed(4)};
const float BYTE_DYE_RANGE_C = ${BYTE_DYE_RANGE.toFixed(4)};
// Per-texel, per-pass dither (uSeed changes every draw) on the emitter-tag
// channel only, added before its 8-bit quantisation so rounding is
// unbiased: a multiplicative fade that moves a value by less than half a
// quantum would otherwise round straight back and never decay, and a
// stalled tag paints the whole plume purple. Density is left undithered
// on purpose — the Sobel edge pass turns one-step noise into speckle.
uniform float uSeed;
float byteDither() {
  vec2 p = gl_FragCoord.xy + vec2(uSeed * 917.0, uSeed * 431.0);
  return (fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
}
vec2 decodeVel(vec4 t) { return (t.xy - 0.5) * BYTE_VEL_RANGE_C; }
vec4 encodeVel(vec2 v) { return vec4(clamp(v / BYTE_VEL_RANGE_C, -0.5, 0.5) + 0.5, 0.0, 1.0); }
float decodeScalar(vec4 t) { return (t.x - 0.5) * BYTE_SCALAR_RANGE_C; }
vec4 encodeScalar(float s) { return vec4(clamp(s / BYTE_SCALAR_RANGE_C, -0.5, 0.5) + 0.5, 0.0, 0.0, 1.0); }
vec2 decodeDye(vec4 t) { return t.xy * BYTE_DYE_RANGE_C; }
vec4 encodeDye(vec2 d) { return vec4(clamp(d / BYTE_DYE_RANGE_C, 0.0, 1.0) + vec2(0.0, byteDither()), 0.0, 1.0); }
`;
}

// Shared prefix for every sim pass: the two generic input samplers
// (`uVel`/`uAux` — which field is bound to which unit varies per pass, see
// createFluidSim's step()), the codec, and the mirror ghost-cell helpers.
function simPrefix(format: SimFormat): string {
  return `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uVel;
uniform sampler2D uAux;
uniform sampler2D uAux2;
uniform vec2 uVelTexel;
uniform vec2 uTexel;
uniform float uSmooth;
uniform float uDt;
uniform float uAspect;
uniform float uForceScale;
uniform float uCurl;
uniform float uEnergy;
uniform float uFade;
uniform vec4 uSplatPos[${SPLAT_SLOTS}];
uniform vec4 uSplatVel[${SPLAT_SLOTS}];

const float VEL_DAMP_PER_SEC = ${VEL_DAMP_PER_SEC.toFixed(4)};
const float DYE_MAX = ${DYE_MAX.toFixed(4)};
const float CURL_EPS_BASE = ${CURL_EPS_BASE.toFixed(4)};
const float CURL_EPS_ENERGY = ${CURL_EPS_ENERGY.toFixed(4)};
const int CURL_STENCIL_C = ${CURL_STENCIL};
const float EDGE_GAIN = ${EDGE_GAIN.toFixed(4)};
const float TAG_FADE_MULT = ${TAG_FADE_MULT.toFixed(4)};
const float EDGE_LO = ${EDGE_LO.toFixed(4)};
const float EDGE_HI = ${EDGE_HI.toFixed(4)};

${simIoGlsl(format)}

// Ghost-cell helpers. The sim domain is uv/texel [0, size) with (0,0) at
// screen centre. Every boundary — the mirror seams at x=0/y=0 AND the outer
// screen edges at x=1/y=1 — is a free-slip wall: a read that would cross it
// reflects the coordinate back inside and negates the velocity component
// normal to that wall. A mirror seam and a wall are the same thing to a
// free-slip flow, which is why the sim needn't know the mirror mode at all
// (that only changes the domain's aspect and where fluid.ts puts the
// emitter). The outer walls are what make the plume cap and roll into
// vortices instead of just leaving the screen. Scalars (pressure /
// divergence / curl / dye) reflect the coordinate but keep their value.
vec2 velAt(vec2 uv) {
  vec2 s = vec2(1.0);
  if (uv.x < 0.0) { uv.x = -uv.x; s.x = -s.x; }
  if (uv.y < 0.0) { uv.y = -uv.y; s.y = -s.y; }
  if (uv.x > 1.0) { uv.x = 2.0 - uv.x; s.x = -s.x; }
  if (uv.y > 1.0) { uv.y = 2.0 - uv.y; s.y = -s.y; }
  return decodeVel(texture(uVel, clamp(uv, 0.0, 1.0))) * s;
}

ivec2 reflectTexel(ivec2 t, ivec2 size, out vec2 s) {
  s = vec2(1.0);
  if (t.x < 0) { t.x = -t.x - 1; s.x = -s.x; }
  if (t.y < 0) { t.y = -t.y - 1; s.y = -s.y; }
  if (t.x >= size.x) { t.x = 2 * size.x - t.x - 1; s.x = -s.x; }
  if (t.y >= size.y) { t.y = 2 * size.y - t.y - 1; s.y = -s.y; }
  return clamp(t, ivec2(0), size - ivec2(1));
}

vec2 velTexel(ivec2 t) {
  vec2 s;
  t = reflectTexel(t, textureSize(uVel, 0), s);
  return decodeVel(texelFetch(uVel, t, 0)) * s;
}

float scalarTexel(sampler2D tex, ivec2 t) {
  vec2 s;
  t = reflectTexel(t, textureSize(tex, 0), s);
  return decodeScalar(texelFetch(tex, t, 0));
}

vec2 dyeAtTex(sampler2D tex, vec2 uv) {
  if (uv.x < 0.0) uv.x = -uv.x;
  if (uv.y < 0.0) uv.y = -uv.y;
  if (uv.x > 1.0) uv.x = 2.0 - uv.x;
  if (uv.y > 1.0) uv.y = 2.0 - uv.y;
  return decodeDye(texture(tex, clamp(uv, 0.0, 1.0)));
}

vec2 dyeAt(vec2 uv) { return dyeAtTex(uAux, uv); }

// Dye's red channel through a reflected texelFetch — used by the edge pass,
// which needs dye's own codec (not scalarTexel's, which is calibrated for
// signed pressure/curl/divergence) on a texelFetch stencil.
float dyeRedTexel(ivec2 t) {
  vec2 s;
  t = reflectTexel(t, textureSize(uVel, 0), s);
  return decodeDye(texelFetch(uVel, t, 0)).x;
}

// Dye's full RG channels through a reflected texelFetch — used by
// ADVECT_DYE_BODY's MacCormack clamp, which needs the source-grid texel
// neighbourhood around a uv rather than dyeAt's bilinear sample. Reads uAux:
// in the dye-advection pass dye is bound there (see step()'s advectDye
// call), unlike dyeRedTexel above which is only used by the edge pass, where
// dye is bound to uVel instead.
vec2 dyeTexelRG(ivec2 t) {
  vec2 s;
  t = reflectTexel(t, textureSize(uAux, 0), s);
  return decodeDye(texelFetch(uAux, t, 0));
}

// Splat weights. Dye (ADVECT_DYE_BODY) lands as a gaussian blob centred on
// the splat when Splat.ring is 0, or as a gaussian shell of radius ring
// (thickness sigma) when ring > 0 — each pulse is then a thin ring the flow
// stretches into a filament instead of a blob (E3b). Force (FORCE_BODY) is
// always a blob: a gaussian body-force impulse is what rolls up into one
// clean vortex pair (the mushroom cap), whereas an annular push makes two
// counter-rotating sheets that fight. When the dye is a ring the force blob
// is sized to that ring (sigma = ring) so the cap and the filament match.
// ring rides in uSplatVel[i].w (uSplatPos[i].w already carries tag).
float splatDyeWeight(vec2 uv, int i) {
  vec2 sp = uSplatPos[i].xy;
  float sigma = uSplatPos[i].z;
  float ring = uSplatVel[i].w;
  vec2 d = (uv - sp) * vec2(uAspect, 1.0);
  float delta = ring > 0.0 ? (length(d) - ring) : length(d);
  return exp(-(delta * delta) / (2.0 * sigma * sigma));
}

float splatForceWeight(vec2 uv, int i) {
  vec2 sp = uSplatPos[i].xy;
  float ring = uSplatVel[i].w;
  float sigma = ring > 0.0 ? ring : uSplatPos[i].z;
  vec2 d = (uv - sp) * vec2(uAspect, 1.0);
  return exp(-dot(d, d) / (2.0 * sigma * sigma));
}
`;
}

const ADVECT_VEL_BODY = `
void main() {
  vec2 uv = vUv;
  vec2 back = uv - velAt(uv) * uDt * uVelTexel;
  vec2 v = velAt(back) / (1.0 + VEL_DAMP_PER_SEC * uDt);
  outColor = encodeVel(v);
}
`;

// Viscosity (E2): a 5-tap blur toward the neighbour mean, ping-ponged
// viscosityPasses(viscosity).full-or-so times after advectVel and before
// curl — see step() and the VISC_MAX_PASSES/VISC_K constants above. Reuses
// the ADVECT_VEL_BODY's old blend weight uSmooth as k, but as an explicit
// pass instead of folded into advection, so "how viscous" is a pass count
// rather than a fixed per-frame constant.
const VISCOSITY_BODY = `
void main() {
  ivec2 texel = ivec2(gl_FragCoord.xy);
  vec2 v = velTexel(texel);
  vec2 vL = velTexel(texel + ivec2(-1, 0));
  vec2 vR = velTexel(texel + ivec2( 1, 0));
  vec2 vB = velTexel(texel + ivec2( 0,-1));
  vec2 vT = velTexel(texel + ivec2( 0, 1));
  float k = uSmooth;
  v = (1.0 - 4.0 * k) * v + k * (vL + vR + vB + vT);
  outColor = encodeVel(v);
}
`;

const CURL_BODY = `
void main() {
  ivec2 texel = ivec2(gl_FragCoord.xy);
  vec2 vL = velTexel(texel + ivec2(-CURL_STENCIL_C, 0));
  vec2 vR = velTexel(texel + ivec2( CURL_STENCIL_C, 0));
  vec2 vB = velTexel(texel + ivec2( 0,-CURL_STENCIL_C));
  vec2 vT = velTexel(texel + ivec2( 0, CURL_STENCIL_C));
  float c = 0.5 * ((vR.y - vL.y) - (vT.x - vB.x));
  outColor = encodeScalar(c);
}
`;

// Vorticity confinement (Fedkiw et al.) plus the gaussian force/dye splats.
// The combined force is left unscaled by uForceScale until the final
// integration step, so both the confinement term and the splats get the
// same tier-independent rescale (decision #4 in the design plan) rather
// than being scaled twice.
const FORCE_BODY = `
void main() {
  ivec2 texel = ivec2(gl_FragCoord.xy);
  vec2 v = decodeVel(texelFetch(uVel, texel, 0));

  float cL = scalarTexel(uAux, texel + ivec2(-CURL_STENCIL_C, 0));
  float cR = scalarTexel(uAux, texel + ivec2( CURL_STENCIL_C, 0));
  float cB = scalarTexel(uAux, texel + ivec2( 0,-CURL_STENCIL_C));
  float cT = scalarTexel(uAux, texel + ivec2( 0, CURL_STENCIL_C));
  float c  = decodeScalar(texelFetch(uAux, texel, 0));

  vec2 grad = 0.5 * vec2(abs(cR) - abs(cL), abs(cT) - abs(cB));
  vec2 n = grad / (length(grad) + 1e-5);
  float eps = uCurl * (CURL_EPS_BASE + CURL_EPS_ENERGY * uEnergy);
  vec2 force = eps * vec2(n.y, -n.x) * c;

  vec2 uv = vUv;
  for (int i = 0; i < ${SPLAT_SLOTS}; i++) {
    force += uSplatVel[i].xy * splatForceWeight(uv, i);
  }

  v += force * uForceScale * uDt;

  // No explicit wall pinning: the ghost-cell reflection in velTexel/velAt
  // already makes every boundary free-slip, and pinning a wall row's own
  // normal velocity to zero traps dye there into a bright streak.
  outColor = encodeVel(v);
}
`;

const DIVERGENCE_BODY = `
void main() {
  ivec2 texel = ivec2(gl_FragCoord.xy);
  vec2 vL = velTexel(texel + ivec2(-1, 0));
  vec2 vR = velTexel(texel + ivec2( 1, 0));
  vec2 vB = velTexel(texel + ivec2( 0,-1));
  vec2 vT = velTexel(texel + ivec2( 0, 1));
  float d = 0.5 * (vR.x - vL.x + vT.y - vB.y);
  outColor = encodeScalar(d);
}
`;

const JACOBI_BODY = `
void main() {
  ivec2 texel = ivec2(gl_FragCoord.xy);
  float pL = scalarTexel(uVel, texel + ivec2(-1, 0));
  float pR = scalarTexel(uVel, texel + ivec2( 1, 0));
  float pB = scalarTexel(uVel, texel + ivec2( 0,-1));
  float pT = scalarTexel(uVel, texel + ivec2( 0, 1));
  float div = decodeScalar(texelFetch(uAux, texel, 0));
  float p = 0.25 * (pL + pR + pB + pT - div);
  outColor = encodeScalar(p);
}
`;

const GRADIENT_BODY = `
void main() {
  ivec2 texel = ivec2(gl_FragCoord.xy);
  vec2 v = decodeVel(texelFetch(uVel, texel, 0));
  float pL = scalarTexel(uAux, texel + ivec2(-1, 0));
  float pR = scalarTexel(uAux, texel + ivec2( 1, 0));
  float pB = scalarTexel(uAux, texel + ivec2( 0,-1));
  float pT = scalarTexel(uAux, texel + ivec2( 0, 1));
  v -= 0.5 * vec2(pR - pL, pT - pB);
  outColor = encodeVel(v);
}
`;

// MacCormack predictor: the plain semi-Lagrangian step, written to its own
// target (dyeTemp) so the corrector below can re-sample the *interpolated*
// intermediate — the interpolation error is the whole signal MacCormack
// measures, so it can't be estimated from the source field alone.
const ADVECT_DYE_PREDICT_BODY = `
void main() {
  vec2 uv = vUv;
  vec2 back = uv - velAt(uv) * uDt * uVelTexel;
  outColor = encodeDye(dyeAt(back));
}
`;

// Dye step proper. uAux is the previous dye; with DYE_MACCORMACK, uAux2 is
// the predictor's output and this pass is the corrector: trace the
// intermediate forward, take half the round-trip discrepancy as the error
// estimate, clamp to the source neighbourhood, then fade and inject.
const ADVECT_DYE_BODY = `
void main() {
  vec2 uv = vUv;
  vec2 back = uv - velAt(uv) * uDt * uVelTexel;
${
  DYE_MACCORMACK
    ? `  // MacCormack (clamped predictor-corrector, Selle et al. 2008's
  // BFECC/MacCormack idea — written from that textbook description,
  // independently). dHat is the semi-Lagrangian result; advecting it
  // forward again should land back on the source value, and half of what it
  // misses by is a second-order estimate of the interpolation error.
  vec2 dHat = dyeAtTex(uAux2, uv);
  vec2 dRound = dyeAtTex(uAux2, uv + velAt(uv) * uDt * uVelTexel);
  vec2 d = dHat + 0.5 * (dyeAt(uv) - dRound);

  // Clamp to the source-grid 2x2 neighbourhood around \`back\` so the
  // correction can't overshoot into new extrema (uncorrected MacCormack's
  // usual failure mode: ringing at sharp edges).
  vec2 auxSize = vec2(textureSize(uAux, 0));
  vec2 p = back * auxSize - 0.5;
  ivec2 i0 = ivec2(floor(p));
  vec2 c00 = dyeTexelRG(i0);
  vec2 c10 = dyeTexelRG(i0 + ivec2(1, 0));
  vec2 c01 = dyeTexelRG(i0 + ivec2(0, 1));
  vec2 c11 = dyeTexelRG(i0 + ivec2(1, 1));
  vec2 lo = min(min(c00, c10), min(c01, c11));
  vec2 hi = max(max(c00, c10), max(c01, c11));
  d = clamp(d, lo, hi);
`
    : `  vec2 d = dyeAt(back);
`
}  // Dye diffusion: same 4-neighbour blend as the velocity's viscosity used
  // to blend inline (E1: DYE_SMOOTH = 0 by default — MacCormack keeps dye
  // sharp on its own; the blend stays wired so it can be swept back up).
  vec2 avg = 0.25 * (dyeAt(back + vec2(uTexel.x, 0.0)) + dyeAt(back - vec2(uTexel.x, 0.0))
                   + dyeAt(back + vec2(0.0, uTexel.y)) + dyeAt(back - vec2(0.0, uTexel.y)));
  d = mix(d, avg, uSmooth) / vec2(1.0 + uFade * uDt, 1.0 + uFade * TAG_FADE_MULT * uDt);

  vec2 inj = vec2(0.0);
  for (int i = 0; i < ${SPLAT_SLOTS}; i++) {
    float tag = uSplatPos[i].w;
    float rate = uSplatVel[i].z * splatDyeWeight(uv, i) * uDt;
    inj.x += rate;
    inj.y += rate * tag;
  }

  d = clamp(d + inj, 0.0, DYE_MAX);
  outColor = encodeDye(d);
}
`;

const EDGE_BODY = `
void main() {
  ivec2 texel = ivec2(gl_FragCoord.xy);
  float tl = dyeRedTexel(texel + ivec2(-1, 1));
  float t  = dyeRedTexel(texel + ivec2( 0, 1));
  float tr = dyeRedTexel(texel + ivec2( 1, 1));
  float l  = dyeRedTexel(texel + ivec2(-1, 0));
  float r  = dyeRedTexel(texel + ivec2( 1, 0));
  float bl = dyeRedTexel(texel + ivec2(-1,-1));
  float b  = dyeRedTexel(texel + ivec2( 0,-1));
  float br = dyeRedTexel(texel + ivec2( 1,-1));
  float gx = (tr + 2.0 * r + br) - (tl + 2.0 * l + bl);
  float gy = (tl + 2.0 * t + tr) - (bl + 2.0 * b + br);
  float m = length(vec2(gx, gy)) * EDGE_GAIN;
  // Soft threshold: low-contrast shear-layer fuzz drops out, real outlines
  // stay — this is what makes the lines read as drawn neon rather than a
  // gradient-magnitude heat map.
  // Stored raw (no codec): the edge is already in [0,1] in both formats, and
  // the display pass reads .r straight off the (mipmapped) texture.
  outColor = vec4(smoothstep(EDGE_LO, EDGE_HI, m / (1.0 + m)), 0.0, 0.0, 1.0);
}
`;

/** "edge" is a scalar target that stores a raw [0,1] value with no codec. */
type TargetKind = "vel" | "scalar" | "dye" | "edge";
type TargetFilter = "linear" | "nearest" | "mipmap";

interface SimTarget {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  w: number;
  h: number;
}

/** Allocates one render target, checks completeness, and clears it to the
 *  format's encoded zero (byte mode biases vel/scalar by 0.5; dye is
 *  unbiased since density is never negative). */
function createTarget(
  gl: WebGL2RenderingContext,
  w: number,
  h: number,
  kind: TargetKind,
  format: SimFormat,
  filter: TargetFilter,
): SimTarget {
  const tex = gl.createTexture();
  if (!tex) throw new Error("fluidSim: createTexture failed");
  gl.bindTexture(gl.TEXTURE_2D, tex);

  const isHalf = format === "half";
  const oneChannel = kind === "scalar" || kind === "edge";
  const internalFormat = isHalf ? (oneChannel ? gl.R16F : gl.RG16F) : gl.RGBA8;
  const glFormat = isHalf ? (oneChannel ? gl.RED : gl.RG) : gl.RGBA;
  const type = isHalf ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, glFormat, type, null);

  const minFilter = filter === "mipmap" ? gl.LINEAR_MIPMAP_LINEAR : filter === "linear" ? gl.LINEAR : gl.NEAREST;
  const magFilter = filter === "nearest" ? gl.NEAREST : gl.LINEAR;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minFilter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, magFilter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const fbo = gl.createFramebuffer();
  if (!fbo) {
    gl.deleteTexture(tex);
    throw new Error("fluidSim: createFramebuffer failed");
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(tex);
    throw new Error(`fluidSim: target incomplete (kind=${kind}, format=${format})`);
  }

  gl.viewport(0, 0, w, h);
  const clear: readonly [number, number, number, number] = isHalf
    ? [0, 0, 0, 0]
    : kind === "dye" || kind === "edge"
      ? [0, 0, 0, 1]
      : kind === "vel"
        ? [0.5, 0.5, 0, 1]
        : [0.5, 0, 0, 1];
  gl.clearColor(clear[0], clear[1], clear[2], clear[3]);
  gl.clear(gl.COLOR_BUFFER_BIT);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return { tex, fbo, w, h };
}

function deleteTarget(gl: WebGL2RenderingContext, t: SimTarget): void {
  gl.deleteFramebuffer(t.fbo);
  gl.deleteTexture(t.tex);
}

interface PassProgram {
  prog: GLProgram;
  velLoc: WebGLUniformLocation | null;
  auxLoc: WebGLUniformLocation | null;
  aux2Loc: WebGLUniformLocation | null;
}

function makePass(gl: WebGL2RenderingContext, format: SimFormat, body: string): PassProgram {
  const prog = createProgram(gl, simPrefix(format) + body);
  return {
    prog,
    velLoc: gl.getUniformLocation(prog.program, "uVel"),
    auxLoc: gl.getUniformLocation(prog.program, "uAux"),
    aux2Loc: gl.getUniformLocation(prog.program, "uAux2"),
  };
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** Splits a 0..1 `viscosity` setting into a whole number of VISCOSITY_BODY
 *  passes at full strength plus one fractional-strength pass, so step() can
 *  ping-pong a continuous amount of blur rather than snapping between
 *  integer pass counts. Pure and exported so it's unit-testable without a GL
 *  context — see step()'s use of it. */
export function viscosityPasses(viscosity: number): { full: number; frac: number } {
  const passesF = clamp01(viscosity) * VISC_MAX_PASSES;
  const full = Math.floor(passesF);
  const frac = passesF - full;
  return { full, frac };
}

export function createFluidSim(
  gl: WebGL2RenderingContext,
  quadVao: WebGLVertexArrayObject,
  initialSize: SimSize,
  format: SimFormat,
): FluidSim {
  const passes = {
    advectVel: makePass(gl, format, ADVECT_VEL_BODY),
    viscosity: makePass(gl, format, VISCOSITY_BODY),
    curl: makePass(gl, format, CURL_BODY),
    force: makePass(gl, format, FORCE_BODY),
    divergence: makePass(gl, format, DIVERGENCE_BODY),
    jacobi: makePass(gl, format, JACOBI_BODY),
    gradient: makePass(gl, format, GRADIENT_BODY),
    advectDyePredict: makePass(gl, format, ADVECT_DYE_PREDICT_BODY),
    advectDye: makePass(gl, format, ADVECT_DYE_BODY),
    edge: makePass(gl, format, EDGE_BODY),
  };

  let size = initialSize;
  let vel: [SimTarget, SimTarget];
  let pressure: [SimTarget, SimTarget];
  let curlTarget: SimTarget;
  let divTarget: SimTarget;
  let dye: [SimTarget, SimTarget];
  let dyeTemp: SimTarget;
  let edgeTarget: SimTarget;
  let velRead = 0;
  let pRead = 0;
  let dyeRead = 0;

  function allocate(s: SimSize): void {
    vel = [
      createTarget(gl, s.velW, s.velH, "vel", format, "linear"),
      createTarget(gl, s.velW, s.velH, "vel", format, "linear"),
    ];
    pressure = [
      createTarget(gl, s.velW, s.velH, "scalar", format, "nearest"),
      createTarget(gl, s.velW, s.velH, "scalar", format, "nearest"),
    ];
    curlTarget = createTarget(gl, s.velW, s.velH, "scalar", format, "nearest");
    divTarget = createTarget(gl, s.velW, s.velH, "scalar", format, "nearest");
    dye = [
      createTarget(gl, s.dyeW, s.dyeH, "dye", format, "linear"),
      createTarget(gl, s.dyeW, s.dyeH, "dye", format, "linear"),
    ];
    dyeTemp = createTarget(gl, s.dyeW, s.dyeH, "dye", format, "linear");
    edgeTarget = createTarget(gl, s.dyeW, s.dyeH, "edge", format, "mipmap");
    velRead = 0;
    pRead = 0;
    dyeRead = 0;
  }

  function release(): void {
    for (const t of vel) deleteTarget(gl, t);
    for (const t of pressure) deleteTarget(gl, t);
    deleteTarget(gl, curlTarget);
    deleteTarget(gl, divTarget);
    for (const t of dye) deleteTarget(gl, t);
    deleteTarget(gl, dyeTemp);
    deleteTarget(gl, edgeTarget);
  }

  allocate(size);

  function drawPass(
    pp: PassProgram,
    target: SimTarget,
    velTex: WebGLTexture | null,
    auxTex: WebGLTexture | null,
    dt: number,
    velTexel: readonly [number, number],
    aspect: number,
    forceScale: number,
    curl: number,
    energy: number,
    fade: number,
    splats: readonly Splat[],
    smooth = 0,
    aux2Tex: WebGLTexture | null = null,
  ): void {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, target.w, target.h);
    pp.prog.use();
    pp.prog.setF("uSmooth", smooth);
    // Only the byte codec declares uSeed; a null location is a no-op in half mode.
    pp.prog.setF("uSeed", Math.random());
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, velTex);
    gl.uniform1i(pp.velLoc, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, auxTex);
    gl.uniform1i(pp.auxLoc, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, aux2Tex);
    gl.uniform1i(pp.aux2Loc, 2);

    pp.prog.setF("uDt", dt);
    pp.prog.setV2("uVelTexel", velTexel[0], velTexel[1]);
    pp.prog.setV2("uTexel", 1 / target.w, 1 / target.h);
    pp.prog.setF("uAspect", aspect);
    pp.prog.setF("uForceScale", forceScale);
    pp.prog.setF("uCurl", curl);
    pp.prog.setF("uEnergy", energy);
    pp.prog.setF("uFade", fade);
    for (let i = 0; i < SPLAT_SLOTS; i++) {
      const sp = splats[i];
      if (sp) {
        pp.prog.setV4(`uSplatPos[${i}]`, sp.x, sp.y, sp.sigma, sp.tag);
        // .w is E3b's ring radius (0 = plain gaussian blob) — see
        // splatDyeWeight / splatForceWeight in simPrefix.
        pp.prog.setV4(`uSplatVel[${i}]`, sp.fx, sp.fy, sp.dye, sp.ring);
      } else {
        pp.prog.setV4(`uSplatPos[${i}]`, 0, 0, 1, 0);
        // A missing splat's ring stays 0 (last component) — plain blob.
        pp.prog.setV4(`uSplatVel[${i}]`, 0, 0, 0, 0);
      }
    }
    drawFullscreenQuad(gl, quadVao);
  }

  return {
    get size() {
      return size;
    },
    format,

    step(inputs: SimStepInputs): void {
      const { dt, curl, dissipation, energy, viscosity, splats } = inputs;
      const fade = DYE_FADE_MIN + (DYE_FADE_MAX - DYE_FADE_MIN) * clamp01(dissipation);
      const velTexel: readonly [number, number] = [1 / size.velW, 1 / size.velH];
      const aspect = size.velW / size.velH;
      const forceScale = size.velH / FORCE_REF_ROWS;

      // 1. advect velocity (plain semi-Lagrangian + damping — viscosity is
      // its own pass now, see below).
      let vw = 1 - velRead;
      drawPass(passes.advectVel, vel[vw], vel[velRead].tex, null, dt, velTexel, aspect, forceScale, curl, energy, fade, splats);
      velRead = vw;

      // 1b. viscosity: viscosityPasses(viscosity).full 5-tap blur passes at
      // VISC_K, plus one more at VISC_K * frac when a fractional pass
      // remains, so the viscosity setting is continuous.
      const { full: viscFull, frac: viscFrac } = viscosityPasses(viscosity);
      for (let i = 0; i < viscFull; i++) {
        vw = 1 - velRead;
        drawPass(passes.viscosity, vel[vw], vel[velRead].tex, null, dt, velTexel, aspect, forceScale, curl, energy, fade, splats, VISC_K);
        velRead = vw;
      }
      if (viscFrac > 1e-3) {
        vw = 1 - velRead;
        drawPass(passes.viscosity, vel[vw], vel[velRead].tex, null, dt, velTexel, aspect, forceScale, curl, energy, fade, splats, VISC_K * viscFrac);
        velRead = vw;
      }

      // 2. curl.
      drawPass(passes.curl, curlTarget, vel[velRead].tex, null, dt, velTexel, aspect, forceScale, curl, energy, fade, splats);

      // 3. force: vorticity confinement + splats.
      vw = 1 - velRead;
      drawPass(passes.force, vel[vw], vel[velRead].tex, curlTarget.tex, dt, velTexel, aspect, forceScale, curl, energy, fade, splats);
      velRead = vw;

      // 4. divergence.
      drawPass(passes.divergence, divTarget, vel[velRead].tex, null, dt, velTexel, aspect, forceScale, curl, energy, fade, splats);

      // 5. jacobi x N, pressure ping-ponged and warm-started (never
      // cleared here — only createTarget's initial/resize clear touches it).
      for (let i = 0; i < size.jacobiIters; i++) {
        const pw = 1 - pRead;
        drawPass(passes.jacobi, pressure[pw], pressure[pRead].tex, divTarget.tex, dt, velTexel, aspect, forceScale, curl, energy, fade, splats);
        pRead = pw;
      }

      // 6. gradient: project out the pressure gradient.
      vw = 1 - velRead;
      drawPass(passes.gradient, vel[vw], vel[velRead].tex, pressure[pRead].tex, dt, velTexel, aspect, forceScale, curl, energy, fade, splats);
      velRead = vw;

      // 7. advect dye with the projected velocity.
      const dw = 1 - dyeRead;
      // With DYE_MACCORMACK the predictor writes the plain semi-Lagrangian
      // result to dyeTemp and the main pass corrects it (see the two bodies).
      if (DYE_MACCORMACK) {
        drawPass(passes.advectDyePredict, dyeTemp, vel[velRead].tex, dye[dyeRead].tex, dt, velTexel, aspect, forceScale, curl, energy, fade, splats);
      }
      drawPass(passes.advectDye, dye[dw], vel[velRead].tex, dye[dyeRead].tex, dt, velTexel, aspect, forceScale, curl, energy, fade, splats, DYE_SMOOTH, DYE_MACCORMACK ? dyeTemp.tex : null);
      dyeRead = dw;

      // 8. edge (Sobel of dye.r) + mipmap chain for the display pass's halo.
      drawPass(passes.edge, edgeTarget, dye[dyeRead].tex, null, dt, velTexel, aspect, forceScale, curl, energy, fade, splats);
      gl.bindTexture(gl.TEXTURE_2D, edgeTarget.tex);
      gl.generateMipmap(gl.TEXTURE_2D);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, null);
    },

    dyeTexture(): WebGLTexture | null {
      return dye[dyeRead].tex;
    },

    velTexture(): WebGLTexture | null {
      return vel[velRead].tex;
    },

    edgeTexture(): WebGLTexture | null {
      return edgeTarget.tex;
    },

    resize(newSize: SimSize): void {
      release();
      size = newSize;
      allocate(size);
    },

    dispose(): void {
      release();
      passes.advectVel.prog.dispose();
      passes.viscosity.prog.dispose();
      passes.curl.prog.dispose();
      passes.force.prog.dispose();
      passes.divergence.prog.dispose();
      passes.jacobi.prog.dispose();
      passes.gradient.prog.dispose();
      passes.advectDyePredict.prog.dispose();
      passes.advectDye.prog.dispose();
      passes.edge.prog.dispose();
    },
  };
}
