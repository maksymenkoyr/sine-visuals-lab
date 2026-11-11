// Oil Drops' shaders: the paint underneath (PAINT_FRAG, one fullscreen pass)
// and the drops on top (DROP_VERT + DROP_FRAG, one instanced quad per drop,
// blended over the paint in drawing order). Both read the common uniforms,
// the scene's settings and its drives through sceneCommon.ts, so index.ts
// uploads them with uploadCommonUniforms like any fullscreen scene.
//
// The paint is a few octaves of value noise, each octave read at its own
// wrapped slide (uPaintDrift, the sheet's translation from drops.ts, wrapped
// per octave in index.ts as noiseHash.ts's header requires) and its own
// depth along a time axis, so the paint slowly boils under drops that ride
// it. Glitter is a lattice of flakes that flash when their random facet
// comes round, the treble bringing more of them round at once.
//
// A drop is drawn in unit-disc coordinates (vQ, 1 at the rim) on a quad
// QUAD_PAD radii wide, so the lens ring and the shadow outside the rim fit
// on it. The shading follows what was measured per colour family
// (docs/scenes/oildrops.md): one light for the whole frame from the upper
// left (LIGHT_DIR), a body tilted toward it, a fall-off toward the rim, a
// soft highlight on the glossy families, glitter inside the pink ones, a
// thin dark line at the rim, a soft edge EDGE_WIDTH wide in width units
// (not radii, so a bead's edge is as soft as a pool's), a shadow on the
// paint to the lower right, and a clear lens ring around a share of the
// big drops. Colour is premultiplied and blended ONE, ONE_MINUS_SRC_ALPHA,
// so the shadow and the ring's dark edge are plain alpha over the paint.
import { NOISE_HASH_GLSL, NOISE_MASK } from "../../noiseHash.ts";
import { PALETTE_INK_COUNT } from "../../palette.ts";
import { FAMILY_COUNT, FAMILY_MAGENTA, FAMILY_ORANGE, FAMILY_PINK, FAMILY_PURPLE, FAMILY_RED, FAMILY_YELLOW } from "./drops.ts";

/** Octaves of the paint's noise, its base frequency in cells per width unit
 *  and how much each finer octave slides faster (the paint shader's per-
 *  octave drift is wrapped by index.ts with these). */
export const PAINT_OCTAVES = 5;
export const PAINT_FREQ = 2.2;
export const PAINT_LACUNARITY = 2.05;
/** How fast the paint's base octave boils along the time axis, in cells
 *  per second, and how much faster each finer octave; the measured paint
 *  between the drops barely changes shape, so this is slow. */
export const BOIL_RATE = 0.012;
export const BOIL_OCTAVE_GROWTH = 1.7;
/** Golden-ratio stagger between octaves' depths: value noise loses contrast
 *  halfway between two lattice slices, and octaves passing that point
 *  together would make the whole paint breathe. */
export const BOIL_STAGGER = 0.618;

/** How many radii the drop's quad spans from its centre: the shadow and
 *  the lens ring reach to about 1.45. */
const QUAD_PAD = 1.5;
/** The soft edge's 10–90% width in width units: 7–9 px at 1920 wide. */
const EDGE_WIDTH = 0.0042;
/** Where the light comes from, in the frame's plane (x right, y up):
 *  about 25° left of straight up, as every family's lit side agreed. */
const LIGHT_DIR: readonly [number, number] = [-0.42, 0.91];
/** The lens ring's inner and outer radii, in radii. */
const LENS_IN = 1.17;
const LENS_OUT = 1.28;
/** The dark line at the rim, as a share of the body's brightness, and the
 *  shadow's darkest alpha just outside the rim on the far side. */
const RIM_DARK = 0.18;
const SHADOW_ALPHA = 0.34;

/** Per family (drops.ts's FAMILY_* order): the body's tilt toward the light,
 *  the brightness at 0.85–0.92 r relative to the body, the highlight's peak
 *  over the body and how much glitter the drop carries. Measured per
 *  colour family on the clips; the reds read as flat discs, the pinks as
 *  glossy glitter-filled domes. */
