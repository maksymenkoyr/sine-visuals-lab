// Sweep's fragment shader body (index.ts splices it into
// createFullscreenScene). Per pixel, every copy of every path is composited
// front to back — the head first, then older copies behind it — until the
// pixel is covered (transmittance under COVERED) or the copies run out. A
// copy is the piece's shape (shapeSdf) placed at its path point, scaled and
// turned there; its edge softness and fade grow with its age down the trail,
// its fill colour comes off the piece's five-stop palette (pal5) shifted by
// age and by depth inside the shape (the rim), and its outline is drawn on
// top. Pixels outside a path's bounding box (pieces.ts's pathBounds, sent
// per frame) skip that path entirely — most of the frame is plain ground.
//
// Everything about the piece comes in one packed vec4 array, `uSw`, whose
// slots are pieces.ts's `SW` table; the #defines below are generated from
// it so the two cannot drift apart.
import { NOISE_HASH_GLSL, NOISE_MASK } from "../../noiseHash.ts";
import { MAX_COPIES, MAX_PATHS, SHAPE_REACH, SHAPES, SW } from "./pieces.ts";

const COVERED = 0.004;

const SW_DEFINES = Object.entries(SW)
  .map(([k, v]) => `#define SW_${k} ${v}`)
  .join("\n");

export const SWEEP_UNIFORMS_GLSL = `uniform vec4 uSw[${SW.LEN}];`;

