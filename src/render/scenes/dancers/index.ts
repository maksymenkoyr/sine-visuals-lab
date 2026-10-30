/**
 * Dancers — one figure dancing to the music, raymarched as a signed-distance
 * field. The rig (rig.ts) is solved on the CPU from the choreographer's pose
 * (choreo.ts, moves.ts) and uploaded as a packed vec4 array; the shader
 * below owns the camera, the march and the lighting, and delegates the
 * figure's shape and colour to whichever skin in SKINS the `skin` setting
 * selects (stickSkin.ts, skeletonSkin.ts).
 *
 * Skin contract: a GLSL string defining `<prefix>_map(vec3 p)` (signed
 * distance, world space) and `<prefix>_shade(p, n, rd, rim, ao)` (lit
 * colour), built only from RIG_GLSL's bone helpers and SDF_GLSL's
 * primitives. Every skin compiles into the one program; `map()` branches on
 * a uniform, which is coherent across the whole draw and costs nothing.
 *
 * Cost, and the `renderer` setting: the raymarcher starts at the figure's
 * bounding sphere, so background pixels exit after one analytic test, but
 * inside it every step evaluates every bone — thousands of SDF taps per
 * covered pixel, which no TV GPU affords. So the same rig can also be
 * drawn by the two cheap renderers in fastRenderers.ts (analytic capsules,
 * or flat projected capsules), and the raymarcher hands over to Capsules
 * below the Mid preset (RAYMARCH_MIN_DETAIL); that is what lets the scene
 * register at minQuality "floor". The `fastMarch` toggle trims the
 * raymarcher itself (FAST_MARCH_*) for when its look is wanted cheaper.
 */
import { createFullscreenScene } from "../../fullscreenScene.ts";
import {
  createBoneBuffer,
  createPose,
  createRigWorld,
  forwardKinematics,
  groundToFloor,
  packBones,
  CH_LIFT,
  RIG_GLSL,
  type Pose,
} from "./rig.ts";
import { SDF_GLSL } from "./sdf.ts";
import { createChoreographer } from "./choreo.ts";
import type { MoveClocks } from "./moves.ts";
import { CLIP_LIBRARY_URL, decodeClipLibrary, sampleClip, type ClipLibrary } from "./clipFormat.ts";
import { clipPhaseAt, createBarCounter } from "./player.ts";
import { STICK_SKIN_GLSL } from "./stickSkin.ts";
import { SKELETON_SKIN_GLSL } from "./skeletonSkin.ts";
import { FAST_RENDERERS_GLSL } from "./fastRenderers.ts";
import { card, BLENDS, RENDERERS, SKIN_NAMES, STYLES } from "./card.ts";
import { sceneMedia } from "../../../pinnedAssets.ts";

// Scene media (src/pinnedAssets.ts's header): a stable file under
// public/media/, fetched the first time a host mounts this scene (onInit,
// below), not at import, and kept for the session; a show pins it up front.
// Code Rain names the same path, so the two share one copy.
const clips = sceneMedia(CLIP_LIBRARY_URL);

/** Starts the clip library's fetch. The extraUniforms closure below sets it
 *  (the library and the choreographer live there); onInit calls it. */
let loadLibrary = (): void => {};

export const DANCERS_ID = card.id;

interface Skin {
  /** Shown in the device menu's picker. */
  name: string;
  /** Function-name prefix inside `glsl`. */
  prefix: string;
  glsl: string;
}

/** Each skin's prefix and shader, at the index its name has in SKIN_NAMES (card.ts). */
const SKIN_SHADERS: readonly Omit<Skin, "name">[] = [
  { prefix: "skel", glsl: SKELETON_SKIN_GLSL },
  { prefix: "stick", glsl: STICK_SKIN_GLSL },
];
export const SKINS: readonly Skin[] = SKIN_NAMES.map((name, i) => ({ name, ...SKIN_SHADERS[i] }));

const RENDERER_RAYMARCH = 0;
const RENDERER_CAPSULES = 1;
const RENDERER_FLAT = 2;
/** uDetail below which the raymarcher hands over to Capsules — the `low`
 *  and `floor` presets in quality.ts. */
const RAYMARCH_MIN_DETAIL = 0.5;
/** What the `fastMarch` toggle trims: the step budget, the hit epsilon,
 *  and the detail the skins build at (below the skeleton skin's LOD cutoff). */
const FAST_MARCH_STEPS = 0.6;
const FAST_MARCH_EPS = 1.6;
const FAST_MARCH_DETAIL = 0.45;

const skinDispatch = (fn: "map" | "shade", args: string): string =>
  SKINS.map((s, i) => `${i > 0 ? "else " : ""}if (gSkin == ${i}) return ${s.prefix}_${fn}(${args});`).join("\n  ") +
  `\n  return ${SKINS[0].prefix}_${fn}(${args});`;

