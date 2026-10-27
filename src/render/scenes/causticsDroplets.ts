import { createColorTarget, createProgram, destroyTarget, type ColorTarget, type GLProgram } from "../gl.ts";
import type { SceneContext, Viewport } from "../scene.ts";

// Droplets, the fourth Sparkle effect (causticsSparkle.ts). While a treble
// hit sounds, every lit line of Caustics' pool sprays fine bright drops out
// of tiny holes along its whole length, as a pricked rubber hose does, and a
// brighter line opens more holes. The pool's water stops each drop within a
// fraction of a second; the drop then moves with the line that sprayed it
// until its light runs out. docs/scenes/caustics.md has the owner's calls
// behind it.
//
// The drops live on the GPU. Two buffers hold every drop (position and
// velocity, then age, light, radius and its own fade), and a
// transform-feedback pass steps them from one buffer into the other each
// frame. Drops come in blocks of DROPS_PER_HOLE: a block is one hole's jet,
// born together and spent together, so a spent block is free for a new hole
// without any allocator. On a frame that sprays, each free block opens a
// hole with the chance JS hands it (`openChance`): it tries random points of
// the frame and keeps the first that passes a test on the pool's brightness
// there, so lines get holes in proportion to how bright they are drawn. The
// test reads the pool through the GLSL caustics.ts hands createDroplets
// (POOL_GLSL's poolAt and ridgeField, POOL_FLOW_GLSL's poolFlow), so a hole
// opens on a line where FRAG draws it, ripple, bass bulge and Breathe
// included, and a drop rides the exact motion of its line's octave. A second
// pass splats every drop additively into a one-channel target the size of
// the frame, which FRAG blends toward the palette's brightest colour.
//
// The splat target is R16F where the browser renders to half floats, else R8
// holding the light scaled down by MIST_BYTE_RANGE (TV runtimes: see
// vite.config.ts's target note), read back scaled up.

/** Drops per hole: one block of slots, one hole's jet. */
export const DROPS_PER_HOLE = 8;
/** The most drops at any quality preset. */
export const MAX_DROPS = 65536;
// The share of QualitySettings.maxParticles the drops may take.
const DROP_BUDGET_SHARE = 1 / 3;

// Points a block tries before giving up on this frame's hole; a block that
// finds none stays free and tries again next frame.
const HOLE_TRIES = 24;
// The ridge light (ridgeField's sum) where a point starts passing the hole
// test and where it always passes, as fractions of the peak of a first-octave
// line drawn with this frame's Fog and the band levels averaged over the
// octaves. A loud passage lifts every line, and against a fixed reference
// most of the pool would pass; the first octave's own band (the bass) can't
// be the reference either, since a kick pumps it. The pass chance climbs as
// the square in between, so a line brighter than the rest gets most holes.
const HOLE_LIGHT_LO = 0.6;
const HOLE_LIGHT_HI = 1.25;
// A hole is moved onto the middle of its line in SNAP_STEPS Newton steps on
// that line's octave, each at most SNAP_STEP in p (the frame is 3 tall), so a
// point that passed on the haze of a wide line (Fog pulse widens them on a
// beat) still sprays from the middle.
const SNAP_STEPS = 3;
const SNAP_STEP = 0.04;
// A tiny hole: the spread of headings inside one jet, in radians.
const JET_SPREAD = 0.05;
// The spread of hole headings around the line's normal at Fan 0 and 1, radians.
const FAN_MIN = 0.05;
const FAN_MAX = 0.9;

