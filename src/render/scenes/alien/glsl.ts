/**
 * The alien's picture: a neon wireframe over a dark body, after the green
 * glowing mesh of the reference VJ loop (the scene record has the link).
 *
 * MESH_VERT skins every vertex of mesh.ts's bind-pose mesh to the rig: each
 * bone's skin transform is a rotation (uSkin[2b]) and a translation
 * (uSkin[2b+1].xyz) taking a bind-pose point to where that bone carries it
 * now, and a vertex is the weighted sum over its MAX_INFLUENCES bones. It
 * then projects through the loop's camera into room space and the device's
 * slice of it (the CAMERA math Gates and Ambience use, kept in clip space so
 * the depth test and perspective-correct interpolation still work).
 *
 * MESH_FRAG draws each triangle's own three edges from a barycentric derived
 * from gl_VertexID (mesh.ts de-indexes the mesh for this), LINE_HALF_PX wide
 * whatever the distance, over a fill that is near-black facing the camera
 * and glows toward the silhouette (a fresnel term). Wires brighten toward
 * the silhouette too, and where the mesh turns away the triangles crowd
 * into a solid glowing rim on their own — the look the reference has.
 * Colour runs from WIRE_NEAR to WIRE_FAR over the figure's depth, the
 * reference's green-to-teal.
 *
 * The bloom is BLUR_FRAG on two smaller targets; COMPOSITE_FRAG adds them
 * to the sharp picture through a soft knee (index.ts owns the passes).
 */
import { BONE_COUNT } from "../dancers/rig.ts";

const f = (v: number): string => v.toFixed(4);
const v3 = (c: readonly number[]): string => `vec3(${c.map(f).join(", ")})`;

/** Near and far clip planes, metres from the camera. */
export const NEAR = 0.05;
export const FAR = 12;
/** Half the drawn width of a wire, in pixels. */
const LINE_HALF_PX = 0.8;
/** Where the silhouette band starts and is full, in 1 − (normal · view). */
const OUTLINE_FROM = 0.6;
const OUTLINE_TO = 0.93;
/** Wire colour on the near side of the figure and on its far side. */
const WIRE_NEAR = [0.16, 1.0, 0.26];
const WIRE_FAR = [0.04, 0.82, 0.6];
/** The body's own fill at its silhouette (fresnel 1); black facing the camera. */
const RIM = [0.1, 1.0, 0.22];
/** On-screen triangle height, in pixels, below which the wire dims… */
const DENSE_TRI_PX = 11;
/** …down to this share of its brightness. */
const DENSE_WIRE_FLOOR = 0.35;
/** Metres of view depth across which the colour runs near to far. */
const DEPTH_SPAN = 1.2;
/** Separable blur stride, in texels of the target being blurred. */
export const BLUR_STRIDE = 2.2;
/** Composite knee: linear below this, rolling off toward 1 above it. */
const TONE_KNEE = 0.75;

export const MESH_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec4 aBones;
layout(location = 3) in vec4 aWeights;
uniform vec2 uResolution;
uniform vec4 uViewport; // x,y,w,h slice of the shared room-space canvas (sceneCommon.ts)
uniform vec4 uSkin[${BONE_COUNT * 2}];
uniform vec3 uEye;
uniform vec3 uRight;
uniform vec3 uUp;
uniform vec3 uFwd;
uniform float uFocal;
uniform float uDepthMid;
out vec3 vNormal;
out vec3 vToEye;
out vec3 vBary;
out float vDepth;

vec3 qrot(vec4 q, vec3 v) {
  vec3 t = 2.0 * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}

