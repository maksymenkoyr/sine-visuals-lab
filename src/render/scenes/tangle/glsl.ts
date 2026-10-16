// Shaders for Tangle (index.ts says what the scene is and how it is wired).
//
// Four programs:
// - SIM_FRAG: one step of the warp. Every texel of the position texture
//   reads the texture back at its own uv plus a noise offset (a manual
//   bilinear tap, wrapped around the sphere's longitude and clamped at the
//   poles), then mixes toward its home on the sphere by uBlend. The position
//   lives in two RGBA8 targets at 16 bits an axis (see packAxis below), the
//   same packing powder.ts uses — this repo renders only into 8-bit formats
//   (chladni.ts's header says why EXT_color_buffer_float is left unused).
// - SEG_VERT/SEG_FRAG: one anti-aliased line segment per pair of
//   neighbouring texels (along u and along v), added into an R8 target.
//   Where a basin boundary separates two copied positions, the pairs across
//   it draw the straight chord between them; inside a basin the pair has no
//   length and its quad piles onto the knot.
// - KNOT_VERT/KNOT_FRAG: one faint point per texel into a quarter-res
//   target, blurred tight for a core and wide for a halo: the flares. A line spreads its texels thin and
//   barely registers there; a knot, where thousands sit on one spot,
//   saturates its pixel and the blur turns it into a flare. (An 8-bit
//   target can't hold a knot's brightness at full res: a point there clips
//   at the same white as a line.)
// - BLUR_FRAG: one direction of a separable Gaussian, on the half-res glow.
// - COMPOSITE_FRAG: red, green and blue read from three frames of the
//   segment history (the colour fringe), the glow added, toned and laid on
//   the ground. GLOW_SRC_FRAG is the same three-frame read into the glow's
//   half-res source, so the glow carries the fringe too.
import { NOISE_HASH_GLSL, NOISE_MASK } from "../../noiseHash.ts";

/** Positions stay inside the unit sphere: every step is a blend of sphere
 *  points, so the packing range is exactly the sphere's radius. */
export const POS_RANGE = 1.0;

const PACK_GLSL = `
float unpackAxis(vec2 c) {
  vec2 b = floor(c * 255.0 + 0.5);
  float v = (b.x * 256.0 + b.y) / 65535.0;
  return (v * 2.0 - 1.0) * ${POS_RANGE.toFixed(4)};
}

vec2 packAxis(float p) {
  float u = floor(clamp(p / ${POS_RANGE.toFixed(4)} * 0.5 + 0.5, 0.0, 1.0) * 65535.0 + 0.5);
  float hi = floor(u / 256.0);
  return vec2(hi, u - hi * 256.0) / 255.0;
}

vec3 fetchPos(highp sampler2D a, highp sampler2D b, ivec2 t) {
  vec4 ca = texelFetch(a, t, 0);
  vec4 cb = texelFetch(b, t, 0);
  return vec3(unpackAxis(ca.rg), unpackAxis(ca.ba), unpackAxis(cb.rg));
}

const float PI = 3.14159265358979;
const float TAU = 6.28318530717959;

// The home of texel uv on the unit sphere: u runs once round the equator,
// v from pole to pole.
vec3 sphereAt(vec2 uv) {
  float th = uv.x * TAU;
  float ph = uv.y * PI;
  return vec3(sin(ph) * cos(th), cos(ph), sin(ph) * sin(th));
}
`;

