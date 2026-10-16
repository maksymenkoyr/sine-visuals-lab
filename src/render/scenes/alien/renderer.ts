/**
 * The alien drawn live: the skinned wireframe mesh (mesh.ts, glsl.ts) through
 * one loop's camera, with bloom. The scene itself no longer draws this — it
 * plays videos baked from it (index.ts) — so this runs only on the bake page
 * (bakePage.ts, driven by tools/alien-bake.mjs), which renders every frame of
 * every loop and hands them to ffmpeg.
 *
 * Passes (the Gates pattern): the mesh into a sharp target with its own depth
 * buffer, two blur levels for the bloom, then a composite to the drawing
 * buffer.
 */
import { createProgram, createFullscreenQuad, drawFullscreenQuad, type GLProgram } from "../../gl.ts";
import { BONE_COUNT, CH_LIFT, createRigWorld, forwardKinematics, groundToFloor, quatConjugate, quatMul, quatRotate, type Pose } from "../dancers/rig.ts";
import { alienMesh, MAX_INFLUENCES } from "./mesh.ts";
import type { LoopCamera } from "./reel.ts";
import { BLUR_FRAG, BLUR_STRIDE, COMPOSITE_FRAG, MESH_FRAG, MESH_VERT } from "./glsl.ts";

/** Bloom gains for the two blur levels. */
const GLOW_A_GAIN = 0.55;
const GLOW_B_GAIN = 1.1;

const scratchInv = new Float32Array(4);
const scratchQ = new Float32Array(4);
const scratchMoved = new Float32Array(3);

/** Per-bone skin transform for MESH_VERT: the rotation and translation that
 *  take a bind-pose point to where the bone carries it now. */
export function packSkin(bindPos: Float32Array, bindRot: Float32Array, pos: Float32Array, rot: Float32Array, out: Float32Array): void {
  const inv = scratchInv, q = scratchQ, moved = scratchMoved;
  for (let b = 0; b < BONE_COUNT; b++) {
    quatConjugate(bindRot, b * 4, inv, 0);
    quatMul(rot, b * 4, inv, 0, q, 0);
    quatRotate(q, 0, bindPos[b * 3], bindPos[b * 3 + 1], bindPos[b * 3 + 2], moved, 0);
    out.set(q, b * 8);
    out[b * 8 + 4] = pos[b * 3] - moved[0];
    out[b * 8 + 5] = pos[b * 3 + 1] - moved[1];
    out[b * 8 + 6] = pos[b * 3 + 2] - moved[2];
    out[b * 8 + 7] = 0;
  }
}

/** A loop camera's view basis: forward, right and up, unit length. */
export function cameraBasis(cam: LoopCamera): { fwd: number[]; right: number[]; up: number[]; dist: number } {
  const fx = cam.target[0] - cam.eye[0], fy = cam.target[1] - cam.eye[1], fz = cam.target[2] - cam.eye[2];
  const dist = Math.hypot(fx, fy, fz);
  const fwd = [fx / dist, fy / dist, fz / dist];
  const rl = Math.hypot(fwd[2], fwd[0]) || 1;
  const right = [-fwd[2] / rl, 0, fwd[0] / rl];
  const up = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0]];
  return { fwd, right, up, dist };
}

/** Where world point `p` lands in a frame of `aspect` through `cam`, as
 *  0..1 picture coordinates (y up) — what MESH_VERT computes for a vertex. */
export function projectToFrame(cam: LoopCamera, aspect: number, p: readonly number[]): [number, number] {
  const { fwd, right, up } = cameraBasis(cam);
  const rel = [p[0] - cam.eye[0], p[1] - cam.eye[1], p[2] - cam.eye[2]];
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const z = dot(rel, fwd);
  return [((dot(rel, right) * cam.focal) / aspect / z) * 0.5 + 0.5, ((dot(rel, up) * cam.focal) / z) * 0.5 + 0.5];
}

export interface AlienRenderer {
  /** Draws `pose` through `cam` to the drawing buffer, filling it. */
  draw(pose: Pose, cam: LoopCamera, bloomPasses: number): void;
  dispose(): void;
}

