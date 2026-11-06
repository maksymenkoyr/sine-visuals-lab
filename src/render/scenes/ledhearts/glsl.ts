/**
 * LED Hearts' picture, as one fragment body (createFullscreenScene's
 * `fragBody`).
 *
 * The hearts are drawn first as a field of light, then seen through a grid
 * of round LEDs fixed to the screen: each LED shows the field at its own
 * centre, so a heart is made of whole dots and its outline steps from dot to
 * dot as it moves. A softer copy of the same field, sampled at the pixel,
 * is the haze that fills the gaps between lit LEDs and glows past a heart's
 * edge. Blur, slider plus wires, sets how soft those edges are and how far
 * the haze reaches.
 *
 * The field is LAYERS hashed lattices of hearts (motion.ts says how they
 * zoom and wrap). A lattice cell holds at most one heart, jittered and sized
 * so it stays inside the 2×2 cells nearest any point, which is all a lookup
 * reads; its edge and haze fade out before `LOOKUP_REACH`, past which that
 * lookup would cut them off. Each heart turns about its vertical axis and
 * leans violet as it narrows, but never to a line (`MIN_WIDTH`); near
 * hearts soften and redden as their layer fades out. Overlapping
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
/** Blur's two ends. How far the haze reaches past a heart's edge, in
 *  half-heights per e-fold; the reference measures 12–14 px at 720 px tall,
 *  about a third of the way up, and the owner wants it sharper than that. */
const HAZE_EFOLD_SHARP = 0.012;
const HAZE_EFOLD_SOFT = 0.1;
/** Edge softness either side of the outline: in LEDs at no blur, since any
 *  less and a dot pops on and off as an edge passes it instead of fading;
 *  in half-heights at full blur. */
const EDGE_SHARP_LEDS = 0.45;
const EDGE_SOFT = 0.07;
/** How much softer, in cells, a near, fading layer gets at full blur. */
const NEAR_BLUR = 0.3;
/** The heart's outline, in any unit: a lobe disc on each side and a small
 *  disc at the bottom tip, joined along their outer tangents. Only the tip is
 *  rounded: a rounded cleft fills in, and a heart a few LEDs tall then reads
 *  as a blob. Tuned by eye against the reference's hearts at 3–10 LEDs per
 *  half-height. */
const LOBE_X = 0.44;
const LOBE_Y = 0.2;
const LOBE_R = 0.52;
const TIP_Y = -0.78;
const TIP_R = 0.07;

const HEART_TOP = LOBE_Y + LOBE_R;
const HEART_BOTTOM = TIP_Y - TIP_R;
const HEART_HALF = (HEART_TOP - HEART_BOTTOM) / 2;
const HEART_MID = (HEART_TOP + HEART_BOTTOM) / 2;
/** The same outline in half-heights from the heart's centre. */
const LOBE = [LOBE_X / HEART_HALF, (LOBE_Y - HEART_MID) / HEART_HALF] as const;
const LOBE_RADIUS = LOBE_R / HEART_HALF;
const TIP = (TIP_Y - HEART_MID) / HEART_HALF;
const TIP_RADIUS = TIP_R / HEART_HALF;
const AXIS_LEN = Math.hypot(LOBE[0], LOBE[1] - TIP);
const SIN_A = (LOBE_RADIUS - TIP_RADIUS) / AXIS_LEN;
const COS_A = Math.sqrt(1 - SIN_A * SIN_A);
/** How far the heart reaches from its centre, in half-heights: the far side
 *  of a lobe. */
export const HEART_REACH = Math.hypot(LOBE[0], LOBE[1]) + LOBE_RADIUS;

/** A heart's size range: its half-height, in lattice cells. */
const A_MIN = 0.22;
export const A_MAX = 0.4;
/** How far a heart sits off its cell centre, in cells. */
const JITTER = 0.24;
/** The 2×2 lookup sees every heart whose centre is nearer than this, in
 *  cells; a heart's light must be gone by then, or the lookup's cell edges
 *  show as straight seams through the haze. tests/ledheartsMotion.test.ts
 *  checks A_MAX's heart fits inside it. */