export const SIM_FRAG = `#version 300 es
precision highp float;
${NOISE_HASH_GLSL}
${PACK_GLSL}

uniform highp sampler2D uPosA;
uniform highp sampler2D uPosB;
uniform float uSide;
// Offset amplitudes, in uv units per step, and cell counts across the
// texture — whole numbers, so each octave wraps round the longitude.
uniform float uAmp;
uniform float uFreq;
uniform float uAmpFine;
uniform float uFreqFine;
// Each octave's drift phase, already wrapped to NOISE_PERIOD on the JS side.
uniform float uPhase;
uniform float uPhaseFine;
uniform float uBlend;

layout(location = 0) out vec4 outA;
layout(location = 1) out vec4 outB;

const int MASK = ${NOISE_MASK};

int wrapI(int i, int n) {
  int m = i % n;
  return m < 0 ? m + n : m;
}

// Two-valued value noise on a lattice periodic in x (period cells), with a
// third axis z that the drift moves along: each whole step of z is an
// independent hash stream, blended smoothly. Cells are hashed by integer
// index (NOISE_HASH_GLSL) and the drift phase arrives already wrapped, as
// noiseHash.ts's header requires of a noise coordinate that grows.
vec2 vnoise(vec2 p, float z, int period, uint seed) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 w = f * f * (3.0 - 2.0 * f);
  float iz = floor(z);
  float fz = z - iz;
  float wz = fz * fz * (3.0 - 2.0 * fz);
  int x0 = wrapI(int(i.x), period);
  int x1 = wrapI(int(i.x) + 1, period);
  float y0 = i.y;
  float y1 = i.y + 1.0;
  vec2 layer[2];
  for (int k = 0; k < 2; k++) {
    uint s = seed + uint((int(iz) + k) & MASK) * 0x632be5abu;
    vec2 a = hash2Cell(vec2(float(x0), y0), MASK, s);
    vec2 b = hash2Cell(vec2(float(x1), y0), MASK, s);
    vec2 c = hash2Cell(vec2(float(x0), y1), MASK, s);
    vec2 d = hash2Cell(vec2(float(x1), y1), MASK, s);
    layer[k] = mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
  }
  return mix(layer[0], layer[1], wz) * 2.0 - 1.0;
}

// One texel, with the sphere's own topology: longitude wraps, and a row past
// a pole continues down the far side, half a turn round.
vec3 texelOnSphere(int x, int y, int n) {
  if (y < 0) {
    y = -1 - y;
    x += n / 2;
  } else if (y >= n) {
    y = 2 * n - 1 - y;
    x += n / 2;
  }
  return fetchPos(uPosA, uPosB, ivec2(wrapI(x, n), y));
}

// The position texture read at a fractional texel coordinate, bilinear by
// hand on the sphere's topology.
vec3 tapPos(vec2 tc) {
  int n = int(uSide);
  vec2 f = tc - 0.5;
  vec2 i0 = floor(f);
  vec2 w = f - i0;
  int x = int(i0.x);
  int y = int(i0.y);
  vec3 p00 = texelOnSphere(x, y, n);
  vec3 p10 = texelOnSphere(x + 1, y, n);
  vec3 p01 = texelOnSphere(x, y + 1, n);
  vec3 p11 = texelOnSphere(x + 1, y + 1, n);
  return mix(mix(p00, p10, w.x), mix(p01, p11, w.x), w.y);
}

void main() {
  vec2 uv = floor(gl_FragCoord.xy) / uSide + 0.5 / uSide;
  vec2 off = uAmp * vnoise(uv * uFreq, uPhase, int(uFreq), 11u)
           + uAmpFine * vnoise(uv * uFreqFine, uPhaseFine, int(uFreqFine), 29u);
  vec3 p = tapPos((uv + off) * uSide);
  p = mix(p, sphereAt(uv), uBlend);
  outA = vec4(packAxis(p.x), packAxis(p.y));
  outB = vec4(packAxis(p.z), 0.0, 1.0);
}
`;

const CAMERA_GLSL = `
// Camera: rotation (world to view), distance from the centre, and the
// focal length in half-heights of the room.
uniform mat3 uRot;
uniform float uCamDist;
uniform float uFocal;
uniform vec2 uRoomPx;    // the whole room's size in pixels
uniform vec4 uViewport;  // this device's slice of the room: x, y, w, h

// Room pixels of a world point, and its depth in front of the camera.
vec3 project(vec3 p) {
  vec3 v = uRot * p;
  float z = uCamDist - v.z;
  vec2 ndc = vec2(v.x, v.y) * (uFocal / max(z, 1e-3));
  // ndc is in half-heights; x spreads over the room's aspect.
  vec2 room = vec2(ndc.x * uRoomPx.y / uRoomPx.x, ndc.y) * 0.5 + 0.5;
  return vec3(room * uRoomPx, z);
}
`;

export const SEG_VERT = `#version 300 es
precision highp float;
precision highp int;
${PACK_GLSL}

uniform highp sampler2D uPosA;
uniform highp sampler2D uPosB;
uniform float uSide;
${CAMERA_GLSL}
uniform float uHalfW;    // stroke half-width, device pixels
uniform float uGain;

out float vAcross;
out float vAlong;
out float vLen;
out float vGain;

void main() {
  int n = int(uSide);
  int texel = gl_InstanceID >> 1;
  int dir = gl_InstanceID & 1;
  ivec2 t = ivec2(texel % n, texel / n);
  ivec2 nb = dir == 0 ? ivec2((t.x + 1) % n, t.y) : ivec2(t.x, min(t.y + 1, n - 1));
  vec3 a = fetchPos(uPosA, uPosB, t);
  vec3 b = fetchPos(uPosA, uPosB, nb);
  vec3 pa = project(a);
  vec3 pb = project(b);

  // A texel's share of the sphere: rows near a pole crowd onto a tiny
  // circle, and at full weight they'd light the poles up as two knots.
  float v = (float(t.y) + 0.5) / uSide;
  float area = sin(v * PI);

  // Corner of the quad: along in {0,1} (which end), across in {-1,+1}.
  int c = gl_VertexID;
  float along = (c == 1 || c == 2 || c == 4) ? 1.0 : 0.0;
  float across = (c == 2 || c == 4 || c == 5) ? 1.0 : -1.0;

  vec2 d = pb.xy - pa.xy;
  float len = length(d);
  vec2 dirv = len > 1e-4 ? d / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dirv.y, dirv.x);
  float pad = uHalfW + 1.0;
  vec2 room = mix(pa.xy, pb.xy, along) + dirv * (along * 2.0 - 1.0) * pad + nrm * across * pad;

  vAcross = across * pad;
  vAlong = along * (len + 2.0 * pad) - pad;
  vLen = len;
  vGain = uGain * area;
  if (pa.z < 0.05 || pb.z < 0.05 || (dir == 1 && t.y == n - 1)) vGain = 0.0;

  vec2 roomUv = room / uRoomPx;
  vec2 dev = (roomUv - uViewport.xy) / uViewport.zw;
  gl_Position = vec4(dev * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const SEG_FRAG = `#version 300 es
