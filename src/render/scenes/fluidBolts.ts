/**
 * The Fluid scene's lightning: a strike pool of jagged bolt trees (the shape
 * and timing math is `../bolt.ts`, lifted from Storm) drawn into their own
 * additive layer in sim-uv space, so the dye's fold/mirror transform (which
 * samples the display in the same `s` it samples the dye) mirrors the bolts
 * along with everything else.
 *
 * Two halves, the same split as fluidSim.ts's pure/GL divide:
 *  - `createBoltPool` is the JS-only strike pool — slots' age/amplitude/seed/
 *    strength and each slot's drawn path, a refractory window, oldest-slot
 *    reuse — so `tests/bolt.test.ts` can exercise it without a GL context.
 *  - `createFluidBolts` wraps a pool with the GL side: one small render
 *    target (`.r` = core, `.g` = glow — the same profile as Storm's
 *    BOLT_FRAG), a program that expands the ribbon in layer-texel space
 *    instead of screen space, and the vertex buffer/VAO that pool.paths
 *    uploads into.
 *
 * The layer is identity-projected (`pos.xy` is already sim uv in [0,1]), so
 * there is no camera to route the tangent through the way Storm's BOLT_VERT
 * does — the tangent's xy is scaled by the layer's own texel size instead of
 * a projected screen direction, which is what turns a unit tangent into a
 * texel-space normal to offset the ribbon along.
 */
import { BOLT_RIBBON_VERTS, BOLT_VERT_FLOATS, buildBoltTree, strikeEnvelope } from "../bolt.ts";
import { createProgram } from "../gl.ts";
import type { SimFormat } from "./fluidSim.ts";

/** Bolt slots the layer can hold in flight at once. */
export const MAX_BOLTS = 6;
/** Shortest gap between strikes before a second one is dropped, unless
 *  `force` overrides it — the same idea as Storm's STRIKE_REFRACTORY_SEC,
 *  folding a beat and an onset that land on adjacent frames into one bolt. */