export function createAlienRenderer(gl: WebGL2RenderingContext): AlienRenderer {
  const meshProg: GLProgram = createProgram(gl, MESH_FRAG, MESH_VERT);
  const blurProg: GLProgram = createProgram(gl, BLUR_FRAG);
  const compProg: GLProgram = createProgram(gl, COMPOSITE_FRAG);
  const quadVao = createFullscreenQuad(gl);
  const mesh = alienMesh();
  const meshBufs: WebGLBuffer[] = [];
  const world = createRigWorld();
  const skin = new Float32Array(BONE_COUNT * 8);

  const meshVao = gl.createVertexArray();
  gl.bindVertexArray(meshVao);
  const attrib = (loc: number, data: ArrayBufferView, size: number, type: number, normalized: boolean): void => {
    const buf = gl.createBuffer()!;
    meshBufs.push(buf);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, type, normalized, 0, 0);
  };
  attrib(0, mesh.position, 3, gl.FLOAT, false);
  attrib(1, mesh.normal, 3, gl.FLOAT, false);
  attrib(2, mesh.bones, MAX_INFLUENCES, gl.UNSIGNED_BYTE, false);
  attrib(3, mesh.weights, MAX_INFLUENCES, gl.UNSIGNED_BYTE, true);
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  const vertexCount = mesh.triCount * 3;

  // Render targets: the sharp mesh (with depth) at full size, two blur levels.
  let sharpTex: WebGLTexture | null = null;
  let sharpDepth: WebGLRenderbuffer | null = null;
  let sharpFbo: WebGLFramebuffer | null = null;
  const levelTex: (WebGLTexture | null)[] = [null, null, null, null];
  const levelFbo: (WebGLFramebuffer | null)[] = [null, null, null, null];
  let sharpW = 0;
  let sharpH = 0;
  const levelW = [0, 0];
  const levelH = [0, 0];

  function makeTexture(w: number, h: number): WebGLTexture | null {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  function attach(tex: WebGLTexture | null, depth: WebGLRenderbuffer | null = null): WebGLFramebuffer | null {
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (depth) gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`alien: framebuffer incomplete (0x${status.toString(16)})`);
    return fbo;
  }

  function freeTargets(): void {
    if (sharpFbo) gl.deleteFramebuffer(sharpFbo);
    if (sharpTex) gl.deleteTexture(sharpTex);
    if (sharpDepth) gl.deleteRenderbuffer(sharpDepth);
    sharpFbo = null;
    sharpTex = null;
    sharpDepth = null;
    for (let i = 0; i < 4; i++) {
      if (levelFbo[i]) gl.deleteFramebuffer(levelFbo[i]);
      if (levelTex[i]) gl.deleteTexture(levelTex[i]);
      levelFbo[i] = null;
      levelTex[i] = null;
    }
    sharpW = 0;
    sharpH = 0;
  }

  /** Rebuilds the targets when the drawing buffer changes size. */
  function ensureTargets(): void {
    const w = Math.max(1, gl.drawingBufferWidth);
    const h = Math.max(1, gl.drawingBufferHeight);
    if (w === sharpW && h === sharpH && sharpFbo) return;
    freeTargets();
    sharpTex = makeTexture(w, h);
    sharpDepth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, sharpDepth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    sharpFbo = attach(sharpTex, sharpDepth);
    for (let level = 0; level < 2; level++) {
      const shift = level + 2;
      levelW[level] = Math.max(1, w >> shift);
      levelH[level] = Math.max(1, h >> shift);
      for (let j = 0; j < 2; j++) {
        const i = level * 2 + j;
        levelTex[i] = makeTexture(levelW[level], levelH[level]);
        levelFbo[i] = attach(levelTex[i]);
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    sharpW = w;
    sharpH = h;
  }

  /** One separable blur: src -> level's A (horizontal) -> level's B. */
  function blurLevel(level: number, src: WebGLTexture | null): void {
    gl.viewport(0, 0, levelW[level], levelH[level]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, levelFbo[level * 2]);
    gl.bindTexture(gl.TEXTURE_2D, src);
    blurProg.setV2("uBlurStep", BLUR_STRIDE / levelW[level], 0);
    drawFullscreenQuad(gl, quadVao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, levelFbo[level * 2 + 1]);
    gl.bindTexture(gl.TEXTURE_2D, levelTex[level * 2]);
    blurProg.setV2("uBlurStep", 0, BLUR_STRIDE / levelH[level]);
    drawFullscreenQuad(gl, quadVao);
  }

  return {
    draw(pose, cam, bloomPasses) {
      ensureTargets();
      forwardKinematics(pose, world);
      groundToFloor(world, pose[CH_LIFT]);
      packSkin(mesh.bind.pos, mesh.bind.rot, world.pos, world.rot, skin);
      const { fwd, right, up, dist } = cameraBasis(cam);

      // 1. The mesh, into the sharp target.
      gl.bindFramebuffer(gl.FRAMEBUFFER, sharpFbo);
      gl.viewport(0, 0, sharpW, sharpH);
      gl.clearColor(0, 0, 0, 1);
      gl.clearDepth(1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LESS);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      gl.disable(gl.BLEND);
      meshProg.use();
      meshProg.setV2("uResolution", gl.drawingBufferWidth, gl.drawingBufferHeight);
      meshProg.setV4("uViewport", 0, 0, 1, 1);
      meshProg.setV4v("uSkin", skin);
      meshProg.setV3v("uEye", cam.eye as unknown as number[]);
      meshProg.setV3v("uRight", right);
      meshProg.setV3v("uUp", up);
      meshProg.setV3v("uFwd", fwd);
      meshProg.setF("uFocal", cam.focal);
      meshProg.setF("uDepthMid", dist);
      gl.bindVertexArray(meshVao);
      gl.drawArrays(gl.TRIANGLES, 0, vertexCount);
      gl.bindVertexArray(null);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.DEPTH_TEST);

      // 2. Bloom levels.
      gl.activeTexture(gl.TEXTURE0);
      if (bloomPasses >= 1) {
        blurProg.use();
        blurProg.setI("uTex", 0);
        blurLevel(0, sharpTex);
        if (bloomPasses >= 2) blurLevel(1, levelTex[1]);
      }

      // 3. Composite, opaque, to the drawing buffer.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      compProg.use();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sharpTex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, levelTex[1]);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, levelTex[3]);
      compProg.setI("uSharpTex", 0);
      compProg.setI("uGlowATex", 1);
      compProg.setI("uGlowBTex", 2);
      compProg.setF("uGlowAGain", bloomPasses >= 1 ? GLOW_A_GAIN : 0);
      compProg.setF("uGlowBGain", bloomPasses >= 2 ? GLOW_B_GAIN : 0);
      drawFullscreenQuad(gl, quadVao);
      for (let unit = 2; unit >= 0; unit--) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, null);
      }
    },

    dispose() {
      meshProg.dispose();
      blurProg.dispose();
      compProg.dispose();
      gl.deleteVertexArray(quadVao);
      gl.deleteVertexArray(meshVao);
      for (const b of meshBufs) gl.deleteBuffer(b);
      freeTargets();
    },
  };
}
