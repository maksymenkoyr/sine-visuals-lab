// Shards — the GLSL. One instanced primitive (a triangular prism, see
// layout.ts's header) drawn attribute-less: the corner comes from
// gl_VertexID with the same arithmetic as layout.ts's faceOf()/cornerOf(),
// the shard from gl_InstanceID via four vec4 uniform arrays packed by
// packShards(). Plus a star-field ground, the bloom blur and the composite.
//
// Material, from the measured picture: flat colour per face with a pale
// gradient toward the tip; extrusion sides dark navy, faintly tinted by the
// face colour; a thin bright rim on every edge, measured in pixels so it
// stays a line at any distance (edge distance from barycentrics / quad
// coordinates through fwidth). Lighting is one fixed lamp in view space so
// faces toward the camera are the bright ones, as in the reference.
//
// Camera: right/up/forward basis plus eye position as uniforms (no shared
// mat4 helper exists — ambience.ts and meshGrid.ts each do this in-shader
// too). FOCAL is a 60° vertical field of view; layout.ts's randomCamera
// distances assume it.

import { MAX_SHARDS, PALETTE } from "./layout.ts";

export const FOCAL = 1 / Math.tan((60 * Math.PI) / 180 / 2);
export const NEAR = 0.08;
export const FAR = 80;
/** Bloom weight at Bloom = 1 — the measured halo sits near 0.2 of the core
 *  a few pixels out, so the blurred layer is added quietly. */
export const BLOOM_WEIGHT = 0.7;
/** Only what is brighter than this feeds the halo: rims and the lit faces,
 *  not the whole plate. */
export const BLOOM_THRESHOLD = 0.6;
/** Full-res pixels per blur tap on the first (downsampling) pass and
 *  half-res texels per tap on the second: both ≈ 8 px reach at full res,
 *  the measured glow e-fold of 5–7 px with a little to spare. */
export const BLUR_STRIDE_X = 2.0;
export const BLUR_STRIDE_Y = 1.0;

const HASH_GLSL = `
float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
`;

const PALETTE_GLSL = `const vec3 PALETTE[${PALETTE.length}] = vec3[${PALETTE.length}](
${PALETTE.map(([r, g, b]) => `  vec3(${r.toFixed(3)}, ${g.toFixed(3)}, ${b.toFixed(3)})`).join(",\n")}
);`;

/** Star-field ground: near-black, sparse white points that roll with the
 *  camera (the star arcs in the reference's motion tile). Covers the frame
 *  every tick — previewRenderer.ts says the gallery never clears. */
export function bgFrag(commonUniforms: string, settingsUniforms: string, roomUv: string): string {
  return `#version 300 es
precision highp float;
in vec2 vUv;
${commonUniforms}
${settingsUniforms}
${roomUv}
${HASH_GLSL}
uniform float uRollBg;
uniform float uAspect;
out vec4 outColor;

void main() {
  vec2 r = roomUv(vUv);
  vec2 p = (r - 0.5) * vec2(uAspect, 1.0);
  float c = cos(uRollBg);
  float s = sin(uRollBg);
  p = mat2(c, -s, s, c) * p;
  vec3 col = vec3(0.004, 0.004, 0.012);
  const float CELLS = 24.0;
  vec2 g = p * CELLS;
  vec2 id = floor(g);
  vec2 f = fract(g);
  float h = hash21(id);
  if (h < uStars * 0.1) {
    vec2 sp = vec2(hash21(id + 7.1), hash21(id + 3.3));
    // Distance in pixels: p is in half-height units of the viewport slice.
    float pxPerUnit = uResolution.y * uViewport.w;
    float dPx = length(f - sp) / CELLS * pxPerUnit;
    float b = 0.35 + 0.65 * hash21(id + 9.9);
    col += b * (1.0 - smoothstep(0.5, 1.4, dPx));
  }
  outColor = vec4(col, 1.0);
}
`;
}

