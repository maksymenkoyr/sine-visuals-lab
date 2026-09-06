// Shaders for the Neon Gates scene. index.ts owns the design and the
// reference it was measured from, layout.ts owns what is in the tunnel;
// this file owns the picture. index.ts assembles each program from the
// common uniform block, the setting uniforms and the sources here.
//
// The gate pass draws one primitive: a neon tube segment swept through the
// shutter. Each instance is (object, mirror copy, segment): the vertex
// shader looks the object up in the uObjA/uObjB arrays, takes the
// segment's endpoints from the shape's index arithmetic (segmentOf, the
// same table as layout.ts's), places it in the tunnel, mirrors it, spins
// it, and projects it twice — where it is now and where it was a shutter
// ago — then emits an oriented bounding quad around those four screen
// points plus the stroke and the halo margin. The fragment shader samples
// the tube along the sweep and averages an anti-aliased core and a short
// halo, so the streaks the reference has are the motion of the 3D
// geometry itself, not a smear pasted on afterwards. Everything is
// additive into an RGBA8 target; the blur chain and the composite in
// index.ts turn that into the bloom and the tinted ground.
//
// Stroke is a tube radius in world units projected to pixels and floored
// at CORE_MIN_PX, so it is thin at the vanishing point and thick at the
// edge the way the reference's is. Past DOF_Z the halo widens with depth —
// the cheap depth of field that turns far gates into soft blobs.

import { MAX_OBJ, SEG_MAX, TUNNEL_LEN } from "./layout.ts";

/** Vertical focal length: the tunnel is seen through a wide lens. */
const FOCAL_Y = 1.0;
/** Nearest view depth a segment is clipped to. */
const NEAR = 0.12;
/** Tube half-width on screen, in pixels at a 720-high frame: the floor
 *  keeps the vanishing point crisp, the cap is the reference's edge stroke. */
const CORE_MIN_PX = 0.9;
const CORE_MAX_PX = 4.5;
/** Halo around the core: width in px, its gain at the core edge. */
const HALO_PX = 3.0;
const HALO_GAIN = 0.16;
/** Depth of field: beyond DOF_Z the halo widens by DOF_GAIN px per unit. */
const DOF_Z = 5.0;
const DOF_GAIN = 0.25;
/** Haze: brightness falls off with depth, so the far cluster at the
 *  vanishing point stays fine instead of burning white. */
const HAZE = 0.28;
/** A gate fades out over its last stretch before the camera instead of
 *  filling the frame. */
const NEAR_FADE_Z = 1.1;
/** Most samples along the shutter sweep (one per stroke width of sweep,
 *  so a long smear stays a smear and a short one costs little), and how
 *  dim the tail end is. */
const SWEEP_TAPS = 40;
const TAIL_DIM = 0.35;
/** How much the core pushes toward white. */
const WHITE_CORE = 0.2;
/** Onset flash: extra gain on the nearest gates. */
const FLASH_GAIN = 1.6;
/** Blur stride in texels of the level being blurred. */
export const BLUR_STRIDE = 2.4;
/** Composite knee: per-channel Reinhard just above white. */
const TONE_KNEE = 1.25;

const f = (v: number) => v.toFixed(4);

/** Room-space perspective camera (ambience.ts's pattern): world -> room NDC,
 *  then the device's slice of it. */
export const CAMERA_GLSL = `
const float FOCAL_Y = ${f(FOCAL_Y)};
const float NEAR = ${f(NEAR)};

float roomAspect() {
  return (uResolution.x / max(uViewport.z, 0.0001)) / (uResolution.y / max(uViewport.w, 0.0001));
}
vec2 project(vec3 view) {
  return vec2(view.x * FOCAL_Y / roomAspect(), view.y * FOCAL_Y) / max(view.z, NEAR);
}
vec2 toDevice(vec2 ndc) {
  vec2 uv01 = (ndc * 0.5 + 0.5 - uViewport.xy) / uViewport.zw;
  return uv01 * 2.0 - 1.0;
}
`;

