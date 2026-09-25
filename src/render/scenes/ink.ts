import { createFullscreenScene } from "../fullscreenScene.ts";
import type { SceneSetting } from "../sceneSettings.ts";
import { NOISE_HASH_GLSL, NOISE_MASK, wrapFlow } from "../noiseHash.ts";

/**
 * Ink Synth — black ink on white paper, drawn as thousands of fine contour
 * lines that hug a cross along the screen axes, curl into spirals along
 * the arms, and merge into a solid core; pure red/green/blue shows only
 * where the three colour channels disagree near the core.
 *
 * Built from `/ref` on a silent "video synthesis" loop (bundle
 * `tools/.cache/refs/-2j_U0pqovQ/`). Its author describes it as a random
 * tree of (x,y)->(r,g,b) functions animated by interpolating parameter
 * vectors, and that is the shape of this scene too: one fragment shader,
 * a parameter vector (`uParams`, laid out per PARAM below) that eases from
 * one random roll to the next, and a JS side that decides *when* the next
 * roll happens. The reference has no audio, so every trigger here is our
 * mapping, chosen so silence reproduces the reference's resting look:
 *
 * - The ink cross: density falls off like exp(-r) from a solid core and
 *   like a gaussian away from the nearest axis — the measured dark-pixel
 *   profile (core solid to r≈0.2 half-heights, ~5 % at r≈0.8, gone by
 *   r≈1.2, axes several times denser than the diagonals). `ink` scales the
 *   whole thing, `arms` narrows the arms, and `uLow` × `bassSwell` grows
 *   the core live.
 * - The lines are level sets of a contour function whose spacing shrinks
 *   away from each axis (measured: period ≈ 12 px near the axis, ≈ 4 px
 *   half a screen-height out, at 720p). Duty = density, so the same lines
 *   are hairlines far out and merge to solid ink in the core. `lineDensity`
 *   scales the frequency; lines fade rather than alias when a period falls
 *   under a couple of pixels.
 * - Spirals: VORTEX_COUNT swirl warps sitting on the arms, positions,
 *   strengths and radii from the parameter vector, plus two sliding sine
 *   warps whose phase runs on uFlowPhase × `flow`. Interpolating the
 *   vector between rolls is what makes spirals wind and slide the way the
 *   reference's motion tracks showed (fringes along every line, static
 *   skeleton, no cuts).
 * - Rolls land on bar starts while the tempo is locked (the reference
 *   re-targets on a ~1.4 s timer; NODE_FALLBACK_SEC keeps that cadence
 *   with no beat). Every NODES_PER_PHRASE-th roll — and any drop — also
 *   re-rolls which channel is lifted, so the accent colour changes on
 *   phrases the way the reference drifts from green/blue to red.
 * - The stretch: the reference's one big event is a half-second horizontal
 *   smear of the whole field. Ours fires on anim.onset (render-latched)
 *   and decays at STRETCH_DECAY_PER_SEC; `stretch` is the amount.
 * - Colour: each channel's ink duty is the shared density nudged by a
 *   smooth field times that channel's lift (PARAM.lift). Channels only
 *   disagree where density is near 1, so colour stays a small share of
 *   the picture (the reference: under 2 % of pixels, all primaries).
 *
 * Precision, or why the flow phase never reaches the shader raw: the
 * marbling warps and the organic stroke term are value noise, and the flow
 * phase (uFlowPhase × `flow`, ever-growing) used to be added to their
 * coordinates in the shader, so the noise hash's input climbed with session
 * length. On mobile GPUs that broke the field along noise-cell boundaries
 * into straight and slanted seams — the octave rotation in fbm sets the
 * slants — with the contour lines shifted on either side, exactly the
 * failure noiseHash.ts's header describes for Caustics. So fbm hashes the
 * integer cell lattice (NOISE_HASH_GLSL, periodic in NOISE_PERIOD cells)
 * and reads its flow offset per octave from uNoiseFlow, which noiseFlows
 * fills on the JS side: each call site's offset carried through the same
 * octave transform the shader applies to p, then wrapped into the lattice
 * period in float64. The sine terms that also ride the phase read it from
 * uSinPhase instead, each already reduced modulo one turn (sinPhases), so
 * no sin() ever sees a large argument either.
 *
 * The pure pieces (rollParams, blendParams, createParamDrift, advanceStretch,
 * noiseFlows, sinPhases) are exported for tests/ink.test.ts.
 */

