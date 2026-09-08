import { createFullscreenScene } from "../fullscreenScene.ts";
import type { SceneSetting } from "../sceneSettings.ts";
import type { SignalLink } from "../signals.ts";

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
 * The pure pieces (rollParams, blendParams, createParamDrift, advanceStretch)
 * are exported for tests/ink.test.ts.
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
export function rollParams(rng: Rng, morph: number, out: Float32Array, ribbon = 0.6): Float32Array {
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
    advance(dtSec, barPhase, tempoLock, morph, recolour = false, ribbon = 0.6) {
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

const STRETCH_READS = ["feature.onset"] satisfies readonly SignalLink[];

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
    default: 0.6,
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
    reads: STRETCH_READS,
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

void main() {
  vec2 uv = roomUv(vUv);
  float aspect = uResolution.x / uResolution.y;
  // Half-height units: y spans -1..1, the centre is the origin — the same
  // frame the reference was measured in.
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0) * 2.0;
  p.x /= 1.0 + uStretchEnv * uStretch;

  // Spirals: a swirl warp per vortex, each parked on one arm.
  vec2 q = p;
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
  // Sliding waviness — the phase runs on the audio-warped flow clock.
  float ph = uFlowPhase * uFlow * 1.5;
  float ampA = uParams[${PARAM.warpAmpA}] * uSwirl;
  float freqA = uParams[${PARAM.warpFreqA}];
  q += ampA * vec2(sin(q.y * freqA + ph), sin(q.x * freqA * 0.8 - ph * 0.7 + 1.0));
  float ampB = uParams[${PARAM.warpAmpB}] * uSwirl;
  float freqB = uParams[${PARAM.warpFreqB}];
  q += ampB * vec2(sin(q.y * freqB * 1.3 - ph * 1.1 + 2.0), sin(q.x * freqB + ph * 0.9 + 4.0));
  // The large, slow warp that bends the whole cross into the reference's
  // curved marbled X (its arms are far from straight at the ribbon end).
  float marble = uParams[${PARAM.marble}];
  float ampL = uParams[${PARAM.warpAmpL}] * uSwirl * (0.35 + 0.65 * marble);
  float freqL = uParams[${PARAM.warpFreqL}];
  q += ampL * vec2(sin(q.y * freqL + ph * 0.25 + 3.0), sin(q.x * freqL * 0.85 - ph * 0.2 + 1.5));
  q += 0.5 * ampL * vec2(sin(q.x * freqL * 2.1 - ph * 0.15 + 0.7), sin(q.y * freqL * 1.9 + ph * 0.3 + 2.4));

  float r = length(q);
  float dAxis = min(abs(q.x), abs(q.y));
  // Ink density: the measured cross. Solid where density >= 1.
  float coreR = 0.28 * uParams[${PARAM.coreScale}] * (1.0 + 0.45 * marble) * (1.0 + 0.6 * uLow * uBassSwell);
  float armW = 0.3 * uParams[${PARAM.armScale}] * (1.0 + 0.5 * marble) / max(uArms, 0.05);
  // Two falloffs: the core's, and a faint long tail so the arms still
  // reach the frame edges as hairlines the way the reference's do.
  float reach = exp(-r / coreR) + 0.04 * exp(-r / 1.2);
  float density = 2.8 * uInk * (1.0 + 0.3 * marble) * reach * exp(-(dAxis * dAxis) / (armW * armW));
  // Strokes thicken and thin along their length the way the reference's
  // do (its lines break into dashes far out): a cheap two-sine grain.
  float grain = mix(0.22, 0.1, marble);
  density *= (1.0 - grain) + grain * sin(q.x * 31.0 + 1.7 + ph * 0.2) * sin(q.y * 29.0 + 0.4 - ph * 0.15);

  // Contour function: spacing shrinks away from the axis (measured ~d^1.7),
  // a weak radial term closes the lines around the arm ends.
  // Ribbons are the same contours ruled three times coarser.
  float lineScale = uLineDensity * mix(0.6, 1.0, uDetail) * mix(1.0, 0.42, marble);
  float phi = 420.0 * lineScale * (pow(dAxis + 1e-4, 1.5) + 0.12 * dAxis) + 8.0 * lineScale * r * r;
  phi += 0.9 * sin(q.x * 23.0 + ph * 0.3) * sin(q.y * 19.0 - ph * 0.2);
  float v = 0.5 + 0.5 * sin(phi);
  float fw = fwidth(phi);
  // Marbling groups its strokes: a few ribbons, a white gap, a few more.
  // A slow mask over the contour index does that at the ribbon end.
  float bandMask = 0.5 + 0.5 * sin(phi / 5.5 + 0.8 * sin(q.y * 1.7 + ph * 0.1) + 1.3);
  float banded = 0.25 + 0.95 * smoothstep(0.3, 0.75, bandMask);
  // The solid core stays solid: the mask only thins ink that is lines.
  density *= mix(1.0, mix(banded, 1.0, smoothstep(0.7, 1.3, density)), marble);
  // A period under a few pixels can't be drawn as lines — let it fade to
  // paper (the reference's arms thin out to nothing the same way), and so
  // does any line where the ink has all but run out (the reference has
  // nothing past r≈1.2, no hairlines either).
  float drawable = (1.0 - smoothstep(1.6, 3.2, fw)) * smoothstep(0.04, 0.12, density);
  float aa = fwidth(v) * 0.75 + 1e-3;

  // Per-channel duty: the shared density nudged by a smooth field times
  // each channel's lift, only where the density is near 1.
  float colourField = 0.5 + 0.5 * sin(q.x * 1.8 + uParams[${PARAM.colourPhaseX}]) * sin(q.y * 1.8 + uParams[${PARAM.colourPhaseY}]);
  // At the ribbon end the tint runs along every stroke (the reference's
  // all-blue passages), at the ruled end it stays near the core.
  float splitGain = uColorSplit * colourField * mix(clamp(density, 0.0, 1.0), 0.12 + 0.88 * clamp(density, 0.0, 1.0), marble) * mix(1.0, 0.35, marble);
  vec3 lift = vec3(uParams[${PARAM.lift}], uParams[${PARAM.lift + 1}], uParams[${PARAM.lift + 2}]);
  vec3 duty = density * (1.0 - splitGain * lift);
  vec3 edge = 1.0 - duty;
  vec3 ink = smoothstep(edge - aa, edge + aa, vec3(v));
  // Solid ink never fades, however dense the ruling is.
  vec3 solid = smoothstep(vec3(1.0), vec3(1.3), duty);
  ink = max(ink * drawable, solid);
  // The liquid look of the broad strokes: a white ridge down each ribbon's
  // spine and grey toward its edges, and an oil-slick sheen where the
  // core is solid in every channel.
  float ridge = smoothstep(0.975, 0.995, v) * smoothstep(0.35, 0.7, density) * (1.0 - smoothstep(1.0, 1.3, density)) * marble;
  ink = max(ink - ridge, 0.0);
  float edgeGrey = 0.16 * marble * smoothstep(1.0, 0.55, v);

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
  extraUniformDecls: `uniform float uParams[${PARAM_COUNT}];\nuniform float uStretchEnv;`,
  extraUniforms: (() => {
    const drift = createParamDrift();
    let stretchEnv = 0;
    let prevDropOnset = false;
    return (_frame, anim, getSetting) => {
      stretchEnv = advanceStretch(stretchEnv, anim.dtSec, anim.onset);
      const drop = anim.dropOnset && !prevDropOnset;
      prevDropOnset = anim.dropOnset;
      const params = drift.advance(anim.dtSec, anim.barPhase, anim.tempoLock, getSetting("morph"), drop, getSetting("ribbon"));
      return { uParams: params, uStretchEnv: stretchEnv };
    };
  })(),
});
