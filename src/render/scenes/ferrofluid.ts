import { createFullscreenScene } from "../fullscreenScene.ts";

// A raymarched black-chrome blob that grows spikes toward 24 fixed
// directions (one per band, spread evenly via the golden angle), each
// spike's height driven by that band's energy. Fresnel + specular give it
// an oil-slick sheen. Sculptural and glossy; the most expensive of the
// five, so it leans on uMaxSteps the way tunnel.ts does.
const FRAG = `
const int MAX_STEPS = 64;

vec3 modeDir(int i) {
  float fi = float(i);
  float golden = 2.399963;
  float y = 1.0 - 2.0 * (fi + 0.5) / 24.0;
  float radius = sqrt(max(0.0, 1.0 - y * y));
  float theta = golden * fi;
  return vec3(cos(theta) * radius, y, sin(theta) * radius);
}

float sdBlob(vec3 p) {
  float d = length(p) - 1.0;
  vec3 n = normalize(p + 1e-4);
  float bump = 0.0;
  for (int i = 0; i < 24; i++) {
    float band = uBands[i];
    if (band < 0.02) continue;
    vec3 dir = modeDir(i);
    float lobe = pow(max(0.0, dot(n, dir)), 3.5);
    bump += band * lobe * 0.85;
  }
  return d - bump - uBeatPulse * 0.05;
}

vec3 calcNormal(vec3 p) {
  vec2 e = vec2(0.001, 0.0);
  return normalize(vec3(
    sdBlob(p + e.xyy) - sdBlob(p - e.xyy),
    sdBlob(p + e.yxy) - sdBlob(p - e.yxy),
    sdBlob(p + e.yyx) - sdBlob(p - e.yyx)
  ));
}

void main() {
  vec2 uv = roomUv(vUv) - 0.5;
  uv.x *= uResolution.x / uResolution.y;

  vec3 ro = vec3(0.0, 0.0, -4.5);
  vec3 rd = normalize(vec3(uv * 1.6, 1.0));

  int steps = int(min(float(MAX_STEPS), uMaxSteps));
  float t = 0.0;
  bool hit = false;
  vec3 p = ro;

  for (int i = 0; i < MAX_STEPS; i++) {
    if (i >= steps) break;
    p = ro + rd * t;
    float d = sdBlob(p);
    if (d < 0.001) { hit = true; break; }
    t += d * 0.8;
    if (t > 8.0) break;
  }

  vec3 col = vec3(0.01, 0.01, 0.015);
  if (hit) {
    vec3 n = calcNormal(p);
    vec3 lightDir = normalize(vec3(0.5, 0.8, -0.6));
    float diff = max(0.0, dot(n, lightDir));
    float fresnel = pow(1.0 - max(0.0, dot(n, -rd)), 3.0);
    vec3 base = palette(fresnel * 0.5 + uTime * 0.02, uPalA, uPalB, uPalC, uPalD);
    vec3 spec = vec3(1.0) * pow(max(0.0, dot(reflect(-lightDir, n), -rd)), 40.0);
    col = base * (0.15 + diff * 0.5) + fresnel * base * 1.5 + spec;
  }

  outColor = vec4(col, 1.0);
}
`;

// The most expensive scene (see comment above) — worse than tunnel.ts, which
// itself is gated to minTier "low". uMaxSteps alone isn't enough protection:
// gate the gallery/scene picker too, or a floor-tier device can select it.
export const ferrofluidScene = createFullscreenScene("ferrofluid", "Ferrofluid", FRAG, { minTier: "mid" });