// Prototype v3/v4's drop sizes (16MDY55AqFA1Qypib6yxKa): about 0.4 px to 2 px
// radius on a 1000 px tall frame.
const DROP_R_MIN = 0.0011;
const DROP_R_MAX = 0.0055;
// The water's drag on a drop of DRAG_REF_R; a drop of radius r feels
// sqrt(DRAG_REF_R / r) times it, so smaller drops stop sooner.
const DRAG_REF_R = 0.002;
const DRAG_LIGHT = 18;
const DRAG_HEAVY = 6;
// Top launch speed, p/s.
const THROW_MIN = 0.5;
const THROW_MAX = 16;
// A drop's light fades with this time constant (s) while it flies, and at
// STOPPED_FADE of it once the water has stopped it (relative speed under
// STOPPED_SPEED p/s).
const FADE_SHORT = 0.25;
const FADE_LONG = 1.4;
const STOPPED_FADE = 0.3;
const STOPPED_SPEED = 0.3;
// A block lives this many fade time constants: by then a drop that stopped
// as late as the heaviest do has faded out. The last LIFE_FADE_OUT of it
// fades the drawn light, so a spent block never pops.
const LIFE_PER_FADE = 2.4;
const LIFE_FADE_OUT = 0.2;
// Drawn light at Glow 0 and 1.
const GLOW_MIN = 0.5;
const GLOW_MAX = 3;
// Each drop is smeared along its flight over this many seconds of travel.
const SMEAR_SEC = 1.2 / 60;
// The rate (per second, per free block) of tries for a hole at Amount 1,
// Sparkle 1 and a full hit's pressure. A full Pluck hit (an area of about
// PLUCK_TAU seconds) then has nearly every free block try; at the defaults,
// about half. Tuned by eye on the synthetic feed until the lines read as
// sprayed along their whole length.
const OPEN_RATE = 12;
// Pressure past this adds holes but no more speed.
const PRESSURE_SPEED_CAP = 1.5;
// The R8 fallback stores light / MIST_BYTE_RANGE.
const MIST_BYTE_RANGE = 6;
const DEAD_AGE = 1e9;
// A drop's fade factor (0.7..1.3) shares a float with its octave, as
// fade + OCTAVE_PACK * octave; the factor stays below OCTAVE_PACK.
const OCTAVE_PACK = 2;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Drop size (0..1) -> a typical drop's radius in p. */
export function dropRadius(size: number): number {
  return DROP_R_MIN * Math.pow(DROP_R_MAX / DROP_R_MIN, size);
}

/** Throw (0..1) -> the top launch speed of a full-pressure jet, p/s. */
export function dropThrow(throwAmt: number): number {
  return lerp(THROW_MIN, THROW_MAX, throwAmt);
}

/** Fan (0..1) -> the spread of hole headings around the line's normal, radians. */
export function dropFan(fan: number): number {
  return lerp(FAN_MIN, FAN_MAX, fan);
}

/** Weight (0..1) -> the water's drag on a DRAG_REF_R drop, per second. */
export function dropDrag(weight: number): number {
  return lerp(DRAG_LIGHT, DRAG_HEAVY, weight);
}

/** Life (0..1) -> a flying drop's light time constant, seconds. */
export function dropFade(life: number): number {
  return lerp(FADE_SHORT, FADE_LONG, life);
}

/** Life (0..1) -> how long a hole's jet lives, seconds. */
export function blockLife(life: number): number {
  return LIFE_PER_FADE * dropFade(life);
}

/** Glow (0..1) -> the drawn light's gain. */
export function dropGlow(glow: number): number {
  return lerp(GLOW_MIN, GLOW_MAX, glow);
}

/** The drop cap for a quality preset's particle budget: a whole number of
 *  blocks, at most MAX_DROPS. */
export function dropCap(maxParticles: number): number {
  const drops = Math.min(MAX_DROPS, Math.floor(maxParticles * DROP_BUDGET_SHARE));
  return Math.max(DROPS_PER_HOLE, Math.floor(drops / DROPS_PER_HOLE) * DROPS_PER_HOLE);
}

/** The chance that a free block opens a hole this frame: a steady rate of
 *  OPEN_RATE per second scaled by Amount, the Sparkle knob and the hit's
 *  pressure (Sparkle's summed shape, its positive part). */
export function openChance(dtSec: number, pressure: number, amount: number, sparkle: number): number {
  const rate = OPEN_RATE * Math.max(0, amount) * Math.max(0, sparkle) * Math.max(0, pressure);
  return dtSec > 0 ? 1 - Math.exp(-rate * dtSec) : 0;
}

