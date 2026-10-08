// Sweep's fragment shader body (index.ts splices it into
// createFullscreenScene). Per pixel and per stack, every copy is composited
// front to back — the head first, then older copies behind it — until the
// pixel is covered (transmittance under COVERED) or the copies run out. A
// copy is the shape (shapeSdf) placed at its path point, scaled and turned
// there; its edge softness and fade grow with its age down the stack, its
// fill colour comes off the palette (pal5, or the room's inks) by its age,
// its depth inside the shape (Rim) and a linear Sheen, and its outline is
// drawn on top in one of stack.ts's OUTLINE_STYLES. Pixels outside a
// stack's bounding box (stack.ts's stackBounds, sent per frame) skip it.
// A copy's shape is a place on the cyclic SHAPES list (stack.ts's Shape
// drift and Morph): between two shapes, their distance fields are blended
// by a smoothstep, so each shape holds a moment before the next takes over.
//
// Two stacks (a Pair) are composited as layers: the first over the second
// and the ground, mixed by Multiply toward the first darkening what it
// covers like ink — the reel's overlaps measure as multiply, darker than
// either colour (docs/scenes/sweep.md, Measurements).
//
// Everything about the frame comes in one packed vec4 array, `uSw`, whose
// slots are stack.ts's `SW` table; the #defines below are generated from it
// so the two cannot drift apart.
import { NOISE_HASH_GLSL, NOISE_MASK } from "../../noiseHash.ts";
import { MAX_COPIES, MAX_STACKS, OUTLINE_STYLES, SHAPE_REACH, SHAPES, SW } from "./stack.ts";

const COVERED = 0.004;

const SW_DEFINES = Object.entries(SW)
  .map(([k, v]) => `#define SW_${k} ${v}`)
  .join("\n");

const shape = (name: (typeof SHAPES)[number]) => SHAPES.indexOf(name);
const style = (name: (typeof OUTLINE_STYLES)[number]) => OUTLINE_STYLES.indexOf(name);

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
  vec2 n1 = vec2(0.5, 0.8660254);
  vec2 n2 = vec2(-0.5, 0.8660254);
  return max(abs(q.x), max(abs(dot(q, n1)), abs(dot(q, n2)))) - 0.8660254;
}

// q in the shape's own unit space, already divided by Stretch along x.
// Every shape fits inside SHAPE_REACH (${SHAPE_REACH.toFixed(2)}) of its centre.
float shapeSdf(vec2 q, int shape) {
  if (shape == ${shape("Disc")}) return length(q) - 1.0;
  if (shape == ${shape("Box")}) return roundBox(q, vec2(0.6, 1.0), 0.12);
  if (shape == ${shape("Cube")}) return hexagon(q);
  if (shape == ${shape("Drop")}) {
    // A round body with a narrow tip toward +y.
    return smoothUnion(length(q - vec2(0.0, -0.25)) - 0.68, length(q - vec2(0.0, 0.72)) - 0.16, 0.55);
  }
  // Blob: two lobes melted together, the reel's first piece.
  return smoothUnion(length(q - vec2(-0.22, -0.3)) - 0.62, length(q - vec2(0.3, 0.36)) - 0.5, 0.35);
}

// Cube faces for a pointy-top hexagon: the top rhombus above the lines
// y = ±x·tan 30°, the left one below it on the left, the right one the
// rest. Comparisons rather than atan — this runs per copy per pixel.
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

// The room palette's inks, read the same cyclic way.
vec3 roomPal(float t) {
  float x = fract(t) * 4.0;
  int i = int(floor(x));
  float f = smoothstep(0.0, 1.0, x - float(i));
  return mix(uPalInk[i], uPalInk[(i + 1) % 4], f);
}

vec2 bezierAt(int j, float s) {
  vec4 a = uSw[SW_STACK0 + j * 4];
  vec4 b = uSw[SW_STACK0 + j * 4 + 1];
  float u = 1.0 - s;
  return u * u * u * a.xy + 3.0 * u * u * s * a.zw + 3.0 * u * s * s * b.xy + s * s * s * b.zw;
}