export const VORTEX_COUNT = 8;
/** Floats per vortex in the parameter vector: along-arm position, lateral
 *  offset, swirl strength (radians at the centre), radius. */
const VORTEX_STRIDE = 4;
/** Index of each non-vortex parameter; vortices occupy [0, VORTEX_COUNT*VORTEX_STRIDE). */
export const PARAM = {
  warpAmpA: VORTEX_COUNT * VORTEX_STRIDE,
  warpFreqA: VORTEX_COUNT * VORTEX_STRIDE + 1,
  warpAmpB: VORTEX_COUNT * VORTEX_STRIDE + 2,
  warpFreqB: VORTEX_COUNT * VORTEX_STRIDE + 3,
  /** Three entries, one per channel: +1 lifts (less ink → that primary shows), negative adds ink. */
  lift: VORTEX_COUNT * VORTEX_STRIDE + 4,
  colourPhaseX: VORTEX_COUNT * VORTEX_STRIDE + 7,
  colourPhaseY: VORTEX_COUNT * VORTEX_STRIDE + 8,
  coreScale: VORTEX_COUNT * VORTEX_STRIDE + 9,
  armScale: VORTEX_COUNT * VORTEX_STRIDE + 10,
  /** 0 = the fine ruled regime, 1 = broad marbled ribbons; rolled around the `ribbon` setting. */
  marble: VORTEX_COUNT * VORTEX_STRIDE + 11,
  /** The large-scale warp that bends the whole cross into a curved X. */
  warpAmpL: VORTEX_COUNT * VORTEX_STRIDE + 12,
  warpFreqL: VORTEX_COUNT * VORTEX_STRIDE + 13,
  sheenPhase: VORTEX_COUNT * VORTEX_STRIDE + 14,
} as const;
export const PARAM_COUNT = PARAM.sheenPhase + 1;

/** Re-target cadence with no tempo lock — the reference's own transition spacing. */
export const NODE_FALLBACK_SEC = 1.4;
/** Every this-many rolls, the lifted colour channel is re-rolled too. */
export const NODES_PER_PHRASE = 4;
/** The stretch smear relaxes to ~5 % in half a second. */
export const STRETCH_DECAY_PER_SEC = 6;

/** FRAG's fbm: octave count, the per-octave scale-up and the rotation
 *  between octaves (cos/sin of the octave matrix's angle) — named here
 *  because noiseFlows has to carry each flow offset through the very same
 *  transform the shader applies to p (see the file header's precision
 *  paragraph). */
export const FBM_OCTAVES = 4;
export const FBM_LACUNARITY = 2.05;
export const FBM_ROT_COS = 0.8;
export const FBM_ROT_SIN = 0.6;

/** Per fbm call site in FRAG, the x/y rate at which its noise coordinate
 *  drifts per unit of flow phase — the large marbling warp, the nested warp
 *  on top of it, and the organic stroke term, in the order the shader names
 *  them (NOISE_FLOW_WARP_L, NOISE_FLOW_WARP_N, NOISE_FLOW_ORGANIC). */
export const NOISE_FLOW_RATES: ReadonlyArray<readonly [number, number]> = [
  [0.05, -0.04],
  [0.03, 0.03],
  [0.02, 0.02],
];
const NOISE_FLOW_WARP_L = 0;
const NOISE_FLOW_WARP_N = 1;
const NOISE_FLOW_ORGANIC = 2;
/** uNoiseFlow layout: per call site, per octave, an [x, y] pair. */
export const NOISE_FLOW_LEN = NOISE_FLOW_RATES.length * FBM_OCTAVES * 2;