/** The launch-speed scale for holes opened at this pressure. */
export function holeStrength(pressure: number): number {
  return Math.min(Math.max(0, pressure), PRESSURE_SPEED_CAP);
}

/** A drop's speed relative to the water, `t` seconds after launch at `v0`:
 *  the drag pulls it toward the current exponentially. The step pass does
 *  the same per frame; exported so tests/causticsDroplets.test.ts can pin
 *  how fast the water stops a drop. */
export function relativeSpeed(v0: number, tSec: number, radius: number, weight: number): number {
  return v0 * Math.exp(-dropDrag(weight) * Math.sqrt(DRAG_REF_R / radius) * tSec);
}

/** What the step and splat passes need this frame, from the scene's settings
 *  and Sparkle's shape. */
export interface DropletFrame {
  dtSec: number;
  /** The drift phase's rate, phase per second: the current is per unit phase. */
  rate: number;
  /** openChance for this frame; 0 opens nothing. */
  open: number;
  /** holeStrength of this frame's pressure. */
  strength: number;
  /** The Droplets dials, each 0..1 as the settings store them. */
  size: number;
  throwAmt: number;
  fan: number;
  weight: number;
  life: number;
  glow: number;
}

export interface Droplets {
  /** Steps the drops, opening this frame's holes, and splats them into the
   *  target. `upload` gives the step pass every uniform the scene's program
   *  got (fullscreenScene.ts's beforeDraw). Leaves `prog` in use, with the
   *  framebuffer, viewport and blend state as it found them. Returns the
   *  target and the scale FRAG multiplies its reading by, or null while no
   *  drop can be alive. */
  draw(
    ctx: SceneContext,
    prog: GLProgram,
    viewport: Viewport,
    upload: (other: GLProgram) => void,
    f: DropletFrame,
  ): { tex: WebGLTexture; scale: number } | null;
  /** The effect isn't picked this frame: whatever is in flight is dropped
   *  before the next spray, instead of resuming where it froze. */
  pause(): void;
  dispose(gl: WebGL2RenderingContext): void;
}

const STEP_FRAG = `#version 300 es
precision highp float;
out vec4 o;
void main() { o = vec4(0.0); }`;