/** The prism vertex shader. */
export function prismVert(commonUniforms: string, settingsUniforms: string): string {
  return `#version 300 es
precision highp float;
${commonUniforms}
${settingsUniforms}
${PALETTE_GLSL}
uniform vec4 uShardA[${MAX_SHARDS}]; // centre xyz, length (extended)
uniform vec4 uShardB[${MAX_SHARDS}]; // axis xyz, width
uniform vec4 uShardC[${MAX_SHARDS}]; // normal xyz, thickness
uniform vec4 uShardD[${MAX_SHARDS}]; // colour index, taper, grow, kind
uniform vec3 uCamPos;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform vec3 uCamFwd;
uniform float uAspect;
out vec3 vBary;          // cap: barycentric; side: (along edge, across thickness, 0)
out float vAlong;        // 0 at the base of the triangle, 1 at the tip
flat out vec3 vColour;
flat out float vFace;    // 0 cap, 1 side
flat out float vShade;
flat out float vKind;

#define FOCAL ${FOCAL.toFixed(6)}
#define NEAR ${NEAR.toFixed(3)}
#define FAR ${FAR.toFixed(1)}

vec2 cornerUv(int corner, float L, float W, float taper) {
  if (corner == 0) return vec2(-0.5 * L, -0.5 * W);
  if (corner == 1) return vec2(-0.5 * L, 0.5 * W);
  return vec2(0.5 * L, taper * 0.5 * W);
}

void main() {
  int vid = gl_VertexID;
  int inst = gl_InstanceID;
  vec4 A = uShardA[inst];
  vec4 B = uShardB[inst];
  vec4 C = uShardC[inst];
  vec4 D = uShardD[inst];
  vec3 centre = A.xyz;
  float L = A.w;
  vec3 axis = B.xyz;
  float W = B.w;
  vec3 nrm = C.xyz;
  float T = C.w * uEdge;
  float taper = D.y;
  vec3 across = cross(nrm, axis);

  // Same arithmetic as layout.ts faceOf()/cornerOf().
  int face;
  int corner;
  float side;
  int cA = 0;
  int cB = 1;
  if (vid < 3) {
    face = 0;
    corner = vid;
    side = 1.0;
  } else if (vid < 6) {
    face = 1;
    corner = 2 - (vid - 3);
    side = -1.0;
  } else {
    int k = (vid - 6) / 6;
    int s = (vid - 6) - k * 6;
    face = 2 + k;
    cA = k;
    cB = (k + 1) - ((k + 1) / 3) * 3;
    corner = (s == 0 || s == 3 || s == 5) ? cA : cB;
    side = (s == 0 || s == 1 || s == 3) ? 1.0 : -1.0;
  }
  vec2 uv = cornerUv(corner, L, W, taper);
  vec3 world = centre + axis * uv.x + across * uv.y + nrm * (side * 0.5 * T);

  vec3 fn;
  if (face < 2) {
    fn = nrm * side;
    vBary = corner == 0 ? vec3(1.0, 0.0, 0.0) : (corner == 1 ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0));
  } else {
    vec2 ea = cornerUv(cA, L, W, taper);
    vec2 eb = cornerUv(cB, L, W, taper);
    vec2 e = eb - ea;
    vec2 out2 = vec2(e.y, -e.x);
    vec2 centroid2 = (cornerUv(0, L, W, taper) + cornerUv(1, L, W, taper) + cornerUv(2, L, W, taper)) / 3.0;
    if (dot(out2, (ea + eb) * 0.5 - centroid2) < 0.0) out2 = -out2;
    fn = normalize(axis * out2.x + across * out2.y);
    vBary = vec3(corner == cA ? 0.0 : 1.0, side > 0.0 ? 0.0 : 1.0, 0.0);
  }
  vFace = face < 2 ? 0.0 : 1.0;
  vAlong = clamp((uv.x + 0.5 * L) / max(L, 1e-4), 0.0, 1.0);

  vec3 rel = world - uCamPos;
  vec3 view = vec3(dot(rel, uCamRight), dot(rel, uCamUp), dot(rel, uCamFwd));
  vec3 fnView = vec3(dot(fn, uCamRight), dot(fn, uCamUp), dot(fn, uCamFwd));
  // One lamp above-left of the camera, on its side of the scene.
  vec3 lightDir = normalize(vec3(-0.45, 0.65, -0.62));
  float lam = max(0.0, dot(fnView, lightDir));
  vShade = face < 2 ? 0.78 + 0.32 * lam : 0.35 + 0.9 * lam;
  vColour = PALETTE[int(D.x + 0.5)];
  vKind = D.w;

  float zc = (view.z * (FAR + NEAR) - 2.0 * FAR * NEAR) / (FAR - NEAR);
  gl_Position = vec4(view.x * FOCAL / uAspect, view.y * FOCAL, zc, view.z);
}
`;
}