export const GATE_VERT_BODY = `
const int SEG_MAX = ${SEG_MAX};
const float TUNNEL_LEN = ${f(TUNNEL_LEN)};
const float PI = 3.14159265;
const float CORE_MIN_PX = ${f(CORE_MIN_PX)};
const float CORE_MAX_PX = ${f(CORE_MAX_PX)};
const float HALO_PX = ${f(HALO_PX)};
const float DOF_Z = ${f(DOF_Z)};
const float DOF_GAIN = ${f(DOF_GAIN)};
const float HAZE = ${f(HAZE)};
const float NEAR_FADE_Z = ${f(NEAR_FADE_Z)};
const float FLASH_GAIN = ${f(FLASH_GAIN)};

uniform vec4 uObjA[${MAX_OBJ}];
uniform vec4 uObjB[${MAX_OBJ}];
uniform int uObjCount;
uniform int uCopies;
uniform float uTravel;
uniform float uTravelDelta;
uniform float uSpinPos;
uniform float uSpinDelta;
uniform vec3 uPrimary;
uniform vec3 uSecondary;
uniform vec3 uAccent;
uniform float uFlash;
uniform float uCoreGain;

flat out vec4 vSegNow;
flat out vec4 vSegPrev;
flat out float vHalfPx;
flat out float vHaloPx;
flat out vec3 vColor;

float hash11(float n) { return fract(sin(n * 127.1 + 311.7) * 43758.5453); }

// Segment i of a shape in object space. Mirrored in layout.ts's segmentOf.
void segmentOf(int shape, int i, vec3 dims, out vec3 a, out vec3 b, out bool used) {
  float h = dims.z * 0.5;
  used = true;
  if (shape == 0) {
    int k = i - (i / 6) * 6;
    float a0 = PI * 0.5 + PI / 3.0 * float(k);
    float a1 = a0 + PI / 3.0;
    vec2 p0 = dims.x * vec2(cos(a0), sin(a0));
    vec2 p1 = dims.x * vec2(cos(a1), sin(a1));
    if (i < 6) { a = vec3(p0, -h); b = vec3(p1, -h); }
    else if (i < 12) { a = vec3(p0, h); b = vec3(p1, h); }
    else { a = vec3(p0, -h); b = vec3(p0, h); }
  } else if (shape == 1) {
    if (i >= 12) { used = false; a = b = vec3(0.0); return; }
    int k = i - (i / 4) * 4;
    int k1 = k + 1 - ((k + 1) / 4) * 4;
    vec2 c0 = vec2((k == 0 || k == 3) ? -dims.x : dims.x, k < 2 ? -dims.y : dims.y);
    vec2 c1 = vec2((k1 == 0 || k1 == 3) ? -dims.x : dims.x, k1 < 2 ? -dims.y : dims.y);
    if (i < 4) { a = vec3(c0, -h); b = vec3(c1, -h); }
    else if (i < 8) { a = vec3(c0, h); b = vec3(c1, h); }
    else { a = vec3(c0, -h); b = vec3(c0, h); }
  } else {
    if (i != 0) { used = false; a = b = vec3(0.0); return; }
    a = vec3(0.0, 0.0, -h);
    b = vec3(0.0, 0.0, h);
  }
}

// Mirror copy c of a cross-section point: bit 0 flips x, bit 1 flips y,
// bit 2 swaps the axes. Returns false for a copy that would land on top
// of the object itself (an object on an axis mirrored across that axis).
bool mirrorCopy(int c, inout vec2 p) {
  if ((c & 4) != 0) p = p.yx;
  if ((c & 1) != 0) {
    if (p.x == 0.0) return false;
    p.x = -p.x;
  }
  if ((c & 2) != 0) {
    if (p.y == 0.0) return false;
    p.y = -p.y;
  }
  return true;
}

vec2 rot(vec2 p, float a) {
  float c = cos(a), s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

// Clips a segment to the near plane; false when it is entirely behind it.
bool clipNear(inout vec3 a, inout vec3 b) {
  if (a.z < NEAR && b.z < NEAR) return false;
  if (a.z < NEAR) a = mix(a, b, (NEAR - a.z) / (b.z - a.z));
  if (b.z < NEAR) b = mix(b, a, (NEAR - b.z) / (a.z - b.z));
  return true;
}

void main() {
  int seg = gl_InstanceID - (gl_InstanceID / SEG_MAX) * SEG_MAX;
  int rest = gl_InstanceID / SEG_MAX;
  int copy = rest - (rest / uCopies) * uCopies;
  int obj = rest / uCopies;
  // Pixel space is the drawing buffer: the pass renders into the scene's
  // own target of exactly that size, so gl_FragCoord matches.
  vec2 vpPx = max(uResolution, vec2(1.0));

  vec4 A = uObjA[obj];
  vec4 B = uObjB[obj];
  int key = int(floor(A.w / 4.0 + 0.01));
  int shape = int(A.w + 0.5) - 4 * key;
  vec3 sa, sb;
  bool used;
  segmentOf(shape, seg, B.xyz, sa, sb, used);

  vec2 centre = A.xy;
  bool drawn = used && obj < uObjCount && mirrorCopy(copy, centre);
  if (!drawn) { gl_Position = vec4(2.0, 2.0, 0.0, 1.0); return; }
  // The copy mirrors the object's own frame as well as its place: a
  // mirrored hexagon is a hexagon, so only the sign pattern matters.
  bool swapped = (copy & 4) != 0;
  vec2 fa = swapped ? sa.yx : sa.xy;
  vec2 fb = swapped ? sb.yx : sb.xy;
  if ((copy & 1) != 0) { fa.x = -fa.x; fb.x = -fb.x; }
  if ((copy & 2) != 0) { fa.y = -fa.y; fb.y = -fb.y; }

  float zRel = mod(A.z - uTravel, TUNNEL_LEN);
  float zPrev = zRel + uTravelDelta;
  vec3 nowA = vec3(rot(centre + fa, uSpinPos), zRel + sa.z);
  vec3 nowB = vec3(rot(centre + fb, uSpinPos), zRel + sb.z);
  float spinPrev = uSpinPos - uSpinDelta;
  vec3 prevA = vec3(rot(centre + fa, spinPrev), zPrev + sa.z);
  vec3 prevB = vec3(rot(centre + fb, spinPrev), zPrev + sb.z);
  bool nowOk = clipNear(nowA, nowB);
  bool prevOk = clipNear(prevA, prevB);
  if (!nowOk) { gl_Position = vec4(2.0, 2.0, 0.0, 1.0); return; }
  if (!prevOk) { prevA = nowA; prevB = nowB; }

  vec2 pa = (toDevice(project(nowA)) * 0.5 + 0.5) * vpPx;
  vec2 pb = (toDevice(project(nowB)) * 0.5 + 0.5) * vpPx;
  vec2 qa = (toDevice(project(prevA)) * 0.5 + 0.5) * vpPx;
  vec2 qb = (toDevice(project(prevB)) * 0.5 + 0.5) * vpPx;

  // Stroke: the tube radius seen at the segment's mean depth.
  float zMid = 0.5 * (nowA.z + nowB.z);
  float pxScale = vpPx.y / 720.0;
  float halfPx = clamp(B.w * FOCAL_Y * vpPx.y * 0.5 / zMid, CORE_MIN_PX * pxScale, CORE_MAX_PX * pxScale);
  float haloPx = (HALO_PX + DOF_GAIN * max(0.0, zMid - DOF_Z)) * pxScale;
  float margin = halfPx + haloPx * 3.0 + 1.0;

  // Oriented bounding quad around the four sweep points.
  vec2 run = pb - pa;
  vec2 sweep = qa - pa;
  vec2 u = dot(run, run) > dot(sweep, sweep) ? run : sweep;
  u = dot(u, u) > 1e-6 ? normalize(u) : vec2(1.0, 0.0);
  vec2 v = vec2(-u.y, u.x);
  vec2 uMinMax = vec2(min(min(dot(pa, u), dot(pb, u)), min(dot(qa, u), dot(qb, u))),
                      max(max(dot(pa, u), dot(pb, u)), max(dot(qa, u), dot(qb, u)))) + vec2(-margin, margin);
  vec2 vMinMax = vec2(min(min(dot(pa, v), dot(pb, v)), min(dot(qa, v), dot(qb, v))),
                      max(max(dot(pa, v), dot(pb, v)), max(dot(qa, v), dot(qb, v)))) + vec2(-margin, margin);
  // Two triangles: (0,1,2) = min-min, max-min, min-max; (3,4,5) = min-max,
  // max-min, max-max.
  int corner = gl_VertexID;
  float cu = (corner == 1 || corner == 4 || corner == 5) ? uMinMax.y : uMinMax.x;
  float cv = (corner == 2 || corner == 3 || corner == 5) ? vMinMax.y : vMinMax.x;
  vec2 px = u * cu + v * cv;
  gl_Position = vec4(px / vpPx * 2.0 - 1.0, 0.0, 1.0);

  vSegNow = vec4(pa, pb);
  vSegPrev = vec4(qa, qb);
  vHalfPx = halfPx;
  vHaloPx = haloPx;

  vec3 col = key == 2 ? uAccent : (key == 1 ? uSecondary : uPrimary);
  float gain = (0.75 + 0.5 * hash11(float(obj) * 3.1 + 7.0))
    * exp(-HAZE * zMid)
    * smoothstep(NEAR, NEAR_FADE_Z, zMid)
    * (1.0 + FLASH_GAIN * uFlash * exp(-0.6 * zMid))
    * uCoreGain;
  vColor = col * gain;
}
`;

