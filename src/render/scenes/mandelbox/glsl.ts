/**
 * Mandelbox Flight's two fragment bodies (index.ts splices them after the common header):
 *
 * - MARCH_BODY marches the view into the fractal flight.ts flies through, from the camera index.ts
 *   uploads, and shades what it hits the way the reference is lit: two hues that turn together, white
 *   metal highlights, white rims on the cells' convex edges (found from the distance field's
 *   Laplacian), black in the creases between cells (occlusion at a few screen-relative radii) and
 *   in the far depths. Every length is measured in pixels at the hit's distance or in the camera's
 *   gap to its nearest wall, so the picture looks the same at every depth of the flight.
 * - OUT_BODY scales the march up to the screen and dissolves from the last place's final frame.
 */
import { ITER, MAX_EXTRA } from "./flight.ts";

/** Tangent of half the vertical field of view. */
export const FOV_TAN = 0.62;
/** The most march steps any preset may ask for (index.ts's MARCH_STEPS). */
const MAX_STEPS = 200;

// Setting uniforms are u<Key> (card.ts): these names must not collide with them.
export const EXTRA_UNIFORMS = `
uniform vec3 uCamPos;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform vec3 uCamFwd;
uniform float uFold;      // the fold scale (flight.ts's foldScale)
uniform float uFolds;     // fold iterations now (flight.ts's foldsAt)
uniform float uGap;       // the camera's gap to its nearest wall: the scene's unit of length
uniform float uPixel;     // one target pixel's angle at unit distance
uniform float uSteps;     // march steps for this quality preset
uniform float uHueNow;    // turns
uniform float uFlashNow;  // the rim flash, 0..
uniform sampler2D uLive;
uniform sampler2D uHold;
uniform float uFade;
`;

export const MARCH_BODY = `
float de(vec3 p, out float trap) {
  vec3 z = p;
  float dr = 1.0;
  float fs = abs(uFold);
  trap = 1e9;
  for (int i = 0; i < ${ITER + MAX_EXTRA}; i++) {
    if (float(i) >= uFolds) break;
    z = clamp(z, -1.0, 1.0) * 2.0 - z;
    float r2 = dot(z, z);
    float k = r2 < 0.25 ? 4.0 : (r2 < 1.0 ? 1.0 / r2 : 1.0);
    z = z * (k * uFold) + p;
    dr = dr * k * fs + 1.0;
    trap = min(trap, r2);
  }
  return length(z) / dr;
}

// A colour of brightness y and colourfulness c at hue h (turns), from YIQ: every hue comes out about
// as bright as every other. A plain hue's brightness swings about tenfold round the wheel (blue to
// green), which turned the whole picture dim and glaring by turns as the colours drifted.
vec3 tint(float h, float y, float c) {
  float a = 6.2831853 * h;
  float i = c * cos(a), q = c * sin(a);
  return clamp(vec3(y + 0.956 * i + 0.621 * q, y - 0.272 * i - 0.647 * q, y - 1.106 * i + 1.703 * q), 0.0, 1.0);
}

void main() {
  vec2 p = roomUv(vUv) - 0.5;
  p.x *= uResolution.x / uResolution.y;
  vec3 rd = normalize(uCamFwd + (p.x * uCamRight + p.y * uCamUp) * ${(2 * FOV_TAN).toFixed(4)});

  float t = 0.0, d = 1.0, trap = 0.0, steps = 0.0, glow = 0.0;
  float tMax = uGap * 90.0;
  bool hit = false;
  for (int i = 0; i < ${MAX_STEPS}; i++) {
    if (float(i) >= uSteps) break;
    d = de(uCamPos + rd * t, trap);
    float foot = uPixel * max(t, uGap * 0.5);
    // Stopping at a pixel and a half keeps sub-pixel folds from sparkling.
    if (d < foot * 1.5) { hit = true; break; }
    glow += exp(-d / (foot * 2.5));
    t += d * 0.9;
    steps += 1.0;
    if (t > tMax) break;
  }

  vec3 tintA = tint(uHueNow, 0.58, 0.35);
  vec3 tintB = tint(uHueNow + 0.42, 0.5, 0.33);
  vec3 col = vec3(0.0);
  if (hit) {
    vec3 q = uCamPos + rd * t;
    float foot = uPixel * t;
    float h = foot * 2.2;
    float tr;
    vec2 k = vec2(1.0, -1.0);
    float a = de(q + k.xyy * h, tr);
    float b = de(q + k.yyx * h, tr);
    float c = de(q + k.yxy * h, tr);
    float e = de(q + k.xxx * h, tr);
    vec3 n = normalize(k.xyy * a + k.yyx * b + k.yxy * c + k.xxx * e);
    // The distance field's Laplacian times the probe size: above 0 on convex cell rims.
    float lap = (a + b + c + e - 4.0 * d) / (2.0 * h);
    float rim = smoothstep(0.25, 0.9, lap * uRims * (1.0 + 0.6 * uFlashNow));
    float ao = 0.0, w = 1.0;
    for (int j = 1; j <= 4; j++) {
      float r = foot * 3.0 * float(j * j);
      ao += w * clamp((r - de(q + n * r, tr)) / r, 0.0, 1.0);
      w *= 0.7;
    }
    ao = clamp(1.0 - 0.45 * ao, 0.0, 1.0);
    ao *= ao;
    vec3 l = normalize(-rd + uCamUp * 0.55 + uCamRight * 0.35);
    float diff = clamp(dot(n, l), 0.0, 1.0);
    float spec = pow(clamp(dot(n, normalize(l - rd)), 0.0, 1.0), 36.0);
    float band = fract(log2(trap + 1e-4) * 0.27);
    vec3 base = mix(tintA, tintB, smoothstep(0.3, 0.7, band));
    // The reference is lit at the edges: dim faces, bright rims.
    col = base * (0.03 + 0.72 * diff) * ao;
    col += vec3(spec * 0.7) * ao;
    col += vec3(rim * (0.95 + 0.45 * uFlashNow)) * sqrt(ao);
    col *= exp(-t / (uGap * 45.0));
  }
  col += tintA * glow * 0.004 * uRims;

  // The grade: saturation and an S-curve that crushes the darks, after a soft shoulder that keeps rims white.
  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = max(mix(vec3(luma), col, 1.0 + 0.7 * uPunch), 0.0);
  col = col / (1.0 + 0.35 * col);
  col = mix(col, smoothstep(0.06, 0.8, col), uPunch);
  outColor = vec4(col, 1.0);
}
`;

export const OUT_BODY = `
void main() {
  vec3 from = texture(uHold, vUv).rgb;
  vec3 to = texture(uLive, vUv).rgb;
  outColor = vec4(mix(from, to, uFade), 1.0);
}
`;
