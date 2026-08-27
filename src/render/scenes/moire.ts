import { createFullscreenScene } from "../fullscreenScene.ts";

// Three line gratings at slowly drifting angles, interfering. Each grating's
// spatial frequency and rotation is driven by a band group (low/mid/high),
// so beat frequencies emerge and sweep across the frame as the music
// changes. Op-art, hard-edged, and the cheapest of the five to draw.
const FRAG = `
float grating(vec2 p, float angle, float freq) {
  vec2 dir = vec2(cos(angle), sin(angle));
  float v = 0.5 + 0.5 * sin(dot(p, dir) * freq);
  return smoothstep(0.45, 0.55, v); // stark bands, not a soft sine
}

float bandAvg(float lo, float hi) {
  float sum = 0.0;
  const int N = 6;
  for (int i = 0; i < N; i++) {
    float t = lo + (hi - lo) * (float(i) + 0.5) / float(N);
    sum += sampleBands(t);
  }
  return sum / float(N);
}

void main() {
  vec2 uv = roomUv(vUv);
  vec2 aspectFix = vec2(uResolution.x / uResolution.y, 1.0);
  vec2 p = (uv - 0.5) * aspectFix * 12.0;

  float low = bandAvg(0.0, 0.2);
  float mid = bandAvg(0.2, 0.6);
  float high = bandAvg(0.6, 1.0);

  float a1 = uTime * 0.05 + low * 0.3;
  float a2 = -uTime * 0.03 + mid * 0.5 + uBeatPulse * 0.6;
  float a3 = uTime * 0.02 + high * 0.8 + 1.0;

  float f1 = 10.0 + low * 26.0;
  float f2 = 14.0 + mid * 34.0;
  float f3 = 18.0 + high * 50.0;

  float g1 = grating(p, a1, f1);
  float g2 = grating(p, a2, f2);
  float g3 = grating(p, a3, f3);

  float mixed = g1 * g2 * g3;
  float t = mixed * 0.6 + uEnergy * 0.3 + uTime * 0.01;

  vec3 col = palette(t, uPalA, uPalB, uPalC, uPalD);
  col *= 0.35 + mixed * 1.4;

  outColor = vec4(col, 1.0);
}
`;

export const moireScene = createFullscreenScene("moire", "Moiré", FRAG);
