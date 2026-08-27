import { createFullscreenScene } from "../fullscreenScene.ts";

// A printed poster, not a demo: flat geometric forms sized by band groups,
// rendered as two halftone ink screens over paper grain. uBeatPulse jolts
// the screens out of register for a split-second, the way a poorly-aligned
// riso print shifts on the beat. The halftone dot grid is computed straight
// from screen pixels (not roomUv) so the ink stays physically fixed to the
// display while the artwork itself spans the room.
const FRAG = `
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float shapeField(vec2 p) {
  float v = 0.0;
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float band = sampleBands(fi / 6.0 + 0.05);
    vec2 c = vec2(sin(fi * 2.1 + uTime * 0.1), cos(fi * 1.7 - uTime * 0.08)) * 0.55;
    float r = 0.12 + band * 0.32;
    v = max(v, 1.0 - smoothstep(r * 0.8, r, length(p - c)));
  }
  return v;
}

float halftone(vec2 screenUv, float value, float angleDeg, float scale) {
  float rad = radians(angleDeg);
  mat2 rot = mat2(cos(rad), -sin(rad), sin(rad), cos(rad));
  vec2 grid = rot * screenUv * scale;
  vec2 cell = fract(grid) - 0.5;
  float dotR = sqrt(clamp(value, 0.0, 1.0)) * 0.5;
  return step(length(cell), dotR);
}

void main() {
  vec2 uv = roomUv(vUv);
  vec2 aspectFix = vec2(uResolution.x / uResolution.y, 1.0);
  vec2 p = (uv - 0.5) * aspectFix * 2.0;

  float minDim = min(uResolution.x, uResolution.y);
  vec2 screenUv = vUv * uResolution.xy / minDim * 220.0;

  float shake = uBeatPulse * 0.006;
  vec2 offA = vec2(shake, 0.0);
  vec2 offB = vec2(-shake * 0.7, shake * 0.4);

  float v = shapeField(p);
  float grain = hash21(floor(screenUv * 3.0)) * 0.06;

  float inkA = halftone(screenUv + offA, v, 15.0, 1.0);
  float inkB = halftone(screenUv + offB, v * 0.75 + 0.12, 75.0, 1.0);

  vec3 paper = vec3(0.93, 0.91, 0.85) - grain;
  vec3 colA = palette(0.15, uPalA, uPalB, uPalC, uPalD);
  vec3 colB = palette(0.65, uPalA, uPalB, uPalC, uPalD);

  vec3 col = paper;
  col = mix(col, col * colB * 1.4, inkB);
  col = mix(col, col * colA * 1.4, inkA);

  outColor = vec4(col, 1.0);
}
`;

export const risoScene = createFullscreenScene("riso", "Riso", FRAG);
