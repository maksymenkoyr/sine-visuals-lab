/**
 * LED Hearts' picture, as one fragment body (createFullscreenScene's
 * `fragBody`).
 *
 * The hearts are drawn first as a field of light, then seen through a grid
 * of round LEDs fixed to the screen: each LED shows the field at its own
 * centre, so a heart is made of whole dots and its outline steps from dot to
 * dot as it moves. A softer copy of the same field, sampled at the pixel,
 * is the haze that fills the gaps between lit LEDs and glows past a heart's
 * edge.
 *
 * The field is LAYERS hashed lattices of hearts (motion.ts says how they
 * zoom and wrap). A lattice cell holds at most one heart, jittered and sized
 * so it stays inside the 2×2 cells nearest any point, which is all a lookup
 * reads. Each heart turns about its vertical axis and goes violet edge-on;
 * near hearts soften and redden as their layer fades out. Overlapping
 * hearts take the brighter light, as LEDs would, rather than occluding.
 *
 * Every TS number reaching the shader goes through `.toFixed()`, so GLSL
 * never sees an int where it wants a float.
 */

import { NOISE_HASH_GLSL, NOISE_MASK } from "../../noiseHash.ts";
import { LAYER_STEP, LAYERS, MIN_SCALE, SPIN_RATE_UNIT } from "./motion.ts";

/** The LED's diameter as a share of the grid pitch: the reference's lit dots
 *  fill 31% of a heart's area, which is a round dot of 0.63 pitch. */
const DOT_DIAMETER = 0.63;
/** Haze inside a heart, relative to a lit dot: the reference's gaps read
 *  0.25 against 0.76 at the dot centres. */
const HAZE_SHARE = 0.5;
/** How far the haze reaches past a heart's edge, in half-heights per e-fold
 *  (the reference measures 12–14 px at 720 px tall). */
const HAZE_EFOLD = 0.036;
/** A heart's size range, in lattice cells from the centre to the bottom tip. */
const A_MIN = 0.22;
const A_MAX = 0.4;
/** How far a heart sits off its cell centre, in cells. A_MAX's heart reaches
 *  about 1.25·A_MAX from its centre; with this jitter that stays under one
 *  cell, the reach the 2×2 lookup can see. */
const JITTER = 0.24;
/** How much the heart's lower half is squashed toward its centre. */
const TIP_SQUASH = 1.25;
/** Share of hearts in the rose accent colour instead of magenta. */
const ROSE_SHARE = 0.1;
/** Share of hearts that turn all the way round; the rest rock by WOBBLE
 *  radians either way. The reference's hearts read 0.82–0.97 wide for tall,
 *  so most face the viewer and only a few show edge-on. */
const SPIN_SHARE = 0.15;
const WOBBLE = 0.6;
/** Edge softness in half-heights (about one LED), and how much more, in
 *  cells, a near, fading layer gets. */
const EDGE = 0.022;
const NEAR_BLUR = 0.22;
/** The drop wave's front speed and width, in half-heights. */
const WAVE_SPEED = 1.8;
const WAVE_WIDTH = 0.35;

const SPAN = LAYERS * LAYER_STEP;

