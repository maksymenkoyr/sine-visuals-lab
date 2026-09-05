// GLSL every Kaleidoscope style shares — see index.ts's header for the scene
// and styles.ts for what each style builds on top of this. Injected after
// createFullscreenScene's common uniforms and palette(), so everything here
// may call palette() and read the scene's setting uniforms.

/** Ink colour for band lines, navy rings and the Burst core: a near-black
 *  navy, not a scaled palette colour (that gave dark-red/dark-green rather
 *  than the reference's ink). */
export const INK_DARK = "vec3(0.05, 0.04, 0.11)";

/** Cell size at Tiling = 0.5, the size every style's constants are tuned
 *  for (index.ts's lattice zoom hands each style a cell of any size). Lives
 *  here rather than index.ts so styles.ts can import it without a cycle. */
export const CELL_MID = 1.8;

/** Octaves in the scale-cycling noise (zfbm below) at full detail; one
 *  fewer on a low tier. */
export const ZOOM_OCTAVES = 5;
/** How much of the room palette the texture styles' rainbow carries: their
 *  references run the whole spectrum, and a cosine room palette on its own
 *  covers a third of it; this keeps the room's tint without losing the
 *  rainbow. */
export const RAINBOW_ROOM_MIX = 0.35;
/** Where blue sits on vivid()'s rainbow (t in 0..1) — the phase the texture
 *  styles bias toward, since their references are blue-based. */
export const RAINBOW_BLUE = 0.33;

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

// Scale-cycling fbm: the infinite zoom. z is the zoom in octaves; as it
// grows every octave slides one step coarser, the finest fading in from
// nothing and the coarsest fading out past the top, and each octave's noise
// is seeded by its *absolute* index k + floor(z) — so when z crosses an
// integer, octave k at full zoom is exactly octave k-1 at zero zoom, and
// the picture keeps diving without ever repeating or snapping. Zooms about
// w = 0, so call it on coordinates centred on whatever should be dived
// into (a rosette centre). Ridged flips each octave about its middle for
// a shard-like texture.
float zfbm(vec2 w, float z, bool ridged) {
  float zi = floor(z);
  float zf = z - zi;
  int oct = uDetail < 0.5 ? ${ZOOM_OCTAVES - 1} : ${ZOOM_OCTAVES};
  float top = float(oct) - 1.0;
  float v = 0.0;
  float norm = 0.0;
  for (int k = 0; k < ${ZOOM_OCTAVES}; k++) {
    if (k >= oct) break;
    float x = float(k) - zf;
    float win = smoothstep(-1.0, 0.0, x) * (1.0 - smoothstep(top - 1.0, top, x));
    float amp = exp2(-x) * win;
    float j = float(k) + zi;
    vec2 seed = vec2(hash21(vec2(j, 1.3)), hash21(vec2(j, 7.9))) * 97.0;
    float nz = vnoise(w * exp2(x) + seed);
    if (ridged) nz = 1.0 - abs(nz * 2.0 - 1.0);
    v += amp * nz;
    norm += amp;
  }
  return v / max(norm, 1e-3);
}

// Coordinates relative to the nearest centre of a hexagonal lattice whose
// neighbouring centres sit s apart: the Voronoi cell is a hexagon of
// inradius s/2, so cell*0.5 means "the edge" for a square and a hex cell
// alike. The nearest lattice point to p is one of the four corners of the
// 60-degree rhombus it falls in (each half of that rhombus is an
// equilateral triangle, and the lattice's Voronoi hexagons cover a
// triangle by its own three vertices).
vec2 hexCell(vec2 p, float s) {
  vec2 b1 = vec2(s, 0.0);
  vec2 b2 = vec2(0.5 * s, 0.86602540 * s);
  float v = p.y / b2.y;
  float u = (p.x - v * b2.x) / s;
  vec2 f = vec2(floor(u), floor(v));
  vec2 best = p;
  float bd = 1e9;
  for (int i = 0; i < 2; i++) {
    for (int j = 0; j < 2; j++) {
      vec2 d = p - ((f.x + float(i)) * b1 + (f.y + float(j)) * b2);
      float dd = dot(d, d);
      if (dd < bd) { bd = dd; best = d; }
    }
  }
  return best;
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

// The full spectrum, tinted by the room palette (RAINBOW_ROOM_MIX), and
// pushed a little past the cosine's softness so hue steps read as edges.
vec3 vivid(float t) {
  vec3 rb = 0.5 + 0.5 * cos(TWO_PI * (t + vec3(0.0, 0.33, 0.67)));
  vec3 col = mix(rb, palette(t, uPalA, uPalB, uPalC, uPalD), ${RAINBOW_ROOM_MIX.toFixed(2)});
  return clamp((col - 0.5) * 1.35 + 0.5, 0.0, 1.0);
}

// Jittered-grid Voronoi: distance to the nearest and second-nearest cell
// point, and the nearest cell's hash (x: F1, y: F2, z: id).
vec3 voronoi(vec2 q) {
  vec2 i = floor(q);
  vec2 f = fract(q);
  float f1 = 8.0;
  float f2 = 8.0;
  float id = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int k = -1; k <= 1; k++) {
      vec2 g = vec2(float(k), float(j));
      vec2 o = vec2(hash21(i + g), hash21(i + g + 19.7));
      vec2 d = g + o - f;
      float dd = dot(d, d);
      if (dd < f1) { f2 = f1; f1 = dd; id = hash21(i + g + 7.3); }
      else if (dd < f2) { f2 = dd; }
    }
  }
  return vec3(sqrt(f1), sqrt(f2), id);
}

// The beat's brightness lift every style applies: the reference videos'
// brightness rides the loudness and pops on each beat (index.ts header).
vec3 beatLift(vec3 col, float amount) {
  return col * (1.0 + amount * uBeatSwell * uPulse);
}
`;
