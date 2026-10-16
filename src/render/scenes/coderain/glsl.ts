/**
 * Code Rain's shaders: the rain columns (RAIN_VERT/RAIN_FRAG, one instanced
 * quad per column) and the figure (FIGURE_VERT/FIGURE_FRAG, one quad). Both
 * are additive over black and share the camera in CAMERA_GLSL; index.ts owns
 * the numbers that go in. What the rain does, cell by cell, is in RAIN_FRAG's
 * own comment.
 *
 * Hashing: every per-column, per-row and per-epoch random number goes
 * through NOISE_HASH_GLSL's integer `uhash` on integers only (the instance
 * id, the row index, an epoch count), never on the growing fall clock — see
 * src/render/noiseHash.ts for why a float hash of a growing input breaks up
 * on mobile GPUs. The fall clock itself only ever feeds `floor()`, which
 * fp32 keeps exact up to 2^24 rows.
 */
import { NOISE_HASH_GLSL } from "../../noiseHash.ts";
import { ATLAS_COLS, DIGIT_COUNT, DIGIT_SHARE, GLYPH_COUNT, KANA_SHARE, MIRRORED_COUNT, TILE_PX } from "./glyphs.ts";
import { FIGURE_CAPSULES } from "./figure.ts";

/** How many hit bursts the shader keeps lit at once (index.ts's ring). */
export const BURST_SLOTS = 4;

const CAMERA_GLSL = `
uniform vec3 uCamPos;
uniform vec3 uRight;
uniform vec3 uUp;
uniform vec3 uFwd;
// x, y: projection scale; z, w: depth terms (A·vz + B) for clip z.
uniform vec4 uProj;
// This device's slice of the room's frame: centre in room NDC, then 1/size.
uniform vec4 uSlice;

vec4 project(vec3 world, out float vz) {
  vec3 rel = world - uCamPos;
  vz = dot(rel, uFwd);
  vec4 clip = vec4(dot(rel, uRight) * uProj.x, dot(rel, uUp) * uProj.y, vz * uProj.z + uProj.w, vz);
  clip.xy = (clip.xy - uSlice.xy * clip.w) * uSlice.zw;
  return clip;
}

// The six corners of a quad drawn as two triangles, (0..1, 0..1).
vec2 quadCorner(int id) {
  int k = id % 6;
  return vec2(k == 1 || k == 4 || k == 5 ? 1.0 : 0.0, k == 2 || k == 3 || k == 5 ? 1.0 : 0.0);
}
`;

const HASH_HELPERS = `
${NOISE_HASH_GLSL}
float h3(uint a, uint b, uint c) {
  return float(uhash(a ^ uhash(b ^ uhash(c))) >> 8u) * (1.0 / 16777216.0);
}

// A small glyph's strokes average away in the atlas's lower mips and the
// glyph goes dim and grey; the reference's small glyphs stay bright and
// chunky. Lift the ink as the glyph shrinks: by how many atlas texels fall
// in one pixel along the column (TILE_PX texels per row).
float inkBoost(float ink, float rowF) {
  float texels = ${TILE_PX}.0 * fwidth(rowF);
  return min(1.0, ink * mix(1.0, 2.4, smoothstep(2.0, 10.0, texels)));
}

// A glyph index from a uniform draw: mostly kana, some digits, few symbols.
float pickGlyph(float h) {
  const float KANA = ${MIRRORED_COUNT}.0;
  const float DIGITS = ${DIGIT_COUNT}.0;
  const float SYMBOLS = ${GLYPH_COUNT - MIRRORED_COUNT - DIGIT_COUNT}.0;
  const float KS = ${KANA_SHARE.toFixed(4)};
  const float DS = ${DIGIT_SHARE.toFixed(4)};
  if (h < KS) return floor(h / KS * KANA);
  if (h < KS + DS) return KANA + floor((h - KS) / DS * DIGITS);
  return KANA + DIGITS + min(SYMBOLS - 1.0, floor((h - KS - DS) / (1.0 - KS - DS) * SYMBOLS));
}
`;

export const RAIN_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec4 aCol; // base x, base z, depth-of-field share, speed factor
${CAMERA_GLSL}
uniform float uField;     // the grid's wrap period, world units
uniform float uSpan;      // half-height of a column quad, world units
uniform float uGlyphW;    // glyph cell width, world units
uniform float uCellH;     // glyph cell height (row pitch), world units
uniform float uDensity;   // share of the columns drawn
uniform float uTopSlope;  // tan(elevation of the view's top edge)
uniform vec4 uFade;       // near fade from x to y, far fade from z to w, world units
out vec2 vUv;             // x across the column 0..1, y in rows (down = +)
flat out vec4 vCol;       // speed factor, row of the view's top here, fade, unused
flat out uint vId;