// The step pass's body. `poolHeaderGlsl` (caustics.ts) declares the scene's
// uniforms and defines POOL_OCTAVES, poolAt, ridgeField, poolFlow, roomUv,
// sampleBands and uhash.
const STEP_BODY = `
uniform float uDt;
uniform float uRate;
uniform float uOpen;
uniform float uSeed; // a frame counter below 2^24, exact as a float
uniform float uStrength;
uniform float uThrow;
uniform float uFan;
uniform float uDrag;
uniform float uRadius;
uniform float uFade;
uniform float uLife;
layout(location = 0) in vec4 aPosVel;
// age, light, radius, and the drop's own fade factor (0.7..1.3) plus
// OCTAVE_PACK times the octave of the line that sprayed it.
layout(location = 1) in vec4 aLife;
out vec4 vPosVel;
out vec4 vLife;

float unitOf(uint h) { return float(h >> 8u) * (1.0 / 16777216.0); }
float gaussOf(uint h) {
  float u1 = max(unitOf(h), 1e-7);
  float u2 = unitOf(uhash(h ^ 0x9e3779b9u));
  return sqrt(-2.0 * log(u1)) * cos(6.28318530718 * u2);
}

void main() {
  vec4 pv = aPosVel;
  vec4 lf = aLife;
  if (lf.x < uLife) {
    int octave = int(lf.w / ${OCTAVE_PACK.toFixed(1)});
    float fade = lf.w - ${OCTAVE_PACK.toFixed(1)} * float(octave);
    // The motion of the octave that sprayed it, so it keeps its place beside that line.
    vec2 cur = poolFlow(poolAt(pv.xy), octave).vel * uRate;
    float f = exp(-uDrag * sqrt(${DRAG_REF_R.toFixed(4)} / lf.z) * uDt);
    pv.zw = cur + (pv.zw - cur) * f;
    pv.xy += pv.zw * uDt;
    float rel = length(pv.zw - cur);
    float tau = uFade * fade * mix(${STOPPED_FADE.toFixed(2)}, 1.0, min(1.0, rel / ${STOPPED_SPEED.toFixed(2)}));
    lf.y *= exp(-uDt / tau);
    lf.x += uDt;
    if (lf.x >= uLife) lf = vec4(${DEAD_AGE.toExponential()}, 0.0, lf.z, lf.w);
  } else if (uOpen > 0.0) {
    uint seed = uhash(uint(uSeed));
    // Every lane of a block runs this the same way, so they agree on the hole.
    uint bh = uhash(uint(gl_VertexID / ${DROPS_PER_HOLE}) * 0x85ebca6bu + seed);
    if (unitOf(bh) < uOpen) {
      vec2 aspectFix = vec2(uResolution.x / uResolution.y, 1.0);
      uint h = bh;
      bool found = false;
      vec2 p = vec2(0.0);
      PoolAt at0 = poolAt(vec2(0.0));
      float bandSum = 0.0;
      for (int i = 0; i < POOL_OCTAVES; i++) {
        if (i >= at0.iterations) break;
        bandSum += sampleBands(float(i) / float(POOL_OCTAVES));
      }
      float peak = at0.ridgeGain * (0.5 + 0.8 * bandSum / float(at0.iterations));
      for (int k = 0; k < ${HOLE_TRIES}; k++) {
        h = uhash(h + 0x6d2b79f5u);
        vec2 pc = (roomUv(vec2(unitOf(h), unitOf(uhash(h ^ 0x68e31da4u)))) - 0.5) * aspectFix * 3.0;
        PoolAt at = poolAt(pc);
        vec2 qc = at.q;
        float light = ridgeField(qc, at.iterations, at.sharp, at.ridgeGain, at.densScale, at.warpAmt, at.flowFwd, at.flowBack);
        float w = clamp((light / peak - ${HOLE_LIGHT_LO.toFixed(2)}) / ${(HOLE_LIGHT_HI - HOLE_LIGHT_LO).toFixed(2)}, 0.0, 1.0);
        if (unitOf(uhash(h ^ 0x2c1b3c6du)) < w * w) {
          p = pc;
          found = true;
          break;
        }
      }
      if (found) {
        // Onto the middle of the brightest octave's line, held to that octave.
        PoolFlow fl = poolFlow(poolAt(p), -1);
        int octave = fl.octave;
        vec2 hole = p;
        for (int s = 0; s < ${SNAP_STEPS}; s++) {
          float gs = dot(fl.grad, fl.grad);
          if (gs < 1e-8) break;
          float gi = inversesqrt(gs);
          hole -= fl.grad * gi * clamp((fl.v - 0.5) * gi, -${SNAP_STEP.toFixed(3)}, ${SNAP_STEP.toFixed(3)});
          fl = poolFlow(poolAt(hole), octave);
        }
        float g2 = dot(fl.grad, fl.grad);
        vec2 n = g2 > 1e-8 ? fl.grad * inversesqrt(g2) : vec2(1.0, 0.0);
        float side = (uhash(bh ^ 0xa511e9b3u) & 1u) == 0u ? 1.0 : -1.0;
        float tilt = clamp(gaussOf(uhash(bh ^ 0x51ed270bu)) * uFan, -1.3, 1.3);
        uint dh = uhash(uint(gl_VertexID) * 0x27d4eb2fu + seed);
        float theta = tilt + gaussOf(dh) * ${JET_SPREAD.toFixed(3)};
        vec2 dir = side * n * cos(theta) + vec2(-n.y, n.x) * sin(theta);
        // Many slow drops and a few fast ones: a jet is densest at its hole.
        float sp = uThrow * uStrength * (0.08 + 0.92 * pow(unitOf(uhash(dh + 1u)), 1.7)) * (1.0 - 0.3 * abs(theta));
        float r = uRadius * clamp(exp(0.5 * gaussOf(uhash(dh + 2u))), 0.5, 4.0);
        pv.xy = hole + dir * sp * uDt * unitOf(uhash(dh + 3u));
        pv.zw = dir * sp + fl.vel * uRate;
        lf = vec4(0.0, 0.6 + 0.4 * unitOf(uhash(dh + 4u)), r, 0.7 + 0.6 * unitOf(uhash(dh + 5u)) + ${OCTAVE_PACK.toFixed(1)} * float(octave));
      }
    }
  }
  vPosVel = pv;
  vLife = lf;
}
`;