/** Fills `out` with the flow offset every fbm octave in FRAG adds to its
 *  noise coordinate, each already wrapped into the lattice period. The
 *  shader used to add `ph * rate` to p once, before the octave loop, so
 *  octave k saw that offset rotated and scaled k times over; the same
 *  transform is applied here, in float64, and only then wrapped — in that
 *  octave's own lattice frame, where the wrap is a whole number of periods
 *  and therefore invisible. `ph` is the raw flow phase times the `flow`
 *  setting. */
export function noiseFlows(ph: number, out: Float32Array = new Float32Array(NOISE_FLOW_LEN)): Float32Array {
  for (let site = 0; site < NOISE_FLOW_RATES.length; site++) {
    let ox = ph * NOISE_FLOW_RATES[site][0];
    let oy = ph * NOISE_FLOW_RATES[site][1];
    for (let k = 0; k < FBM_OCTAVES; k++) {
      const o = (site * FBM_OCTAVES + k) * 2;
      out[o] = wrapFlow(ox);
      out[o + 1] = wrapFlow(oy);
      const nx = FBM_ROT_COS * ox - FBM_ROT_SIN * oy;
      const ny = FBM_ROT_SIN * ox + FBM_ROT_COS * oy;
      ox = nx * FBM_LACUNARITY;
      oy = ny * FBM_LACUNARITY;
    }
  }
  return out;
}

/** The rate (sign included) at which each sine term in FRAG advances with
 *  the flow phase, in the order uSinPhase is read: the fine wave along y,
 *  the fine wave along x, the stroke grain along x, the grain along y, and
 *  the marbling band mask. */
export const SIN_FLOW_RATES: readonly number[] = [1.5, -1.05, 0.2, -0.15, 0.1];
const TWO_PI = Math.PI * 2;

/** x reduced into [0, 2π), in float64; a value that would round up to a
 *  full turn in the fp32 upload is returned as 0 (the same angle). */
export function wrapAngle(x: number): number {
  const w = x - Math.floor(x / TWO_PI) * TWO_PI;
  return Math.fround(w) >= TWO_PI ? 0 : w;
}

/** Fills `out` with each sine term's phase, reduced modulo one turn so the
 *  shader's sin() never sees a large argument (mobile sin() range reduction
 *  is coarse). Congruent to `ph * rate`, so the picture is unchanged. */
export function sinPhases(ph: number, out: Float32Array = new Float32Array(SIN_FLOW_RATES.length)): Float32Array {
  for (let i = 0; i < SIN_FLOW_RATES.length; i++) out[i] = wrapAngle(ph * SIN_FLOW_RATES[i]);
  return out;
}

type Rng = () => number;

/** Centre ± range, with the range scaled by `morph` so a low Morph keeps
 *  every roll near the same picture and a high one roams the whole span. */
function roll(rng: Rng, centre: number, range: number, morph: number): number {
  return centre + range * morph * (rng() * 2 - 1);
}

/** Fills `out` with a fresh random parameter vector. Vortex slots take arm
 *  index slot % 4 in the shader (right, left, up, down), so every arm gets
 *  at least one spiral and the horizontal/vertical arms get two. The lift
 *  entries are left untouched — see rollLift. */