void main() {
  vec2 c = quadCorner(gl_VertexID);
  vId = uint(gl_InstanceID);
  // Wrap the grid around the camera so the field never ends.
  vec2 rel = mod(aCol.xy - uCamPos.xz + 0.5 * uField, uField) - 0.5 * uField;
  float dist = length(rel);
  float fade = smoothstep(uFade.x, uFade.y, dist) * smoothstep(uFade.w, uFade.z, dist);
  if (aCol.z > uDensity || fade < 0.004) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0); // dropped: outside the clip volume
    vUv = vec2(0.0);
    vCol = vec4(0.0);
    return;
  }
  vec3 rightH = normalize(vec3(uRight.x, 0.0, uRight.z));
  vec3 fwdH = normalize(vec3(uFwd.x, 0.0, uFwd.z));
  vec3 base = vec3(uCamPos.x + rel.x, uCamPos.y, uCamPos.z + rel.y);
  vec3 world = base + rightH * (c.x - 0.5) * uGlyphW + vec3(0.0, (2.0 * c.y - 1.0) * uSpan, 0.0);
  float vz;
  gl_Position = project(world, vz);
  vUv = vec2(c.x, -world.y / uCellH);
  float ahead = max(dot(rel, fwdH.xz), 0.0);
  float topRow = -(uCamPos.y + ahead * uTopSlope) / uCellH - 2.0;
  vCol = vec4(aCol.w, topRow, fade, 0.0);
}
`;

export const RAIN_FRAG = `#version 300 es
precision highp float;
${HASH_HELPERS}
// The rain, cell by cell. Every column is a fixed string of glyphs; nothing
// slides down it. What falls is the *head*: a bright cell that steps down
// one row at a time, lighting the glyphs it passes, which then fade behind
// it into a trail (measured on the reference: the glyph texture inside a
// trail doesn't move while the head moves down it). Heads repeat down the
// column every P rows, so a column is lit in trails of L rows with gaps
// between. A hit adds bursts: a share of the columns starts a fresh head at
// the top of the view, brighter, falling at the column's own speed.
in vec2 vUv;
flat in vec4 vCol;
flat in uint vId;
uniform sampler2D uAtlas;
uniform float uFall;      // fall clock, rows at speed factor 1
uniform float uTime;
uniform float uTrail;     // mean trail length, rows
uniform float uGap;       // mean gap between trails, in trail lengths
uniform float uFlicker;   // glyph swaps per second per cell
uniform float uHeadLift;  // head brightness multiplier (Hit glow)
uniform float uGain;
uniform vec4 uBurst[${BURST_SLOTS}]; // fall clock at start, share, id, unused
uniform vec3 uHeadCol;
uniform vec3 uTrailCol;
uniform vec3 uTailCol;
out vec4 outColor;

const float COLS = ${ATLAS_COLS}.0;

// Trail brightness d rows behind a head (0 = the head itself): from the
// head's side down to 0.3 of it at the far end, then out (the measured
// tail-to-head brightness ratio was ~0.34).
float trail(float d, float L) {
  if (d < 0.0 || d >= L) return 0.0;
  return mix(1.0, 0.3, d / L) * smoothstep(L, 0.82 * L, d);
}

void main() {
  float spd = vCol.x;
  float rowF = vUv.y;
  float row = floor(rowF);
  uint urow = uint(int(row));
  float L = uTrail * (0.6 + 0.8 * h3(vId, 11u, 0u));
  float P = L * (1.0 + uGap * (0.4 + 1.2 * h3(vId, 13u, 0u)));
  float head = floor(uFall * spd + 4096.0 * h3(vId, 17u, 0u));
  float d = mod(head - row, floor(P));
  float b = trail(d, L);
  float isHead = d < 0.5 ? 1.0 : 0.0;

  for (int k = 0; k < ${BURST_SLOTS}; k++) {
    vec4 bu = uBurst[k];
    if (bu.y <= 0.0) continue;
    if (h3(vId, uint(bu.z), 29u) >= bu.y) continue;
    // Each column's head enters from its own height above the top edge, so
    // a hit's burst doesn't arrive as one straight front.
    float start = vCol.y - 30.0 * h3(vId, uint(bu.z), 31u);
    float bh = floor(start + (uFall - bu.x) * spd);
    float dk = bh - row;
    float bb = trail(dk, L) * 1.25;
    if (bb > b) {
      b = bb;
      isHead = dk < 0.5 ? 1.0 : 0.0;
    }
  }
  if (b <= 0.0) discard;

  // Which glyph: fixed per cell, re-rolled at the cell's own flicker rate;
  // the head flickers faster, as in the film.
  float rate = uFlicker * (0.3 + 1.4 * h3(vId, urow, 3u)) * (1.0 + 7.0 * isHead);
  float epoch = floor(uTime * rate + h3(vId, urow, 5u));
  float g = pickGlyph(h3(vId, urow, uint(int(epoch)) + 7u));
  vec2 tile = vec2(mod(g, COLS), floor(g / COLS));
  vec2 inCell = vec2(vUv.x, fract(rowF));
  vec2 uvA = (tile + inCell) / COLS;
  // Gradients from the continuous coordinate, so the mip level doesn't jump
  // at a cell boundary where the tile changes.
  vec2 gx = dFdx(vec2(vUv.x, rowF)) / COLS;
  vec2 gy = dFdy(vec2(vUv.x, rowF)) / COLS;
  float ink = inkBoost(textureGrad(uAtlas, uvA, gx, gy).r, rowF);

  vec3 col = mix(uTailCol, uTrailCol, b) * b;
  col = mix(col, uHeadCol * uHeadLift, isHead);
  outColor = vec4(col * ink * vCol.z * uGain, 1.0);
}
`;

export const FIGURE_VERT = `#version 300 es
precision highp float;
${CAMERA_GLSL}
uniform vec3 uFigOrigin;  // world position of the figure's feet, centred
uniform float uFigScale;  // world units per rig metre
uniform vec2 uFigSize;    // the quad, rig metres (width, height)
out vec2 vFig;            // rig metres: x centred, y up from the floor
out float vDepth;