const FRAG = `
const int MAX_STEPS = 96;
// Everything the rig can reach sits inside this sphere; the march never
// leaves it, and pixels whose ray misses it are background outright.
const vec3 FIG_CENTER = vec3(0.0, 0.98, 0.0);
const float FIG_RADIUS = 1.5;
const float FOCAL = 1.5;

uniform float uCamDolly;
uniform float uCamTilt;
uniform float uCamRoll;

// Which of SKINS draws this frame — set once in main() from uSkin.
int gSkin = 0;
// The detail the skins build at: uDetail, or less under the fast march.
float gDetail = 1.0;
float map(vec3 p);

${SDF_GLSL}
${RIG_GLSL}
${FAST_RENDERERS_GLSL}
${SKINS.map((s) => s.glsl).join("\n")}

float map(vec3 p) {
  ${skinDispatch("map", "p")}
}
vec3 shade(vec3 p, vec3 n, vec3 rd, vec3 rim, float ao) {
  ${skinDispatch("shade", "p, n, rd, rim, ao")}
}

// Tetrahedral normal: four map() taps instead of six.
// Inigo Quilez's tetrahedral-tap normal (MIT) — see THIRD-PARTY-NOTICES.md
vec3 calcNormal(vec3 p, float eps) {
  const vec2 k = vec2(1.0, -1.0);
  return normalize(
    k.xyy * map(p + k.xyy * eps) +
    k.yyx * map(p + k.yyx * eps) +
    k.yxy * map(p + k.yxy * eps) +
    k.xxx * map(p + k.xxx * eps));
}

// Two taps along the normal: crevices (sockets, between ribs) darken.
float ambientOcclusion(vec3 p, vec3 n) {
  float a = clamp(map(p + n * 0.025) / 0.025, 0.0, 1.0);
  float b = clamp(map(p + n * 0.07) / 0.07, 0.0, 1.0);
  return mix(0.45, 1.0, a * 0.6 + b * 0.4);
}

vec3 rimLight(vec3 p, vec3 n, vec3 rd) {
  float fresnel = pow(1.0 - max(0.0, dot(n, -rd)), 3.0);
  return palette(0.15 + p.y * 0.2, uPalA, uPalB, uPalC, uPalD) * fresnel * uGlow;
}

void main() {
  gSkin = int(clamp(uSkin, 0.0, float(${SKINS.length - 1})) + 0.5);
  bool fastMarch = uFastMarch > 0.5;
  gDetail = fastMarch ? min(uDetail, ${FAST_MARCH_DETAIL.toFixed(2)}) : uDetail;
  // Below the Mid preset the raymarcher is out of budget: fall back to Capsules.
  int renderer = int(clamp(uRenderer, 0.0, ${(RENDERERS.length - 1).toFixed(1)}) + 0.5);
  if (renderer == ${RENDERER_RAYMARCH} && uDetail < ${RAYMARCH_MIN_DETAIL.toFixed(2)}) renderer = ${RENDERER_CAPSULES};

  vec2 uv = roomUv(vUv) - 0.5;
  uv.x *= uResolution.x / uResolution.y;
  float cr = cos(uCamRoll), sr = sin(uCamRoll);
  uv = vec2(uv.x * cr - uv.y * sr, uv.x * sr + uv.y * cr);

  // A low camera looking slightly up at the pelvis, dollied in on the beat.
  vec3 eye = vec3(0.0, 0.8, 3.45 - uCamDolly);
  vec3 target = vec3(0.0, 1.02 + uCamTilt, 0.0);
  vec3 fwd = normalize(target - eye);
  vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(right, fwd);
  vec3 rd = normalize(fwd * FOCAL + uv.x * right + uv.y * up);

  vec3 col = vec3(0.012, 0.011, 0.016);
  // Faint floor glow under the figure so it stands on something.
  if (rd.y < 0.0) {
    vec3 fp = eye + rd * ((0.0 - eye.y) / rd.y);
    float ring = exp(-dot(fp.xz, fp.xz) * 1.2);
    col += palette(0.6, uPalA, uPalB, uPalC, uPalD) * ring * (0.035 + 0.03 * uBeatPulse);
  }

  if (renderer == ${RENDERER_FLAT}) {
    vec3 p, n;
    float cover = flatTrace(uv, eye, right, up, fwd, FOCAL, p, n);
    if (cover > 0.0) col = mix(col, shade(p, n, rd, rimLight(p, n, rd), 1.0), cover);
    outColor = vec4(col, 1.0);
    return;
  }
  if (renderer == ${RENDERER_CAPSULES}) {
    vec3 p, n;
    if (capsulesTrace(eye, rd, p, n)) col = shade(p, n, rd, rimLight(p, n, rd), 1.0);
    outColor = vec4(col, 1.0);
    return;
  }

  vec3 oc = eye - FIG_CENTER;
  float b = dot(oc, rd);
  float h = b * b - (dot(oc, oc) - FIG_RADIUS * FIG_RADIUS);
  if (h > 0.0) {
    h = sqrt(h);
    float t = max(0.0, -b - h);
    float tFar = -b + h;
    // The fast march: fewer steps, a looser hit, no occlusion, coarser skins.
    int steps = int(min(float(MAX_STEPS), uMaxSteps) * (fastMarch ? ${FAST_MARCH_STEPS.toFixed(2)} : 1.0));
    float epsScale = fastMarch ? ${FAST_MARCH_EPS.toFixed(2)} : 1.0;
    bool hit = false;
    vec3 p = eye;
    for (int i = 0; i < MAX_STEPS; i++) {
      if (i >= steps) break;
      p = eye + rd * t;
      float d = map(p);
      // Looser hits at low detail / few steps: a gallery tile with a dozen
      // steps should still close on the surface rather than leave holes.
      float eps = (0.0008 + t * (0.0008 + 0.0025 * (1.0 - gDetail))) * epsScale;
      if (d < eps) { hit = true; break; }
      t += d;
      if (t > tFar) break;
    }
    if (hit) {
      vec3 n = calcNormal(p, 0.0015 + 0.002 * (1.0 - gDetail));
      float ao = gDetail > 0.6 ? ambientOcclusion(p, n) : 1.0;
      col = shade(p, n, rd, rimLight(p, n, rd), ao);
    }
  }

  outColor = vec4(col, 1.0);
}
`;

