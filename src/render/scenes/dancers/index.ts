/**
 * Dancers — one figure dancing to the music, raymarched as a signed-distance
 * field. The rig (rig.ts) is solved on the CPU from the choreographer's pose
 * (choreo.ts, moves.ts) and uploaded as a packed vec4 array; the shader
 * below owns the camera, the march and the lighting, and delegates the
 * figure's shape and colour to a skin (stickSkin.ts, skeletonSkin.ts).
 *
 * Cost: the march starts at the figure's bounding sphere, so background
 * pixels exit after one analytic test; inside, every step evaluates every
 * bone, so this sits with ferrofluid.ts at minQuality "mid".
 */
import { createFullscreenScene } from "../../fullscreenScene.ts";
import type { SceneSetting } from "../../sceneSettings.ts";
import {
  createBoneBuffer,
  createRigWorld,
  forwardKinematics,
  groundToFloor,
  packBones,
  CH_LIFT,
  RIG_GLSL,
} from "./rig.ts";
import { createChoreographer } from "./choreo.ts";
import type { MoveClocks } from "./moves.ts";
import { STICK_SKIN_GLSL } from "./stickSkin.ts";

export const DANCERS_ID = "dancers";

const SETTINGS: SceneSetting[] = [
  {
    key: "motion",
    label: "Move energy",
    description: "How big every move is — bounce height, arm swing, step width.",
    group: "Dance",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
  },
  {
    key: "bob",
    label: "Camera bob",
    description: "How much the camera nudges in on each beat.",
    group: "Camera",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.4,
  },
];

const FRAG = `
const int MAX_STEPS = 96;
// Everything the rig can reach sits inside this sphere; the march never
// leaves it, and pixels whose ray misses it are background outright.
const vec3 FIG_CENTER = vec3(0.0, 0.98, 0.0);
const float FIG_RADIUS = 1.5;

uniform float uCamDolly;
uniform float uCamTilt;
uniform float uCamRoll;

${RIG_GLSL}
${STICK_SKIN_GLSL}

float map(vec3 p) { return stick_map(p); }

// Tetrahedral normal: four map() taps instead of six.
vec3 calcNormal(vec3 p, float eps) {
  const vec2 k = vec2(1.0, -1.0);
  return normalize(
    k.xyy * map(p + k.xyy * eps) +
    k.yyx * map(p + k.yyx * eps) +
    k.yxy * map(p + k.yxy * eps) +
    k.xxx * map(p + k.xxx * eps));
}

void main() {
  vec2 uv = roomUv(vUv) - 0.5;
  uv.x *= uResolution.x / uResolution.y;
  float cr = cos(uCamRoll), sr = sin(uCamRoll);
  uv = vec2(uv.x * cr - uv.y * sr, uv.x * sr + uv.y * cr);

  // A low camera looking slightly up at the pelvis, dollied in on the beat.
  vec3 eye = vec3(0.0, 0.8, 4.0 - uCamDolly);
  vec3 target = vec3(0.0, 1.02 + uCamTilt, 0.0);
  vec3 fwd = normalize(target - eye);
  vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(right, fwd);
  vec3 rd = normalize(fwd * 1.45 + uv.x * right + uv.y * up);

  vec3 col = vec3(0.012, 0.011, 0.016);
  // Faint floor glow under the figure so it stands on something.
  float floorT = (0.0 - eye.y) / min(rd.y, -1e-4);
  if (rd.y < 0.0) {
    vec3 fp = eye + rd * floorT;
    float ring = exp(-dot(fp.xz, fp.xz) * 1.2);
    col += palette(0.6, uPalA, uPalB, uPalC, uPalD) * ring * (0.035 + 0.03 * uBeatPulse);
  }

  vec3 oc = eye - FIG_CENTER;
  float b = dot(oc, rd);
  float h = b * b - (dot(oc, oc) - FIG_RADIUS * FIG_RADIUS);
  if (h > 0.0) {
    h = sqrt(h);
    float t = max(0.0, -b - h);
    float tFar = -b + h;
    int steps = int(min(float(MAX_STEPS), uMaxSteps));
    bool hit = false;
    vec3 p = eye;
    for (int i = 0; i < MAX_STEPS; i++) {
      if (i >= steps) break;
      p = eye + rd * t;
      float d = map(p);
      // Looser hits at low detail / few steps: a gallery tile with a dozen
      // steps should still close on the surface rather than leave holes.
      float eps = 0.0008 + t * (0.0008 + 0.0025 * (1.0 - uDetail));
      if (d < eps) { hit = true; break; }
      t += d;
      if (t > tFar) break;
    }
    if (hit) {
      vec3 n = calcNormal(p, 0.0015 + 0.002 * (1.0 - uDetail));
      float fresnel = pow(1.0 - max(0.0, dot(n, -rd)), 3.0);
      vec3 rim = palette(0.15 + p.y * 0.2, uPalA, uPalB, uPalC, uPalD) * fresnel * 0.5;
      col = stick_shade(p, n, rd, rim);
    }
  }

  outColor = vec4(col, 1.0);
}
`;

export const dancersScene = createFullscreenScene(DANCERS_ID, "Dancers", FRAG, {
  minQuality: "mid",
  settings: SETTINGS,
  extraUniformDecls: "", // uBones and the camera uniforms are declared inside FRAG next to their users
  extraUniforms: (() => {
    const choreographer = createChoreographer();
    const world = createRigWorld();
    const boneBuf = createBoneBuffer();
    const clocks: MoveClocks = {
      beatPhase: 0, barPhase: 0, tempoLock: 0, beatPulse: 0, lowPulse: 0,
      sectionIntensity: 0, dropPulse: 0, flowPhase: 0, timeSec: 0,
    };

    return (_frame, anim, getSetting) => {
      clocks.beatPhase = anim.beatPhase;
      clocks.barPhase = anim.barPhase;
      clocks.tempoLock = anim.tempoLock;
      clocks.beatPulse = anim.beatPulse;
      clocks.lowPulse = anim.lowPulse;
      clocks.sectionIntensity = anim.sectionIntensity;
      clocks.dropPulse = anim.dropPulse;
      clocks.flowPhase = anim.flowPhase;
      clocks.timeSec = anim.timeSec;

      const out = choreographer.advance(clocks, anim.dtSec, {
        energy: getSetting("motion"),
        bob: getSetting("bob"),
      });
      forwardKinematics(out.pose, world);
      groundToFloor(world, out.pose[CH_LIFT]);
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
