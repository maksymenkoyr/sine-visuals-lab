import { createFullscreenScene } from "../fullscreenScene.ts";

/** Camera speed (units per second) with no tempo, and the extra per BPM. */
const BASE_SPEED = 1.2;
const SPEED_PER_BPM = 0.004;
/** How fast the speed eases toward the tempo's (per second). */
const SPEED_EASE_PER_SEC = 2;
/** The longest clock step that still counts as motion (a hidden tab, or the
 *  clock swapped for another, must not fling the camera down the tunnel). */
const MAX_STEP_SEC = 0.1;

export interface TunnelCamera {
  z: number; // distance travelled down the tunnel
  speed: number;
  lastSec: number | null;
}

export function createTunnelCamera(): TunnelCamera {
  return { z: 0, speed: 0, lastSec: null };
}

/** Moves the camera to `timeSec` and returns how far down the tunnel it is.
 *  The position is an integral of the speed, which eases toward the tempo's:
 *  the tempo changing (the tracker settling, a lock, silence reading 0 BPM)
 *  then changes how fast the camera goes, where `time * speed(bpm)` moved it
 *  by `time * dSpeed` in one frame, a lurch that grew with the session. */
export function advanceTunnelCamera(cam: TunnelCamera, timeSec: number, bpm: number): number {
  const target = BASE_SPEED + Math.max(0, bpm) * SPEED_PER_BPM;
  if (cam.lastSec === null) {
    // First frame: start at the speed the tempo asks for, and where the old
    // time-times-speed formula would have been.
    cam.speed = target;
    cam.z = timeSec * target;
  } else {
    const dt = Math.min(MAX_STEP_SEC, Math.max(0, timeSec - cam.lastSec));
    cam.speed += (target - cam.speed) * Math.min(1, dt * SPEED_EASE_PER_SEC);
    cam.z += dt * cam.speed;
  }
  cam.lastSec = timeSec;
  return cam.z;
}

const FRAG = `
const int MAX_STEPS = 100;
const float TWO_PI = 6.28318;

void main() {
  vec2 uv = roomUv(vUv) - 0.5;
  uv.x *= uResolution.x / uResolution.y;

  vec3 ro = vec3(0.0, 0.0, -uTunnelZ);
  vec3 rd = normalize(vec3(uv, 1.0));

  int steps = int(min(float(MAX_STEPS), uMaxSteps));
  float t = 0.0;
  float glow = 0.0;
  vec3 hitCol = vec3(0.0);
  bool hit = false;

  for (int i = 0; i < MAX_STEPS; i++) {
    if (i >= steps) break;
    vec3 p = ro + rd * t;
    float angle = atan(p.y, p.x);
    float bandF = angle / TWO_PI + 0.5;
    float wobble = sampleBands(bandF) * 0.4;
    float radius = 1.0 + wobble + 0.12 * sin(p.z * 0.4 + uBeatPhase * TWO_PI);
    float dist = abs(length(p.xy) - radius);

    glow += (0.015 / (dist + 0.015)) * (0.4 + uEnergy) * uDetail;

    if (dist < 0.015) {
      float band = sampleBands(bandF);
      hitCol = palette(fract(-p.z * 0.04 + band * 0.35), uPalA, uPalB, uPalC, uPalD);
      hitCol *= 1.1 + uBeatPulse * 1.6;
      hit = true;
      break;
    }
    t += max(dist * 0.55, 0.02);
    if (t > 50.0) break;
  }

  vec3 glowCol = palette(uTime * 0.015 + uBeatPhase * 0.1, uPalA, uPalB, uPalC, uPalD);
  vec3 result = (hit ? hitCol : vec3(0.0)) + glowCol * glow * 0.12;
  outColor = vec4(result, 1.0);
}
`;

export const tunnelScene = createFullscreenScene("tunnel", "Tunnel", FRAG, {
  minQuality: "low",
  extraUniformDecls: "uniform float uTunnelZ;",
  extraUniforms: (() => {
    const camera = createTunnelCamera();
    return (frame, anim) => ({ uTunnelZ: advanceTunnelCamera(camera, anim.timeSec, frame.bpm) });
  })(),
});
