import { createFullscreenScene } from "../fullscreenScene.ts";

const FRAG = `
const int MAX_STEPS = 100;
const float TWO_PI = 6.28318;

void main() {
  vec2 uv = roomUv(vUv) - 0.5;
  uv.x *= uResolution.x / uResolution.y;

  vec3 ro = vec3(0.0, 0.0, -uTime * (1.2 + uBpm * 0.004));
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

    glow += (0.015 / (dist + 0.015)) * (0.4 + uEnergy) * uQuality;

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

export const tunnelScene = createFullscreenScene("tunnel", "Tunnel", FRAG, { minTier: "low" });
