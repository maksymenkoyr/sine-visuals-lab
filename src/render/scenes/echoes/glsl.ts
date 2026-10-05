// Echoes' two shader passes — index.ts's header has the picture model this
// implements and why it is a feedback loop rather than a drawn stack.
//
// Pass 1 (STEP_FRAG) is one generation of the loop: per pixel, the previous
// frame sampled one step *back* along the flow field (so whatever was drawn
// travels one step forward along it), faded, with this frame's crisp outline
// screened on top. It writes two channels into an RGBA8 target: R is the
// line's brightness, G its freshness — 1 where the outline is drawn this
// frame, falling by the same fade every generation, so the display pass can
// tell a new line from an old echo without counting anything.
//
// The fade is linear — the same amount, uFadeStep, off every generation —
// so echo k is drawn at 1 − k·uFadeStep and the Echoes setting is exactly
// how many lines trail before they're gone. A proportional fade left a long
// tail of faint lines; the reference shows a handful of even ones that stop.
// It also keeps an RGBA8 target honest: a proportional fade rounds its last
// few levels back up and never reaches black.
//
// Pass 2 (DISPLAY_FRAG) turns those two channels into colour: the measured
// warm white on black, or — with Colours raised — the room palette's ramp by
// freshness over its ground.
import { DRIVE_GLSL, ROOM_UV_GLSL, settingUniformName } from "../../sceneCommon.ts";
import type { SceneSetting } from "../../sceneSettings.ts";
import { NOISE_HASH_GLSL, NOISE_MASK } from "../../noiseHash.ts";
import { MAX_SOLID_EDGES } from "./solids.ts";

/** The line colour measured on the reference's wall projection (bright
 *  pixels minus the local wall, normalised — docs/scenes/echoes.md's
 *  Measurements), used at Colours = 0. */
export const LINE_RGB: readonly [number, number, number] = [1.0, 0.94, 0.84];

function settingUniformsGlsl(settings: readonly SceneSetting[]): string {
  return settings.map((s) => `uniform float ${settingUniformName(s.key)};`).join("\n");
}

/** A smooth 2D vector field: two independent channels of a 3D value noise
 *  (x, y on the screen in half-heights, z the drift phase), plus a second,
 *  finer octave. Hashed with noiseHash.ts's integer cell hash because the
 *  drift phase grows for as long as the scene runs — index.ts wraps it with
 *  wrapFlow before upload, and z's lattice index is masked to the same
 *  period, so the wrap is invisible. */
const FIELD_GLSL = `
${NOISE_HASH_GLSL}

float vnoise3(vec3 q, uint channel) {
  vec3 i = floor(q);
  vec3 f = q - i;
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  uint z0 = uint(int(i.z) & ${NOISE_MASK}) * 8u + channel;
  uint z1 = uint(int(i.z + 1.0) & ${NOISE_MASK}) * 8u + channel;
  float a0 = hashCell(i.xy, ${NOISE_MASK}, z0);
  float b0 = hashCell(i.xy + vec2(1.0, 0.0), ${NOISE_MASK}, z0);
  float c0 = hashCell(i.xy + vec2(0.0, 1.0), ${NOISE_MASK}, z0);
  float d0 = hashCell(i.xy + vec2(1.0, 1.0), ${NOISE_MASK}, z0);
  float a1 = hashCell(i.xy, ${NOISE_MASK}, z1);
  float b1 = hashCell(i.xy + vec2(1.0, 0.0), ${NOISE_MASK}, z1);
  float c1 = hashCell(i.xy + vec2(0.0, 1.0), ${NOISE_MASK}, z1);
  float d1 = hashCell(i.xy + vec2(1.0, 1.0), ${NOISE_MASK}, z1);
  float n0 = mix(mix(a0, b0, u.x), mix(c0, d0, u.x), u.y);
  float n1 = mix(mix(a1, b1, u.x), mix(c1, d1, u.x), u.y);
  return mix(n0, n1, u.z);
}

// Each component roughly in [-1, 1]; the finer octave bends the bundles
// without breaking them up. Kept faint: every echo is warped again by it,
// so it compounds down the fan, and at twice this the echoes crinkled where
// the reference's sweep in smooth arcs.
vec2 flowField(vec2 p) {
  vec3 q = vec3(p * uFieldFreq + uFieldOffset, uFieldZ);
  vec2 v = vec2(vnoise3(q, 0u), vnoise3(q, 1u)) * 2.0 - 1.0;
  vec3 q2 = vec3(mat2(0.8, -0.6, 0.6, 0.8) * q.xy * 2.1 + 17.0, q.z * 1.7);
  v += 0.2 * (vec2(vnoise3(q2, 2u), vnoise3(q2, 3u)) * 2.0 - 1.0);
  return v;
}
`;

