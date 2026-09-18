// Shards — a close cluster of flat, extruded triangular plates on a star
// field that hard-cuts to a new arrangement on every beat. Built from the
// /ref measurement of a YouTube short (tools/.cache/refs/AcUcijyvpVc):
// layout.ts's header lists what was measured and which rule each part of
// this scene answers; glsl.ts owns the material.
//
// Sync: the cut rides anim.onset (the render-latched one-shot — never
// frame.onset, see renderLatch.ts). The reference reacts on every beat with
// no rank preference and our onset lands on 93 % of its beats, while our
// tempo lock never held its 161 bpm — so nothing here reads the beat clock
// unless the Cut mode is switched to Bars. Between cuts the plates extend
// along their axes (faster on bass) and the camera rolls clockwise.
//
// Draw: the ground pass and the depth-tested instanced prisms go into a
// full-res sharp target (with its own depth renderbuffer — an FBO has no
// depth of its own), a half-res two-pass blur makes the halo, and the
// composite adds them on the default framebuffer. At floor quality
// (bloomPasses 0) the same passes go straight to the default framebuffer.

import type { Scene, SceneContext } from "../../scene.ts";
import type { SceneSetting } from "../../sceneSettings.ts";
import { createProgram, createFullscreenQuad, drawFullscreenQuad, type GLProgram } from "../../gl.ts";
import {
  COMMON_UNIFORMS_GLSL,
  ROOM_UV_GLSL,
  settingUniformName,
  uploadCommonUniforms,
} from "../../sceneCommon.ts";
import { resolveSceneSetting } from "../../autoTune.ts";
import { NUM_BANDS } from "../../../audio/types.ts";
import {
  CUT_MODE_NAMES,
  MAX_SHARDS,
  PRISM_VERTS,
  advanceShards,
  cameraBasis,
  createShardState,
  packShards,
  minHoldSec,
  shouldCut,
  type AdvanceOptions,
  type ShardState,
} from "./layout.ts";
import { BLOOM_THRESHOLD, BLUR_FRAG, BLUR_STRIDE_X, BLUR_STRIDE_Y, bgFrag, compositeFrag, prismFrag, prismVert } from "./glsl.ts";

const ID = "shards";
/** Fixed so a headless shot of the same beats is the same cluster. */
const SEED = 0x5ca1ab1e;

const SETTINGS: SceneSetting[] = [
  {
    key: "density",
    label: "Density",
    description: "How many plates and spikes each arrangement gets",
    group: "Form",
    min: 0.3,
    max: 2,
    step: 0.05,
    default: 1,
    auto: { density: 0.3 },
  },
  {
    key: "spread",
    label: "Spread",
    description: "How far the cluster reaches from its centre — tight knot low, scattered high",
    group: "Form",
    min: 0.4,
    max: 2,
    step: 0.05,
    default: 1,
  },
  {
    key: "blades",
    label: "Blades",
    description: "Share of thin spikes among the small pieces, against chunky fragments",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.55,
  },
  {
    key: "cutMode",
    label: "Cut on",
    description:
      "What triggers a hard cut to a new arrangement. Every beat is what the reference does; Bass hits and Bars are for songs whose beat is too busy",
    group: "Motion",
    type: "enum",
    options: CUT_MODE_NAMES,
    min: 0,
    max: CUT_MODE_NAMES.length - 1,
    step: 1,
    default: 0,
    reads: ["feature.onset"],
  },
  {
    key: "extend",
    label: "Extend",
    description: "How fast the plates grow along their own length between cuts — bass pushes it",
    group: "Motion",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
    auto: { pulse: 0.25, loudness: 0.2 },
  },
  {
    key: "spin",
    label: "Spin",
    description: "How fast the whole view rolls between cuts",
    group: "Motion",
    min: 0,
    max: 3,
    step: 0.05,
    default: 1,
    auto: { tempo: 0.2 },
  },
  {
    key: "recolour",
    label: "Recolour",
    description: "How often a beat swaps a big plate's colour instead of the whole arrangement",
    group: "Motion",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
  },
  {
    key: "rim",
    label: "Rim",
    description: "Width of the bright line along every edge, in pixels",
    group: "Look",
    min: 0,
    max: 4,
    step: 0.1,
    default: 2,
  },
  {
    key: "edge",
    label: "Thickness",
    description: "How thick the plates are — the dark extruded side you see on the big ones",
    group: "Look",
    min: 0.3,
    max: 2.5,
    step: 0.05,
    default: 1,
  },
  {
    key: "stars",
    label: "Stars",
    description: "How many stars in the ground behind the cluster",
    group: "Look",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
  },
  {
    key: "distance",
    label: "Distance",
    description: "How close the camera sits — the cluster fills the frame low, breathes high",
    group: "Camera",
    min: 0.6,
    max: 1.6,
    step: 0.05,
    default: 1,
  },
  {
    key: "dolly",
    label: "Dolly",
    description: "How much the camera drifts back between cuts, so each new arrangement lands close and then recedes",
    group: "Camera",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
  },
  {
    key: "bloom",
    label: "Bloom",
    description: "The soft halo around the bright plates and rims",
    group: "Post",
    min: 0,
    max: 2,
    step: 0.05,
    default: 0.8,
    auto: { brightness: 0.2 },
  },
];

