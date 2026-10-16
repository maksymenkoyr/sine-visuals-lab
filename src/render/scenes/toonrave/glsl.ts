// Toon Rave's one shader: the post pass that shows the Canvas2D picture and does
// the impact frame.
//
// The picture itself is drawn on the CPU side (svgDraw.ts) and uploaded as a
// texture, so this pass only has to put it on screen. The one effect it owns is
// the prototype's impact frame, the SVG filter pair in art/scene.ts: an
// feColorMatrix (every output channel is one luminance mix, IMPACT_MATRIX's
// rows) followed by an feComponentTransfer with a discrete three-entry table
// per channel, `lo hi hi`. A discrete table with three entries picks entry
// floor(C * 3), so the result is `lo` below 1/3 and `hi` from 1/3 up. The
// filter runs in sRGB (color-interpolation-filters="sRGB" in the markup), the
// same space as the canvas, so no conversion is needed here. IMPACT_A is the
// pink-on-dark pair, IMPACT_B the inverted pair the second half of the impact
// uses. The constants come from art/scene.ts so the markup and this shader
// can't drift apart.
import { IMPACT_MATRIX, IMPACT_A, IMPACT_B } from "./art/scene.ts";

const f = (n: number): string => {
  const s = String(n);
  return /[.e]/.test(s) ? s : `${s}.0`;
};
const vec3 = (v: readonly number[]): string => `vec3(${v.map(f).join(", ")})`;
const row = (r: number): string => vec3(IMPACT_MATRIX.slice(r * 5, r * 5 + 3));

/** The fragment shader (paired with FULLSCREEN_VERT, which gives vUv). */
export function buildPostFrag(): string {
  return `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform float uImpact;  // 0 = the picture as drawn, 1 = the impact frame
uniform float uInvert;  // 1 in the impact frame's second half (the inverted pair)
in vec2 vUv;
out vec4 outColor;

const vec3 ROW_R = ${row(0)};
const vec3 ROW_G = ${row(1)};
const vec3 ROW_B = ${row(2)};
const vec3 A_LO = ${vec3(IMPACT_A.lo)};
const vec3 A_HI = ${vec3(IMPACT_A.hi)};
const vec3 B_LO = ${vec3(IMPACT_B.lo)};
const vec3 B_HI = ${vec3(IMPACT_B.hi)};

void main() {
  // The canvas is uploaded top row first, so flip V here instead of in the upload.
  vec3 c = texture(uTex, vec2(vUv.x, 1.0 - vUv.y)).rgb;
  if (uImpact > 0.0) {
    vec3 m = clamp(vec3(dot(c, ROW_R), dot(c, ROW_G), dot(c, ROW_B)), 0.0, 1.0);
    vec3 hi = step(vec3(1.0 / 3.0), m);
    vec3 a = mix(A_LO, A_HI, hi);
    vec3 b = mix(B_LO, B_HI, hi);
    c = mix(c, mix(a, b, uInvert), uImpact);
  }
  outColor = vec4(c, 1.0);
}`;
}
