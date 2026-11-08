// Plasma: a crimson field of folded, marbled noise with thin glowing
// contour lines running through it, dark channels between its plateaus and
// a violet haze in some of the darks, churning in place: no pan, zoom, spin
// or cut. Built against a measured, silent reference (docs/scenes/plasma.md,
// References and Measurements), so every reaction to music is our own.
//
// The field f is value noise read through two nested domain warps (q, then
// r on q), the folds coming from the warps compressing the noise. It is
// coloured through a tone curve fitted to the reference's value bands:
// z = (f - 0.5) / FIELD_SPREAD in standard units, red carrying the value,
// blue a share of it that rises in the darks, green only near the top.
//
// The lines are level sets of the same z, spaced 1 / (LINE_DENSITY * Lines)
// apart, with a width in z units rather than pixels, so a line is thin
// where the field is steep and spreads into a broad glow where the field
// hovers near its level: the reference's rims show no preferred side (no
// light), which rules out glints and leaves level sets. A pixel-width floor
// from fwidth keeps a line from aliasing, with its energy kept, so a
// too-thin line dims instead of fattening.
//
// Motion: each warp octave drifts in its own direction (WARP_SITE_RATES,
// turned by OCTAVE_TURN per octave), so the warps bend rather than carry
// the picture anywhere, and the field itself boils along a third noise axis
// (boilDepths), because moving only the warps left the big shapes standing
// still. Both accumulate in JS and reach the shader wrapped, as
// noiseHash.ts's header requires.
//
// Music, each on its drive: Rush (loudness) speeds the churn, Swell (bass)
// deepens the folds, Sweep (a kick) moves every line's level and lets it
// settle back, and Flash (any hit) brightens and widens the lines.
import { createFullscreenScene } from "../fullscreenScene.ts";
import { NOISE_HASH_GLSL, NOISE_MASK, wrapFlow } from "../noiseHash.ts";
import { levelOf } from "../signals.ts";
import { card } from "./plasma.card.ts";

/** Octaves of each warp fbm and of the field's own fbm. */
export const WARP_OCTAVES = 4;
export const FIELD_OCTAVES = 6;
/** Per warp fbm call site (q.x, q.y, r.x, r.y): its drift in noise cells
 *  per unit of churn phase, in the base octave's lattice frame. They point
 *  different ways so the warps bend rather than travel. */
export const WARP_SITE_RATES: ReadonlyArray<readonly [number, number]> = [
  [0.1, -0.058],
  [-0.072, 0.091],
  [0.082, 0.067],
  [-0.053, -0.096],
];
/** How far each octave's drift turns from the one below it, in radians,
 *  and how much faster it runs. */
export const OCTAVE_TURN = 2.4;
export const OCTAVE_SPEEDUP = 1.6;
/** uDrift layout: per call site, per octave, an [x, y] pair. */
export const DRIFT_LEN = WARP_SITE_RATES.length * WARP_OCTAVES * 2;
/** How far the field's base octave moves along the time axis per unit of
 *  churn phase, in noise cells, and how much faster each finer octave
 *  boils. The reference's big layout never moves at all (an hour's mean
 *  frame keeps a quarter of its variance) while its detail turns over in
 *  seconds; ours lets the layout change over minutes instead of never. */
export const BOIL_RATE = 0.05;
export const BOIL_OCTAVE_GROWTH = 2.0;
/** Golden-ratio stagger between octaves' depths: value noise loses contrast
 *  halfway between two lattice slices, and octaves passing that point
 *  together would make the whole picture breathe. */
const BOIL_STAGGER = 0.618;
/** How much a full Rush reading on top of a full Rush setting multiplies the
 *  churn rate by: rate = churn * (1 + RUSH_GAIN * rush * reading). */
export const RUSH_GAIN = 1.5;
/** How much a full Swell reading on a full Swell setting deepens the folds. */
export const SWELL_GAIN = 0.6;
/** Longest frame step that still counts as motion — a hidden tab hands in
 *  seconds of dt, and the plasma should resume, not lurch. */
const MAX_STEP_SEC = 0.25;

/** The Sweep envelope: a kick lifts a fast stage that relaxes over
 *  SWEEP_FALL_SEC, and the output follows it over SWEEP_RISE_SEC, so a line
 *  travels out over about a tenth of a second and drifts back instead of
 *  jumping (an instant jump read as a flicker, not a sweep). */
