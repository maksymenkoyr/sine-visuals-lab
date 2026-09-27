// TEMPORARY prototype — spatial re-sort of agent storage order. Never commit as-is.
import { createProgram, drawFullscreenQuad, type GLProgram } from "../gl.ts";

const GATHER_FRAG = `#version 300 es
precision highp float;
precision highp usampler2D;
in vec2 vUv;
layout(location = 0) out vec4 outPos;
layout(location = 1) out vec4 outDir;
uniform usampler2D uPerm;
uniform sampler2D uAgentPos;
uniform sampler2D uAgentDir;
uniform float uAgentSide;
void main() {
  ivec2 t = ivec2(gl_FragCoord.xy);
  int src = int(texelFetch(uPerm, t, 0).r);
  int side = int(uAgentSide);
  ivec2 s = ivec2(src % side, src / side);
  outPos = texelFetch(uAgentPos, s, 0);
  outDir = texelFetch(uAgentDir, s, 0);
}
`;

const GRID_BITS = 7; // 128x128 cells
function part1by1(v: number): number {
  v &= 0xff;
  v = (v | (v << 4)) & 0x0f0f;
  v = (v | (v << 2)) & 0x3333;
  v = (v | (v << 1)) & 0x5555;
  return v;
}

export function createSorter(gl: WebGL2RenderingContext, side: number, count: number) {
  const prog: GLProgram = createProgram(gl, GATHER_FRAG);
  const total = side * side;
  const bytes = new Uint8Array(total * 4);
  const keys = new Uint16Array(count);
  const buckets = new Uint32Array(1 << (GRID_BITS * 2));
  const perm = new Uint32Array(total);
  const permTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, permTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R32UI, side, side);
  const shift = 16 - GRID_BITS;
  let lastCpuMs = 0;

  function sort(fbo: WebGLFramebuffer, posTex: WebGLTexture, dirTex: WebGLTexture, writeFbo: WebGLFramebuffer, quadVao: WebGLVertexArrayObject) {
    const t0 = performance.now();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(0, 0, side, side, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    buckets.fill(0);
    for (let i = 0; i < count; i++) {
      const o = i * 4;
      const x = ((bytes[o] << 8) | bytes[o + 1]) >> shift;
      const y = ((bytes[o + 2] << 8) | bytes[o + 3]) >> shift;
      const k = part1by1(x) | (part1by1(y) << 1);
      keys[i] = k;
      buckets[k]++;
    }
    let run = 0;
    for (let b = 0; b < buckets.length; b++) {
      const c = buckets[b];
      buckets[b] = run;
      run += c;
    }
    for (let i = 0; i < count; i++) perm[buckets[keys[i]]++] = i;
    for (let i = count; i < total; i++) perm[i] = i;
    gl.bindTexture(gl.TEXTURE_2D, permTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, side, side, gl.RED_INTEGER, gl.UNSIGNED_INT, perm);
    lastCpuMs = performance.now() - t0;

    gl.bindFramebuffer(gl.FRAMEBUFFER, writeFbo);
    gl.viewport(0, 0, side, side);
    prog.use();
    prog.setF("uAgentSide", side);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, permTex);
    gl.uniform1i(gl.getUniformLocation(prog.program, "uPerm"), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, posTex);
    gl.uniform1i(gl.getUniformLocation(prog.program, "uAgentPos"), 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, dirTex);
    gl.uniform1i(gl.getUniformLocation(prog.program, "uAgentDir"), 2);
    drawFullscreenQuad(gl, quadVao);
    (globalThis as unknown as { __p2sortMs?: number }).__p2sortMs = lastCpuMs;
  }
  return { sort };
}