precision highp float;
uniform float uHalfW;
in float vAcross;
in float vAlong;
in float vLen;
in float vGain;
out vec4 outColor;

void main() {
  if (vGain <= 0.0) discard;
  // Distance to the segment (a capsule), in pixels.
  float s = clamp(vAlong, 0.0, vLen);
  float dist = length(vec2(vAlong - s, vAcross));
  float cover = clamp(uHalfW + 0.5 - dist, 0.0, 1.0);
  if (cover <= 0.0) discard;
  outColor = vec4(cover * vGain, 0.0, 0.0, 1.0);
}
`;

export const KNOT_VERT = `#version 300 es
precision highp float;
precision highp int;
${PACK_GLSL}

uniform highp sampler2D uPosA;
uniform highp sampler2D uPosB;
uniform float uSide;
${CAMERA_GLSL}
uniform float uPointPx;  // point diameter, in the glow target's pixels
out float vGain;

void main() {
  int n = int(uSide);
  ivec2 t = ivec2(gl_VertexID % n, gl_VertexID / n);
  vec3 p = project(fetchPos(uPosA, uPosB, t));
  float v = (float(t.y) + 0.5) / uSide;
  vGain = p.z < 0.05 ? 0.0 : sin(v * PI);
  vec2 dev = (p.xy / uRoomPx - uViewport.xy) / uViewport.zw;
  gl_Position = vec4(dev * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = uPointPx;
}
`;

export const KNOT_FRAG = `#version 300 es
precision highp float;
uniform float uGain;
in float vGain;
out vec4 outColor;
void main() {
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(d, d);
  if (r2 > 1.0 || vGain <= 0.0) discard;
  float a = (1.0 - r2) * (1.0 - r2) * vGain * uGain;
  outColor = vec4(a, a, a, 1.0);
}
`;

const FRINGE_GLSL = `
uniform sampler2D uSegR;
uniform sampler2D uSegG;
uniform sampler2D uSegB;
// Line coverage, red/green/blue each from its own moment of the history.
vec3 fringe(vec2 uv) {
  return vec3(texture(uSegR, uv).r, texture(uSegG, uv).r, texture(uSegB, uv).r);
}
`;

export const GLOW_SRC_FRAG = `#version 300 es
precision highp float;
${FRINGE_GLSL}
uniform float uLineGlow;
in vec2 vUv;
out vec4 outColor;
void main() {
  outColor = vec4(fringe(vUv) * uLineGlow, 1.0);
}
`;

export const BLUR_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uStep;   // one tap's offset, in uv
// Only what lies above the knee passes, rescaled to 0..1 (0 = everything):
// the flares' first pass keeps the knots and drops the haze of the lines.
uniform float uKnee;
in vec2 vUv;
out vec4 outColor;
vec3 tap(vec2 uv) {
  return max(texture(uSrc, uv).rgb - uKnee, 0.0) / (1.0 - uKnee);
}
void main() {
  // 9 taps, Gaussian weights at sigma = 2 taps.
  const float W0 = 0.2270270;
  const float W1 = 0.1945946;
  const float W2 = 0.1216216;
  const float W3 = 0.0540541;
  const float W4 = 0.0162162;
  vec3 c = tap(vUv) * W0;
  c += (tap(vUv + uStep) + tap(vUv - uStep)) * W1;
  c += (tap(vUv + 2.0 * uStep) + tap(vUv - 2.0 * uStep)) * W2;
  c += (tap(vUv + 3.0 * uStep) + tap(vUv - 3.0 * uStep)) * W3;
  c += (tap(vUv + 4.0 * uStep) + tap(vUv - 4.0 * uStep)) * W4;
  outColor = vec4(c, 1.0);
}
`;

export const COMPOSITE_FRAG = `#version 300 es
precision highp float;
${FRINGE_GLSL}
uniform sampler2D uGlow;
uniform sampler2D uFlareCore;
uniform sampler2D uFlareHalo;
uniform float uCoreGain;
uniform float uHaloGain;
uniform float uLine;
uniform float uGlowGain;
uniform vec3 uGround;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec3 sharp = fringe(vUv) * uLine;
  vec3 glow = texture(uGlow, vUv).rgb * uGlowGain
            + texture(uFlareCore, vUv).rgb * uCoreGain
            + texture(uFlareHalo, vUv).rgb * uHaloGain;
  // Soft shoulder: a knot where thousands of segments pile up reads white
  // with a halo instead of a flat clipped disc.
  vec3 c = 1.0 - exp(-(sharp + glow) * 1.6);
  outColor = vec4(uGround + c * (1.0 - uGround), 1.0);
}
`;