export const FAMILY_SHADING: ReadonlyArray<readonly [tilt: number, fall: number, highlight: number, glitter: number]> = (() => {
  const t: Array<readonly [number, number, number, number]> = new Array(FAMILY_COUNT);
  t[FAMILY_RED] = [0.15, 0.95, 1.0, 0];
  t[FAMILY_MAGENTA] = [0.2, 0.93, 1.1, 0.4];
  t[FAMILY_ORANGE] = [0.27, 0.84, 1.13, 0];
  t[FAMILY_PINK] = [0.35, 0.86, 1.34, 1];
  t[FAMILY_YELLOW] = [0.1, 0.85, 1.06, 0];
  t[FAMILY_PURPLE] = [0.3, 0.86, 1.25, 0.8];
  return t;
})();

/** Per family, the drop's own colour (the Own colour mode). */
export const FAMILY_RGB: ReadonlyArray<readonly [number, number, number]> = (() => {
  const t: Array<readonly [number, number, number]> = new Array(FAMILY_COUNT);
  t[FAMILY_RED] = [0.78, 0.07, 0.1];
  t[FAMILY_MAGENTA] = [0.72, 0.14, 0.42];
  t[FAMILY_ORANGE] = [0.95, 0.44, 0.09];
  t[FAMILY_PINK] = [0.94, 0.42, 0.62];
  t[FAMILY_YELLOW] = [0.93, 0.78, 0.22];
  t[FAMILY_PURPLE] = [0.42, 0.22, 0.62];
  return t;
})();

/** Per Paint option (card.ts's PAINTS): the paint's deep colour, its mid
 *  colour and the pale streak colour. */
export const PAINT_RGB: ReadonlyArray<readonly [deep: readonly [number, number, number], mid: readonly [number, number, number], pale: readonly [number, number, number]]> = [
  [
    [0.03, 0.06, 0.2],
    [0.14, 0.28, 0.6],
    [0.5, 0.64, 0.84],
  ],
  [
    [0.02, 0.03, 0.1],
    [0.08, 0.12, 0.3],
    [0.22, 0.3, 0.5],
  ],
];

const f = (x: number) => x.toFixed(4);

/** Uniforms both passes declare on top of the common set. */
const SHARED_DECLS = `
uniform float uRoomAspect; // room height over width
uniform float uPxW;        // one screen pixel, in width units
uniform vec3 uPaintDeep;
uniform vec3 uPaintMid;
uniform vec3 uPaintPale;
uniform float uGlitterAmt; // the Glitter setting with its treble lift applied
`;

/** The glitter lattice: a flake in some cells, flashing as its facet comes
 *  round. `p` is in width units; `amt` scales how many are lit at once. */
const GLITTER_GLSL = `
float glitter(vec2 p, float cell, float amt, uint seed) {
  vec2 g = p / cell;
  vec2 i = floor(g);
  float has = hashCell(i, 0xffff, seed);
  if (has > 0.16) return 0.0;
  vec2 off = hash2Cell(i, 0xffff, seed + 7u) * 0.6 + 0.2;
  float d = length(g - i - off) * cell / uPxW;
  float dot_ = 1.0 - smoothstep(0.6, 1.4, d);
  float ph = hashCell(i, 0xffff, seed + 13u);
  float rate = 0.6 + 1.8 * hashCell(i, 0xffff, seed + 19u);
  float facet = sin(uTime * rate + ph * 6.2831853);
  float flash = smoothstep(1.0 - 0.22 * amt, 1.0, facet);
  return dot_ * flash;
}`;

