import { NUM_BANDS } from "../audio/types.ts";
import type { FeatureFrame } from "../audio/types.ts";
import { createProgram, createFullscreenQuad, drawFullscreenQuad, type GLProgram } from "./gl.ts";
import { PALETTE_GLSL } from "./palette.ts";
import type { SceneSetting } from "./sceneSettings.ts";
import { resolveSceneSetting } from "./autoTune.ts";
import type { Scene, SceneContext } from "./scene.ts";
import type { AnimFrame } from "./animClock.ts";
import type { QualitySettings } from "./quality.ts";
import { PASSTHROUGH_DRIVES, type SceneDrives } from "./drives.ts";
import {
  COMMON_UNIFORMS_GLSL,
  DRIVE_GLSL,
  ROOM_UV_GLSL,
  SAMPLE_BANDS_GLSL,
  settingUniformName,
  uploadCommonUniforms,
} from "./sceneCommon.ts";

/** What a scene's `extraUniforms` may return per name — see the option's
 *  doc comment for which GL upload each shape maps to. */
export type ExtraUniformValue = number | Float32Array | { vec4: Float32Array };

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
     *  after the common/setting uniforms are bound. A bare Float32Array
     *  uploads via setFv (a `float[]`, same path as uBands); wrap it as
     *  `{ vec4: arr }` for a `vec4[]` (setV4v — four floats per element,
     *  which is how a packed transform array like dancers/rig.ts's bone
     *  list stays inside the fragment-uniform vector budget); everything
     *  else via setF. */
    extraUniforms?: (
      frame: FeatureFrame,
      anim: AnimFrame,
      getSetting: (key: string) => number,
      /** See Scene.render()'s own `drives` param (scene.ts) — a JS trigger
       *  reads `drives.fired("ripple", anim.lowOnset)`; a continuous JS
       *  coupling reads `drives.value("driftKick", anim.lowPulse)`. Always
       *  present here (defaults to PASSTHROUGH_DRIVES when the scene itself
       *  wasn't given one), so an extraUniforms closure never has to guard
       *  against it being undefined. */
      drives: SceneDrives,
    ) => Record<string, ExtraUniformValue>;
    /** An optional GPU simulation pass run once per render, before this
     *  scene's own uniforms are uploaded — a ping-pong height field, a
     *  sim-only program, its own FBOs — for a scene whose reactive layer
     *  needs real per-cell state (a stepped wave equation, a reaction-
     *  diffusion field) rather than something a shaped analytic formula in
     *  `extraUniforms` can carry. See rippleTank.ts for the first user.
     *  `init`/`dispose` run alongside this scene's own program/quad
     *  lifecycle. `step` may freely bind its own framebuffers, viewport and
     *  programs — it must not assume the display program or the default
     *  framebuffer/canvas viewport are still current when it returns, since
     *  the framework rebinds all three itself immediately afterwards, then
     *  uploads the common/setting/extra uniforms, then binds each texture
     *  `step` returned to its own consecutive texture unit with that
     *  record's key set as the matching `sampler2D` uniform (name, and
     *  therefore texture unit, are re-resolved by name every call, but the
     *  underlying `WebGLUniformLocation` is cached the same way
     *  `createProgram`'s own `loc()` caches one), unbinding them again after
     *  the draw. A scene declaring no `simulation` behaves bit-identically
     *  to one built before this option existed. */
    simulation?: {
      init(gl: WebGL2RenderingContext, quality: QualitySettings): void;
      step(
        gl: WebGL2RenderingContext,
        frame: FeatureFrame,
        anim: AnimFrame,
        getSetting: (key: string) => number,
        drives: SceneDrives,
      ): Record<string, WebGLTexture>;
      dispose(gl: WebGL2RenderingContext): void;
    };
  } = {},
): Scene {
  let prog: GLProgram | null = null;
  let vao: WebGLVertexArrayObject | null = null;
  const bandsBuf = new Float32Array(NUM_BANDS);
  const simSamplerLocs = new Map<string, WebGLUniformLocation | null>();
  const settings = opts.settings ?? [];
  const settingsByKey = new Map(settings.map((s) => [s.key, s]));

  const settingsUniformsGlsl = settings.map((s) => `uniform float ${settingUniformName(s.key)};`).join("\n");
  const driveUniformsGlsl = DRIVE_GLSL(settings);

  const fragSrc = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
${COMMON_UNIFORMS_GLSL}
${settingsUniformsGlsl}
${driveUniformsGlsl}
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
      opts.simulation?.init(ctx.gl, ctx.quality);
    },

    render(ctx, frame, viewport, palette, anim, drives = PASSTHROUGH_DRIVES) {
      if (!prog || !vao) return;
      const { gl } = ctx;

      // Run before any uniform upload — see the `simulation` option's own
      // doc comment above for the exact contract. `step` may leave the GL
      // state pointed at its own FBOs/program, so the display program and
      // the real target are rebound right after it returns, before this
      // scene's own uniforms (which assume `prog` is current) go up.
      let simTextures: Record<string, WebGLTexture> | null = null;
      if (opts.simulation) {
        simTextures = opts.simulation.step(gl, frame, anim, getSetting, drives);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      }

      prog.use();
      uploadCommonUniforms(prog, ctx, frame, viewport, palette, anim, id, settings, bandsBuf, drives);
      if (opts.extraUniforms) {
        const extras = opts.extraUniforms(frame, anim, getSetting, drives);
        for (const [name, value] of Object.entries(extras)) {
          if (value instanceof Float32Array) prog.setFv(name, value);
          else if (typeof value === "number") prog.setF(name, value);
          else prog.setV4v(name, value.vec4);
        }
      }

      if (simTextures) {
        let unit = 0;
        for (const [name, tex] of Object.entries(simTextures)) {
          let loc = simSamplerLocs.get(name);
          if (loc === undefined) {
            loc = gl.getUniformLocation(prog.program, name);
            simSamplerLocs.set(name, loc);
          }
          gl.activeTexture(gl.TEXTURE0 + unit);
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.uniform1i(loc, unit);
          unit++;
        }
      }

      drawFullscreenQuad(gl, vao);

      if (simTextures) {
        let unit = 0;
        for (const _ in simTextures) {
          gl.activeTexture(gl.TEXTURE0 + unit);
          gl.bindTexture(gl.TEXTURE_2D, null);
          unit++;
        }
        gl.activeTexture(gl.TEXTURE0);
      }
    },

    dispose(ctx: SceneContext) {
      opts.simulation?.dispose(ctx.gl);
      prog?.dispose();
      if (vao) ctx.gl.deleteVertexArray(vao);
      prog = null;
      vao = null;
    },
  };
}