/** The prism fragment shader: flat faces, dark sides, pixel-measured rim. */
export function prismFrag(commonUniforms: string, settingsUniforms: string): string {
  return `#version 300 es
precision highp float;
${commonUniforms}
${settingsUniforms}
in vec3 vBary;
in float vAlong;
flat in vec3 vColour;
flat in float vFace;
flat in float vShade;
flat in float vKind;
out vec4 outColor;

void main() {
  vec3 fw = fwidth(vBary) + 1e-5;
  float dPx;
  if (vFace < 0.5) {
    vec3 d = vBary / fw;
    dPx = min(d.x, min(d.y, d.z));
  } else {
    dPx = min(min(vBary.x / fw.x, (1.0 - vBary.x) / fw.x), min(vBary.y / fw.y, (1.0 - vBary.y) / fw.y));
  }
  float rim = 1.0 - smoothstep(0.0, max(uRim, 0.05), dPx);
  bool backdrop = vKind > 2.5;
  vec3 col;
  if (vFace < 0.5) {
    vec3 pale = min(vColour * 1.25 + 0.06, 1.0);
    col = mix(vColour, pale, 0.5 * smoothstep(0.1, 1.0, vAlong)) * vShade;
    if (backdrop) col = vColour * (0.55 + 0.45 * vShade);
  } else {
    vec3 navy = vec3(0.035, 0.045, 0.16);
    // Thin spikes are lit all round in the reference; only the plates show
    // a dark extruded side.
    bool blade = vKind > 0.5 && vKind < 1.5;
    col = blade ? mix(vColour * 0.8, navy, 0.3) * (0.5 + 0.5 * vShade) : mix(navy, vColour * 0.6, 0.18) * vShade;
  }
  float rimGain = vFace < 0.5 ? 0.9 : 0.35;
  if (backdrop) rimGain *= 0.3;
  col += rim * rimGain * mix(vec3(1.0), vColour, 0.25);
  outColor = vec4(col, 1.0);
}
`;
}

/** 9-tap separable Gaussian, as powder.ts's. */
export const BLUR_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uBlurStep;
uniform float uThreshold;

vec3 tap(vec2 uv) {
  return max(texture(uTex, uv).rgb - uThreshold, 0.0);
}

void main() {
  vec3 c = tap(vUv) * 0.2270270;
  c += (tap(vUv + uBlurStep) + tap(vUv - uBlurStep)) * 0.1945946;
  c += (tap(vUv + uBlurStep * 2.0) + tap(vUv - uBlurStep * 2.0)) * 0.1216216;
  c += (tap(vUv + uBlurStep * 3.0) + tap(vUv - uBlurStep * 3.0)) * 0.0540541;
  c += (tap(vUv + uBlurStep * 4.0) + tap(vUv - uBlurStep * 4.0)) * 0.0162162;
  outColor = vec4(c, 1.0);
}
`;

/** Sharp frame plus its halo. The flat colours are the point of the look,
 *  so the sharp layer is not tone-mapped — only the sum gets a shoulder so
 *  a rim over a bright halo does not clip to a flat white. */
export function compositeFrag(commonUniforms: string, settingsUniforms: string): string {
  return `#version 300 es
precision highp float;
in vec2 vUv;
${commonUniforms}
${settingsUniforms}
uniform sampler2D uSharpTex;
uniform sampler2D uBlurTex;
out vec4 outColor;

void main() {
  vec3 sharp = texture(uSharpTex, vUv).rgb;
  vec3 halo = texture(uBlurTex, vUv).rgb;
  // The halo lands where the frame is dark: outside the plates, not on top
  // of their flat colour, which is the point of the look.
  float lum = dot(sharp, vec3(0.3, 0.59, 0.11));
  vec3 col = sharp + halo * (uBloom * ${BLOOM_WEIGHT.toFixed(3)}) * (1.0 - min(lum, 1.0));
  vec3 over = max(col - 0.9, 0.0);
  col = min(col, 0.9) + over / (1.0 + over * 4.0);
  outColor = vec4(col, 1.0);
}
`;
}
