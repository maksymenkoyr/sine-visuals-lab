import { NUM_BANDS } from "../audio/types.ts";
import type { FeatureFrame } from "../audio/types.ts";
import { createProgram, createFullscreenQuad, drawFullscreenQuad, type GLProgram } from "./gl.ts";
import { PALETTE_GLSL } from "./palette.ts";
import type { SceneSetting } from "./sceneSettings.ts";
import { resolveSceneSetting } from "./autoTune.ts";
import type { Scene, SceneContext } from "./scene.ts";
import type { AnimFrame } from "./animClock.ts";
import {
  COMMON_UNIFORMS_GLSL,
  ROOM_UV_GLSL,
  SAMPLE_BANDS_GLSL,
  settingUniformName,
  uploadCommonUniforms,
} from "./sceneCommon.ts";

/**
 * Builds a Scene from just a fragment shader body. The body must assign
 * `outColor` and may use: vUv, roomUv(), palette(), and everything in
 * COMMON_UNIFORMS_GLSL (see sceneCommon.ts).
 */
export function createFullscreenScene(
  id: string,
  name: string,
  fragBody: string,
  opts: {
    minQuality?: Scene["minQuality"];
    settings?: SceneSetting[];
    /** Extra GLSL uniform declarations this scene needs beyond
     *  COMMON_UNIFORMS_GLSL — for small per-scene arrays/values driven by
     *  JS-side state (a ripple pool, a scene-owned drift accumulator) that
     *  don't belong on every scene's common uniform set. */
    extraUniformDecls?: string;
    /** Computes this frame's extra uniform values, called once per render
     *  after the common/setting uniforms are bound. Array values upload via
     *  setFv (same path as uBands); everything else via setF. */
    extraUniforms?: (
      frame: FeatureFrame,
      anim: AnimFrame,
      getSetting: (key: string) => number,
    ) => Record<string, number | Float32Array>;
  } = {},
): Scene {
  let prog: GLProgram | null = null;
  let vao: WebGLVertexArrayObject | null = null;
  const bandsBuf = new Float32Array(NUM_BANDS);
  const settings = opts.settings ?? [];
  const settingsByKey = new Map(settings.map((s) => [s.key, s]));

  const settingsUniformsGlsl = settings.map((s) => `uniform float ${settingUniformName(s.key)};`).join("\n");

  const fragSrc = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
${COMMON_UNIFORMS_GLSL}
${settingsUniformsGlsl}
${opts.extraUniformDecls ?? ""}
${PALETTE_GLSL}
${ROOM_UV_GLSL}
${SAMPLE_BANDS_GLSL}
${fragBody}
`;

  const getSetting = (key: string): number => {
    const spec = settingsByKey.get(key);
    return spec ? resolveSceneSetting(id, spec) : 0;
  };

  return {
    id,
    name,
    minQuality: opts.minQuality,
    settings: opts.settings,

    init(ctx: SceneContext) {
      prog = createProgram(ctx.gl, fragSrc);
      vao = createFullscreenQuad(ctx.gl);
    },

    render(ctx, frame, viewport, palette, anim) {
      if (!prog || !vao) return;
      const { gl } = ctx;
      prog.use();
      uploadCommonUniforms(prog, ctx, frame, viewport, palette, anim, id, settings, bandsBuf);
      if (opts.extraUniforms) {
        const extras = opts.extraUniforms(frame, anim, getSetting);
        for (const [name, value] of Object.entries(extras)) {
          if (value instanceof Float32Array) prog.setFv(name, value);
          else prog.setF(name, value);
        }
      }
      drawFullscreenQuad(gl, vao);
    },

    dispose(ctx: SceneContext) {
      prog?.dispose();
      if (vao) ctx.gl.deleteVertexArray(vao);
      prog = null;
      vao = null;
    },
  };
}
