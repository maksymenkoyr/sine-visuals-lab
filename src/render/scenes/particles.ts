import { createFullscreenScene } from "../fullscreenScene.ts";

const FRAG = `
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

vec2 hash22(vec2 p) {
  return vec2(hash21(p), hash21(p + 17.13));
}

vec2 flow(vec2 p, float t) {
  float n1 = sin(p.x * 2.3 + t) * cos(p.y * 2.3 - t * 0.7);
  float n2 = sin((p.x + 0.05) * 2.3 + t) * cos(p.y * 2.3 - t * 0.7);
  float n3 = sin(p.x * 2.3 + t) * cos((p.y + 0.05) * 2.3 - t * 0.7);
  return vec2(n3 - n1, -(n2 - n1)) * 12.0;
}

void main() {
  vec2 uv = roomUv(vUv);
  vec2 aspectFix = vec2(uResolution.x / uResolution.y, 1.0);
  vec2 p = (uv - 0.5) * aspectFix * 8.0;

  float bass = sampleBands(0.06);

  // Denser field at higher detail; a few extra neighbor cells cost little
  // since this whole pass is O(9) per pixel regardless of density.
  float cellsScale = mix(0.85, 1.25, uDetail);
  vec2 cellUv = p * cellsScale;

  vec3 col = vec3(0.0);
  for (int gx = -1; gx <= 1; gx++) {
    for (int gy = -1; gy <= 1; gy++) {
      vec2 cellId = floor(cellUv) + vec2(float(gx), float(gy));
      vec2 rnd = hash22(cellId);
      float band = sampleBands(fract(rnd.x + cellId.x * 0.013 + cellId.y * 0.021));

      vec2 center = cellId + 0.5 + (rnd - 0.5) * 0.85;
      vec2 drift = flow(cellId * 0.15 + rnd, uTime * 0.2) * 0.03;
      center += drift * (0.4 + band);

      float d = length(cellUv - center);
      float r = 0.05 + band * 0.16 + bass * 0.08 * uBeatPulse;
      float glow = exp(-d * d / (r * r) * 2.5);

      float t = rnd.x + uTime * 0.04 + band * 0.5;
      col += palette(t, uPalA, uPalB, uPalC, uPalD) * glow * (0.25 + band * 1.2);
    }
  }

  col *= 0.85 + uEnergy * 0.7;
  outColor = vec4(col, 1.0);
}
`;

export const particlesScene = createFullscreenScene("particles", "Particles", FRAG);
