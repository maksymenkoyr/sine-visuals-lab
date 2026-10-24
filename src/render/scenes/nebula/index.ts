/**
 * Nebula (in development): a slow flight through a glowing violet gas
 * cloud whose edges burn white-blue with a red-orange fringe outside them,
 * between dark voids full of stars. flight.ts moves the camera, volume.ts
 * bakes the gas, glsl.ts marches through it, stars.ts lays the stars over it.
 *
 * Three draws: the march runs into an offscreen target no taller than
 * `GAS_HEIGHT` for the quality preset, a full-resolution pass scales it up
 * with its glare, and the stars go on top as points. The gas is soft enough
 * to scale up; the march at full Retina resolution measured 112 ms a frame
 * on an M1 Pro.
 *
 * The look and the motion were measured from a silent Blender screensaver
 * (the `/ref` bundles `violet-filament` and `violet-loop`); nothing in it
 * reacts to sound, so every reaction here is this scene's own design: the
 * cloud glows brighter with the music's loudness (Glow), its edges flare on
 * hits (Flare), and the flight speeds up as a section builds (Surge).
 * docs/scenes/nebula.md has the record: the measurements, the decisions,
 * and what is still to tune.
 */

import { NUM_BANDS } from "../../../audio/types.ts";
import { resolveSceneSetting } from "../../autoTune.ts";
import {
  createColorTarget,
  createFullscreenQuad,
  createProgram,
  drawFullscreenQuad,
  type ColorTarget,
  type GLProgram,
} from "../../gl.ts";
import { PASSTHROUGH_DRIVES } from "../../drives.ts";
import { PALETTE_GLSL } from "../../palette.ts";
import type { QualityPreset } from "../../quality.ts";
import type { Scene, SceneContext } from "../../scene.ts";
import {
  COMMON_UNIFORMS_GLSL,
  DRIVE_GLSL,
  ROOM_UV_GLSL,
  settingUniformName,
  uploadCommonUniforms,
} from "../../sceneCommon.ts";
import type { SceneSetting } from "../../sceneSettings.ts";
import { advanceFlight, cameraUniforms, createFlight, hueWander, pathUniforms, type Flight } from "./flight.ts";
import { EXTRA_UNIFORMS, FOV_TAN, GAS_BODY, OUT_BODY, T_MAX } from "./glsl.ts";
import { buildStars, STAR_COUNT, STAR_FRAG, STAR_INSTANCES, starVert } from "./stars.ts";
import { bakeVolume } from "./volume.ts";

const ID = "nebula";
/** World units per second at Flight speed 1, matched to the reference's frame-to-frame change (docs/scenes/nebula.md). */
const BASE_SPEED = 0.22;
/** How fast the gas churns on its own, in radians per second of its churn clock. */
const CHURN_RATE = 0.05;
/** How much faster the flight runs at full drive at Surge 1. */
const SURGE_GAIN = 2.5;
/** The longest frame step that counts as flight; a stalled tab's gap is clamped to this. */
const MAX_DT_SEC = 0.25;
/** The gas target's height cap per quality preset, in pixels; its width follows the canvas's aspect. */
const GAS_HEIGHT: Record<QualityPreset, number> = { high: 540, mid: 432, low: 324, floor: 270 };

