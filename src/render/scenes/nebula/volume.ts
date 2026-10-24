/**
 * Nebula's gas, baked once per mount into a `VOLUME_SIZE`³ RGBA8 3D texture
 * that repeats seamlessly on every axis (wrap REPEAT), so glsl.ts's march
 * reads a whole fbm with one hardware-filtered fetch instead of evaluating
 * noise octaves per step.
 *
 * The channels:
 * - R, the gas: gradient-noise fbm on lattices of `BASE_CELLS` cells per
 *   repeat. glsl.ts thresholds it into cloud and void, and reads it again
 *   at the detail's scale for its veins.
 * - G, detail: a finer fbm (`DETAIL_CELLS`) that glsl.ts reads at a higher
 *   frequency still, for the fine folds inside the cloud.
 * - B and A, the warp: two independent coarse fbms (`WARP_CELLS`) that bend
 *   the gas into the reference's combed, flowing filaments.
 *
 * Every lattice's cell count divides the texture's repeat, and the cell
 * index is masked into it before hashing (NOISE_HASH_GLSL's uhash), which is
 * what makes the volume tile. A lattice finer than `VOLUME_SIZE / 4` cells
 * aliases at this size, so no list may go past that.
 *
 * The bake draws one layer at a time into a framebuffer attached to the
 * texture, then puts back every piece of GL state it touched: it runs inside
 * the scene's render, after the host has set up the frame.
 */

import { createFullscreenQuad, createProgram, drawFullscreenQuad } from "../../gl.ts";
import { NOISE_HASH_GLSL } from "../../noiseHash.ts";

/** Texels per repeat on each axis: 8 MB of RGBA8. */
const VOLUME_SIZE = 128;

const BASE_CELLS = [4, 8, 16, 32];
const BASE_AMPS = [1, 0.45, 0.16, 0.06];
const DETAIL_CELLS = [8, 16, 32];
const DETAIL_AMPS = [1, 0.6, 0.35];
const WARP_CELLS = [2, 4, 8];
const WARP_AMPS = [1, 0.45, 0.2];
/** Stretches each fbm's narrow spread over more of the channel's 0..1. */
const CONTRAST = 1.15;

function fbmGlsl(name: string, cells: number[], amps: number[]): string {
  const total = amps.reduce((a, b) => a + b, 0);
  const terms = cells.map((c, k) => `${(amps[k] / total).toFixed(4)} * gnoise(p, ${c}, seed + ${k}u)`).join(" + ");
  return `float ${name}(vec3 p, uint seed) { return ${terms}; }`;
}

const BAKE_FRAG = `#version 300 es
precision highp float;
${NOISE_HASH_GLSL}
out vec4 outColor;
uniform float uLayer;

vec3 grad3(ivec3 c, int mask, uint seed) {
  c &= ivec3(mask);
  uint h = uhash(uint(c.x) ^ uhash(uint(c.y) ^ uhash(uint(c.z) ^ (seed * 0x9e3779b9u))));
  float a = float(h & 0xffffu) * (6.2831853 / 65536.0);
  float z = float(h >> 16u) * (2.0 / 65536.0) - 1.0;
  float r = sqrt(max(0.0, 1.0 - z * z));
  return vec3(r * cos(a), r * sin(a), z);
}

// Gradient noise on a lattice of 'cells' cells per repeat, p in repeats.
float gnoise(vec3 p, int cells, uint seed) {
  vec3 x = p * float(cells);
  ivec3 i = ivec3(floor(x));
  vec3 f = fract(x);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  int m = cells - 1;
  float n000 = dot(grad3(i, m, seed), f);
  float n100 = dot(grad3(i + ivec3(1, 0, 0), m, seed), f - vec3(1.0, 0.0, 0.0));
  float n010 = dot(grad3(i + ivec3(0, 1, 0), m, seed), f - vec3(0.0, 1.0, 0.0));
  float n110 = dot(grad3(i + ivec3(1, 1, 0), m, seed), f - vec3(1.0, 1.0, 0.0));
  float n001 = dot(grad3(i + ivec3(0, 0, 1), m, seed), f - vec3(0.0, 0.0, 1.0));
  float n101 = dot(grad3(i + ivec3(1, 0, 1), m, seed), f - vec3(1.0, 0.0, 1.0));
  float n011 = dot(grad3(i + ivec3(0, 1, 1), m, seed), f - vec3(0.0, 1.0, 1.0));
  float n111 = dot(grad3(i + ivec3(1, 1, 1), m, seed), f - vec3(1.0, 1.0, 1.0));
  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
             mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}

${fbmGlsl("baseFbm", BASE_CELLS, BASE_AMPS)}
${fbmGlsl("detailFbm", DETAIL_CELLS, DETAIL_AMPS)}
${fbmGlsl("warpFbm", WARP_CELLS, WARP_AMPS)}

void main() {
  vec3 p = vec3(gl_FragCoord.xy / ${VOLUME_SIZE.toFixed(1)}, uLayer);
  float k = ${CONTRAST.toFixed(3)};
  outColor = clamp(0.5 + k * vec4(baseFbm(p, 11u), detailFbm(p, 37u), warpFbm(p, 71u), warpFbm(p, 97u)), 0.0, 1.0);
}
`;

/** Bakes the gas volume into a new 3D texture and returns it, or null if the
 *  context can't make one. Leaves the framebuffer, viewport, blend, scissor
 *  and texture bindings as it found them; the caller re-binds its program. */
export function bakeVolume(gl: WebGL2RenderingContext): WebGLTexture | null {
  const tex = gl.createTexture();
  const fbo = gl.createFramebuffer();
  if (!tex || !fbo) return null;
  const prevFbo = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
  const prevViewport = gl.getParameter(gl.VIEWPORT) as Int32Array;
  const prevTex = gl.getParameter(gl.TEXTURE_BINDING_3D) as WebGLTexture | null;
  const blend = gl.isEnabled(gl.BLEND);
  const scissor = gl.isEnabled(gl.SCISSOR_TEST);

  gl.bindTexture(gl.TEXTURE_3D, tex);
  gl.texStorage3D(gl.TEXTURE_3D, 1, gl.RGBA8, VOLUME_SIZE, VOLUME_SIZE, VOLUME_SIZE);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.REPEAT);
  // A texture can't be sampled and rendered into at once; unbind it before attaching layers.
  gl.bindTexture(gl.TEXTURE_3D, prevTex);

  const prog = createProgram(gl, BAKE_FRAG);
  const vao = createFullscreenQuad(gl);
  gl.disable(gl.BLEND);
  gl.disable(gl.SCISSOR_TEST);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.viewport(0, 0, VOLUME_SIZE, VOLUME_SIZE);
  prog.use();
  let ok = true;
  for (let z = 0; z < VOLUME_SIZE; z++) {
    gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, tex, 0, z);
    if (z === 0 && gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      ok = false;
      break;
    }
    prog.setF("uLayer", (z + 0.5) / VOLUME_SIZE);
    drawFullscreenQuad(gl, vao);
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, prevFbo);
  gl.viewport(prevViewport[0], prevViewport[1], prevViewport[2], prevViewport[3]);
  if (blend) gl.enable(gl.BLEND);
  if (scissor) gl.enable(gl.SCISSOR_TEST);
  gl.deleteFramebuffer(fbo);
  gl.deleteVertexArray(vao);
  prog.dispose();
  if (!ok) {
    gl.deleteTexture(tex);
    return null;
  }
  return tex;
}