function settingFor(key: string): SceneSetting {
  const spec = SETTINGS.find((s) => s.key === key);
  if (!spec) throw new Error(`shards: unknown setting "${key}"`);
  return spec;
}

const settingsUniformsGlsl = SETTINGS.map((s) => `uniform float ${settingUniformName(s.key)};`).join("\n");

const BG_FRAG = bgFrag(COMMON_UNIFORMS_GLSL, settingsUniformsGlsl, ROOM_UV_GLSL);
const PRISM_VERT = prismVert(COMMON_UNIFORMS_GLSL, settingsUniformsGlsl);
const PRISM_FRAG = prismFrag(COMMON_UNIFORMS_GLSL, settingsUniformsGlsl);
const COMPOSITE_FRAG = compositeFrag(COMMON_UNIFORMS_GLSL, settingsUniformsGlsl);

export const shardsScene: Scene = (() => {
  let bgProg: GLProgram | null = null;
  let prismProg: GLProgram | null = null;
  let blurProg: GLProgram | null = null;
  let compositeProg: GLProgram | null = null;
  let quadVao: WebGLVertexArrayObject | null = null;
  let emptyVao: WebGLVertexArrayObject | null = null;
  // Full-res sharp target with depth, half-res blur pair.
  let sharpTex: WebGLTexture | null = null;
  let sharpFbo: WebGLFramebuffer | null = null;
  let depthRb: WebGLRenderbuffer | null = null;
  let blurTexA: WebGLTexture | null = null;
  let blurTexB: WebGLTexture | null = null;
  let blurFboA: WebGLFramebuffer | null = null;
  let blurFboB: WebGLFramebuffer | null = null;
  let sharpW = 0;
  let sharpH = 0;
  const samplerLocs = new Map<string, WebGLUniformLocation | null>();
  let state: ShardState | null = null;
  let prevBarPhase = 0;
  const bandsBuf = new Float32Array(NUM_BANDS);
  const shardA = new Float32Array(MAX_SHARDS * 4);
  const shardB = new Float32Array(MAX_SHARDS * 4);
  const shardC = new Float32Array(MAX_SHARDS * 4);
  const shardD = new Float32Array(MAX_SHARDS * 4);

  /** GLProgram has no integer setter; samplers need one (powder.ts idiom). */
  function samplerLoc(gl: WebGL2RenderingContext, prog: GLProgram, key: string, name: string) {
    let l = samplerLocs.get(key);
    if (l === undefined) {
      l = gl.getUniformLocation(prog.program, name);
      samplerLocs.set(key, l);
    }
    return l;
  }

  function makeTexture(gl: WebGL2RenderingContext, w: number, h: number): WebGLTexture | null {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  function attachColour(gl: WebGL2RenderingContext, tex: WebGLTexture | null, depth: WebGLRenderbuffer | null) {
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (depth) gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`shards: framebuffer incomplete (0x${status.toString(16)})`);
    }
    return f;
  }

  function freeTargets(gl: WebGL2RenderingContext): void {
    if (sharpFbo) gl.deleteFramebuffer(sharpFbo);
    if (blurFboA) gl.deleteFramebuffer(blurFboA);
    if (blurFboB) gl.deleteFramebuffer(blurFboB);
    if (sharpTex) gl.deleteTexture(sharpTex);
    if (blurTexA) gl.deleteTexture(blurTexA);
    if (blurTexB) gl.deleteTexture(blurTexB);
    if (depthRb) gl.deleteRenderbuffer(depthRb);
    sharpFbo = blurFboA = blurFboB = null;
    sharpTex = blurTexA = blurTexB = null;
    depthRb = null;
    sharpW = sharpH = 0;
  }

  /** Rebuilt whenever the drawing buffer changes size (the governor moves
   *  renderScale at runtime, so the size is compared every frame). */
  function ensureTargets(gl: WebGL2RenderingContext): void {
    const w = Math.max(1, gl.drawingBufferWidth);
    const h = Math.max(1, gl.drawingBufferHeight);
    if (w === sharpW && h === sharpH && sharpFbo) return;
    freeTargets(gl);
    sharpW = w;
    sharpH = h;
    sharpTex = makeTexture(gl, w, h);
    depthRb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depthRb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    sharpFbo = attachColour(gl, sharpTex, depthRb);
    const hw = Math.max(1, w >> 1);
    const hh = Math.max(1, h >> 1);
    blurTexA = makeTexture(gl, hw, hh);
    blurTexB = makeTexture(gl, hw, hh);
    blurFboA = attachColour(gl, blurTexA, null);
    blurFboB = attachColour(gl, blurTexB, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function options(detail: number, tempoLock: number, bpm: number): AdvanceOptions {
    return {
      density: resolveSceneSetting(ID, settingFor("density")),
      spread: resolveSceneSetting(ID, settingFor("spread")),
      blades: resolveSceneSetting(ID, settingFor("blades")),
      detail,
      extend: resolveSceneSetting(ID, settingFor("extend")),
      spin: resolveSceneSetting(ID, settingFor("spin")),
      dolly: resolveSceneSetting(ID, settingFor("dolly")),
      recolour: resolveSceneSetting(ID, settingFor("recolour")),
      minHold: minHoldSec(tempoLock, bpm),
    };
  }

  return {
    id: ID,
    name: "Shards",
    settings: SETTINGS,

    init(ctx: SceneContext) {
      const { gl } = ctx;
      bgProg = createProgram(gl, BG_FRAG);
      prismProg = createProgram(gl, PRISM_FRAG, PRISM_VERT);
      blurProg = createProgram(gl, BLUR_FRAG);
      compositeProg = createProgram(gl, COMPOSITE_FRAG);
      quadVao = createFullscreenQuad(gl);
      // No vertex attributes at all — corner from gl_VertexID, shard from
      // gl_InstanceID — so the prisms draw from an empty VAO (ambience.ts).
      emptyVao = gl.createVertexArray();
      samplerLocs.clear();
      state = createShardState(SEED, options(ctx.quality.detail, 0, 0));
      prevBarPhase = 0;
    },

    render(ctx, frame, viewport, palette, anim) {
      if (!bgProg || !prismProg || !blurProg || !compositeProg || !quadVao || !emptyVao || !state) return;
      const { gl } = ctx;

      // resolveSceneSetting (not getSceneSetting) everywhere — a raw read
      // would re-stomp an auto-tuned slider to manual (autoTune.ts).
      const opts = options(ctx.quality.detail, anim.tempoLock, frame.bpm);
      const barWrapped = anim.barPhase < prevBarPhase - 0.5;
      prevBarPhase = anim.barPhase;
      const cut = shouldCut(Math.round(resolveSceneSetting(ID, settingFor("cutMode"))), {
        onset: anim.onset,
        lowOnset: anim.lowOnset,
        barWrapped,
        tempoLock: anim.tempoLock,
      });
      advanceShards(state, anim.dtSec, cut, anim.low, opts);

      const distance = resolveSceneSetting(ID, settingFor("distance"));
      const cam = { ...state.camera, dist: state.camera.dist * distance };
      const basis = cameraBasis(cam);
      const count = packShards(state.shards, shardA, shardB, shardC, shardD);
      const aspect = (gl.drawingBufferWidth * viewport.w) / Math.max(1e-6, gl.drawingBufferHeight * viewport.h);

      const bloom = resolveSceneSetting(ID, settingFor("bloom"));
      const useBloom = ctx.quality.bloomPasses > 0 && bloom > 0.01;
      if (useBloom) ensureTargets(gl);
      gl.bindFramebuffer(gl.FRAMEBUFFER, useBloom ? sharpFbo : null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);

      // 1. Ground: opaque, covers the frame.
      gl.disable(gl.BLEND);
      gl.disable(gl.DEPTH_TEST);
      bgProg.use();
      uploadCommonUniforms(bgProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf);
      bgProg.setF("uRollBg", state.camera.roll);
      bgProg.setF("uAspect", aspect);
      drawFullscreenQuad(gl, quadVao);

      // 2. Prisms, depth-tested. Nothing else clears depth (gl.ts) — this
      // scene owns clearing its own each frame, and the clear honours
      // depthMask (meshGrid.ts).
      gl.depthMask(true);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.bindVertexArray(emptyVao);
      prismProg.use();
      uploadCommonUniforms(prismProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf);
      prismProg.setV4v("uShardA", shardA);
      prismProg.setV4v("uShardB", shardB);
      prismProg.setV4v("uShardC", shardC);
      prismProg.setV4v("uShardD", shardD);
      prismProg.setV3v("uCamPos", basis.pos);
      prismProg.setV3v("uCamRight", basis.right);
      prismProg.setV3v("uCamUp", basis.up);
      prismProg.setV3v("uCamFwd", basis.fwd);
      prismProg.setF("uAspect", aspect);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, PRISM_VERTS, count);
      gl.bindVertexArray(null);
      gl.disable(gl.DEPTH_TEST);

      if (useBloom) {
        // 3. Halo: full-res sharp → half-res A (horizontal) → B (vertical).
        const hw = Math.max(1, sharpW >> 1);
        const hh = Math.max(1, sharpH >> 1);
        blurProg.use();
        gl.activeTexture(gl.TEXTURE0);
        gl.uniform1i(samplerLoc(gl, blurProg, "blur.uTex", "uTex"), 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, blurFboA);
        gl.viewport(0, 0, hw, hh);
        gl.bindTexture(gl.TEXTURE_2D, sharpTex);
        blurProg.setV2("uBlurStep", BLUR_STRIDE_X / sharpW, 0);
        blurProg.setF("uThreshold", BLOOM_THRESHOLD);
        drawFullscreenQuad(gl, quadVao);
        gl.bindFramebuffer(gl.FRAMEBUFFER, blurFboB);
        gl.bindTexture(gl.TEXTURE_2D, blurTexA);
        blurProg.setV2("uBlurStep", 0, BLUR_STRIDE_Y / hh);
        blurProg.setF("uThreshold", 0);
        drawFullscreenQuad(gl, quadVao);

        // 4. Composite on the default framebuffer.
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        compositeProg.use();
        uploadCommonUniforms(compositeProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sharpTex);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, blurTexB);
        gl.uniform1i(samplerLoc(gl, compositeProg, "comp.uSharpTex", "uSharpTex"), 0);
        gl.uniform1i(samplerLoc(gl, compositeProg, "comp.uBlurTex", "uBlurTex"), 1);
        drawFullscreenQuad(gl, quadVao);
        gl.activeTexture(gl.TEXTURE0);
      }

      // The gallery renders every scene into one shared context each tick —
      // must not leak depth, blend or a bound VAO onto the next tile.
      gl.bindVertexArray(null);
      gl.depthMask(true);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ZERO);
    },

    dispose(ctx: SceneContext) {
      const { gl } = ctx;
      bgProg?.dispose();
      prismProg?.dispose();
      blurProg?.dispose();
      compositeProg?.dispose();
      if (quadVao) gl.deleteVertexArray(quadVao);
      if (emptyVao) gl.deleteVertexArray(emptyVao);
      freeTargets(gl);
      bgProg = prismProg = blurProg = compositeProg = null;
      quadVao = emptyVao = null;
      samplerLocs.clear();
      state = null;
    },
  };
})();