export const PAINT_FRAG = `
${NOISE_HASH_GLSL}
${SHARED_DECLS}
uniform float uPaintDrift[${PAINT_OCTAVES * 2}];
uniform float uBoilDepth[${PAINT_OCTAVES}];

float hash3Cell(vec3 c, uint seed) {
  uint h = cellBits(c.xy, ${NOISE_MASK}, seed) ^ (uint(int(c.z) & ${NOISE_MASK}) * 0x85ebca6bu);
  return float(uhash(h) >> 8u) * (1.0 / 16777216.0);
}

float vnoise3(vec2 p, float t, uint seed) {
  vec3 i = floor(vec3(p, t));
  vec3 fr = vec3(p, t) - i;
  vec3 u = fr * fr * (3.0 - 2.0 * fr);
  float a0 = mix(mix(hash3Cell(i, seed), hash3Cell(i + vec3(1.0, 0.0, 0.0), seed), u.x),
                 mix(hash3Cell(i + vec3(0.0, 1.0, 0.0), seed), hash3Cell(i + vec3(1.0, 1.0, 0.0), seed), u.x), u.y);
  float a1 = mix(mix(hash3Cell(i + vec3(0.0, 0.0, 1.0), seed), hash3Cell(i + vec3(1.0, 0.0, 1.0), seed), u.x),
                 mix(hash3Cell(i + vec3(0.0, 1.0, 1.0), seed), hash3Cell(i + vec3(1.0, 1.0, 1.0), seed), u.x), u.y);
  return mix(a0, a1, u.z);
}

// Each octave at its own wrapped slide and depth; the paint rides the sheet.
float paintFbm(vec2 p, vec2 warp) {
  float sum = 0.0;
  float amp = 1.0;
  float norm = 0.0;
  float freq = ${f(PAINT_FREQ)};
  for (int k = 0; k < ${PAINT_OCTAVES}; k++) {
    vec2 q = (p + warp * (k < 2 ? 1.0 : 0.5)) * freq + vec2(uPaintDrift[k * 2], uPaintDrift[k * 2 + 1]) + float(k) * vec2(3.1, 7.7);
    sum += amp * vnoise3(q, uBoilDepth[k], 101u + uint(k));
    norm += amp;
    amp *= 0.55;
    freq *= ${f(PAINT_LACUNARITY)};
  }
  return sum / norm;
}

${GLITTER_GLSL}

void main() {
  vec2 uv = roomUv(vUv);
  vec2 p = vec2(uv.x, uv.y * uRoomAspect);
  // A gentle warp folds the streaks the way poured paint marbles.
  vec2 w0 = vec2(uPaintDrift[0], uPaintDrift[1]);
  vec2 warp = vec2(vnoise3(p * 1.3 + w0 * 0.6 + vec2(11.0, 5.0), uBoilDepth[0], 77u),
                   vnoise3(p * 1.3 + w0 * 0.6 + vec2(2.0, 19.0), uBoilDepth[0], 78u)) - 0.5;
  float n = paintFbm(p, 0.35 * warp);
  // The streaks: a stretched second reading, thinner and brighter.
  float s = paintFbm(p * vec2(1.0, 3.0) + vec2(50.0, 0.0), 0.2 * warp);
  float streak = smoothstep(0.58, 0.72, s) * 0.5;
  float z = (n - 0.5) / 0.09;
  float v = clamp(0.5 + 0.22 * z, 0.0, 1.0);
  vec3 col;
  if (uColors < 0.5) {
    col = mix(uPaintDeep, uPaintMid, smoothstep(0.1, 0.75, v));
    col = mix(col, uPaintPale, streak * smoothstep(0.4, 0.9, v));
  } else {
    col = mix(uPalGround, palRamp(0.45 * v), smoothstep(0.0, 0.8, v));
    col = mix(col, palRamp(0.6), streak * smoothstep(0.4, 0.9, v));
  }
  // Glitter rides the base octave's slide.
  vec2 gp = p + vec2(uPaintDrift[0], uPaintDrift[1]) / ${f(PAINT_FREQ)};
  float gl = glitter(gp, 0.0045, uGlitterAmt, 3u) + 0.6 * glitter(gp + vec2(0.37, 0.11), 0.0032, uGlitterAmt, 5u);
  col += uGlitterAmt * gl * (uColors < 0.5 ? vec3(0.85, 0.92, 1.0) : palRamp(0.95));
  outColor = vec4(col, 1.0);
}
`;

export const DROP_VERT = `#version 300 es
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aDrop;  // x, y (width units), radius, seed
layout(location = 2) in vec4 aStyle; // family, lens, spare, spare
uniform vec4 uViewport;
uniform float uRoomAspect;
out vec2 vQ;
flat out vec4 vDrop;
flat out vec4 vStyle;
void main() {
  vec2 pos = aDrop.xy + aCorner * aDrop.z * ${f(QUAD_PAD)};
  vec2 room = vec2(pos.x, pos.y / uRoomAspect);
  vec2 scr = (room - uViewport.xy) / uViewport.zw;
  gl_Position = vec4(scr * 2.0 - 1.0, 0.0, 1.0);
  vQ = aCorner * ${f(QUAD_PAD)};
  vDrop = aDrop;
  vStyle = aStyle;
}`;

