// Oil Drops: saturated oil drops floating on glitter paint, the way the oil-
// on-paint clips of abstract liquid videos look, built from measurements of
// two such clips (docs/scenes/oildrops.md: counts, sizes, shading per colour
// family, how drops move and how rarely they merge). The population lives on
// the CPU (drops.ts), the paint and the drops are two GPU passes (glsl.ts):
// the paint fullscreen, then one instanced quad per drop, biggest first,
// blended over it.
//
// Music, each on its drive: Rush (loudness) speeds the sheet everything
// rides, from the quiet clip's creep to the sweeping clip's pace; Swirl
// (bass) stirs the eddies up; Shove (a kick) jolts every drop, the small ones
// most; Pour (a drop in the music) sets a cluster of new drops down that
// grow and push their neighbours aside; Glitter (treble) sets more of the
// paint's flakes flashing. With no music the sheet still drifts and turns at
// Drift's pace, the way the paint in the clips never quite stands still.
import { createProgram, createFullscreenQuad, drawFullscreenQuad, type GLProgram } from "../../gl.ts";
import { PALETTE_GLSL } from "../../palette.ts";
import { NUM_BANDS } from "../../../audio/types.ts";
import { resolveSceneSetting } from "../../autoTune.ts";
import { PASSTHROUGH_DRIVES } from "../../drives.ts";
import { wrapFlow } from "../../noiseHash.ts";
import type { Scene, SceneContext } from "../../scene.ts";
import { COMMON_UNIFORMS_GLSL, DRIVE_GLSL, ROOM_UV_GLSL, SAMPLE_BANDS_GLSL, settingUniformName, uploadCommonUniforms } from "../../sceneCommon.ts";
import type { SceneSetting } from "../../sceneSettings.ts";
import { levelOf } from "../../signals.ts";
import { card } from "./card.ts";
import { createDropSim, DROP_FLOATS, dropCount, driftSpeed, eddyScale, MAX_DROPS, packDrops, stepDrops, type DropSim, type StepParams } from "./drops.ts";
import { BOIL_OCTAVE_GROWTH, BOIL_RATE, BOIL_STAGGER, DROP_FRAG, DROP_VERT, FAMILY_RGB, FAMILY_SHADING, PAINT_FRAG, PAINT_FREQ, PAINT_LACUNARITY, PAINT_OCTAVES, PAINT_RGB } from "./glsl.ts";

const ID = card.id;
const SETTINGS: SceneSetting[] = card.settings ?? [];
const settingsByKey = new Map(SETTINGS.map((s) => [s.key, s]));
const settingFor = (key: string): SceneSetting => {
  const s = settingsByKey.get(key);
  if (!s) throw new Error(`oildrops: no setting ${key}`);
  return s;
};

/** How much a full Glitter reading on a full Glitter setting lifts the
 *  flashing over what the slider alone gives (GLITTER_REST). */
export const GLITTER_REST = 0.45;
export const GLITTER_GAIN = 0.9;

/** The paint's glitter amount: the slider's own share plus the treble lift,
 *  so an unplugged jack leaves the slider in charge. */
export function glitterAmount(glitter: number, reading: number): number {
  return Math.max(0, glitter) * (GLITTER_REST + GLITTER_GAIN * Math.max(0, Math.min(1, reading)));
}

/** Each paint octave's slide offset in its own lattice, wrapped
 *  (noiseHash.ts): the sheet's translation times the octave's frequency. */
export function paintDrifts(paintX: number, paintY: number, out: Float32Array = new Float32Array(PAINT_OCTAVES * 2)): Float32Array {
  let freq = PAINT_FREQ;
  for (let k = 0; k < PAINT_OCTAVES; k++) {
    out[k * 2] = wrapFlow(paintX * freq);
    out[k * 2 + 1] = wrapFlow(paintY * freq);
    freq *= PAINT_LACUNARITY;
  }
  return out;
}

/** Each octave's depth along the paint's time axis, wrapped. */
export function boilDepths(timeSec: number, out: Float32Array = new Float32Array(PAINT_OCTAVES)): Float32Array {
  let rate = BOIL_RATE;
  for (let k = 0; k < PAINT_OCTAVES; k++) {
    out[k] = wrapFlow(timeSec * rate + k * BOIL_STAGGER);
    rate *= BOIL_OCTAVE_GROWTH;
  }
  return out;
}

const settingsUniformsGlsl = SETTINGS.map((s) => `uniform float ${settingUniformName(s.key)};`).join("\n");
const driveUniformsGlsl = DRIVE_GLSL(SETTINGS);
const COMMON_BLOCK = `${COMMON_UNIFORMS_GLSL}\n${settingsUniformsGlsl}\n${driveUniformsGlsl}\n${PALETTE_GLSL}\n${ROOM_UV_GLSL}\n${SAMPLE_BANDS_GLSL}`;