export const LOOKUP_REACH = 1 - JITTER;
/** Share of hearts in the rose accent colour instead of magenta. */
const ROSE_SHARE = 0.1;
/** Share of hearts that turn all the way round; the rest rock by WOBBLE
 *  radians either way. The reference's hearts read 0.82–0.97 wide for tall,
 *  so most face the viewer and only a few show edge-on. */
const SPIN_SHARE = 0.15;
const WOBBLE = 0.6;
/** How narrow a turning heart gets, as a share of its width: any narrower
 *  and the LED grid draws it as a single violet line. */
const MIN_WIDTH = 0.45;
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

const vec2 LOBE = vec2(${LOBE[0].toFixed(5)}, ${LOBE[1].toFixed(5)});
const vec2 TIP = vec2(0.0, ${TIP.toFixed(5)});
const vec2 LOBE_AXIS = vec2(${(LOBE[0] / AXIS_LEN).toFixed(5)}, ${((LOBE[1] - TIP) / AXIS_LEN).toFixed(5)});

// One lobe disc and the tip disc, joined along their tangents (their convex
// hull). Exact signed distance, so the haze stays round past the tip
// instead of trailing a point below it.
float sdLobe(vec2 p) {
  vec2 d = p - TIP;
  float along = dot(d, LOBE_AXIS);
  float across = abs(LOBE_AXIS.x * d.y - LOBE_AXIS.y * d.x);
  float t = along * ${COS_A.toFixed(5)} + across * ${SIN_A.toFixed(5)};
  if (t < 0.0) return length(d) - ${TIP_RADIUS.toFixed(5)};
  if (t > ${(AXIS_LEN * COS_A).toFixed(5)}) return length(p - LOBE) - ${LOBE_RADIUS.toFixed(5)};
  return across * ${COS_A.toFixed(5)} - along * ${SIN_A.toFixed(5)} - ${TIP_RADIUS.toFixed(5)};
}

// A heart of half-height a, centred on p's origin.
float sdHeart(vec2 p, float a) {
  p /= a;
  p.x = abs(p.x);
  return min(sdLobe(p), sdLobe(vec2(-p.x, p.y))) * a;
}

vec3 hueShift(vec3 c, float deg) {
  float r = radians(deg);
  vec3 k = vec3(0.57735);
  return c * cos(r) + cross(k, c) * sin(r) + k * dot(k, c) * (1.0 - cos(r));
}

// This frame's softness, read once in main from Blur and its wires.
float gEdge;
float gHazeEfold;
float gNearBlur;

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
    float squash = max(abs(c), ${MIN_WIDTH.toFixed(3)});
    vec2 d = q - ctr;
    float reach = 1.0 - smoothstep(${HEART_REACH.toFixed(4)} * a, ${LOOKUP_REACH.toFixed(4)}, length(d));
    float tilt = (fract(h2.x * 5.3) - 0.5) * 0.5;
    d = vec2(cos(tilt) * d.x - sin(tilt) * d.y, sin(tilt) * d.x + cos(tilt) * d.y);
    float sd = sdHeart(vec2(d.x / squash, d.y), a) * mix(squash, 1.0, 0.5);
    float cov = halo
      ? exp(-max(sd, 0.0) * scale / gHazeEfold)
      : 1.0 - smoothstep(-1.0, 1.0, sd / (gEdge / scale + near * gNearBlur));
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
    acc = max(acc, col * bright * cov * reach * fade);
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

  // A wire lifts the slider toward full blur, so an empty jack reads the
  // slider alone (drives.ts, "Nothing plugged in").
  float blur = clamp(uBlur + (1.0 - uBlur) * blurDrive(0.0), 0.0, 1.0);
  gEdge = mix(${EDGE_SHARP_LEDS.toFixed(3)} * pitch, ${EDGE_SOFT.toFixed(3)}, blur);
  gHazeEfold = mix(${HAZE_EFOLD_SHARP.toFixed(3)}, ${HAZE_EFOLD_SOFT.toFixed(3)}, blur);
  gNearBlur = ${NEAR_BLUR.toFixed(3)} * blur;

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