// One quad per drop (four TRIANGLE_STRIP corners from gl_VertexID), stretched
// along its flight; a drop under a pixel is drawn a pixel wide with its light
// spread to match.
const SPLAT_VERT = `#version 300 es
precision highp float;
uniform vec4 uViewport;
uniform vec2 uResolution;
uniform vec2 uTarget;
uniform float uGlow;
uniform float uLife;
uniform float uWriteScale;
layout(location = 0) in vec4 aPosVel;
layout(location = 1) in vec4 aLife;
out vec2 vLocal;
out float vLight;
void main() {
  vec2 corner = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1)) * 2.0 - 1.0;
  float light = aLife.y * uGlow * (1.0 - smoothstep(${(1 - LIFE_FADE_OUT).toFixed(2)} * uLife, uLife, aLife.x));
  vLocal = corner;
  vLight = 0.0;
  if (aLife.x >= uLife || light < 0.002) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec2 aspectFix = vec2(uResolution.x / uResolution.y, 1.0);
  vec2 uv = (aPosVel.xy / (aspectFix * 3.0) + 0.5 - uViewport.xy) / uViewport.zw;
  float pxPerP = uTarget.y / (3.0 * uViewport.w);
  float sp = length(aPosVel.zw);
  vec2 dir = sp > 1e-4 ? aPosVel.zw / sp : vec2(1.0, 0.0);
  float rPx = aLife.z * pxPerP;
  float ay = max(rPx, 0.9);
  float ax = ay + sp * pxPerP * ${SMEAR_SEC.toFixed(5)} * 0.5;
  float keep = sqrt(clamp(rPx * rPx / (ax * ay), 0.02, 1.0));
  vec2 offPx = dir * (corner.x * ax) + vec2(-dir.y, dir.x) * (corner.y * ay);
  gl_Position = vec4(uv * 2.0 - 1.0 + offPx * 2.0 / uTarget, 0.0, 1.0);
  vLight = light * keep * uWriteScale;
}`;

const SPLAT_FRAG = `#version 300 es
precision highp float;
in vec2 vLocal;
in float vLight;
out vec4 o;
void main() {
  float d2 = dot(vLocal, vLocal);
  if (d2 >= 1.0) discard;
  float k = 1.0 - d2;
  o = vec4(vLight * k * k, 0.0, 0.0, 0.0);
}`;

// Two vec4s per drop: position and velocity, then age, light, radius, fade.
const FLOATS_PER_DROP = 8;
const STRIDE = FLOATS_PER_DROP * 4;
const CLEAR = new Float32Array(4);

interface GpuState {
  gl: WebGL2RenderingContext;
  cap: number;
  /** Every drop spent: what both buffers start from, and go back to on a pause. */
  spent: Float32Array;
  bufs: [WebGLBuffer, WebGLBuffer];
  stepVaos: [WebGLVertexArrayObject, WebGLVertexArrayObject];
  splatVaos: [WebGLVertexArrayObject, WebGLVertexArrayObject];
  tf: WebGLTransformFeedback;
  step: GLProgram;
  splat: GLProgram;
  half: boolean;
  target: ColorTarget | null;
}