export const FRAG = `
${NOISE_HASH_GLSL}

const float TAU = 6.2831853;
const vec3 HEART = vec3(1.0, 0.27, 0.88);
const vec3 ROSE = vec3(1.0, 0.2, 0.42);
const vec3 VIOLET = vec3(0.42, 0.22, 1.0);
const vec3 FADE_RED = vec3(0.75, 0.1, 0.28);
const vec3 GROUND = vec3(0.016, 0.003, 0.015);

// A heart that reaches a below its centre: the diamond |x|+|y| <= a with a
// disc on the middle of each upper edge, shifted so the shape is centred.
// Signed distance, close enough outside for soft edges.
float sdHeart(vec2 p, float a) {
  p.y += 0.1035 * a;
  p.x = abs(p.x);
  // A shorter tip makes the plumper heart of the reference.
  p.y *= p.y < 0.0 ? ${TIP_SQUASH.toFixed(3)} : 1.0;
  float diamond = (p.x + abs(p.y) - a) * 0.70710678;
  float disc = length(p - vec2(0.5 * a)) - 0.70710678 * a;
  return min(diamond, disc);
}

vec3 hueShift(vec3 c, float deg) {
  float r = radians(deg);
  vec3 k = vec3(0.57735);
  return c * cos(r) + cross(k, c) * sin(r) + k * dot(k, c) * (1.0 - cos(r));
}

// One layer's light at p (half-heights from the centre). halo = false gives
// the field an LED samples; true gives the haze, which glows past the edge.
vec3 layerLight(vec2 p, int k, bool halo) {
  float fade = uLayerFade[k];
  if (fade <= 0.001) return vec3(0.0);
  float scale = uLayerScale[k];
  float near = uLayerNear[k];
  uint seed = uint(uLayerSeed[k] + 0.5) * 2u;
  // Hearts grow brighter as they come closer, as the reference's do.
  float grow = clamp(log(scale / ${MIN_SCALE.toFixed(3)}) / ${SPAN.toFixed(3)}, 0.0, 1.0);
  vec2 q = p / scale;
  vec2 base = floor(q - 0.5);
  vec3 acc = vec3(0.0);
  for (int j = 0; j < 4; j++) {
    vec2 cell = base + vec2(float(j & 1), float(j >> 1));
    vec2 h = hash2Cell(cell, ${NOISE_MASK}, seed);
    if (h.x >= uHearts) continue;
    vec2 h2 = hash2Cell(cell, ${NOISE_MASK}, seed + 1u);
    vec2 ctr = cell + 0.5 + (h2 - 0.5) * ${(2 * JITTER).toFixed(3)};
    float a = mix(${A_MIN.toFixed(3)}, ${A_MAX.toFixed(3)}, fract(h.y * 7.31));
    float rate = ${SPIN_RATE_UNIT.toFixed(3)} * (1.0 + floor(fract(h.y * 13.7) * 4.0))
      * (fract(h.y * 41.9) < 0.5 ? -1.0 : 1.0);
    float turn = uSpinPhase * rate + TAU * h.y;
    // Most hearts face the viewer and only rock; a few turn all the way.
    float c = cos(fract(h.y * 29.1) < ${SPIN_SHARE.toFixed(3)} ? turn : ${WOBBLE.toFixed(3)} * sin(turn));
    float squash = max(abs(c), 0.08);
    vec2 d = q - ctr;
    float tilt = (fract(h2.x * 5.3) - 0.5) * 0.5;
    d = vec2(cos(tilt) * d.x - sin(tilt) * d.y, sin(tilt) * d.x + cos(tilt) * d.y);
    float sd = sdHeart(vec2(d.x / squash, d.y), a) * mix(squash, 1.0, 0.5);
    float cov = halo
      ? exp(-max(sd, 0.0) * scale / ${HAZE_EFOLD.toFixed(3)})
      : 1.0 - smoothstep(-1.0, 1.0, sd / (${EDGE.toFixed(3)} / scale + near * ${NEAR_BLUR.toFixed(3)}));
    float inner = halo ? 0.0 : smoothstep(0.0, 0.6 * a, -sd);

    vec3 col = fract(h2.y * 3.7) < ${ROSE_SHARE.toFixed(3)} ? ROSE : HEART;
    col = mix(col, VIOLET, smoothstep(0.55, 0.95, 1.0 - abs(c)));
    col = mix(col, FADE_RED, near);
    float bright = mix(0.75, 1.1, fract(h.y * 3.3)) * mix(0.75, 1.15, grow) * (0.8 + 0.5 * inner);
    col = mix(col, vec3(1.0, 0.8, 0.97), 0.3 * inner * (1.0 - near));
    float wave = uWaveLvl * uWave
      * exp(-pow((length(ctr * scale) - uWaveAge * ${WAVE_SPEED.toFixed(3)}) / ${WAVE_WIDTH.toFixed(3)}, 2.0));
    col = mix(col, vec3(1.0, 0.75, 0.95), clamp(wave * 0.5, 0.0, 0.6));
    bright *= 1.0 + 1.5 * wave;
    acc = max(acc, col * bright * cov * fade);
  }
  return acc;
}

void main() {
  vec2 p = (roomUv(vUv) - 0.5) * 2.0;
  p.x *= uResolution.x / uResolution.y;

  float pitch = 2.0 / uLedRows;
  vec2 g = p / pitch;
  vec2 dotCentre = (floor(g) + 0.5) * pitch;
  float aa = 0.7 * uLedRows / uResolution.y;
  float dotMask = 1.0 - smoothstep(${(DOT_DIAMETER / 2).toFixed(3)} - aa, ${(DOT_DIAMETER / 2).toFixed(3)} + aa, length(fract(g) - 0.5));

  vec3 core = vec3(0.0);
  vec3 haze = vec3(0.0);
  for (int k = 0; k < ${LAYERS}; k++) {
    core = max(core, layerLight(dotCentre, k, false));
    haze = max(haze, layerLight(p, k, true));
  }

  float level = 0.8 + 0.5 * uGlow * glowDrive(uEnergy);
  // The ground is lifted a little toward the centre, and unlit LEDs show
  // faintly against it, as on the reference's dark gaps.
  vec3 ground = GROUND * (1.0 + 1.2 * (1.0 - smoothstep(0.0, 1.6, length(p))));
  vec3 col = ground * (1.0 + 0.8 * dotMask)
    + (1.15 * core * dotMask + haze * uHaze * ${HAZE_SHARE.toFixed(3)}) * level;
  col = max(hueShift(col, uHue), 0.0);
  col = 1.0 - exp(-col * 1.8);
  outColor = vec4(col, 1.0);
}
`;