export const GATE_FRAG_BODY = `
const int SWEEP_TAPS = ${SWEEP_TAPS};
const float TAIL_DIM = ${f(TAIL_DIM)};
const float HALO_GAIN = ${f(HALO_GAIN)};
const float WHITE_CORE = ${f(WHITE_CORE)};

flat in vec4 vSegNow;
flat in vec4 vSegPrev;
flat in float vHalfPx;
flat in float vHaloPx;
flat in vec3 vColor;

float sdSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h);
}

void main() {
  vec2 p = gl_FragCoord.xy;
  float sweepLen = max(length(vSegNow.xy - vSegPrev.xy), length(vSegNow.zw - vSegPrev.zw));
  // One tap per stroke width of sweep keeps the smear continuous; the cap
  // follows quality so a TV spends less per pixel on the nearest gates.
  int maxTaps = int(mix(12.0, float(SWEEP_TAPS), uDetail));
  int taps = clamp(int(sweepLen / max(vHalfPx * 1.2, 1.0)) + 1, 1, maxTaps);
  float core = 0.0;
  float halo = 0.0;
  float wsum = 0.0;
  for (int k = 0; k < SWEEP_TAPS; k++) {
    if (k >= taps) break;
    float t = (float(k) + 0.5) / float(taps);
    vec2 a = mix(vSegPrev.xy, vSegNow.xy, t);
    vec2 b = mix(vSegPrev.zw, vSegNow.zw, t);
    float d = sdSegment(p, a, b) - vHalfPx;
    float w = mix(TAIL_DIM, 1.0, t);
    core += w * (1.0 - smoothstep(-0.5, 0.75, d));
    halo += w * exp(-max(d, 0.0) / vHaloPx);
    wsum += w;
  }
  core /= wsum;
  halo /= wsum;
  vec3 col = mix(vColor, vec3(max(max(vColor.r, vColor.g), vColor.b)), WHITE_CORE * core) * core
    + vColor * halo * HALO_GAIN;
  outColor = vec4(col, 1.0);
}
`;