function dropVao(gl: WebGL2RenderingContext, buf: WebGLBuffer, divisor: number): WebGLVertexArrayObject {
  const vao = gl.createVertexArray();
  if (!vao) throw new Error("caustics droplets: createVertexArray failed");
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  for (let i = 0; i < 2; i++) {
    gl.enableVertexAttribArray(i);
    gl.vertexAttribPointer(i, 4, gl.FLOAT, false, STRIDE, i * 16);
    gl.vertexAttribDivisor(i, divisor);
  }
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  return vao;
}

/** `poolHeaderGlsl` opens the step pass's vertex shader after its version
 *  line: the scene's uniforms (sceneUniformsGlsl) and caustics.ts's pool
 *  GLSL, with POOL_FWIDTH defined for a vertex shader and POOL_OCTAVES as
 *  the ridge loop's octave count (its band lookups divide by it). */
export function createDroplets(poolHeaderGlsl: string): Droplets {
  // A vertex shader's samplers default to lowp; the ripple spot texture is RG16F.
  const stepVert = `#version 300 es\nprecision highp float;\nprecision highp sampler2D;\n${poolHeaderGlsl}\n${STEP_BODY}`;
  let st: GpuState | null = null;
  // A context that couldn't build the passes (a shader over this GPU's limits)
  // draws no drops rather than taking the scene down with it.
  let failedGl: WebGL2RenderingContext | null = null;
  let read = 0;
  let seed = 1;
  // Seconds since a hole could last open: past a block's life nothing is alive.
  let idleSec = Infinity;
  // Set by pause(): the buffers may hold drops that stopped mid-flight.
  let stale = false;

  function build(gl: WebGL2RenderingContext, cap: number): GpuState {
    const step = createProgram(gl, STEP_FRAG, stepVert, ["vPosVel", "vLife"]);
    const splat = createProgram(gl, SPLAT_FRAG, SPLAT_VERT);
    const spent = new Float32Array(cap * FLOATS_PER_DROP);
    for (let i = 0; i < cap; i++) spent[i * FLOATS_PER_DROP + 4] = DEAD_AGE;
    const mk = (): WebGLBuffer => {
      const b = gl.createBuffer();
      if (!b) throw new Error("caustics droplets: createBuffer failed");
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, spent, gl.DYNAMIC_COPY);
      return b;
    };
    const bufs: [WebGLBuffer, WebGLBuffer] = [mk(), mk()];
    const tf = gl.createTransformFeedback();
    if (!tf) throw new Error("caustics droplets: createTransformFeedback failed");
    return {
      gl,
      cap,
      spent,
      bufs,
      stepVaos: [dropVao(gl, bufs[0], 0), dropVao(gl, bufs[1], 0)],
      splatVaos: [dropVao(gl, bufs[0], 1), dropVao(gl, bufs[1], 1)],
      tf,
      step,
      splat,
      half: gl.getExtension("EXT_color_buffer_float") !== null || gl.getExtension("EXT_color_buffer_half_float") !== null,
      target: null,
    };
  }

  function free(s: GpuState): void {
    const { gl } = s;
    for (const v of [...s.stepVaos, ...s.splatVaos]) gl.deleteVertexArray(v);
    for (const b of s.bufs) gl.deleteBuffer(b);
    gl.deleteTransformFeedback(s.tf);
    s.step.dispose();
    s.splat.dispose();
    destroyTarget(gl, s.target);
  }

  function targetFor(s: GpuState, w: number, h: number): ColorTarget {
    if (s.target && s.target.w === w && s.target.h === h) return s.target;
    const { gl } = s;
    destroyTarget(gl, s.target);
    s.target = null;
    if (s.half) {
      try {
        s.target = createColorTarget(gl, w, h, { internalFormat: gl.R16F, format: gl.RED, type: gl.HALF_FLOAT, label: "caustics droplets" });
      } catch {
        // Advertised but incomplete on this runtime: the byte target below.
        s.half = false;
      }
    }
    s.target ??= createColorTarget(gl, w, h, { internalFormat: gl.R8, format: gl.RED, type: gl.UNSIGNED_BYTE, label: "caustics droplets" });
    return s.target;
  }

  return {
    // @per-frame
    draw(ctx, prog, viewport, upload, f) {
      const gl = ctx.gl;
      const life = blockLife(f.life);
      idleSec = f.open > 0 ? 0 : idleSec + f.dtSec;
      if (idleSec > life || failedGl === gl) return null;
      const cap = dropCap(ctx.quality.maxParticles);
      if (!st || st.gl !== gl || st.cap !== cap) {
        if (st && st.gl === gl) free(st);
        st = null;
        try {
          st = build(gl, cap);
        } catch (e) {
          failedGl = gl;
          console.warn("Caustics Droplets can't run on this GPU:", e);
          return null;
        }
        read = 0;
        stale = false;
      }
      const s = st;
      if (stale) {
        for (const b of s.bufs) {
          gl.bindBuffer(gl.ARRAY_BUFFER, b);
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, s.spent);
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        stale = false;
      }
      const vp = gl.getParameter(gl.VIEWPORT) as Int32Array;
      const target = targetFor(s, Math.max(1, vp[2]), Math.max(1, vp[3]));
      const prevFbo = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
      const blendOn = gl.isEnabled(gl.BLEND);
      const blendSrc = gl.getParameter(gl.BLEND_SRC_RGB) as number;
      const blendDst = gl.getParameter(gl.BLEND_DST_RGB) as number;
      const blendSrcA = gl.getParameter(gl.BLEND_SRC_ALPHA) as number;
      const blendDstA = gl.getParameter(gl.BLEND_DST_ALPHA) as number;

      upload(s.step);
      s.step.setI("uRippleSpotTex", 0);
      s.step.setF("uDt", Math.min(f.dtSec, 0.1));
      s.step.setF("uRate", f.rate);
      s.step.setF("uOpen", f.open);
      s.step.setF("uSeed", seed);
      s.step.setF("uStrength", f.strength);
      s.step.setF("uThrow", dropThrow(f.throwAmt));
      s.step.setF("uFan", dropFan(f.fan));
      s.step.setF("uDrag", dropDrag(f.weight));
      s.step.setF("uRadius", dropRadius(f.size));
      s.step.setF("uFade", dropFade(f.life));
      s.step.setF("uLife", life);
      seed = (seed + 1) % 16777216;
      gl.bindVertexArray(s.stepVaos[read]);
      gl.enable(gl.RASTERIZER_DISCARD);
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, s.tf);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, s.bufs[1 - read]);
      gl.beginTransformFeedback(gl.POINTS);
      gl.drawArrays(gl.POINTS, 0, s.cap);
      gl.endTransformFeedback();
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
      gl.disable(gl.RASTERIZER_DISCARD);
      read = 1 - read;

      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.viewport(0, 0, target.w, target.h);
      gl.clearBufferfv(gl.COLOR, 0, CLEAR);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      s.splat.use();
      s.splat.setV4("uViewport", viewport.x, viewport.y, viewport.w, viewport.h);
      s.splat.setV2("uResolution", gl.drawingBufferWidth, gl.drawingBufferHeight);
      s.splat.setV2("uTarget", target.w, target.h);
      s.splat.setF("uGlow", dropGlow(f.glow));
      s.splat.setF("uLife", life);
      s.splat.setF("uWriteScale", s.half ? 1 : 1 / MIST_BYTE_RANGE);
      gl.bindVertexArray(s.splatVaos[read]);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, s.cap);
      gl.bindVertexArray(null);

      if (!blendOn) gl.disable(gl.BLEND);
      gl.blendFuncSeparate(blendSrc, blendDst, blendSrcA, blendDstA);
      gl.bindFramebuffer(gl.FRAMEBUFFER, prevFbo);
      gl.viewport(vp[0], vp[1], vp[2], vp[3]);
      prog.use();
      return { tex: target.tex, scale: s.half ? 1 : MIST_BYTE_RANGE };
    },
    pause() {
      if (idleSec !== Infinity) stale = true;
      idleSec = Infinity;
    },
    dispose(gl) {
      if (st && st.gl === gl) free(st);
      st = null;
      idleSec = Infinity;
      stale = false;
    },
  };
}