const SETTINGS: SceneSetting[] = [
  {
    key: "gas",
    label: "Gas",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.5,
    description: "How much of the view is cloud. Lower leaves more open space.",
  },
  {
    key: "stars",
    label: "Stars",
    group: "Form",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
    description: "How many stars shine between the clouds.",
  },
  {
    key: "speed",
    label: "Flight speed",
    group: "Motion",
    min: 0,
    max: 4,
    step: 0.05,
    default: 1,
    description: "How fast the camera flies through the cloud.",
  },
  {
    key: "spin",
    label: "Roll",
    group: "Motion",
    min: 0,
    max: 3,
    step: 0.05,
    default: 1,
    description: "How far the view rolls from side to side as it flies.",
  },
  {
    key: "surge",
    label: "Surge",
    group: "Motion",
    min: 0,
    max: 1.5,
    step: 0.05,
    default: 1,
    description: "How much faster the flight runs as the music builds.",
    drive: { default: "anim.sectionIntensity" },
  },
  {
    key: "glow",
    label: "Glow",
    group: "Look",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
    description: "How bright the cloud glows. It glows brighter as the music gets louder.",
    drive: { default: "anim.energy" },
  },
  {
    key: "flare",
    label: "Flare",
    group: "Look",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
    description: "How hard the cloud's edges flare white on each hit.",
    drive: { default: "anim.lowOnset" },
  },
  {
    key: "hue",
    label: "Colour turn",
    group: "Look",
    min: -180,
    max: 180,
    step: 5,
    default: 0,
    description: "Turns every colour around the colour wheel. 0 is violet and magenta.",
  },
  {
    key: "drift",
    label: "Colour drift",
    group: "Look",
    min: 0,
    max: 20,
    step: 0.5,
    default: 1,
    description: "How fast the colours wander around the colour wheel on their own. At 1 they take most of an hour.",
  },
];

const SETTINGS_BY_KEY = new Map(SETTINGS.map((s) => [s.key, s]));

function setting(key: string): number {
  const spec = SETTINGS_BY_KEY.get(key);
  return spec ? resolveSceneSetting(ID, spec) : 0;
}

function fragSource(body: string): string {
  return `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
${COMMON_UNIFORMS_GLSL}
${SETTINGS.map((s) => `uniform float ${settingUniformName(s.key)};`).join("\n")}
${DRIVE_GLSL(SETTINGS)}
${EXTRA_UNIFORMS}
${PALETTE_GLSL}
${ROOM_UV_GLSL}
${body}
`;
}

// This scene's gallery section and the day it was added (scenes/sceneModules.ts).
export const gallery = { stage: "development", added: "2026-10-21" } as const;

