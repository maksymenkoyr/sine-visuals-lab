// GLSL every Kaleidoscope style shares — see index.ts's header for the scene
// and styles.ts for what each style builds on top of this. Injected after
// createFullscreenScene's common uniforms and palette(), so everything here
// may call palette() and read the scene's setting uniforms.

/** Ink colour for band lines, navy rings and the Burst core: a near-black
 *  navy, not a scaled palette colour (that gave dark-red/dark-green rather
 *  than the reference's ink). */
export const INK_DARK = "vec3(0.05, 0.04, 0.11)";

export const KALEIDO_COMMON_GLSL = `
#define PI 3.14159265359
#define TWO_PI 6.28318530718

const vec3 INK = ${INK_DARK};

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Four octaves at full detail, three on a low tier (uDetail).
float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  int oct = uDetail < 0.5 ? 3 : 4;
  for (int i = 0; i < 4; i++) {
    if (i >= oct) break;
    v += amp * vnoise(p);
    p = p * 2.03 + vec2(17.1, 9.7);
    amp *= 0.5;
  }
  return v / (1.0 - amp);
}

// Mirror-fold an angle into wedge [0,1]: 0 on a petal's centre line, 1 on
// the seam between two petals. sgn is the side of the centre line, for the
// analytic derivatives (d af / d angle = sgn * n / PI).
float foldAngle(float a, float n, out float sgn) {
  float sector = TWO_PI / n;
  float u = mod(a + sector * 0.5, sector) - sector * 0.5;
  sgn = u < 0.0 ? -1.0 : 1.0;
  return abs(u) / (sector * 0.5);
}

// Petal profile over the folded angle, morphing round -> zigzag -> drop as
// m goes 0 -> 0.5 -> 1.
float petal(float af, float m) {
  float rnd = 0.5 + 0.5 * cos(af * PI);
  float zig = 1.0 - af;
  float spk = zig * zig * zig;
  return m < 0.5 ? mix(rnd, zig, m * 2.0) : mix(zig, spk, (m - 0.5) * 2.0);
}

// d petal / d af, for the analytic band-width estimate.
float petalD(float af, float m) {
  float rndD = -0.5 * PI * sin(af * PI);
  float zigD = -1.0;
  float z = 1.0 - af;
  float spkD = -3.0 * z * z;
  return m < 0.5 ? mix(rndD, zigD, m * 2.0) : mix(zigD, spkD, (m - 0.5) * 2.0);
}

// d smoothstep(e0, e1, x) / dx.
float smoothstepD(float e0, float e1, float x) {
  float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return 6.0 * t * (1.0 - t) / (e1 - e0);
}

// A posterised palette read: tex quantised into levels steps across
// span of the palette from tBase, with an ink line on every step. wq is
// the step coordinate's pixel footprint (fwidth is fine here — the noise
// styles have no band compression to fade, only the ink line to antialias).
vec3 posterColor(float tex, float levels, float tBase, float span, float lineHalf, float inkAmt) {
  float q = tex * levels;
  float wq = fwidth(q);
  float lv = floor(q);
  float f = fract(q);
  vec3 col = palette(tBase + lv / levels * span, uPalA, uPalB, uPalC, uPalD);
  float d = min(f, 1.0 - f);
  float line = 1.0 - smoothstep(lineHalf - wq, lineHalf + wq, d);
  return mix(col, INK, line * inkAmt);
}
`;
