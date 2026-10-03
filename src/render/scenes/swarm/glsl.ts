// Swarm's two draw programs: the edge quads (one instance per near pair, read
// from the edge buffer swarmSim.ts's collectEdges fills) and the node sprites
// (one instance per particle). Both place a world point on screen the same way
// -- WORLD_TO_PX_GLSL -- and both shade through the same phase ramp, so a
// node always matches the lines meeting at it.
//
// There is no float render target in this repo (chladni.ts's header says why),
// so the tone curve is done in the blend instead: each fragment outputs
// s = 1 - exp(-TONE * c) and the blend is "screen" (ONE, ONE_MINUS_SRC_COLOR),
// and since 1 - prod(1 - s_k) = 1 - exp(-TONE * sum c_k), a pile of overlapping
// lines reaches exactly the soft curve an accumulation buffer would give: the
// dense core goes white, a lone line stays a line.

export const TONE = 1.6;

/** The phase ramp: o = 0 (in step with the core) white, then rose, orange and
 *  yellow-green at o = 1 (half a turn out). `uColours` fades it toward white. */
export const RAMP_GLSL = `
uniform float uColours;
vec3 phaseRamp(float o) {
  vec3 white = vec3(1.0);
  vec3 rose = vec3(0.941, 0.251, 0.690);
  vec3 orange = vec3(1.0, 0.478, 0.102);
  vec3 lime = vec3(0.722, 0.878, 0.251);
  float t = clamp(o, 0.0, 1.0) * 3.0;
  vec3 c = mix(white, rose, clamp(t, 0.0, 1.0));
  c = mix(c, orange, clamp(t - 1.0, 0.0, 1.0));
  c = mix(c, lime, clamp(t - 2.0, 0.0, 1.0));
  return mix(white, c, uColours);
}`;

// World (the sim's pixel-like units, origin at the swarm's centroid once
// uCentre is subtracted) to device pixels. uRoomPx is the whole room's pixel
// size and uVpOrigin the device viewport's corner in it, so a Panorama slice
// draws its own part of one swarm; at the full viewport they are the canvas
// size and (0, 0).
const WORLD_TO_PX_GLSL = `
uniform vec2 uRes;
uniform vec2 uRoomPx;
uniform vec2 uVpOrigin;
uniform vec2 uCentre;
uniform float uScale;
vec2 worldToPx(vec2 w) {
  return uRoomPx * 0.5 + (w - uCentre) * uScale - uVpOrigin;
}
vec4 pxToClip(vec2 px) {
  return vec4(px / uRes * 2.0 - 1.0, 0.0, 1.0);
}`;

export const EDGE_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec4 aSeg;
layout(location = 1) in vec3 aCol;
uniform float uHalfW;
${WORLD_TO_PX_GLSL}
out float vAcross;
out float vAlong;
out vec3 vCol;
const vec2 CORNER[6] = vec2[6](
  vec2(0.0, -1.0), vec2(1.0, -1.0), vec2(0.0, 1.0),
  vec2(0.0, 1.0), vec2(1.0, -1.0), vec2(1.0, 1.0));
void main() {
  vec2 c = CORNER[gl_VertexID];
  vec2 p0 = worldToPx(aSeg.xy);
  vec2 p1 = worldToPx(aSeg.zw);
  vec2 d = p1 - p0;
  float len = max(length(d), 1e-4);
  d /= len;
  vec2 n = vec2(-d.y, d.x);
  float reach = uHalfW + 1.0;
  vec2 px = mix(p0, p1, c.x) + n * c.y * reach;
  vAcross = c.y * reach;
  vAlong = c.x;
  vCol = aCol;
  gl_Position = pxToClip(px);
}`;

export const EDGE_FRAG = `#version 300 es
precision highp float;
uniform float uHalfW;
uniform float uGain;
${RAMP_GLSL}
in float vAcross;
in float vAlong;
in vec3 vCol;
out vec4 outColor;
void main() {
  // One pixel of feather: the context has no MSAA.
  float cov = clamp(uHalfW + 0.5 - abs(vAcross), 0.0, 1.0);
  vec3 c = phaseRamp(mix(vCol.x, vCol.y, vAlong)) * (vCol.z * uGain * cov);
  outColor = vec4(1.0 - exp(-${TONE.toFixed(2)} * c), 1.0);
}`;

export const NODE_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aNode;
uniform float uRadius;
${WORLD_TO_PX_GLSL}
out vec2 vLocal;
out float vO;
const vec2 CORNER[6] = vec2[6](
  vec2(-1.0, -1.0), vec2(1.0, -1.0), vec2(-1.0, 1.0),
  vec2(-1.0, 1.0), vec2(1.0, -1.0), vec2(1.0, 1.0));
void main() {
  vec2 c = CORNER[gl_VertexID];
  float reach = uRadius + 1.0;
  vec2 px = worldToPx(aNode.xy) + c * reach;
  vLocal = c * reach;
  vO = aNode.z;
  gl_Position = pxToClip(px);
}`;

export const NODE_FRAG = `#version 300 es
precision highp float;
uniform float uRadius;
uniform float uNodeGain;
${RAMP_GLSL}
in vec2 vLocal;
in float vO;
out vec4 outColor;
void main() {
  float d = length(vLocal);
  float a = 1.0 - smoothstep(0.0, uRadius + 1.0, d);
  vec3 c = phaseRamp(vO) * (uNodeGain * a * a);
  outColor = vec4(1.0 - exp(-${TONE.toFixed(2)} * c), 1.0);
}`;
