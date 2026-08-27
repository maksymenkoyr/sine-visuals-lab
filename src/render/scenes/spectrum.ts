import { createFullscreenScene } from "../fullscreenScene.ts";

const FRAG = `
void main() {
  vec2 uv = roomUv(vUv);
  float aspect = uResolution.x / uResolution.y;

  // Mirror across the horizontal center so the ribbon reads as symmetric.
  float mx = abs(uv.x - 0.5) * 2.0;
  float band = sampleBands(mx);

  float barTop = band * 0.85;
  float d = uv.y - barTop;

  float bar = smoothstep(0.015, 0.0, d) * step(uv.y, barTop + 0.02);
  float glow = exp(-abs(d) * 12.0) * 0.5;

  float t = mx * 0.9 + uTime * 0.03 + uBeatPhase * 0.2;
  vec3 col = palette(t, uPalA, uPalB, uPalC, uPalD);

  float gridLine = smoothstep(0.0, 0.002 * aspect, abs(fract(uv.x * 48.0) - 0.5) - 0.48);
  vec3 bg = col * 0.04 * (1.0 - gridLine);

  vec3 result = bg + col * (bar * 1.5 + glow) * (0.7 + 0.8 * uBeatPulse);
  outColor = vec4(result, 1.0);
}
`;

export const spectrumScene = createFullscreenScene("spectrum", "Spectrum", FRAG);