export const dancersScene = createFullscreenScene(card.id, card.name, FRAG, {
  // The cheap renderers run anywhere; the raymarcher hands over to them
  // below Mid (RAYMARCH_MIN_DETAIL), so no preset is out of reach.
  minQuality: card.minQuality,
  settings: card.settings,
  onInit: () => loadLibrary(),
  extraUniforms: (() => {
    const choreographer = createChoreographer();
    const world = createRigWorld();
    const boneBuf = createBoneBuffer();
    const clocks: MoveClocks = {
      beatPhase: 0, barPhase: 0, tempoLock: 0, beatPulse: 0, kickPulse: 0,
      sectionIntensity: 0, dropPulse: 0, flowPhase: 0, timeSec: 0, bpm: 0, pulse: 0.5,
    };

    // The clip library arrives asynchronously after the first mount; until
    // it does (or if it can't — tests import this module under node) the
    // dancer sways. A failed fetch is asked for again on the next mount.
    let library: ClipLibrary | null = null;
    let libraryRequested = false;
    loadLibrary = () => {
      if (library || libraryRequested || typeof window === "undefined" || typeof fetch !== "function") return;
      libraryRequested = true;
      clips
        .bytes()
        .then((buf) => {
          library = decodeClipLibrary(buf);
          choreographer.setLibrary(library);
        })
        .catch((err: unknown) => {
          libraryRequested = false;
          console.warn("dancers: clip library unavailable", err);
        });
    };
    // DEV: `?clip=<name>` loops one clip on the beat, for checking a conversion.
    const forcedClipName = import.meta.env.DEV && typeof location !== "undefined" ? new URLSearchParams(location.search).get("clip") : null;
    const bars = createBarCounter();
    const clipPose = createPose();

    return (frame, anim, getSetting, drives) => {
      clocks.beatPhase = anim.beatPhase;
      clocks.barPhase = anim.barPhase;
      clocks.tempoLock = anim.tempoLock;
      clocks.beatPulse = anim.beatPulse;
      clocks.kickPulse = anim.song.kickPulse;
      clocks.sectionIntensity = anim.sectionIntensity;
      clocks.dropPulse = anim.dropPulse;
      clocks.flowPhase = anim.flowPhase;
      clocks.timeSec = anim.timeSec;
      clocks.bpm = frame.bpm;
      clocks.pulse = anim.profile.pulse;

      const out = choreographer.advance(clocks, anim.dtSec, {
        energy: getSetting("motion"),
        bob: getSetting("bob"),
        groove: getSetting("groove"),
        jaw: getSetting("jaw"),
        jawDrive: drives.value("jaw", anim.song.kickPulse),
        bobBeatDrive: drives.value("bob", anim.beatPulse),
        bobLowDrive: drives.value("bob", anim.song.kickPulse),
        family: STYLES[Math.round(getSetting("style"))]?.family ?? null,
        blend: BLENDS[Math.round(getSetting("blend"))]?.mode ?? "crossfade",
      });
      const barsElapsed = bars.advance(anim.barPhase);
      let pose: Pose = out.pose;
      const forced = forcedClipName && library ? library.byName.get(forcedClipName) : undefined;
      if (forced) {
        sampleClip(forced, clipPhaseAt(forced, frame.bpm, barsElapsed), clipPose);
        pose = clipPose;
      }
      forwardKinematics(pose, world);
      groundToFloor(world, pose[CH_LIFT]);
      packBones(world, boneBuf);

      return {
        uBones: { vec4: boneBuf },
        uCamDolly: out.camDolly,
        uCamTilt: out.camTilt,
        uCamRoll: out.camRoll,
      };
    };
  })(),
});