/** Distance from p to the outline. A 3D or 4D figure (uEdgeCount > 0) is
 *  already turned and projected by solids.ts: its edges arrive as 2D
 *  segments, one per texel of uEdges (x1, y1, x2, y2), and the distance is
 *  to the nearest one — skipped entirely beyond uBound, the farthest any
 *  vertex reached, since no line is out there.
 *
 *  Otherwise a regular polygon with uCorners corners (a circle below 3),
 *  circumradius uRadius, turned by uAngle. Edge normals sit at
 *  k·(2π/n) − π/2, so every polygon rests on a flat bottom edge. Within one
 *  edge's angular sector the nearest point of the outline is on that edge
 *  (the sector borders run through the corners, where the two edge lines
 *  are equidistant), so the distance is just to that one segment. */
const OUTLINE_GLSL = `
float segmentsDist(vec2 p) {
  if (length(p) > uBound) return 1e3;
  float d = 1e3;
  for (int i = 0; i < ${MAX_SOLID_EDGES}; i++) {
    if (float(i) >= uEdgeCount) break;
    vec4 e = texelFetch(uEdges, ivec2(i, 0), 0);
    vec2 pa = p - e.xy;
    vec2 ba = e.zw - e.xy;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
    d = min(d, length(pa - ba * h));
  }
  return d;
}

float outlineDist(vec2 p) {
  if (uEdgeCount > 0.5) return segmentsDist(p);
  float c = cos(uAngle), s = sin(uAngle);
  vec2 q = vec2(c * p.x + s * p.y, -s * p.x + c * p.y);
  if (uCorners < 2.5) return abs(length(q) - uRadius);
  float n = uCorners;
  float sector = 6.2831853 / n;
  float k = floor((atan(q.y, q.x) + 1.5707963) / sector + 0.5);
  float na = k * sector - 1.5707963;
  vec2 nrm = vec2(cos(na), sin(na));
  float apothem = uRadius * cos(3.1415927 / n);
  float halfSide = uRadius * sin(3.1415927 / n);
  float x = dot(q, nrm) - apothem;
  float y = abs(dot(q, vec2(-nrm.y, nrm.x)));
  return length(vec2(x, max(y - halfSide, 0.0)));
}
`;

export function buildStepFrag(settings: readonly SceneSetting[], commonUniformsGlsl: string): string {
  return `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
${commonUniformsGlsl}
${settingUniformsGlsl(settings)}
${DRIVE_GLSL(settings)}
${ROOM_UV_GLSL}
uniform sampler2D uPrev;
uniform float uRadius;
uniform float uAngle;
uniform float uCorners;
uniform sampler2D uEdges;
uniform float uEdgeCount;
uniform float uBound;
uniform float uStroke;
uniform float uPx;
uniform float uStep;
uniform float uFadeStep;
uniform float uFieldFreq;
uniform float uFieldZ;
uniform vec2 uFieldOffset;
${FIELD_GLSL}
${OUTLINE_GLSL}

void main() {
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 roomP = roomUv(vUv);
  vec2 p = (roomP - 0.5) * 2.0;
  p.x *= aspect;

  // One step back along the flow: what sits there now moves here.
  vec2 src = p - uStep * flowField(p);
  vec2 srcRoom = vec2(src.x / aspect, src.y) * 0.5 + 0.5;
  vec2 srcUv = (srcRoom - uViewport.xy) / uViewport.zw;
  vec2 prev = vec2(0.0);
  if (all(greaterThanEqual(srcUv, vec2(0.0))) && all(lessThanEqual(srcUv, vec2(1.0)))) {
    prev = texture(uPrev, srcUv).rg;
  }
  float oldR = max(prev.r - uFadeStep, 0.0);
  float oldG = max(prev.g - uFadeStep, 0.0);

  float d = outlineDist(p);
  float line = clamp(0.5 + (uStroke - d) / uPx, 0.0, 1.0);

  // Screen, not add: where echoes bunch up they merge into a sheet as bright
  // as one line instead of blowing out to white.
  float r = 1.0 - (1.0 - line) * (1.0 - oldR);
  float g = max(line, oldG);
  outColor = vec4(r, g, 0.0, 1.0);
}
`;
}

export function buildDisplayFrag(settings: readonly SceneSetting[], commonUniformsGlsl: string): string {
  return `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
${commonUniformsGlsl}
${settingUniformsGlsl(settings)}
${DRIVE_GLSL(settings)}
uniform sampler2D uFrame;

void main() {
  vec2 t = texture(uFrame, vUv).rg;
  float colours = clamp(uColours, 0.0, 1.0);
  vec3 measured = vec3(${LINE_RGB.map((c) => c.toFixed(3)).join(", ")});
  vec3 ink = mix(measured, palRamp(mix(0.45, 0.95, t.g)), colours);
  vec3 ground = mix(vec3(0.0), uPalGround, colours);
  // Eased so echoes stay nearly as bright as the outline for most of the
  // fan and drop off near its end, as the reference's do; the linear fade
  // in the loop alone dimmed them from the first one.
  float b = t.r * (2.0 - t.r);
  outColor = vec4(mix(ground, ink, b), 1.0);
}
`;
}