function createNebulaScene(): Scene {
  let gasProg: GLProgram | null = null;
  let outProg: GLProgram | null = null;
  let starProg: GLProgram | null = null;
  let vao: WebGLVertexArrayObject | null = null;
  let starVao: WebGLVertexArrayObject | null = null;
  let starBuf: WebGLBuffer | null = null;
  let target: ColorTarget | null = null;
  // Baked once per mount; a bake that failed isn't retried every frame.
  let volume: WebGLTexture | null = null;
  let baked = false;
  let flight: Flight = createFlight();
  const cam = new Float32Array(16);
  const path = new Float32Array(8);
  const bandsBuf = new Float32Array(NUM_BANDS);

  function sizedTarget(gl: WebGL2RenderingContext, preset: QualityPreset): ColorTarget {
    const fullW = gl.drawingBufferWidth;
    const fullH = gl.drawingBufferHeight;
    const h = Math.max(1, Math.min(fullH, GAS_HEIGHT[preset]));
    const w = Math.max(1, Math.round((fullW * h) / fullH));
    if (target && target.w === w && target.h === h) return target;
    freeTarget(gl);
    target = createColorTarget(gl, w, h, { label: ID, minFilter: gl.LINEAR_MIPMAP_LINEAR, mipmap: true });
    return target;
  }

  function freeTarget(gl: WebGL2RenderingContext): void {
    if (!target) return;
    gl.deleteFramebuffer(target.fbo);
    gl.deleteTexture(target.tex);
    target = null;
  }

  return {
    id: ID,
    name: "Nebula",
    settings: SETTINGS,

    init(ctx: SceneContext) {
      const { gl } = ctx;
      gasProg = createProgram(gl, fragSource(GAS_BODY));
      outProg = createProgram(gl, fragSource(OUT_BODY));
      starProg = createProgram(gl, STAR_FRAG, starVert(FOV_TAN, T_MAX));
      vao = createFullscreenQuad(gl);
      starVao = gl.createVertexArray();
      starBuf = gl.createBuffer();
      gl.bindVertexArray(starVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, starBuf);
      gl.bufferData(gl.ARRAY_BUFFER, buildStars(), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
      flight = createFlight();
      baked = false;
    },

    render(ctx, frame, viewport, palette, anim, drives = PASSTHROUGH_DRIVES) {
      if (!gasProg || !outProg || !starProg || !vao || !starVao) return;
      const { gl } = ctx;
      if (!baked) {
        volume = bakeVolume(gl);
        baked = true;
      }
      const dt = Math.min(Math.max(anim.dtSec, 0), MAX_DT_SEC);
      gasProg.use();
      uploadCommonUniforms(gasProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf, drives);
      const surge = 1 + SURGE_GAIN * setting("surge") * drives.value("surge", anim.sectionIntensity);
      advanceFlight(flight, dt, BASE_SPEED * setting("speed") * surge, setting("drift"), CHURN_RATE);
      cameraUniforms(flight, setting("spin"), cam);
      pathUniforms(flight, path);
      const hueDrift = hueWander(flight);

      const tgt = sizedTarget(gl, ctx.quality.preset);
      gl.bindFramebuffer(gl.FRAMEBUFFER, tgt.fbo);
      gl.viewport(0, 0, tgt.w, tgt.h);
      gasProg.setV2("uResolution", tgt.w, tgt.h);
      gasProg.setV4v("uCam", cam);
      gasProg.setV4v("uPath", path);
      gasProg.setF("uHueDrift", hueDrift);
      gasProg.setF("uChurn", flight.churn);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_3D, volume);
      gasProg.setI("uVol", 0);
      drawFullscreenQuad(gl, vao);
      gl.bindTexture(gl.TEXTURE_3D, null);
      // OUT_BODY's glare reads the gas through its mip chain.
      gl.bindTexture(gl.TEXTURE_2D, tgt.tex);
      gl.generateMipmap(gl.TEXTURE_2D);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      outProg.use();
      uploadCommonUniforms(outProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf, drives);
      gl.bindTexture(gl.TEXTURE_2D, tgt.tex);
      outProg.setI("uGasTex", 0);
      drawFullscreenQuad(gl, vao);

      if (setting("stars") > 0) {
        starProg.use();
        starProg.setV4v("uCam", cam);
        starProg.setV2("uResolution", gl.drawingBufferWidth, gl.drawingBufferHeight);
        starProg.setV4("uViewport", viewport.x, viewport.y, viewport.w, viewport.h);
        starProg.setF("uStars", setting("stars"));
        starProg.setI("uGasTex", 0);
        // Screen blend: a star brightens the gas under it without clipping it to white.
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE_MINUS_DST_COLOR, gl.ONE);
        gl.bindVertexArray(starVao);
        gl.drawArraysInstanced(gl.POINTS, 0, STAR_COUNT, STAR_INSTANCES);
        gl.bindVertexArray(null);
        gl.disable(gl.BLEND);
      }
      // The gallery renders every scene into one shared context each tick: leave nothing bound.
      gl.bindTexture(gl.TEXTURE_2D, null);
    },

    dispose(ctx: SceneContext) {
      const { gl } = ctx;
      freeTarget(gl);
      if (volume) gl.deleteTexture(volume);
      volume = null;
      baked = false;
      gasProg?.dispose();
      outProg?.dispose();
      starProg?.dispose();
      if (vao) gl.deleteVertexArray(vao);
      if (starVao) gl.deleteVertexArray(starVao);
      if (starBuf) gl.deleteBuffer(starBuf);
      gasProg = null;
      outProg = null;
      starProg = null;
      vao = null;
      starVao = null;
      starBuf = null;
    },
  };
}

export const nebulaScene = createNebulaScene();