const PAINT_SRC = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
${COMMON_BLOCK}
${PAINT_FRAG}
`;

// No vUv here: the drop pass has its own vertex shader, and a fragment input
// the vertex stage never writes would be a link error on some drivers.
const DROP_SRC = `#version 300 es
precision highp float;
out vec4 outColor;
${COMMON_BLOCK}
${DROP_FRAG}
`;

const famShade = new Float32Array(FAMILY_SHADING.length * 4);
FAMILY_SHADING.forEach((s, i) => famShade.set(s, i * 4));
const famRgb = new Float32Array(FAMILY_RGB.length * 3);
FAMILY_RGB.forEach((c, i) => famRgb.set(c, i * 3));
const paintVecs = PAINT_RGB.map((option) => option.map((c) => Float32Array.from(c)));

let paintProg: GLProgram | null = null;
let dropProg: GLProgram | null = null;
let quadVao: WebGLVertexArrayObject | null = null;
let dropVao: WebGLVertexArrayObject | null = null;
let cornerBuf: WebGLBuffer | null = null;
let instBuf: WebGLBuffer | null = null;
const bandsBuf = new Float32Array(NUM_BANDS);
const instData = new Float32Array(MAX_DROPS * DROP_FLOATS);
const order: number[] = [];
const drifts = new Float32Array(PAINT_OCTAVES * 2);
const depths = new Float32Array(PAINT_OCTAVES);
let sim: DropSim = createDropSim();
let lastTime: number | null = null;
let clockSec = 0;

const params: StepParams = { aspect: 9 / 16, count: 80, size: 1, nested: 0.5, paint: 0, speed: 0, eddy: 1, shove: 0, pour: 0 };

export const oilDropsScene: Scene = {
  ...card,

  init(ctx: SceneContext) {
    const { gl } = ctx;
    paintProg = createProgram(gl, PAINT_SRC);
    dropProg = createProgram(gl, DROP_SRC, DROP_VERT);
    quadVao = createFullscreenQuad(gl);

    dropVao = gl.createVertexArray();
    gl.bindVertexArray(dropVao);
    cornerBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    instBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
    gl.bufferData(gl.ARRAY_BUFFER, instData.byteLength, gl.DYNAMIC_DRAW);
    const stride = DROP_FLOATS * 4;
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 16);
    gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);

    sim = createDropSim();
    lastTime = null;
    clockSec = Math.random() * 1000;
  },

  render(ctx, frame, viewport, palette, anim, drives = PASSTHROUGH_DRIVES) {
    if (!paintProg || !dropProg || !quadVao || !dropVao || !instBuf) return;
    const { gl } = ctx;
    // Own delta from anim.timeSec: the gallery preview hands render() an
    // un-latched anim, and the population must never step twice for one
    // frame or stand still for another.
    const dt = lastTime === null ? 1 / 60 : Math.max(0, anim.timeSec - lastTime);
    lastTime = anim.timeSec;
    clockSec += Math.min(dt, 0.1);

    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const roomAspect = (h / viewport.h) / (w / viewport.w);
    const pxW = viewport.w / w;

    const get = (key: string) => resolveSceneSetting(ID, settingFor(key));
    params.aspect = roomAspect;
    params.count = dropCount(get("drops"));
    params.size = get("size");
    params.nested = get("nested");
    params.paint = Math.round(get("paint"));
    params.speed = driftSpeed(get("drift"), get("rush"), drives.value("rush", levelOf(frame)));
    params.eddy = eddyScale(get("swirl"), drives.value("swirl", anim.low));
    // fired() consumes the edge and feeds the detector, so both hit drivers
    // are read every frame whatever their settings.
    params.shove = drives.fired("shove", anim.song.kickOnset) ? drives.hitSize("shove") * get("shove") : 0;
    params.pour = drives.fired("pour", anim.dropOnset) ? drives.hitSize("pour") * get("pour") : 0;
    stepDrops(sim, dt, params);

    const paintRgb = paintVecs[Math.min(paintVecs.length - 1, Math.max(0, params.paint))];
    const glitterAmt = glitterAmount(get("glitter"), drives.value("glitter", anim.high));
    const shared = (prog: GLProgram) => {
      uploadCommonUniforms(prog, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf, drives);
      prog.setF("uRoomAspect", roomAspect);
      prog.setF("uPxW", pxW);
      prog.setV3v("uPaintDeep", paintRgb[0]);
      prog.setV3v("uPaintMid", paintRgb[1]);
      prog.setV3v("uPaintPale", paintRgb[2]);
      prog.setF("uGlitterAmt", glitterAmt);
    };

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    paintProg.use();
    shared(paintProg);
    paintProg.setFv("uPaintDrift", paintDrifts(sim.paintX, sim.paintY, drifts));
    paintProg.setFv("uBoilDepth", boilDepths(clockSec, depths));
    drawFullscreenQuad(gl, quadVao);

    const n = packDrops(sim, instData, order);
    if (n > 0) {
      dropProg.use();
      shared(dropProg);
      dropProg.setV4v("uFamShade", famShade);
      dropProg.setV3v("uFamRgb", famRgb);
      gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, instData, 0, n * DROP_FLOATS);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindVertexArray(dropVao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
      gl.bindVertexArray(null);
    }
    // The gallery renders every scene into one shared context each tick:
    // leave no blend state behind.
    gl.disable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ZERO);
  },

  dispose(ctx: SceneContext) {
    const { gl } = ctx;
    paintProg?.dispose();
    dropProg?.dispose();
    if (quadVao) gl.deleteVertexArray(quadVao);
    if (dropVao) gl.deleteVertexArray(dropVao);
    if (cornerBuf) gl.deleteBuffer(cornerBuf);
    if (instBuf) gl.deleteBuffer(instBuf);
    paintProg = null;
    dropProg = null;
    quadVao = null;
    dropVao = null;
    cornerBuf = null;
    instBuf = null;
  },
};