export const DROP_FRAG = `
${NOISE_HASH_GLSL}
${SHARED_DECLS}
uniform vec4 uFamShade[${FAMILY_COUNT}]; // tilt, fall, highlight, glitter
uniform vec3 uFamRgb[${FAMILY_COUNT}];
in vec2 vQ;
flat in vec4 vDrop;
flat in vec4 vStyle;

${GLITTER_GLSL}

void main() {
  float rho = length(vQ);
  float r = vDrop.z;
  int fam = int(vStyle.x + 0.5);
  vec4 sh = uFamShade[fam];
  vec3 base = uColors < 0.5 ? uFamRgb[fam] : uPalInk[fam - (fam / ${PALETTE_INK_COUNT}) * ${PALETTE_INK_COUNT}];
  vec2 L = vec2(${f(LIGHT_DIR[0])}, ${f(LIGHT_DIR[1])});
  // The soft edge in radii: a fixed width on screen, never under two pixels.
  float e = min(0.6, max(${f(EDGE_WIDTH)}, 2.0 * uPxW) / r);

  // Body: tilted toward the light, falling off toward the rim, a dark line
  // just inside the edge.
  float shade = 1.0 + sh.x * uGloss * dot(vQ, L);
  shade *= mix(1.0, sh.y, smoothstep(0.6, 0.92, rho));
  float rimC = 1.0 - 0.7 * e;
  float rimLine = exp(-pow((rho - rimC) / (0.35 * e + 0.004), 2.0));
  shade *= 1.0 - ${f(RIM_DARK)} * rimLine;
  // Highlight: a soft dome glint on the glossy families, a small sharp
  // spot on all.
  vec2 hq = vQ - 0.42 * L;
  shade += (sh.z - 1.0) * uGloss * exp(-dot(hq, hq) / (2.0 * 0.23 * 0.23));
  vec2 sq = vQ - 0.5 * L;
  shade += 0.22 * uGloss * exp(-dot(sq, sq) / (2.0 * 0.06 * 0.06)) * (1.0 - smoothstep(0.8, 1.0, rho));
  vec3 col = base * shade;
  // Glitter inside the glossy drops, moving with the drop.
  if (sh.w > 0.0) {
    vec2 gp = vQ * r + vDrop.w * 13.7;
    col += sh.w * uGlitterAmt * glitter(gp, 0.0038, uGlitterAmt, 23u) * (1.0 - smoothstep(0.8, 0.95, rho)) * vec3(1.0, 0.95, 0.9);
  }
  float body = 1.0 - smoothstep(1.0 - e, 1.0 + 0.15 * e, rho);

  // Shadow on the paint, to the lower right, fading out by 1.45 r.
  vec2 dir = vQ / max(rho, 1e-4);
  float away = max(0.0, dot(dir, -L));
  float shadow = ${f(SHADOW_ALPHA)} * uGloss * pow(away, 1.5) * smoothstep(0.98, 1.0 + 0.3 * e, rho) * (1.0 - smoothstep(1.05, 1.45, rho));

  // The lens ring: a clear ring whose inner edge catches light and whose
  // outer edge is a thin dark line.
  float lensA = 0.0;
  vec3 lensCol = vec3(0.0);
  if (vStyle.y > 0.5) {
    float pxR = uPxW / r;
    float inner = exp(-pow((rho - ${f(LENS_IN)}) / (1.2 * pxR + 0.008), 2.0));
    float outer = exp(-pow((rho - ${f(LENS_OUT)}) / (1.0 * pxR + 0.006), 2.0));
    float between = smoothstep(${f(LENS_IN)}, ${f(LENS_IN)} + 0.02, rho) * (1.0 - smoothstep(${f(LENS_OUT)} - 0.02, ${f(LENS_OUT)}, rho));
    float lit = 0.5 + 0.5 * dot(dir, L);
    lensA = 0.22 * inner * lit + 0.24 * outer + 0.04 * between;
    lensCol = vec3(1.0) * 0.22 * inner * lit + base * 0.04 * between;
  }

  float alpha = clamp(body + (1.0 - body) * (shadow + lensA), 0.0, 1.0);
  outColor = vec4(col * body + (1.0 - body) * lensCol, alpha);
}
`;
