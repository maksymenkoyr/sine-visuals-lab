import { NUM_BANDS } from "../audio/types.ts";
import type { FeatureFrame } from "../audio/types.ts";
import { createProgram, createFullscreenQuad, drawFullscreenQuad, type GLProgram } from "./gl.ts";
import { PALETTE_GLSL, type Palette } from "./palette.ts";
import type { SceneSetting } from "./sceneSettings.ts";
import { resolveSceneSetting } from "./autoTune.ts";
import type { Scene, SceneContext, Viewport } from "./scene.ts";
import type { AnimFrame } from "./animClock.ts";
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

/** Every declaration a fullscreen scene's fragment body can rely on: the
 *  common uniforms, one per setting, each drive setting's pair and helper,
 *  the scene's own `extraUniformDecls`, and the palette, room-UV and band
 *  helpers. Exported so a scene's second pass, a vertex shader included,
 *  declares exactly what the scene's program sees and takes the same values
 *  through beforeDraw's `upload`. */
export function sceneUniformsGlsl(settings: readonly SceneSetting[], extraUniformDecls = ""): string {
  const settingsUniformsGlsl = settings.map((s) => `uniform float ${settingUniformName(s.key)};`).join("\n");
  return `${COMMON_UNIFORMS_GLSL}
${settingsUniformsGlsl}
${DRIVE_GLSL(settings)}
${extraUniformDecls}
${PALETTE_GLSL}
${ROOM_UV_GLSL}
${SAMPLE_BANDS_GLSL}`;
}

// @per-frame
function setExtras(prog: GLProgram, extras: Record<string, ExtraUniformValue>): void {
  for (const name in extras) {
    const value = extras[name];
    if (value instanceof Float32Array) prog.setFv(name, value);
    else if (typeof value === "number") prog.setF(name, value);
    else prog.setV4v(name, value.vec4);
  }
}

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
    /** Passed through as the scene's own `Scene.panel` (scene.ts). */
    panel?: Scene["panel"];
    /** Extra GLSL uniform declarations this scene needs beyond
     *  COMMON_UNIFORMS_GLSL — for small per-scene arrays/values driven by
     *  JS-side state (a ripple pool, a scene-owned drift accumulator) that
     *  don't belong on every scene's common uniform set. */
    extraUniformDecls?: string;
    /** Called at the end of every init(), i.e. each time a host mounts the
     *  scene. `extraUniforms` closures live as long as the scene module, so
     *  state that should start over on a mount (an intro ramp's clock) is
     *  reset here. */
    onInit?: () => void;
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
       *  coupling reads `drives.value("driftPump", anim.lowPulse)`. Always
       *  present here (defaults to PASSTHROUGH_DRIVES when the scene itself
       *  wasn't given one), so an extraUniforms closure never has to guard
       *  against it being undefined. */
      drives: SceneDrives,
    ) => Record<string, ExtraUniformValue>;
    /** Called after every uniform is uploaded and just before the draw,
     *  with the program in use — for what a uniform can't carry, such as a
     *  data texture the scene fills itself (bind it here, creating it on the
     *  first call; scenes/chaikin/index.ts's seed texture is the example).
     *  `upload(other)` puts `other` in use and sets on it every uniform this
     *  draw set on `prog`, this frame's extras included, for a pass of the
     *  scene's own declared with sceneUniformsGlsl. A beforeDraw that calls
     *  it, or draws anything else, must put `prog` back in use (and any GL
     *  state it changed back as it was) before it returns. */
    beforeDraw?: (ctx: SceneContext, prog: GLProgram, viewport: Viewport, upload: (other: GLProgram) => void) => void;
    /** Called from dispose(), before the program is freed — release what
     *  beforeDraw created. */
    onDispose?: (ctx: SceneContext) => void;
  } = {},
): Scene {
  let prog: GLProgram | null = null;
  let vao: WebGLVertexArrayObject | null = null;
  const bandsBuf = new Float32Array(NUM_BANDS);
  const settings = opts.settings ?? [];
  const settingsByKey = new Map(settings.map((s) => [s.key, s]));

  const fragSrc = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
${sceneUniformsGlsl(settings, opts.extraUniformDecls)}
${fragBody}
`;

  const getSetting = (key: string): number => {
    const spec = settingsByKey.get(key);
    return spec ? resolveSceneSetting(id, spec) : 0;
  };

  // The draw in progress, for beforeDraw's `upload`: made once here, so a
  // frame doesn't build a closure over its own arguments.
  let drawCtx: SceneContext | null = null;
  let drawFrame: FeatureFrame | null = null;
  let drawViewport: Viewport | null = null;
  let drawPalette: Palette | null = null;
  let drawAnim: AnimFrame | null = null;
  let drawDrives: SceneDrives = PASSTHROUGH_DRIVES;
  let drawExtras: Record<string, ExtraUniformValue> | null = null;
  const upload = (other: GLProgram): void => {
    if (!drawCtx || !drawFrame || !drawViewport || !drawPalette || !drawAnim) return;
    other.use();
    uploadCommonUniforms(other, drawCtx, drawFrame, drawViewport, drawPalette, drawAnim, id, settings, bandsBuf, drawDrives);
    if (drawExtras) setExtras(other, drawExtras);
  };

  return {
    id,
    name,
    minQuality: opts.minQuality,
    settings: opts.settings,
    panel: opts.panel,

    init(ctx: SceneContext) {
      prog = createProgram(ctx.gl, fragSrc);
      vao = createFullscreenQuad(ctx.gl);
      opts.onInit?.();
    },

    render(ctx, frame, viewport, palette, anim, drives = PASSTHROUGH_DRIVES) {
      if (!prog || !vao) return;
      const { gl } = ctx;
      prog.use();
      uploadCommonUniforms(prog, ctx, frame, viewport, palette, anim, id, settings, bandsBuf, drives);
      const extras = opts.extraUniforms ? opts.extraUniforms(frame, anim, getSetting, drives) : null;
      if (extras) setExtras(prog, extras);
      if (opts.beforeDraw) {
        drawCtx = ctx;
        drawFrame = frame;
        drawViewport = viewport;
        drawPalette = palette;
        drawAnim = anim;
        drawDrives = drives;
        drawExtras = extras;
        opts.beforeDraw(ctx, prog, viewport, upload);
      }
      drawFullscreenQuad(gl, vao);
    },

    dispose(ctx: SceneContext) {
      opts.onDispose?.(ctx);
      prog?.dispose();
      if (vao) ctx.gl.deleteVertexArray(vao);
      prog = null;
      vao = null;
    },
  };
}