export function rollParams(rng: Rng, morph: number, out: Float32Array, ribbon = 0.7): Float32Array {
  const m = Math.max(0, Math.min(2, morph));
  for (let i = 0; i < VORTEX_COUNT; i++) {
    const o = i * VORTEX_STRIDE;
    out[o] = roll(rng, 0.5, 0.35, m); // along the arm, in half-heights
    out[o + 1] = roll(rng, 0, 0.08, m); // lateral offset
    const sign = rng() < 0.5 ? -1 : 1;
    out[o + 2] = sign * (1.5 + Math.abs(roll(rng, 3, 3, m))); // strength, radians
    out[o + 3] = 0.07 + Math.abs(roll(rng, 0.045, 0.045, m)); // radius, half-heights
  }
  out[PARAM.warpAmpA] = 0.03 + Math.abs(roll(rng, 0.03, 0.03, m));
  out[PARAM.warpFreqA] = 2.5 + Math.abs(roll(rng, 1.2, 1.2, m));
  out[PARAM.warpAmpB] = 0.01 + Math.abs(roll(rng, 0.015, 0.015, m));
  out[PARAM.warpFreqB] = 4 + Math.abs(roll(rng, 2, 2, m));
  out[PARAM.colourPhaseX] = rng() * Math.PI * 2;
  out[PARAM.colourPhaseY] = rng() * Math.PI * 2;
  out[PARAM.coreScale] = roll(rng, 1, 0.15, m);
  out[PARAM.armScale] = roll(rng, 1, 0.2, m);
  out[PARAM.marble] = Math.max(0, Math.min(1, roll(rng, ribbon, 0.3, m)));
  out[PARAM.warpAmpL] = 0.18 + Math.abs(roll(rng, 0.11, 0.11, m));
  out[PARAM.warpFreqL] = 1 + Math.abs(roll(rng, 0.6, 0.6, m));
  out[PARAM.sheenPhase] = rng() * Math.PI * 2;
  return out;
}

/** Picks which channel shows through: one lifted to +1, the other two
 *  pushed to −0.5 (their mean stays at zero so total ink is unchanged). */
export function rollLift(rng: Rng, out: Float32Array): Float32Array {
  const lifted = Math.min(2, Math.floor(rng() * 3));
  for (let c = 0; c < 3; c++) out[PARAM.lift + c] = c === lifted ? 1 : -0.5;
  return out;
}

