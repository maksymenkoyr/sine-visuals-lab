import { createFullscreenScene } from "../fullscreenScene.ts";

// Chladni-style standing waves. Each of the 24 audio bands is treated as one
// circular plate mode (radial order m, angular order n derived from the band
// index) and summed, weighted by that band's energy. Bass -> a few large
// slow lobes; treble -> a fine lattice. The picture is a direct rendering of
// the spectrum as physical geometry, not a reaction to it.
const FRAG = `
const float PI = 3.14159265;

float wavefield(vec2 p) {
  float r = length(p);
  float a = atan(p.y, p.x);
  float w = 0.0;
  for (int i = 0; i < 24; i++) {
    float fi = float(i);
    if (uDetail < 0.5 && mod(fi, 2.0) > 0.5) continue; // stride on low detail
    float band = uBands[i];
    if (band < 0.015) continue;
    float m = 1.0 + floor(fi / 4.0);  // radial order   1..6
    float n = mod(fi, 4.0) * 2.0;     // angular order  0,2,4,6
    float phase = uTime * (0.05 + 0.008 * m) + fi * 0.37;
    float radial = cos(m * PI * r) * exp(-0.5 * r);
    float angular = cos(n * a + phase);
    w += band * radial * angular;
  }
  return w * (1.0 + uBeatPulse * 0.5);
}

void main() {
  vec2 uv = roomUv(vUv);
  vec2 aspectFix = vec2(uResolution.x / uResolution.y, 1.0);
  vec2 p = (uv - 0.5) * aspectFix * 2.2;

  float r = length(p);
  float w = wavefield(p);

  // Sand: grains settle where the plate is nearly still (|w| ~ 0).
  float still = 1.0 - smoothstep(0.0, 0.09 + 0.05 * uEnergy, abs(w));
  float grainN = fract(sin(dot(p * 400.0, vec2(12.9898, 78.233))) * 43758.5453);
  float grain = step(1.0 - still * 0.9, grainN);

  // Hairline stroke exactly on the zero-crossings, antialiased by fwidth.
  float lineW = fwidth(w) * 1.5 + 0.001;
  float line = 1.0 - smoothstep(0.0, lineW, abs(w));

  float disc = smoothstep(1.05, 0.98, r);
  float shade = clamp(grain * 0.85 + line * 0.5, 0.0, 1.0) * disc;

  vec3 col = palette(0.08 + r * 0.15, uPalA, uPalB, uPalC, uPalD) * shade;
  outColor = vec4(col, 1.0);
}
`;

export const cymaticsScene = createFullscreenScene("cymatics", "Cymatics", FRAG);
