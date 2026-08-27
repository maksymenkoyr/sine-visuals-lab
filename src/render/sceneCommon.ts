import { NUM_BANDS, type FeatureFrame } from "../audio/types.ts";
import type { GLProgram } from "./gl.ts";
import { paletteVecs, type Palette } from "./palette.ts";
import type { SceneSetting } from "./sceneSettings.ts";
import { resolveSceneSetting } from "./autoTune.ts";
import type { SceneContext, Viewport } from "./scene.ts";
import type { AnimFrame } from "./animClock.ts";

/** GLSL uniform declarations every scene (fullscreen or geometry) can rely
 *  on — kept in one place so a new scene path doesn't have to restate them. */
export const COMMON_UNIFORMS_GLSL = `
uniform vec2 uResolution;
uniform float uTime;
uniform float uFlowPhase; // monotonic, audio-warped clock — see flowClock.ts
uniform vec4 uViewport; // x,y,w,h slice of the shared room-space canvas
uniform float uBands[${NUM_BANDS}];
uniform float uEnergy;
uniform float uBeatPulse;
uniform float uBeatPhase; // phase-locked beat clock — see beatClock.ts, never restarts mid-beat
uniform float uBarPhase;  // uBeatPhase over a 4-beat bar
uniform float uTempoLock; // 0..1, ramps in while a tempo is held, ramps out with no beat
uniform float uBpm;
uniform float uLow;       // slewed low/mid/high band levels — see bandEnergy.ts
uniform float uMid;
uniform float uHigh;
uniform float uLowPulse;  // decaying per-group onset pulse, same shape as uBeatPulse
uniform float uMidPulse;
uniform float uHighPulse;
uniform float uSectionIntensity; // phrase-level loudness trend — see sectionIntensity.ts
uniform float uDropPulse;        // decaying flash on a detected section change/drop
uniform float uMaxSteps; // tier.raymarchSteps, for raymarched scenes
uniform float uQuality;  // 0..1 tier proxy, for density/bloom scaling
uniform vec3 uPalA;
uniform vec3 uPalB;
uniform vec3 uPalC;
uniform vec3 uPalD;
`;

export function settingUniformName(key: string): string {
  return `u${key[0].toUpperCase()}${key.slice(1)}`;
}

// Smoothly samples the (already normalized + enveloped) band array at a
// fractional [0,1] position, so visuals aren't stepped across 24 bands.
export const SAMPLE_BANDS_GLSL = `
float sampleBands(float x) {
  float fi = clamp(x, 0.0, 0.999) * float(${NUM_BANDS});
  int i0 = int(floor(fi));
  int i1 = int(min(float(i0 + 1), float(${NUM_BANDS} - 1)));
  return mix(uBands[i0], uBands[i1], fract(fi));
}`;

// Maps a fragment's [0,1] UV into the shared room-space canvas defined by
// uViewport. At the full viewport {0,0,1,1} this is the identity, so every
// fullscreen scene spans a Panorama slice for free without knowing Panorama
// exists.
export const ROOM_UV_GLSL = `
vec2 roomUv(vec2 uv) {
  return uViewport.xy + uv * uViewport.zw;
}`;

/** Uploads every uniform COMMON_UNIFORMS_GLSL declares, plus this scene's
 *  own settings. Shared between createFullscreenScene and any geometry-based
 *  scene (see meshGrid.ts) so the two paths stay in lockstep. */
export function uploadCommonUniforms(
  prog: GLProgram,
  ctx: SceneContext,
  frame: FeatureFrame,
  viewport: Viewport,
  palette: Palette,
  anim: AnimFrame,
  sceneId: string,
  settings: SceneSetting[],
  bandsBuf: Float32Array,
): void {
  const { gl } = ctx;
  prog.setV2("uResolution", gl.drawingBufferWidth, gl.drawingBufferHeight);
  prog.setF("uTime", anim.timeSec);
  prog.setF("uFlowPhase", anim.flowPhase);
  prog.setV4("uViewport", viewport.x, viewport.y, viewport.w, viewport.h);
  bandsBuf.set(frame.bands);
  prog.setFv("uBands", bandsBuf);
  prog.setF("uEnergy", frame.energy);
  prog.setF("uBeatPulse", anim.beatPulse);
  prog.setF("uBeatPhase", anim.beatPhase);
  prog.setF("uBarPhase", anim.barPhase);
  prog.setF("uTempoLock", anim.tempoLock);
  prog.setF("uBpm", frame.bpm);
  prog.setF("uLow", anim.low);
  prog.setF("uMid", anim.mid);
  prog.setF("uHigh", anim.high);
  prog.setF("uLowPulse", anim.lowPulse);
  prog.setF("uMidPulse", anim.midPulse);
  prog.setF("uHighPulse", anim.highPulse);
  prog.setF("uSectionIntensity", anim.sectionIntensity);
  prog.setF("uDropPulse", anim.dropPulse);
  prog.setF("uMaxSteps", ctx.tier.raymarchSteps);
  prog.setF("uQuality", ctx.tier.quality);
  for (const s of settings) {
    prog.setF(settingUniformName(s.key), resolveSceneSetting(sceneId, s));
  }
  const pv = paletteVecs(palette);
  prog.setV3v("uPalA", pv.a);
  prog.setV3v("uPalB", pv.b);
  prog.setV3v("uPalC", pv.c);
  prog.setV3v("uPalD", pv.d);
}