export const BOLT_REFRACTORY = 0.06;

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** The JS-only strike pool: endpoints, amplitude, age and each slot's drawn
 *  bolt tree, kept in flat arrays shaped for a GL upload but usable (and
 *  tested) with no GL at all. Mirrors Storm's createStrikePool, minus the
 *  lobe placement (the Fluid scene's callers pick endpoints themselves) and
 *  in 2D: every endpoint is a sim-uv coordinate, clamped into [0,1]^2. */
export interface BoltPool {
  /** Seconds since each slot last fired; large means "long faded". */
  readonly ages: Float32Array;
  /** Current light strength per slot: amplitude x strikeEnvelope(age). */
  readonly strengths: Float32Array;
  /** Amplitude each slot fired at, un-enveloped. 0 = never fired. */
  readonly amps: Float32Array;
  /** Per-slot seed strikeEnvelope's return strokes are placed with. */
  readonly seeds: Float32Array;
  /** Every slot's drawn bolt tree, back to back: slot i owns the
   *  BOLT_RIBBON_VERTS ribbon vertices (BOLT_VERT_FLOATS floats each)
   *  starting at i * BOLT_RIBBON_VERTS * BOLT_VERT_FLOATS. */
  readonly paths: Float32Array;
  /** 1 where a slot's path has changed since it was last uploaded to GL. */
  readonly dirty: Uint8Array;
  /** Fires a bolt from (ax,ay) to (bx,by) (sim uv, clamped to [0,1]^2) in
   *  whichever slot has been fading the longest. Returns false (and does
   *  nothing) inside the refractory window unless `force`. */
  strike(ax: number, ay: number, bx: number, by: number, amp: number, force?: boolean): boolean;
  /** Ages every slot and recomputes its strength from strikeEnvelope. */
  tick(dtSec: number, afterglow: number, flicker: number): void;
}

/** Pure half of the bolt layer — see the file header. `rng` defaults to
 *  Math.random; pass `createRng(seed)` from `../bolt.ts` for a reproducible
 *  pool (what the tests do). */
export function createBoltPool(rng: () => number = Math.random): BoltPool {
  const age = new Float32Array(MAX_BOLTS).fill(1e6); // huge = never triggered, fully faded
  const amp = new Float32Array(MAX_BOLTS); // 0 = inactive
  const seed = new Float32Array(MAX_BOLTS);
  const strength = new Float32Array(MAX_BOLTS);
  const paths = new Float32Array(MAX_BOLTS * BOLT_RIBBON_VERTS * BOLT_VERT_FLOATS);
  const dirty = new Uint8Array(MAX_BOLTS);
  let sinceLast = 1e6;

  return {
    ages: age,
    strengths: strength,
    amps: amp,
    seeds: seed,
    paths,
    dirty,
    strike(ax: number, ay: number, bx: number, by: number, amp0: number, force = false): boolean {
      if (!force && sinceLast < BOLT_REFRACTORY) return false;
      sinceLast = 0;
      let slot = 0;
      for (let i = 1; i < MAX_BOLTS; i++) if (age[i] > age[slot]) slot = i;
      age[slot] = 0;
      amp[slot] = amp0;
      seed[slot] = rng() * 1000;
      const a: [number, number, number] = [clamp01(ax), clamp01(ay), 0];
      const b: [number, number, number] = [clamp01(bx), clamp01(by), 0];
      buildBoltTree(rng, a, b, paths, slot * BOLT_RIBBON_VERTS * BOLT_VERT_FLOATS);
      dirty[slot] = 1;
      strength[slot] = amp0;
      return true;
    },
    tick(dtSec: number, afterglow: number, flicker: number): void {
      sinceLast += dtSec;
      for (let i = 0; i < MAX_BOLTS; i++) {
        age[i] += dtSec;
        strength[i] = amp[i] > 0 ? amp[i] * strikeEnvelope(age[i], seed[i], afterglow, flicker) : 0;
      }
    },
  };
}

/** GL-facing bolt layer: a pool plus the render target and program it draws
 *  into. See the file header for the shape of the layer's texture. */
export interface FluidBolts {
  /** Fire a bolt from a to b (sim uv, [0,1]^2), amplitude ~0.5..1.5. Returns
   *  false if refractory blocked it (force skips the refractory). */
  strike(ax: number, ay: number, bx: number, by: number, amp: number, force?: boolean): boolean;
  /** Age every bolt; strength = amp * strikeEnvelope(age, seed, afterglow, flicker). */
  tick(dtSec: number, afterglow: number, flicker: number): void;
  /** Clear the layer and draw every live bolt into it additively. Leaves FBO
   *  null, viewport restored, BLEND disabled, ARRAY_BUFFER/VAO unbound.
   *  `widthPx` = ribbon half-width scale in layer texels. */
  draw(widthPx: number): void;
  texture(): WebGLTexture | null;
  resize(w: number, h: number): void;
  dispose(): void;
  /** Pure-testable pool state (ages/strengths) for tests. */
  readonly ages: Float32Array;
  readonly strengths: Float32Array;
}

interface BoltTarget {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  w: number;
  h: number;
}

/** Allocates the layer's render target: RG16F (.r core, .g glow) when the sim
 *  is running in half-float mode, RGBA8 otherwise — the same format/filter
 *  choice fluidSim.ts's own createTarget makes for its float-format targets,
 *  reimplemented locally since that helper isn't exported. Byte mode clamps
 *  to [0,1] on write, which is exactly the range core/glow live in. */
function createBoltTarget(gl: WebGL2RenderingContext, w: number, h: number, format: SimFormat): BoltTarget {
  const isHalf = format === "half";
  const tex = gl.createTexture();
  if (!tex) throw new Error("fluidBolts: createTexture failed");
  gl.bindTexture(gl.TEXTURE_2D, tex);
  const internalFormat = isHalf ? gl.RG16F : gl.RGBA8;
  const glFormat = isHalf ? gl.RG : gl.RGBA;
  const type = isHalf ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, glFormat, type, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const fbo = gl.createFramebuffer();
  if (!fbo) {
    gl.deleteTexture(tex);
    throw new Error("fluidBolts: createFramebuffer failed");
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
  if (!complete) {
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(tex);
    throw new Error(`fluidBolts: target incomplete (format=${format})`);
  }
  return { tex, fbo, w, h };
}

function deleteBoltTarget(gl: WebGL2RenderingContext, t: BoltTarget): void {
  gl.deleteFramebuffer(t.fbo);
  gl.deleteTexture(t.tex);
}

// Attributes match buildBoltTree's ribbon-vertex layout (see bolt.ts):
// position, tangent, signed half-width + fork level, BOLT_VERT_FLOATS floats
// per vertex.
const BOLT_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;   // sim-uv xy (z unused, always 0)
layout(location = 1) in vec3 aTan;   // unit tangent of the path at this vertex
layout(location = 2) in vec2 aShape; // x: signed half-width, y: fork level
uniform vec2 uLayerSize;  // the bolt layer's own size, in texels
uniform float uWidthPx;   // ribbon half-width scale, in layer texels
uniform float uStrength;  // this slot's strikeEnvelope value
out float vSide;
out float vStrength;

// Branches read thinner than the channel they left, the same idea as
// Storm's BOLT_VERT (there it also rides a user-facing "Bolt" setting;
// here the base is fixed since this layer has no such slider).
#define BOLT_BRANCH_BASE 0.35

void main() {
  vec2 px = uLayerSize;
  // The tangent is already in the layer's own identity-projected space, so
  // its screen (texel) direction is just itself scaled by the texel size —
  // no second projected point needed the way Storm derives one through a
  // camera.
  vec2 tanPx = aTan.xy * px;
  vec2 nrm = dot(tanPx, tanPx) > 1e-12 ? normalize(vec2(-tanPx.y, tanPx.x)) : vec2(1.0, 0.0);
  float fork = pow(max(BOLT_BRANCH_BASE, 1e-4), aShape.y);
  float halfPx = abs(aShape.x) * fork * uWidthPx;
  vSide = sign(aShape.x);
  vStrength = uStrength;
  gl_Position = vec4((aPos.xy + nrm * sign(aShape.x) * halfPx / px) * 2.0 - 1.0, 0.0, 1.0);
}
`;

// Storm's BOLT_FRAG profile: a white-hot core with a soft additive shoulder,
// both falling to nothing at the ribbon's edge (all the antialiasing a strip
// a few texels wide needs). `.r` carries the core, `.g` the glow, so the
// display pass in fluid.ts can tint the glow (the Sparkle colour) separately
// from the always-white core.
const BOLT_FRAG = `#version 300 es
precision highp float;
in float vSide;
in float vStrength;
out vec4 outColor;

void main() {
  float e = clamp(1.0 - abs(vSide), 0.0, 1.0);
  float glow = e * e;
  float core = pow(e, 8.0);
  outColor = vec4(core, glow, 0.0, 1.0) * vStrength;
}
`;

/** Wraps a `createBoltPool` with the GL side: a small render target, the
 *  ribbon program and its vertex buffer/VAO. `format` should be whatever
 *  `detectSimFormat` (fluidSim.ts) already decided for this context — the
 *  sim and the bolt layer share one answer so they either both get half-float
 *  precision or neither does. */
export function createFluidBolts(
  gl: WebGL2RenderingContext,
  w: number,
  h: number,
  format: SimFormat,
  rng: () => number = Math.random,
): FluidBolts {
  if (format === "half") {
    // detectSimFormat already requested this on the same context to decide
    // `format` in the first place; asking again is idempotent and covers a
    // caller (or test) that builds the bolt layer before the sim does.
    gl.getExtension("EXT_color_buffer_float") ?? gl.getExtension("EXT_color_buffer_half_float");
  }

  const pool = createBoltPool(rng);
  let target = createBoltTarget(gl, w, h, format);

  const prog = createProgram(gl, BOLT_FRAG, BOLT_VERT);
  const vao = gl.createVertexArray();
  if (!vao) throw new Error("fluidBolts: createVertexArray failed");
  const buf = gl.createBuffer();
  if (!buf) throw new Error("fluidBolts: createBuffer failed");
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, MAX_BOLTS * BOLT_RIBBON_VERTS * BOLT_VERT_FLOATS * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, BOLT_VERT_FLOATS * 4, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, BOLT_VERT_FLOATS * 4, 3 * 4);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 2, gl.FLOAT, false, BOLT_VERT_FLOATS * 4, 6 * 4);
  gl.bindVertexArray(null);

  const boltFloats = BOLT_RIBBON_VERTS * BOLT_VERT_FLOATS;

  return {
    ages: pool.ages,
    strengths: pool.strengths,
    strike: (ax, ay, bx, by, amp, force = false) => pool.strike(ax, ay, bx, by, amp, force),
    tick: (dtSec, afterglow, flicker) => pool.tick(dtSec, afterglow, flicker),
    draw(widthPx: number): void {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.viewport(0, 0, target.w, target.h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      // Only a slot that fired since the last draw re-uploads its tree.
      for (let i = 0; i < MAX_BOLTS; i++) {
        if (!pool.dirty[i]) continue;
        gl.bufferSubData(gl.ARRAY_BUFFER, i * boltFloats * 4, pool.paths.subarray(i * boltFloats, (i + 1) * boltFloats));
        pool.dirty[i] = 0;
      }

      prog.use();
      prog.setV2("uLayerSize", target.w, target.h);
      prog.setF("uWidthPx", widthPx);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      for (let i = 0; i < MAX_BOLTS; i++) {
        if (pool.strengths[i] <= 0.001) continue;
        prog.setF("uStrength", pool.strengths[i]);
        gl.drawArrays(gl.TRIANGLE_STRIP, i * BOLT_RIBBON_VERTS, BOLT_RIBBON_VERTS);
      }
      gl.disable(gl.BLEND);

      gl.bindVertexArray(null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    },
    texture: () => target.tex,
    resize(nw: number, nh: number): void {
      if (nw === target.w && nh === target.h) return;
      deleteBoltTarget(gl, target);
      target = createBoltTarget(gl, nw, nh, format);
    },
    dispose(): void {
      deleteBoltTarget(gl, target);
      gl.deleteBuffer(buf);
      gl.deleteVertexArray(vao);
      prog.dispose();
    },
  };
}