export const SWEEP_RISE_SEC = 0.08;
export const SWEEP_FALL_SEC = 0.25;
/** The two-stage envelope's peak for a unit kick, so the output's peak is
 *  the kick's own size. */
export const SWEEP_PEAK = (() => {
  const a = SWEEP_FALL_SEC;
  const b = SWEEP_RISE_SEC;
  return (b / a) ** (b / (a - b));
})();
/** How far the lines' level moves at the envelope's peak on a full-size
 *  kick with Sweep at 1, as a share of the spacing between two lines. */
export const SWEEP_DEPTH = 0.5;
/** The Flash envelope relaxes by e every this many seconds. */
export const FLASH_TAU_SEC = 0.18;

/** Lines per unit of z at Lines = 1, each line's half-width in z, where
 *  the levels sit (LINE_PHASE puts one on the rim of the dark holes, the
 *  next across the mid-crimson ground and the next on the lit zones), and
 *  the value a line's core burns at. */
const LINE_DENSITY = 1.0;
const LINE_WIDTH = 0.005;
const LINE_PHASE = 0.5;
const LINE_V = 1.0;
/** A line's screen-space width scale in half-heights, matched to the
 *  reference's rims measured the same way at 1280x720: 3 px across at half
 *  height (docs/scenes/plasma.md). */
const LINE_EFOLD_HH = 0.007;
/** One standard deviation of the warped fbm, all octaves and the first
 *  SOFT_OCTAVES (the soft shading), measured on our own frames rendered
 *  raw across many layouts (a few shots of one layout read high: only a
 *  handful of base cells fit on screen). */
const FIELD_SPREAD = 0.083;
const SOFT_SPREAD = 0.112;
const LINE_SPREAD = 0.098;
/** The spread of what the octaves past LINE_OCTAVES add (the field less
 *  the line field), measured the same way. */
const FINE_RESIDUAL_SPREAD = 0.025;
const SOFT_OCTAVES = 3;
/** The lines follow the field's first LINE_OCTAVES octaves: on five or six
 *  they broke into short glittering fragments, where the reference's are
 *  long curves outlining its plateaus and holes. */
const LINE_OCTAVES = 4;
/** Base frequencies in noise cells per half-height, and how many
 *  half-heights' worth of q and r the two warps add. */
const BASE_FREQ = 1.2;
const FIELD_FREQ = 1.8;
const WARP_Q = 1.4;
const WARP_R = 1.6;
const WARP_GAIN = 0.65;
const FIELD_GAIN = 0.75;
/** The share of the warp the fine octaves take (see fieldFbm). */
const FINE_WARP = 0.45;

/** The tone curve's knots, z (the full field in standard units) to value:
 *  a histogram match. Each inner knot's z is where our raw field (rendered
 *  over 16 fresh mounts, so 16 layouts: one mount's layout alone moves
 *  the percentiles by a few hundredths) has the share of pixels below it that the
 *  reference has below that value, so the two value distributions agree;
 *  the values sit a notch lower (about 0.02, a little more at the top),
 *  because the reference's distribution already counts its lines and ours
 *  add theirs, and their halos, on top.
 *  The gentle middle is the crimson shelf a third of the reference's pixels
 *  sit on. Re-fit it whenever the field's octaves or warps change. */
export const TONE_Z: readonly number[] = [-3.2, -2.481, -1.773, -1.441, -1.158, -0.544, 0.354, 0.827, 1.158, 1.489, 1.773, 2.103, 3.0];
export const TONE_V: readonly number[] = [0.01, 0.04, 0.085, 0.13, 0.18, 0.28, 0.38, 0.48, 0.58, 0.65, 0.73, 0.81, 0.9];

/** Fritsch–Carlson tangents for a monotone cubic through (xs, ys): the
 *  curve never overshoots between knots, and its slope has no jumps, which
 *  would show as a faint contour at a knot's level. */
export function monotoneTangents(xs: readonly number[], ys: readonly number[]): number[] {
  const n = xs.length;
  const d: number[] = [];
  for (let k = 0; k < n - 1; k++) d.push((ys[k + 1] - ys[k]) / (xs[k + 1] - xs[k]));
  const m: number[] = [d[0]];
  for (let k = 1; k < n - 1; k++) m.push(d[k - 1] * d[k] <= 0 ? 0 : (d[k - 1] + d[k]) / 2);
  m.push(d[n - 2]);
  for (let k = 0; k < n - 1; k++) {
    if (d[k] === 0) {
      m[k] = 0;
      m[k + 1] = 0;
      continue;
    }
    const a = m[k] / d[k];
    const b = m[k + 1] / d[k];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[k] = t * a * d[k];
      m[k + 1] = t * b * d[k];
    }
  }
  return m;
}