function smoothstep01(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

/** out = prev eased toward next by smoothstep(t). */
export function blendParams(prev: Float32Array, next: Float32Array, t: number, out: Float32Array): Float32Array {
  const s = smoothstep01(t);
  for (let i = 0; i < out.length; i++) out[i] = prev[i] + (next[i] - prev[i]) * s;
  return out;
}

export interface ParamDrift {
  /** Advances the drift by dt seconds and returns the blended parameter
   *  vector for this frame. With the tempo locked, a roll happens on each
   *  bar wrap (barPhase dropping back toward 0) and the ease follows
   *  barPhase itself; otherwise a NODE_FALLBACK_SEC timer stands in.
   *  `recolour` forces a lift re-roll on top of the phrase counter. */
  advance(dtSec: number, barPhase: number, tempoLock: number, morph: number, recolour?: boolean, ribbon?: number): Float32Array;
  /** How many rolls have happened so far. */
  readonly nodes: number;
}

export function createParamDrift(rng: Rng = Math.random): ParamDrift {
  const prev = new Float32Array(PARAM_COUNT);
  const next = new Float32Array(PARAM_COUNT);
  const cur = new Float32Array(PARAM_COUNT);
  rollParams(rng, 1, prev);
  rollLift(rng, prev);
  rollParams(rng, 1, next);
  next.set(prev.subarray(PARAM.lift, PARAM.lift + 3), PARAM.lift);
  cur.set(prev);
  let t = 0;
  let lastBarPhase = 0;
  let wasLocked = false;
  let nodes = 0;

  const node = (morph: number, recolour: boolean, ribbon: number): void => {
    // Start the next ease from where the picture actually is, not from
    // the roll it was heading for — a wrap that lands early never jumps.
    prev.set(cur);
    rollParams(rng, morph, next, ribbon);
    nodes++;
    if (recolour || nodes % NODES_PER_PHRASE === 0) rollLift(rng, next);
    else next.set(prev.subarray(PARAM.lift, PARAM.lift + 3), PARAM.lift);
  };
  // A drop mid-segment: only the lift re-targets, from where it is now;
  // the running ease carries it the rest of the way (a colour jump on a
  // drop is a flash, the geometry must not jump with it).
  const recolourNow = (): void => {
    prev.set(cur.subarray(PARAM.lift, PARAM.lift + 3), PARAM.lift);
    rollLift(rng, next);
  };

  return {
    get nodes() {
      return nodes;
    },
    advance(dtSec, barPhase, tempoLock, morph, recolour = false, ribbon = 0.7) {
      const locked = tempoLock > 0.5;
      if (locked) {
        if (wasLocked && barPhase < lastBarPhase - 0.5) node(morph, recolour, ribbon);
        else if (recolour) recolourNow();
        t = barPhase;
      } else {
        t += dtSec / NODE_FALLBACK_SEC;
        if (t >= 1) {
          t -= 1;
          node(morph, recolour, ribbon);
        } else if (recolour) recolourNow();
      }
      wasLocked = locked;
      lastBarPhase = barPhase;
      return blendParams(prev, next, t, cur);
    },
  };
}

/** The horizontal-smear envelope: snaps to 1 on an onset, relaxes exponentially. */
export function advanceStretch(env: number, dtSec: number, onset: boolean): number {
  const decayed = env * Math.exp(-dtSec * STRETCH_DECAY_PER_SEC);
  return onset ? 1 : decayed;
}

const SETTINGS: SceneSetting[] = [
  {
    key: "ink",
    label: "Ink",
    description: "How much ink is on the page — the size of the solid core and how far the arms reach.",
    group: "Form",
    min: 0.3,
    max: 2.5,
    step: 0.05,
    default: 1.0,
    auto: { loudness: 0.25, density: 0.15 },
  },
  {
    key: "arms",
    label: "Arms",
    description: "How tightly the ink hugs the two axes — higher is a thinner cross with emptier diagonals.",
    group: "Form",
    min: 0.3,
    max: 3,
    step: 0.05,
    default: 1.0,
    auto: { density: -0.2 },
  },
  {
    key: "swirl",
    label: "Swirl",
    description: "How hard the lines curl into spirals along the arms.",
    group: "Form",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1.0,
    auto: { dynamics: 0.2, brightness: 0.15 },
  },
  {
    key: "ribbon",
    label: "Ribbon",
    description: "Fine ruled lines at the left, broad liquid marbled strokes at the right — each bar rolls around this.",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.7,
    auto: { loudness: 0.25, density: -0.15 },
  },
  {
    key: "lineDensity",
    label: "Line density",
    description: "How finely the ink is ruled — more lines, thinner, closer together.",
    group: "Form",
    min: 0.3,
    max: 2.5,
    step: 0.05,
    default: 1.0,
    auto: { brightness: 0.3, density: 0.15 },
  },
  {
    key: "flow",
    label: "Flow",
    description: "How fast the lines slide along the arms.",
    group: "Motion",
    min: 0,
    max: 3,
    step: 0.05,
    default: 1.0,
    auto: { tempo: 0.3, pulse: 0.15 },
  },
  {
    key: "morph",
    label: "Morph",
    description: "How different each bar's picture is from the last — where the spirals sit, how tight they wind.",
    group: "Motion",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1.0,
    auto: { dynamics: 0.25, attack: 0.15 },
  },
  {
    key: "stretch",
    label: "Stretch",
    description: "How far a hit smears the whole picture sideways before it relaxes.",
    group: "Motion",
    min: 0,
    max: 1.5,
    step: 0.05,
    default: 0.6,
    auto: { attack: 0.3, pulse: 0.15 },
    // The trigger is anim.onset directly (advanceStretch's own decay
    // math is unaffected by which edge resets it) — a plain Beat default.
    drive: { default: "feature.onset" },
  },
  {
    key: "bassSwell",
    label: "Bass swell",
    description: "How much the bass grows the core and the arms.",
    group: "Motion",
    min: 0,
    max: 2,
    step: 0.05,
    default: 0.8,
    auto: { loudness: 0.2 },
    // uLow directly (the core-radius term in FRAG) — a plain Bass level default.
    drive: { default: "anim.low" },
  },
  {
    key: "colorSplit",
    label: "Colour split",
    description: "How far the three colour channels disagree near the core — pure red, green or blue where they do.",
    group: "Look",
    min: 0,
    max: 1.5,
    step: 0.05,
    default: 0.5,
    auto: { brightness: 0.25, dynamics: 0.15 },
  },
  {
    key: "paper",
    label: "Paper",
    description: "How bright the paper is.",
    group: "Look",
    min: 0.5,
    max: 1.05,
    step: 0.01,
    default: 1.0,
  },
  {
    key: "negative",
    label: "Negative",
    description: "White ink on black paper.",
    group: "Look",
    min: 0,
    max: 1,
    step: 1,
    default: 0,
    type: "boolean",
  },
];

const FRAG = `
const vec2 ARMS[4] = vec2[4](vec2(1.0, 0.0), vec2(-1.0, 0.0), vec2(0.0, 1.0), vec2(0.0, -1.0));

mat2 rot2(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, -s, s, c);
}

// The integer lattice hash (hashCell) — see the file header's precision
// paragraph and noiseHash.ts.
${NOISE_HASH_GLSL}

// Value noise with a smooth blend over the periodic lattice, and an fbm
// rotated between octaves so its ridges don't line up with the axes.
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hashCell(i, ${NOISE_MASK}, 0u);
  float b = hashCell(i + vec2(1.0, 0.0), ${NOISE_MASK}, 0u);
  float c = hashCell(i + vec2(0.0, 1.0), ${NOISE_MASK}, 0u);
  float d = hashCell(i + vec2(1.0, 1.0), ${NOISE_MASK}, 0u);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// site picks this call's block of per-octave flow offsets in uNoiseFlow
// (noiseFlows on the JS side); the offset is added per octave, after the
// octave transform, because that is the frame it was wrapped in.
float fbm(vec2 p, int site) {
  float v = 0.0;
  float amp = 0.5;
  mat2 m = mat2(${FBM_ROT_COS.toFixed(3)}, ${FBM_ROT_SIN.toFixed(3)}, -${FBM_ROT_SIN.toFixed(3)}, ${FBM_ROT_COS.toFixed(3)});
  for (int i = 0; i < ${FBM_OCTAVES}; i++) {
    int o = (site * ${FBM_OCTAVES} + i) * 2;
    v += amp * vnoise(p + vec2(uNoiseFlow[o], uNoiseFlow[o + 1]));
    p = m * p * ${FBM_LACUNARITY.toFixed(3)} + vec2(1.7, 9.2);
    amp *= 0.5;
  }
  return v;
}

vec2 fbm2(vec2 p, int site) {
  return vec2(fbm(p, site), fbm(p + vec2(5.2, 1.3), site));
}

void main() {
  vec2 uv = roomUv(vUv);
  float aspect = uResolution.x / uResolution.y;
  // Half-height units: y spans -1..1, the centre is the origin — the same
  // frame the reference was measured in.
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0) * 2.0;
  p.x /= 1.0 + uStretchEnv * uStretch;

  float marble = uParams[${PARAM.marble}];

  // The marbling: the field is read through two nested noise warps whose
  // amplitude is comparable to the ribbons themselves — that is what turns
  // parallel contours into liquid strokes that swell, thin and fold. The
  // warp drifts on the flow clock (uNoiseFlow, per octave — see the file
  // header's precision paragraph) so the picture never sits still.
  float ampL = uParams[${PARAM.warpAmpL}] * uSwirl * (0.3 + 0.7 * marble);
  float freqL = uParams[${PARAM.warpFreqL}];
  vec2 w1 = fbm2(p * freqL, ${NOISE_FLOW_WARP_L}) - 0.5;
  vec2 q = p + 3.2 * ampL * w1;
  vec2 w2 = fbm2(q * freqL * 1.8 + vec2(2.3, 7.1), ${NOISE_FLOW_WARP_N}) - 0.5;
  q += 1.6 * ampL * (0.4 + 0.6 * marble) * w2;

  // Spirals: a swirl warp per vortex, each parked on one arm.
  for (int i = 0; i < ${VORTEX_COUNT}; i++) {
    vec2 dir = ARMS[i - 4 * (i / 4)];
    vec2 perp = vec2(-dir.y, dir.x);
    vec2 c = dir * uParams[i * ${VORTEX_STRIDE}] + perp * uParams[i * ${VORTEX_STRIDE} + 1];
    float strength = uParams[i * ${VORTEX_STRIDE} + 2] * uSwirl;
    float radius = uParams[i * ${VORTEX_STRIDE} + 3];
    vec2 d = q - c;
    float g = exp(-dot(d, d) / (radius * radius));
    q = c + rot2(strength * g) * d;
  }
  // Fine waviness on the ruled end only.
  float ampA = uParams[${PARAM.warpAmpA}] * uSwirl * (1.0 - 0.7 * marble);
  float freqA = uParams[${PARAM.warpFreqA}];
  q += ampA * vec2(sin(q.y * freqA + uSinPhase[0]), sin(q.x * freqA * 0.8 + uSinPhase[1] + 1.0));

  float r = length(q);
  float dAxis = min(abs(q.x), abs(q.y));
  // Ink density: the measured cross. Solid where density >= 1. Two
  // falloffs: the core's, and a faint long tail so the arms still reach
  // the frame edges as hairlines the way the reference's do.
  float coreR = 0.28 * uParams[${PARAM.coreScale}] * (1.0 + 0.45 * marble) * (1.0 + 0.6 * bassSwellDrive(uLow) * uBassSwell);
  float armW = 0.3 * uParams[${PARAM.armScale}] * (1.0 + 0.5 * marble) / max(uArms, 0.05);
  float reach = exp(-r / coreR) + 0.04 * exp(-r / 1.2);
  float density = 2.8 * uInk * (1.0 + 0.15 * marble) * reach * exp(-(dAxis * dAxis) / (armW * armW));
  // Strokes thicken and thin along their length the way the reference's
  // do (its lines break into dashes far out): a cheap two-sine grain.
  float grain = mix(0.22, 0.08, marble);
  density *= (1.0 - grain) + grain * sin(q.x * 31.0 + 1.7 + uSinPhase[2]) * sin(q.y * 29.0 + 0.4 + uSinPhase[3]);

  // The stroke field. At the ruled end the contours follow the arms
  // (spacing shrinking away from each axis, measured ~d^1.5); at the ribbon
  // end an organic noise term of comparable gradient takes over, so strokes
  // still run along the arms but swell, split and fold like marbling.
  float lineScale = uLineDensity * mix(0.6, 1.0, uDetail);
  float organic = fbm(q * 1.4 + vec2(3.1, 7.7), ${NOISE_FLOW_ORGANIC});
  float axisTerm = pow(dAxis + 1e-4, 1.5) + 0.12 * dAxis;
  float phi = lineScale * (mix(420.0, 85.0, marble) * axisTerm + mix(35.0, 58.0, marble) * organic + 8.0 * r * r);
  float fw = fwidth(phi);
  // Marbling groups its strokes: a few ribbons, a white gap, a few more.
  // A slow mask over the contour index does that at the ribbon end; the
  // solid core is kept out of it so it stays solid.
  float bandMask = 0.5 + 0.5 * sin(phi / 5.5 + 0.8 * sin(q.y * 1.7 + uSinPhase[4]) + 1.3);
  float banded = 0.04 + 1.1 * smoothstep(0.3, 0.75, bandMask);
  density *= mix(1.0, mix(banded, 1.0, smoothstep(0.7, 1.3, density)), marble);

  // Per-channel contour phase: near the core the three channels read the
  // field slightly apart (the reference's three functions disagreeing),
  // which draws the thin red/green/blue fringes inside the dark core.
  float coreMask = smoothstep(0.6, 1.1, density);
  vec3 phic = vec3(phi) + uColorSplit * 0.8 * coreMask * vec3(-1.0, 0.0, 1.0);
  vec3 v = 0.5 + 0.5 * sin(phic);
  float v0 = 0.5 + 0.5 * sin(phi);

  // A period under a few pixels can't be drawn as lines — let it fade to
  // paper, and so does any line where the ink has all but run out (the
  // reference has nothing past r≈1.2, no hairlines either).
  float drawable = (1.0 - smoothstep(1.6, 3.2, fw)) * smoothstep(0.04, 0.12, density);
  float aa = fwidth(v0) * 0.75 + 1e-3;

  // Per-channel duty: the shared density nudged by a smooth field times
  // each channel's lift. At the ribbon end the tint runs along every stroke
  // (the reference's all-blue passages), at the ruled end it stays near the
  // core.
  float colourField = 0.5 + 0.5 * sin(q.x * 1.8 + uParams[${PARAM.colourPhaseX}]) * sin(q.y * 1.8 + uParams[${PARAM.colourPhaseY}]);
  float splitGain = uColorSplit * colourField * mix(clamp(density, 0.0, 1.0), 0.12 + 0.88 * clamp(density, 0.0, 1.0), marble) * mix(1.0, 0.35, marble);
  vec3 lift = vec3(uParams[${PARAM.lift}], uParams[${PARAM.lift + 1}], uParams[${PARAM.lift + 2}]);
  vec3 duty = density * (1.0 - splitGain * lift);
  vec3 edge = 1.0 - duty;
  vec3 ink = smoothstep(edge - aa, edge + aa, v);
  // Solid ink never fades, however dense the ruling is.
  vec3 solid = smoothstep(vec3(1.0), vec3(1.3), duty);
  ink = max(ink * drawable, solid);

  // The liquid look of the broad strokes: grey toward each ribbon's edges,
  // a white ridge down its spine, and an oil-slick sheen where the core is
  // solid in every channel.
  float inside = clamp((v0 - (1.0 - density)) / max(density, 1e-3), 0.0, 1.0);
  float edgeGrey = 0.2 * marble * (1.0 - inside) * (1.0 - inside);
  float ridge = smoothstep(0.975, 0.995, v0) * smoothstep(0.35, 0.7, density) * (1.0 - smoothstep(1.0, 1.3, density)) * marble;
  ink = max(ink - ridge, 0.0);

  vec3 paper = vec3(0.98) * uPaper;
  vec3 col = paper * (1.0 - ink) + edgeGrey * ink;
  float allSolid = min(min(solid.r, solid.g), solid.b);
  float sheen = 0.5 + 0.5 * sin(q.x * 3.1 + uParams[${PARAM.sheenPhase}]) * sin(q.y * 2.7 - uParams[${PARAM.sheenPhase}] * 0.7);
  vec3 tint = clamp(0.5 + 0.5 * lift, 0.0, 1.0);
  col += allSolid * tint * sheen * 0.22 * uColorSplit * (0.3 + 0.7 * marble);
  col = mix(col, vec3(1.0) - col, uNegative);
  outColor = vec4(col, 1.0);
}
`;

export const inkScene = createFullscreenScene("ink", "Ink Synth", FRAG, {
  settings: SETTINGS,
  extraUniformDecls: `uniform float uParams[${PARAM_COUNT}];\nuniform float uStretchEnv;\nuniform float uNoiseFlow[${NOISE_FLOW_LEN}];\nuniform float uSinPhase[${SIN_FLOW_RATES.length}];`,
  extraUniforms: (() => {
    const drift = createParamDrift();
    const flowBuf = new Float32Array(NOISE_FLOW_LEN);
    const sinBuf = new Float32Array(SIN_FLOW_RATES.length);
    let stretchEnv = 0;
    let prevDropOnset = false;
    return (_frame, anim, getSetting, drives) => {
      // The flow phase, at the Flow setting's rate — reduced here, in
      // float64, before anything reaches the shader (file header).
      const ph = anim.flowPhase * getSetting("flow");
      stretchEnv = advanceStretch(stretchEnv, anim.dtSec, drives.fired("stretch", anim.onset));
      const drop = anim.dropOnset && !prevDropOnset;
      prevDropOnset = anim.dropOnset;
      const params = drift.advance(anim.dtSec, anim.barPhase, anim.tempoLock, getSetting("morph"), drop, getSetting("ribbon"));
      return { uParams: params, uStretchEnv: stretchEnv, uNoiseFlow: noiseFlows(ph, flowBuf), uSinPhase: sinPhases(ph, sinBuf) };
    };
  })(),
});
