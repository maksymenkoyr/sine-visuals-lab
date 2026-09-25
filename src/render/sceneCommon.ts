import { NUM_BANDS, type FeatureFrame } from "../audio/types.ts";
import type { GLProgram } from "./gl.ts";
import { paletteVecs, type Palette } from "./palette.ts";
import type { SceneSetting } from "./sceneSettings.ts";
import { resolveSceneSetting } from "./autoTune.ts";
import type { SceneContext, Viewport } from "./scene.ts";
import type { AnimFrame } from "./animClock.ts";
import { PASSTHROUGH_DRIVES, type SceneDrives } from "./drives.ts";

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
uniform float uCentroid; // range-adapted spectral centroid — see spectralCentroid.ts; 0.5 is this track's own recent middle
uniform float uMaxSteps; // quality.raymarchSteps, for raymarched scenes
uniform float uDetail;   // 0..1 quality proxy, for density/bloom scaling
uniform vec3 uPalA;
uniform vec3 uPalB;
uniform vec3 uPalC;
uniform vec3 uPalD;
`;

export function settingUniformName(key: string): string {
  return `u${key[0].toUpperCase()}${key.slice(1)}`;
}

/** Per drive setting (SceneSetting.drive — see sceneSettings.ts and
 *  drives.ts): `uniform float u<Key>Drive`, `uniform float u<Key>Custom`,
 *  and the `<key>Drive(sceneDefault)` GLSL helper a scene's own FRAG calls
 *  at the coupling's call site instead of the old fixed formula — see
 *  drives.ts's header for why `mix(sceneDefault, u<Key>Drive, u<Key>Custom)`
 *  is bit-for-bit identical to `sceneDefault` alone at Custom=0 (Scene) and
 *  to the engine's own value at Custom=1 (every catalogue/grid/line
 *  default). Settings with no `drive` contribute nothing — spliced into
 *  fullscreenScene.ts's fragSrc next to settingsUniformsGlsl, and uploaded
 *  in uploadCommonUniforms below alongside every other setting uniform. */
export function DRIVE_GLSL(settings: readonly SceneSetting[]): string {
  return settings
    .filter((s) => s.drive)
    .map((s) => {
      const u = settingUniformName(s.key);
      return `uniform float ${u}Drive;\nuniform float ${u}Custom;\nfloat ${s.key}Drive(float sceneDefault) { return mix(sceneDefault, ${u}Drive, ${u}Custom); }`;
    })
    .join("\n");
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
 *  own settings and — for each setting with a `drive` — the pair DRIVE_GLSL
 *  declared for it. Shared between createFullscreenScene and any
 *  geometry-based scene (see meshGrid.ts) so the two paths stay in
 *  lockstep. `drives` defaults to PASSTHROUGH_DRIVES (drives.ts) — every
 *  caller not wired to a real DriveEngine (a gallery preview, a probe, a
 *  test) then uploads {0,0} for every drive setting, which is exactly the
 *  Scene/identity reading, so a scene renders the same as it always did. */
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
  drives: SceneDrives = PASSTHROUGH_DRIVES,
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
  prog.setF("uCentroid", anim.centroid);
  prog.setF("uMaxSteps", ctx.quality.raymarchSteps);
  prog.setF("uDetail", ctx.quality.detail);
  for (const s of settings) {
    const u = settingUniformName(s.key);
    prog.setF(u, resolveSceneSetting(sceneId, s));
    if (s.drive) {
      const pair = drives.uniformPair(s.key);
      prog.setF(`${u}Drive`, pair.drive);
      prog.setF(`${u}Custom`, pair.custom);
    }
  }
  const pv = paletteVecs(palette);
  prog.setV3v("uPalA", pv.a);
  prog.setV3v("uPalB", pv.b);
  prog.setV3v("uPalC", pv.c);
  prog.setV3v("uPalD", pv.d);
}