void main() {
  vec3 p = vec3(0.0);
  vec3 n = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    float w = aWeights[i];
    if (w <= 0.0) continue;
    int b = int(aBones[i] + 0.5);
    vec4 q = uSkin[b * 2];
    p += w * (qrot(q, aPos) + uSkin[b * 2 + 1].xyz);
    n += w * qrot(q, aNormal);
  }
  vec3 rel = p - uEye;
  vec3 view = vec3(dot(rel, uRight), dot(rel, uUp), dot(rel, uFwd));
  float roomAspect = (uResolution.x / max(uViewport.z, 0.0001)) / (uResolution.y / max(uViewport.w, 0.0001));
  float w = view.z;
  vec2 clipRoom = vec2(view.x * uFocal / roomAspect, view.y * uFocal);
  // Room clip space -> this device's slice, still linear in w.
  vec2 clipDevice = ((clipRoom + w) * 0.5 - uViewport.xy * w) / uViewport.zw * 2.0 - w;
  float z = (w * ${f(FAR + NEAR)} - ${f(2 * FAR * NEAR)}) / ${f(FAR - NEAR)};
  gl_Position = vec4(clipDevice, z, w);

  vNormal = n;
  vToEye = uEye - p;
  vDepth = clamp((w - uDepthMid) / ${f(DEPTH_SPAN)} + 0.5, 0.0, 1.0);
  int corner = gl_VertexID % 3;
  vBary = vec3(corner == 0 ? 1.0 : 0.0, corner == 1 ? 1.0 : 0.0, corner == 2 ? 1.0 : 0.0);
}
`;

export const MESH_FRAG = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vToEye;
in vec3 vBary;
in float vDepth;
out vec4 outColor;

void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(vToEye);
  float facing = clamp(dot(n, v), 0.0, 1.0);
  float rim = pow(1.0 - facing, 2.0);

  // Distance to the nearest of this triangle's edges, in pixels.
  vec3 fw = max(fwidth(vBary), vec3(1e-5));
  vec3 px = vBary / fw;
  float edgePx = min(px.x, min(px.y, px.z));
  float wire = 1.0 - smoothstep(${f(LINE_HALF_PX - 0.5)}, ${f(LINE_HALF_PX + 0.5)}, edgePx);
  // Triangles only a few pixels across would fill the body with wire: dim
  // the wire as they shrink so the body stays dark between the lines.
  float triPx = 1.0 / max(fw.x, max(fw.y, fw.z));
  float sparse = clamp(triPx / ${f(DENSE_TRI_PX)}, ${f(DENSE_WIRE_FLOOR)}, 1.0);

  // The silhouette: a band where the surface turns edge-on, the bright
  // contour every figure in the reference is drawn with.
  float outline = smoothstep(${f(OUTLINE_FROM)}, ${f(OUTLINE_TO)}, 1.0 - facing);

  vec3 wireCol = mix(${v3(WIRE_NEAR)}, ${v3(WIRE_FAR)}, vDepth);
  vec3 col = ${v3(RIM)} * (0.008 + 0.3 * rim + 1.1 * outline * outline) * mix(1.0, 0.7, vDepth);
  col += wireCol * wire * sparse * (0.62 + 0.8 * rim);
  outColor = vec4(col, 1.0);
}
`;

export const BLUR_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uBlurStep;

void main() {
  // Nine-tap Gaussian along uBlurStep.
  vec3 c = texture(uTex, vUv).rgb * 0.2270270;
  c += (texture(uTex, vUv + uBlurStep).rgb + texture(uTex, vUv - uBlurStep).rgb) * 0.1945946;
  c += (texture(uTex, vUv + uBlurStep * 2.0).rgb + texture(uTex, vUv - uBlurStep * 2.0).rgb) * 0.1216216;
  c += (texture(uTex, vUv + uBlurStep * 3.0).rgb + texture(uTex, vUv - uBlurStep * 3.0).rgb) * 0.0540541;
  c += (texture(uTex, vUv + uBlurStep * 4.0).rgb + texture(uTex, vUv - uBlurStep * 4.0).rgb) * 0.0162162;
  outColor = vec4(c, 1.0);
}
`;

export const COMPOSITE_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uSharpTex;
uniform sampler2D uGlowATex;
uniform sampler2D uGlowBTex;
uniform float uGlowAGain;
uniform float uGlowBGain;

void main() {
  vec3 c = texture(uSharpTex, vUv).rgb;
  c += texture(uGlowATex, vUv).rgb * uGlowAGain;
  c += texture(uGlowBTex, vUv).rgb * uGlowBGain;
  // Soft knee: linear up to TONE_KNEE, then Reinhard toward 1.
  vec3 over = max(c - ${f(TONE_KNEE)}, 0.0);
  c = min(c, ${f(TONE_KNEE)}) + over * ${f(1 - TONE_KNEE)} / (over + ${f(1 - TONE_KNEE)});
  outColor = vec4(c, 1.0);
}
`;