const TONE_M = monotoneTangents(TONE_Z, TONE_V);
const glslFloats = (xs: readonly number[]): string => `float[${xs.length}](${xs.map((x) => x.toFixed(5)).join(", ")})`;

/** The tone curve at z, in JS, the same Hermite the shader evaluates. */
export function plasmaTone(z: number, m: readonly number[] = TONE_M): number {
  const n = TONE_Z.length;
  if (z <= TONE_Z[0]) return Math.max(0, TONE_V[0] + m[0] * (z - TONE_Z[0]));
  if (z >= TONE_Z[n - 1]) return TONE_V[n - 1] + m[n - 1] * (z - TONE_Z[n - 1]);
  let i = 0;
  while (z >= TONE_Z[i + 1]) i++;
  const h = TONE_Z[i + 1] - TONE_Z[i];
  const t = (z - TONE_Z[i]) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * TONE_V[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * TONE_V[i + 1] + (t3 - t2) * h * m[i + 1];
}

/** Fills `out` with each warp octave's drift offset at churn phase `ph`,
 *  wrapped into the lattice period — see the header. */
export function plasmaDrifts(ph: number, out: Float32Array = new Float32Array(DRIFT_LEN)): Float32Array {
  for (let site = 0; site < WARP_SITE_RATES.length; site++) {
    const [rx, ry] = WARP_SITE_RATES[site];
    let speed = 1;
    for (let k = 0; k < WARP_OCTAVES; k++) {
      const a = k * OCTAVE_TURN;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const o = (site * WARP_OCTAVES + k) * 2;
      out[o] = wrapFlow(ph * speed * (c * rx - s * ry));
      out[o + 1] = wrapFlow(ph * speed * (s * rx + c * ry));
      speed *= OCTAVE_SPEEDUP;
    }
  }
  return out;
}

/** Fills `out` with each field octave's position along the time axis, each
 *  wrapped into the lattice period (the hash is periodic there, so the wrap
 *  is invisible). */
export function boilDepths(ph: number, out: Float32Array = new Float32Array(FIELD_OCTAVES)): Float32Array {
  let rate = BOIL_RATE;
  for (let k = 0; k < FIELD_OCTAVES; k++) {
    out[k] = wrapFlow(ph * rate + k * BOIL_STAGGER);
    rate *= BOIL_OCTAVE_GROWTH;
  }
  return out;
}

/** The churn phase's next value: Churn times the Rush boost, integrated, so
 *  a change in either only ever changes the speed going forward. */
export function advanceChurn(ph: number, dtSec: number, churn: number, rush: number, rushReading: number): number {
  if (!(dtSec > 0)) return ph;
  const rate = churn * (1 + RUSH_GAIN * rush * Math.max(0, rushReading));
  return Number.isFinite(rate) ? ph + Math.min(dtSec, MAX_STEP_SEC) * Math.max(0, rate) : ph;
}

export interface SweepState {
  fast: number;
  out: number;
}

/** One step of the Sweep envelope; `kick` is 0 for no kick, else its size.
 *  Returns the state; `out / SWEEP_PEAK` peaks at the kick's size. */
export function advanceSweep(s: SweepState, dtSec: number, kick: number): SweepState {
  const dt = Math.min(Math.max(0, dtSec), MAX_STEP_SEC);
  const fast = Math.max(s.fast * Math.exp(-dt / SWEEP_FALL_SEC), kick);
  const out = s.out + (fast - s.out) * (1 - Math.exp(-dt / SWEEP_RISE_SEC));
  return { fast, out };
}

/** The Flash envelope after `dtSec`, jumped to at least `kick` by a hit. */
export function advanceFlash(env: number, dtSec: number, kick: number): number {
  return Math.max(env * Math.exp(-Math.max(0, dtSec) / FLASH_TAU_SEC), kick);
}

const FRAG = `
${NOISE_HASH_GLSL}

const int WOCT = ${WARP_OCTAVES};
const int FOCT = ${FIELD_OCTAVES};

float vnoise(vec2 p, uint seed) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hashCell(i, ${NOISE_MASK}, seed);
  float b = hashCell(i + vec2(1.0, 0.0), ${NOISE_MASK}, seed);
  float c = hashCell(i + vec2(0.0, 1.0), ${NOISE_MASK}, seed);
  float d = hashCell(i + vec2(1.0, 1.0), ${NOISE_MASK}, seed);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// A lattice with time as its third axis, periodic in it like the other two.
float hash3Cell(vec3 c, uint seed) {
  uint h = cellBits(c.xy, ${NOISE_MASK}, seed) ^ (uint(int(c.z) & ${NOISE_MASK}) * 0x85ebca6bu);
  return float(uhash(h) >> 8u) * (1.0 / 16777216.0);
}

float vnoise3(vec2 p, float t, uint seed) {
  vec3 i = floor(vec3(p, t));
  vec3 f = vec3(p, t) - i;
  vec3 u = f * f * (3.0 - 2.0 * f);
  float a0 = mix(mix(hash3Cell(i, seed), hash3Cell(i + vec3(1.0, 0.0, 0.0), seed), u.x),
                 mix(hash3Cell(i + vec3(0.0, 1.0, 0.0), seed), hash3Cell(i + vec3(1.0, 1.0, 0.0), seed), u.x), u.y);
  float a1 = mix(mix(hash3Cell(i + vec3(0.0, 0.0, 1.0), seed), hash3Cell(i + vec3(1.0, 0.0, 1.0), seed), u.x),
                 mix(hash3Cell(i + vec3(0.0, 1.0, 1.0), seed), hash3Cell(i + vec3(1.0, 1.0, 1.0), seed), u.x), u.y);
  return mix(a0, a1, u.z);
}

// One warp fbm call site: each octave adds its own wrapped drift (uDrift)
// in its own lattice frame.
float warpFbm(vec2 p, int site, uint seed) {
  float sum = 0.0;
  float amp = 0.5;
  float norm = 0.0;
  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
  for (int k = 0; k < WOCT; k++) {
    int o = (site * WOCT + k) * 2;
    sum += amp * vnoise(p + vec2(uDrift[o], uDrift[o + 1]), seed + uint(k));
    norm += amp;
    p = rot * p * 2.03;
    amp *= ${WARP_GAIN.toFixed(3)};
  }
  return sum / norm;
}

// The field, each octave read at its own depth along the time axis, its
// octaves past the soft ones scaled by the local detail mask. Returns (its
// first SOFT_OCTAVES octaves, all of them), each normalised.
// The fine octaves take only FINE_WARP of the warp: the full warp
// stretched them into parallel wrinkles, where the reference's fine detail
// is rounder lace and holes riding on the folded big shapes.
// Returns (the first SOFT_OCTAVES octaves, the first LINE_OCTAVES, all of
// them), each normalised.
vec3 fieldFbm(vec2 p0, vec2 warp, float detail) {
  float sum = 0.0;
  float amp = 1.0;
  float norm = 0.0;
  vec2 soft = vec2(0.0);
  vec2 mid = vec2(0.0);
  vec2 pa = p0 + warp;
  vec2 pb = p0 + ${FINE_WARP.toFixed(3)} * warp;
  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
  for (int k = 0; k < FOCT; k++) {
    // The mask scales an octave's swing about its mean, never the mean,
    // or the lace zones would come out brighter as a whole.
    bool isSoft = k < ${SOFT_OCTAVES};
    float n = vnoise3(isSoft ? pa : pb, uBoilDepth[k], 7u + uint(k));
    sum += amp * (isSoft ? n : 0.5 + detail * (n - 0.5));
    norm += amp;
    if (k == ${SOFT_OCTAVES - 1}) soft = vec2(sum, norm);
    if (k == ${LINE_OCTAVES - 1}) mid = vec2(sum, norm);
    pa = rot * pa * 2.03 + vec2(1.7, 9.2);
    pb = rot * pb * 2.03 + vec2(1.7, 9.2);
    amp *= ${FIELD_GAIN.toFixed(3)};
  }
  return vec3(soft.x / soft.y, mid.x / mid.y, sum / norm);
}

const float TZ[${TONE_Z.length}] = ${glslFloats(TONE_Z)};
const float TV[${TONE_V.length}] = ${glslFloats(TONE_V)};
const float TM[${TONE_M.length}] = ${glslFloats(TONE_M)};

// The tone curve: a monotone cubic through the knots (plasmaTone in JS).
float tone(float z) {
  const int LAST = ${TONE_Z.length - 1};
  if (z <= TZ[0]) return max(0.0, TV[0] + TM[0] * (z - TZ[0]));
  if (z >= TZ[LAST]) return TV[LAST] + TM[LAST] * (z - TZ[LAST]);
  for (int i = 0; i < LAST; i++) {
    if (z < TZ[i + 1]) {
      float h = TZ[i + 1] - TZ[i];
      float t = (z - TZ[i]) / h;
      float t2 = t * t;
      float t3 = t2 * t;
      return (2.0 * t3 - 3.0 * t2 + 1.0) * TV[i] + (t3 - 2.0 * t2 + t) * h * TM[i]
        + (-2.0 * t3 + 3.0 * t2) * TV[i + 1] + (t3 - t2) * h * TM[i + 1];
    }
  }
  return TV[LAST];
}

// Value in the reference's crimson: red carries it, blue is a share that
// rises in the darks (and further where the violet haze sits), green only
// appears near the top, where the lines burn pink.
vec3 crimson(float v, float haze) {
  float dark = 1.0 - smoothstep(0.05, 0.35, v);
  float bShare = 0.225 + 0.075 * dark + 0.09 * smoothstep(0.35, 0.95, v);
  bShare += haze * 0.55 * (1.0 - smoothstep(0.1, 0.4, v));
  float g = 0.27 * max(v - 0.4, 0.0) * max(v - 0.4, 0.0);
  return vec3(v, g, v * bShare);
}

void main() {
  vec2 uv = roomUv(vUv);
  float aspect = uResolution.x / uResolution.y;
  // Half-height units, centred, then shifted away from the lattice origin.
  vec2 hh = (uv - 0.5) * vec2(aspect, 1.0) * 2.0 / max(uScale, 0.05);
  vec2 p = hh * ${BASE_FREQ.toFixed(3)} + vec2(37.0, 61.0);

  float fold = uFolds * (1.0 + ${SWELL_GAIN.toFixed(3)} * uSwell * swellDrive(uLow));
  vec2 q = vec2(warpFbm(p, 0, 11u), warpFbm(p + vec2(5.2, 1.3), 1, 23u)) - 0.5;
  vec2 pq = p + ${WARP_Q.toFixed(3)} * fold * q;
  vec2 r = vec2(warpFbm(pq + vec2(1.7, 9.2), 2, 37u), warpFbm(pq + vec2(8.3, 2.8), 3, 41u)) - 0.5;
  // Where the fine detail is: the reference keeps lace in some zones and
  // smooth plateaus in others (its local detail varies far more than plain
  // fbm's), so the first warp, a slow field, turns the fine octaves up or down.
  float detail = 0.5 + 0.8 * smoothstep(-0.05, 0.2, q.x - 0.6 * q.y);
  vec3 f = fieldFbm(hh * ${FIELD_FREQ.toFixed(3)} + vec2(91.0, 17.0), ${WARP_R.toFixed(3)} * fold * r, detail);
  float zs = (f.x - 0.5) / ${SOFT_SPREAD.toFixed(4)};
  float zl = (f.y - 0.5) / ${LINE_SPREAD.toFixed(4)};
  float z = (f.z - 0.5) / ${FIELD_SPREAD.toFixed(4)};

  float base = tone(z);

  // Contour lines at evenly spaced levels of the full field (see the
  // header), kept to the brighter regions as in the reference.
  float flash = clamp(uFlash * uFlashEnv, 0.0, 2.0);
  float density = ${LINE_DENSITY.toFixed(3)} * uLines;
  float x = zl * density + ${LINE_PHASE.toFixed(3)} + uSweepPhase;
  float d = abs(fract(x) - 0.5);
  // The width is the wider of a fixed screen width (LINE_EFOLD_HH, the
  // reference's measured rim) and a width in field units, which only wins
  // where the field is shallow enough to spread a line into a glow.
  float widen = 1.0 + 0.8 * flash;
  float perPx = length(vec2(dFdx(x), dFdy(x)));
  float pxPerHh = uResolution.y * 0.5;
  float w = max(${LINE_WIDTH.toFixed(4)} * density, ${LINE_EFOLD_HH.toFixed(4)} * pxPerHh * perPx) * widen + 1e-6;
  // Where the field folds so fast that the next level is only a few pixels
  // away, lines bunch into parallel pairs and then alias into dotted
  // ripples, so they fade out there. By the soft field, they stay out of
  // the dark voids and out of the brightest zones, which the reference
  // keeps as smooth glows: its veins run over mid-crimson ground.
  // The profile falls off like the reference's rims: an exponential core
  // whose tail is cut by the square term, so a line lights 2-3 px on each
  // side and not the ground around it (a plain exponential's tail lifted
  // whole lit zones by a few hundredths).
  float u = d / w;
  float line = exp(-u - 0.25 * u * u) * (1.0 - smoothstep(0.06, 0.2, perPx))
    * smoothstep(-0.3, 0.7, zs) * (1.0 - 0.6 * smoothstep(1.2, 2.0, zs));
  // A line burns at one brightness wherever it runs, as the reference's
  // rims do (their cores sit near the top whether the ground beside them is
  // a dark hole or a lit plateau), so it pulls the value toward LINE_V
  // rather than adding to it. The lace zones carry the lines, not the
  // bright ones: the reference's brightest zones are often smooth glows.
  // What the finest octave adds on top of the line field brightens a line
  // in one stretch and lets it fade in the next, as the reference's do,
  // instead of an even neon tube.
  float along = smoothstep(-1.2, 1.2, (f.z - f.y) / ${FINE_RESIDUAL_SPREAD.toFixed(4)});
  float burn = clamp(1.5 * line * mix(0.6, 1.0, smoothstep(0.7, 1.2, detail)) * mix(0.65, 1.25, along)
    * uGlow * (1.0 + 1.5 * flash), 0.0, 2.0);
  float v = mix(base, ${LINE_V.toFixed(3)}, min(burn, 1.0)) + 0.15 * max(burn - 1.0, 0.0);
  // A soft shoulder instead of a clip, so a flash brightens without
  // flattening the brightest lines into one value.
  v = v < 0.9 ? v : 0.9 + 0.1 * (1.0 - exp(-(v - 0.9) / 0.1));

  float haze = uHaze * smoothstep(0.15, 0.26, length(q));
  vec3 col;
  if (uColors < 0.5) {
    col = crimson(v, haze);
  } else {
    col = mix(uPalGround, palRamp(clamp(v, 0.0, 1.0)), smoothstep(0.0, 0.25, v));
    col += uPalAccent * 0.35 * line;
  }
  outColor = vec4(col, 1.0);
}
`;

/** A mount starts the churn phase somewhere in [0, START_PHASE_SPAN): the
 *  layout only changes over minutes, so a fixed start would open on the
 *  same picture every time. */
export const START_PHASE_SPAN = 4000;

const drifts = new Float32Array(DRIFT_LEN);
const depths = new Float32Array(FIELD_OCTAVES);
let ph = 0;
let sweep: SweepState = { fast: 0, out: 0 };
let flashEnv = 0;

export const plasmaScene = createFullscreenScene(card.id, card.name, FRAG, {
  settings: card.settings,
  extraUniformDecls: `uniform float uDrift[${DRIFT_LEN}];\nuniform float uBoilDepth[${FIELD_OCTAVES}];\nuniform float uSweepPhase;\nuniform float uFlashEnv;`,
  onInit: () => {
    ph = Math.random() * START_PHASE_SPAN;
    sweep = { fast: 0, out: 0 };
    flashEnv = 0;
  },
  extraUniforms: (frame, anim, getSetting, drives) => {
    ph = advanceChurn(ph, anim.dtSec, getSetting("churn"), getSetting("rush"), drives.value("rush", levelOf(frame)));
    const kick = drives.fired("sweep", anim.song.kickOnset) ? drives.hitSize("sweep") : 0;
    sweep = advanceSweep(sweep, anim.dtSec, kick);
    const hit = drives.fired("flash", anim.onset) ? drives.hitSize("flash") : 0;
    flashEnv = advanceFlash(flashEnv, anim.dtSec, hit);
    const sweepPhase = (SWEEP_DEPTH * getSetting("sweep") * sweep.out) / SWEEP_PEAK;
    return {
      uDrift: plasmaDrifts(ph, drifts),
      uBoilDepth: boilDepths(ph, depths),
      uSweepPhase: sweepPhase - Math.floor(sweepPhase),
      uFlashEnv: flashEnv,
    };
  },
});