${NOISE_HASH_GLSL}

void main() {
  vec2 uv = roomUv(vUv);
  vec2 p = (uv - 0.5) * 2.0;
  p.x *= uResolution.x / max(uResolution.y, 1.0);
  float px = 2.0 / max(uResolution.y, 1.0);

  vec4 g = uSw[SW_GROUND];
  vec4 shapeC = uSw[SW_SHAPE];
  bool room = uSw[SW_FLAGS].x > 0.5;
  vec3 ground = room ? uPalGround : g.rgb;
  vec4 headC = uSw[SW_HEAD];
  vec3 accent = room ? uPalAccent : headC.rgb;
  float headAmt = headC.a;
  vec4 inkC = uSw[SW_INK];
  vec3 ink = room ? palRamp(0.06) : inkC.rgb;
  int outlineStyle = int(inkC.a + 0.5);
  vec3 light = vec3(0.97, 0.96, 0.98);
  vec4 look = uSw[SW_LOOK];
  vec4 look2 = uSw[SW_LOOK2];
  vec4 look3 = uSw[SW_LOOK3];
  vec4 look4 = uSw[SW_LOOK4];
  float outlineW = look.x;
  float reach = look.y;
  float opacity = look.z;
  float rim = look.w;
  float faces = look2.x;
  float blurMax = look2.y;
  float fade = look2.z;
  float bands = look2.w;
  int nStacks = int(look3.y + 0.5);
  // Fewer copies on weaker presets; blur and outlines keep the look.
  int n = int(clamp(floor(look3.x * mix(0.5, 1.0, uDetail) + 0.5), 2.0, ${MAX_COPIES.toFixed(1)}));
  float phase = look3.z;
  float sheen = look3.w;
  float headBlur = look4.x;
  float stretch = max(look4.y, 0.05);
  float multiply = look4.z;
  float stepH = look4.w;

  // Steps: the stack sampled in flat horizontal bands (the reel's blocky
  // piece) — x stays continuous, so the copies' edges cross each band as
  // upright bars.
  if (stepH > px) p.y = (floor(p.y / stepH) + 0.5) * stepH;

  vec3 layerC[${MAX_STACKS}];
  float layerT[${MAX_STACKS}];
  for (int j = 0; j < ${MAX_STACKS}; j++) {
    layerC[j] = vec3(0.0);
    layerT[j] = 1.0;
    if (j >= nStacks) continue;
    vec4 box = uSw[SW_BOX0 + j];
    if (p.x < box.x || p.y < box.y || p.x > box.z || p.y > box.w) continue;
    vec4 xf = uSw[SW_STACK0 + j * 4 + 2];
    vec4 st = uSw[SW_STACK0 + j * 4 + 3];
    vec3 acc = vec3(0.0);
    float T = 1.0;
    // The most one copy's boundary can differ from the next one's
    // (stack.ts's boundarySpeed over the copy spacing), and the widest any
    // copy reaches past its own edge (blur and outline). A pixel at
    // distance d outside a copy can't be touched by the next
    // (d - margin) / stride copies, so the loop jumps them — most of the
    // frame around a dense stack would otherwise walk every copy.
    float stride = st.w * abs(st.y - st.x) / float(n - 1);
    float margin = blurMax + 1.2 * outlineW + 2.0 * px;
    int k = 0;
    for (int it = 0; it < ${MAX_COPIES}; it++) {
      if (k >= n || T < ${COVERED}) break;
      float age = float(k) / float(n - 1);
      float s = mix(st.y, st.x, age);
      vec2 c = bezierAt(j, s);
      float sc = xf.x * exp2(xf.y * s);
      float soft = max(px, blurMax * mix(age * sqrt(age), 1.0, headBlur));
      vec2 d0 = p - c;
      float r = sc * ${SHAPE_REACH.toFixed(2)} * max(stretch, 1.0) + 2.0 * soft + 1.6 * outlineW;
      float outside = length(d0) - r;
      if (outside > 0.0) {
        k += max(1, int(outside / max(stride, 1e-5)));
        continue;
      }
      vec2 q = turn2(-(xf.z + xf.w * s)) * d0 / sc;
      vec2 qs = vec2(q.x / stretch, q.y);
      float sx = shapeC.x + shapeC.y * (s - shapeC.z);
      float sfl = floor(sx);
      int sa = int(mod(sfl, ${SHAPES.length.toFixed(1)}) + 0.5) % ${SHAPES.length};
      int sb = (sa + 1) % ${SHAPES.length};
      float sf = smoothstep(0.0, 1.0, sx - sfl);
      float d = shapeSdf(qs, sa);
      if (sf > 0.0) d = mix(d, shapeSdf(qs, sb), sf);
      d *= min(stretch, 1.0) * sc;
      if (d > margin) {
        k += max(1, int((d - margin) / max(stride, 1e-5)));
        continue;
      }

      float t = st.z + phase + age * bands + rim * sqrt(clamp(-d / sc, 0.0, 1.0)) + sheen * (0.35 * q.x + 0.2 * q.y);
      vec3 col = room ? roomPal(t) : pal5(t);
      float cubeW = (sa == ${shape("Cube")} ? 1.0 - sf : 0.0) + (sb == ${shape("Cube")} ? sf : 0.0);
      if (faces > 0.0 && cubeW > 0.0) col *= mix(1.0, cubeFace(qs), faces * cubeW);
      float alphaBase = opacity;
      if (k == 0) {
        col = mix(col, accent, headAmt);
        alphaBase = mix(opacity, 1.0, headAmt);
      }

      float cover = 1.0 - smoothstep(-soft, soft, d);
      float a = cover * alphaBase * (1.0 - fade * age);
      vec3 pre = col * a;

      // Outlines: only on sharp copies, and only as far down the stack as
      // Outline reach keeps them.
      if (outlineW > 0.0) {
        float keep = reach >= 1.0 ? 1.0 : 1.0 - smoothstep(reach * 0.5, max(reach, 0.001), age);
        keep *= clamp(2.0 * px / soft, 0.0, 1.0) * (1.0 - 0.5 * fade * age);
        float hw = 0.5 * outlineW;
        if (outlineStyle == ${style("Bevel")}) {
          // A light band just outside the dark edge (Lilac's contour piece:
          // white highlight, then the dark line, then the fill).
          float hl = keep * smoothstep(hw - px, hw, d) * (1.0 - smoothstep(2.2 * hw, 2.2 * hw + px, d));
          pre = pre * (1.0 - hl) + light * hl;
          a = a * (1.0 - hl) + hl;
        }
        float o = keep * (1.0 - smoothstep(hw, hw + px, abs(d)));
        vec3 oc = ink;
        if (outlineStyle == ${style("Alternate")} && (k - (k / 2) * 2) == 1) oc = light;
        else if (outlineStyle == ${style("Palette")}) oc = (room ? roomPal(t + 0.5) : pal5(t + 0.5)) * 0.7;
        pre = pre * (1.0 - o) + oc * o;
        a = a * (1.0 - o) + o;
      }

      acc += T * pre;
      T *= 1.0 - a;
      k++;
    }
    layerC[j] = acc;
    layerT[j] = T;
  }

  // The second stack and the ground behind the first; the first either
  // paints over that or darkens it like ink.
  vec3 back = layerC[1] + layerT[1] * ground;
  vec3 over = layerC[0] + layerT[0] * back;
  vec3 inked = (layerC[0] + layerT[0]) * back;
  vec3 outc = mix(over, inked, clamp(multiply, 0.0, 1.0));
  // Half a code value of dither so long gradients don't band.
  outc += (hashCell(floor(gl_FragCoord.xy), ${NOISE_MASK}, 7u) - 0.5) / 255.0;
  outColor = vec4(clamp(outc, 0.0, 1.0), 1.0);
}
`;