/** 9-tap separable Gaussian; the step is set per pass by index.ts. */
export const BLUR_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uBlurStep;

void main() {
  vec3 c = texture(uTex, vUv).rgb * 0.2270270;
  c += (texture(uTex, vUv + uBlurStep).rgb + texture(uTex, vUv - uBlurStep).rgb) * 0.1945946;
  c += (texture(uTex, vUv + uBlurStep * 2.0).rgb + texture(uTex, vUv - uBlurStep * 2.0).rgb) * 0.1216216;
  c += (texture(uTex, vUv + uBlurStep * 3.0).rgb + texture(uTex, vUv - uBlurStep * 3.0).rgb) * 0.0540541;
  c += (texture(uTex, vUv + uBlurStep * 4.0).rgb + texture(uTex, vUv - uBlurStep * 4.0).rgb) * 0.0162162;
  outColor = vec4(c, 1.0);
}
`;

/** Ground plus the sharp gates plus two bloom levels, through a knee. */
export const COMPOSITE_BODY = `
const float TONE_KNEE = ${f(TONE_KNEE)};
uniform sampler2D uSharpTex;
uniform sampler2D uGlowATex;
uniform sampler2D uGlowBTex;
uniform vec3 uGround;
uniform float uVignette;
uniform float uGlowAGain;
uniform float uGlowBGain;
uniform float uBlackFrame;
uniform float uFlash;

void main() {
  vec2 ruv = roomUv(vUv);
  vec2 q = (ruv - 0.5) * vec2(roomAspect(), 1.0) * 2.0;
  float r = length(q);
  vec3 ground = uGround * mix(1.0, uVignette, smoothstep(0.2, 1.3, r)) * (1.0 + 0.5 * uFlash);
  vec3 sharpC = texture(uSharpTex, vUv).rgb;
  vec3 glow = texture(uGlowATex, vUv).rgb * uGlowAGain + texture(uGlowBTex, vUv).rgb * uGlowBGain;
  // Per-channel Reinhard: an overdriven core keeps its hue on the way to
  // white instead of clipping one channel first (powder.ts's lesson).
  vec3 col = ground + sharpC + glow;
  col = col / (1.0 + col / TONE_KNEE);
  col = 1.0 - exp(-col * 1.5);
  outColor = vec4(col * (1.0 - uBlackFrame), 1.0);
}
`;