export const SWEEP_FRAG_BODY = `
${SW_DEFINES}

mat2 turn2(float a) {
  float c = cos(a), s = sin(a);
  return mat2(c, s, -s, c);
}

float smoothUnion(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

float roundBox(vec2 q, vec2 halfSize, float r) {
  vec2 e = abs(q) - halfSize + r;
  return length(max(e, 0.0)) + min(max(e.x, e.y), 0.0) - r;
}

// Pointy-top hexagon of circumradius 1 as three slabs (edge normals at 0,
// 60 and 120 degrees) — exact inside, slightly rounded past the corners,
// which only softens the outline there.
float hexagon(vec2 q) {
  float ri = 0.8660254;
  vec2 n1 = vec2(0.5, 0.8660254);
  vec2 n2 = vec2(-0.5, 0.8660254);
  return max(abs(q.x), max(abs(dot(q, n1)), abs(dot(q, n2)))) - ri;
}

// Every shape fits inside SHAPE_REACH (${SHAPE_REACH.toFixed(2)}) of its centre at scale 1.
float shapeSdf(vec2 q, int shape) {
  if (shape == ${SHAPES.disc}) return length(q) - 1.0;
  if (shape == ${SHAPES.rect}) return roundBox(q, vec2(0.6, 1.0), 0.12);
  if (shape == ${SHAPES.cube}) return hexagon(q);
  if (shape == ${SHAPES.drop}) {
    // A round body with a narrow tip toward +y.
    return smoothUnion(length(q - vec2(0.0, -0.25)) - 0.68, length(q - vec2(0.0, 0.72)) - 0.16, 0.55);
  }
  // Blob: two lobes melted together, the reel's first piece.
  return smoothUnion(length(q - vec2(-0.22, -0.3)) - 0.62, length(q - vec2(0.3, 0.36)) - 0.5, 0.35);
}

// Cube faces for a pointy-top hexagon: the top rhombus between 30 and 150
// degrees (above the lines y = ±x·tan 30°), the left one below it on the
// left, the right one the rest. Comparisons rather than atan — this runs
// per copy per pixel.
float cubeFace(vec2 q) {
  if (q.y > 0.57735 * abs(q.x)) return 1.08;
  if (q.x < 0.0) return 0.88;
  return 0.72;
}

vec3 pal5(float t) {
  float x = fract(t) * 5.0;
  int i = int(floor(x));
  float f = smoothstep(0.0, 1.0, x - float(i));
  return mix(uSw[SW_PAL + i].rgb, uSw[SW_PAL + (i + 1) % 5].rgb, f);
}

// The room palette's inks, read the same cyclic way — what Colours pulls
// the measured palette toward.
vec3 roomPal(float t) {
  float x = fract(t) * 4.0;
  int i = int(floor(x));
  float f = smoothstep(0.0, 1.0, x - float(i));
  return mix(uPalInk[i], uPalInk[(i + 1) % 4], f);
}

vec2 bezierAt(int j, float s) {
  vec4 a = uSw[SW_PATH0 + j * 4];
  vec4 b = uSw[SW_PATH0 + j * 4 + 1];
  float u = 1.0 - s;
  return u * u * u * a.xy + 3.0 * u * u * s * a.zw + 3.0 * u * s * s * b.xy + s * s * s * b.zw;
}

${NOISE_HASH_GLSL}

void main() {
  vec2 uv = roomUv(vUv);
  float size = max(uSize, 0.05);
  vec2 p = (uv - 0.5) * 2.0;
  p.x *= uResolution.x / max(uResolution.y, 1.0);
  p /= size;
  float px = 2.0 / max(uResolution.y, 1.0) / size;

  vec4 g = uSw[SW_GROUND];
  vec3 ground = g.rgb;
  int shape = int(g.a + 0.5);
  vec4 headC = uSw[SW_HEAD];
  vec4 inkC = uSw[SW_INK];
  vec3 ink = mix(inkC.rgb, palRamp(0.08), clamp(uColours, 0.0, 1.0));
  vec3 headCol = mix(headC.rgb, uPalAccent, clamp(uColours, 0.0, 1.0));
  float mode = inkC.a;
  vec4 look = uSw[SW_LOOK];
  vec4 look2 = uSw[SW_LOOK2];
  vec4 look3 = uSw[SW_LOOK3];
  float outlineW = look.x * uOutlines;
  float outlineAge = look.y;
  float fillAlpha = look.z;
  float rim = look.w;
  float faceShade = look2.x;
  float blurMax = look2.y * uBlur;
  float fade = look2.z;
  float cycles = look2.w;
  int nPaths = int(look3.y + 0.5);
  // Fewer copies on weaker presets; the blur and the outlines keep the look.
  int n = int(clamp(floor(look3.x * mix(0.5, 1.0, uDetail) + 0.5), 2.0, ${MAX_COPIES.toFixed(1)}));
  float stripePhase = look3.z;
  float sheen = look3.w;
  float headBlur = uSw[SW_LOOK4].x;
  float headAlpha = uSw[SW_LOOK4].y;

  vec3 acc = vec3(0.0);
  float T = 1.0;
  for (int j = 0; j < ${MAX_PATHS}; j++) {
    if (j >= nPaths || T < ${COVERED}) break;
    vec4 box = uSw[SW_BOX0 + j];
    if (p.x < box.x || p.y < box.y || p.x > box.z || p.y > box.w) continue;
    vec4 xf = uSw[SW_PATH0 + j * 4 + 2];
    vec4 st = uSw[SW_PATH0 + j * 4 + 3];
    for (int k = 0; k < ${MAX_COPIES}; k++) {
      if (k >= n || T < ${COVERED}) break;
      float age = float(k) / float(n - 1);
      float s = mix(st.y, st.x, age);
      vec2 c = bezierAt(j, s);
      float sc = mix(xf.x, xf.y, s);
      float soft = max(px, blurMax * mix(age * sqrt(age), 1.0, headBlur));
      vec2 d0 = p - c;
      if (dot(d0, d0) > pow(sc * ${SHAPE_REACH.toFixed(2)} + 2.0 * soft + outlineW, 2.0)) continue;
      vec2 q = turn2(-mix(xf.z, xf.w, s)) * d0 / sc;
      float d = shapeSdf(q, shape) * sc;

      float t = st.z + stripePhase + age * cycles + rim * sqrt(clamp(-d / sc, 0.0, 1.0)) + sheen * (0.35 * q.x + 0.2 * q.y);
      vec3 col = pal5(t);
      if (uColours > 0.0) col = mix(col, roomPal(t), min(uColours, 1.0));
      if (faceShade > 0.0) col *= mix(1.0, cubeFace(q), faceShade);
      if (k == 0) col = mix(col, headCol, headC.a);

      float cover = 1.0 - smoothstep(-soft, soft, d);
      float a = cover * (k == 0 ? headAlpha : fillAlpha) * (1.0 - fade * age);

      // Outlines: only on sharp copies, and only as far down the trail as
      // the piece keeps them.
      float o = 0.0;
      vec3 oc = ink;
      if (outlineW > 0.0) {
        float keep = outlineAge >= 1.0 ? 1.0 : 1.0 - smoothstep(outlineAge * 0.5, max(outlineAge, 0.001), age);
        keep *= clamp(2.0 * px / soft, 0.0, 1.0);
        o = keep * (1.0 - smoothstep(0.5 * outlineW, 0.5 * outlineW + px, abs(d))) * (1.0 - 0.5 * fade * age);
        if (mode > 1.5) oc = pal5(t + 0.5) * 0.7;
        else if (mode > 0.5 && (k - (k / 2) * 2) == 1) oc = vec3(0.96, 0.95, 0.97);
      }

      vec3 pre = col * a * (1.0 - o) + oc * o;
      float alpha = a * (1.0 - o) + o;
      acc += T * pre;
      T *= 1.0 - alpha;
    }
  }

  vec3 outc = acc + T * ground;
  // Half a code value of dither so long gradients don't band.
  outc += (hashCell(floor(gl_FragCoord.xy), ${NOISE_MASK}, 7u) - 0.5) / 255.0;
  outColor = vec4(clamp(outc, 0.0, 1.0), 1.0);
}
`;