void main() {
  vec2 c = quadCorner(gl_VertexID);
  vFig = vec2((c.x - 0.5) * uFigSize.x, c.y * uFigSize.y);
  vec3 rightH = normalize(vec3(uRight.x, 0.0, uRight.z));
  vec3 world = uFigOrigin + (rightH * vFig.x + vec3(0.0, vFig.y, 0.0)) * uFigScale;
  float vz;
  gl_Position = project(world, vz);
  vDepth = vz;
}
`;

export const FIGURE_FRAG = `#version 300 es
precision highp float;
${HASH_HELPERS}
// The figure: the dancer's silhouette (capsules unioned smoothly) filled
// with a sheet of tiny glyph columns that rain like the field's, brighter
// toward the body's middle so it reads as a solid. Glyphs only fill the
// silhouette, the way the reference's "ghosts" were image pixels drawn as
// glyphs.
in vec2 vFig;
in float vDepth;
uniform sampler2D uAtlas;
uniform vec4 uCaps[${FIGURE_CAPSULES}];
uniform float uCapR[${FIGURE_CAPSULES}];
uniform vec3 uSkull;
uniform float uFigCell;   // glyph cell width, rig metres
uniform float uFall;
uniform float uTime;
uniform float uFlicker;
uniform float uFigGain;
uniform vec3 uFigCol;
uniform vec3 uTrailCol;
out vec4 outColor;

const float COLS = ${ATLAS_COLS}.0;

float sdCapsule(vec2 p, vec2 a, vec2 b, float r) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

void main() {
  float sd = length(vFig - uSkull.xy) - uSkull.z;
  for (int i = 0; i < ${FIGURE_CAPSULES}; i++) {
    sd = smin(sd, sdCapsule(vFig, uCaps[i].xy, uCaps[i].zw, uCapR[i]), 0.05);
  }
  if (sd > 0.01) discard;
  float body = clamp(-sd / 0.07, 0.0, 1.0);

  float colF = floor(vFig.x / uFigCell);
  uint ucol = uint(int(colF) + 4096);
  float rowF = -vFig.y / (uFigCell * 1.1);
  float row = floor(rowF);
  uint urow = uint(int(row) + 4096);
  float L = 10.0 + 14.0 * h3(ucol, 11u, 1u);
  float P = L * (1.6 + 1.6 * h3(ucol, 13u, 1u));
  float spd = 0.7 + 0.6 * h3(ucol, 19u, 1u);
  float head = floor(uFall * spd + 4096.0 * h3(ucol, 17u, 1u));
  float d = mod(head - row, floor(P));
  float rain = d < L ? mix(1.0, 0.25, d / L) : 0.0;

  float rate = uFlicker * (0.3 + 1.4 * h3(ucol, urow, 3u));
  float epoch = floor(uTime * rate + h3(ucol, urow, 5u));
  float g = pickGlyph(h3(ucol, urow, uint(int(epoch)) + 7u));
  vec2 tile = vec2(mod(g, COLS), floor(g / COLS));
  vec2 inCell = vec2(fract(vFig.x / uFigCell), fract(rowF));
  vec2 coord = vec2(vFig.x / uFigCell, rowF);
  float ink = inkBoost(textureGrad(uAtlas, (tile + inCell) / COLS, dFdx(coord) / COLS, dFdy(coord) / COLS).r, rowF);

  float edge = smoothstep(0.01, -0.01, sd);
  float lum = edge * (0.35 + 0.65 * body) * (0.3 + 0.7 * rain);
  vec3 col = mix(uTrailCol, uFigCol, 0.4 + 0.6 * body * rain);
  outColor = vec4(col * lum * ink * uFigGain * step(0.05, vDepth), 1.0);
}
`;
