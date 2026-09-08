import { createFullscreenScene } from "../fullscreenScene.ts";
import type { SceneSetting } from "../sceneSettings.ts";

// Crystal Wall: one rendered crystal scene — dark faceted panels, a
// faceted star, a ring of soft plates, hex rings, thin edge lines — seen
// through a mirror kaleidoscope, with *light layers* that switch on and
// off and *reframing cuts* that change the fold and scale. Built with
// `/ref` from an LED-wall VJ loop (_RsNDsibqgc: 1011 s, then three random
// 10 s clips at 810, 1027 and 1472 s, each decoded at every source frame)
// whose picture was measured rather than eyeballed. What the three clips
// agree on: the same geometry sits under every look (the star and facets
// hold still while a ring of azure blobs lights up over three frames, then
// dims); four light layers switch independently — the ice blob ring (glow
// e-fold 13–29 px at 720p, halo/core up to 0.5), a twelve-spoke fan, red
// neon lines and dots (a look that is 97% red at under 1% lit area, rising
// over about half a second) and white edge-lit crystal outlines with small
// red hearts (4.6 px strokes); hard cuts every 0.5–1 s reframe the picture
// between a hexagonal three-mirror lattice at several cell sizes and
// single-centre eight- and twelve-fold framings; bright looks arrive as
// two-to-four-frame strobes; one to three near-black frames sit at most
// cuts; ground stays at 2% luminance and lifts to ~13% under the blobs.
//
// The loop is silent, so every one of those is a timer in the reference.
// Here (advanceCrystal): cuts land every few beats (the Cuts slider) and
// on section drops; the blob ring strobes in on bar wraps while the tempo
// is locked; drops light the fan; the red pulses on beats; each cut picks
// which layers the new framing shows, in the reference's proportions.
//
// The fold: `hexLocal` finds the nearest lattice point (spacing 1 along x,
// apothem 0.5, vertices at 0.577) in lattice framings; single framings
// keep the screen centre. Either way the angle is folded into the wedge
// between two mirror lines (S = PI / axes), the fundamental domain, so
// whatever is drawn there tiles; the star and the spokes fold once more
// about the wedge's bisector for their doubled symmetry. main() says
// where a motif has to sit to appear once per wedge. Hex edges are mirror
// lines of p6m, so the lattice tiles seamlessly.

/** Framings a cut picks between: mode 0 = hex lattice with the given cell
 *  spacing (screen half-heights, × Tiling), mode 1 = a single-centre fold
 *  with `fold` mirror axes and the texture scaled by `scale`. */
export const FRAMINGS: readonly { mode: 0 | 1; scale: number; fold: number }[] = [
  { mode: 0, scale: 1.7, fold: 6 },
  { mode: 0, scale: 1.0, fold: 6 },
  { mode: 0, scale: 2.6, fold: 6 },
  { mode: 1, scale: 2.4, fold: 8 },
  { mode: 1, scale: 2.2, fold: 12 },
  { mode: 0, scale: 1.35, fold: 6 },
];

/** Light-layer envelopes, seconds: strobe attack (the reference's bright
 *  looks climb over 2–4 frames), release; the red look rises slower. A
 *  FLICKER_SLOT is one strobe frame. GAP_MIN/MAX: the near-black frames
 *  at a cut. */
const STROBE_ATTACK_SEC = 0.12;
const STROBE_RELEASE_SEC = 0.3;
const RED_ATTACK_SEC = 0.35;
const RED_RELEASE_SEC = 0.45;
const EDGE_ATTACK_SEC = 0.05;
const EDGE_RELEASE_SEC = 0.25;
const FLICKER_SLOT_SEC = 0.04;
const GAP_MIN_SEC = 0.033;
const GAP_MAX_SEC = 0.1;
/** A bar wrap can't restrobe the blobs sooner than this; without a tempo
 *  lock every fourth onset stands in for the bar. */
const STROBE_REFRACTORY_SEC = 0.6;
const UNLOCKED_BAR_BEATS = 4;
/** Layer mix a cut rolls, cumulative: plain dark, red, edges, blobs, fan —
 *  the reference's regime shares across the three clips. */
const CUT_ROLL = [0.3, 0.55, 0.75, 0.92, 1.0] as const;
/** Beat swell: attack and release of the difference-of-exponentials
 *  brightness pulse a beat adds (kaleido's shape, fixed times). */
const SWELL_ATTACK_SEC = 0.03;
const SWELL_RELEASE_SEC = 0.25;
const SWELL_STACK_CAP = 1.5;
/** Flow accumulator: units per second at Drift = 0 and 1, and the extra
 *  factor the bass adds. */
const FLOW_RATE_MIN = 0.05;
const FLOW_RATE_MAX = 0.8;
const FLOW_BASS_GAIN = 0.8;

export function hash01(seed: number, k: number): number {
  const x = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** A light layer `ageSec` after it was switched on: a ramp over
 *  `attackSec` whose frames drop out at random when `flicker` is up (a
 *  dropped frame drops less as the ramp nears the top — the reference's
 *  last strobe frames are all bright), a hold at 1, an exponential
 *  release. `seed` fixes which frames drop. Pure, exported for
 *  tests/crystal.test.ts. */
export function layerEnvelope(
  ageSec: number,
  attackSec: number,
  holdSec: number,
  releaseSec: number,
  flicker: number,
  seed: number,
): number {
  if (!(ageSec >= 0)) return 0;
  const flick = Math.min(1, Math.max(0, flicker));
  const holdEnd = attackSec + Math.max(0, holdSec);
  if (ageSec < attackSec) {
    const base = ageSec / attackSec;
    const slot = Math.floor(ageSec / FLICKER_SLOT_SEC);
    const on = hash01(seed, slot) < 0.45 ? 0.1 : 1;
    return base * (1 - flick * (1 - base) * (1 - on));
  }
  if (ageSec < holdEnd) return 1;
  return Math.exp(-(ageSec - holdEnd) / releaseSec);
}

interface Layer {
  /** Seconds since switched on; Infinity while off. */
  age: number;
  seed: number;
  hold: number;
}

export interface CrystalState {
  framing: number;
  /** Seconds of black gap left after a cut. */
  gap: number;
  beatCount: number;
  blobs: Layer;
  fan: Layer;
  red: Layer;
  edges: Layer;
  prevBarPhase: number;
  prevDropOnset: boolean;
  /** Beat swell's two exponentials (release minus attack). */
  rel: number;
  att: number;
  flowPos: number;
  /** Sequencer randomness counter. */
  roll: number;
}

const offLayer = (): Layer => ({ age: Infinity, seed: 1, hold: 0 });

export function createCrystalState(): CrystalState {
  return {
    framing: 0,
    gap: 0,
    beatCount: 0,
    blobs: offLayer(),
    fan: offLayer(),
    red: offLayer(),
    edges: offLayer(),
    prevBarPhase: 0,
    prevDropOnset: false,
    rel: 0,
    att: 0,
    flowPos: 0,
    roll: 0,
  };
}

const SWELL_KA = 1 / SWELL_ATTACK_SEC;
const SWELL_KR = 1 / SWELL_RELEASE_SEC;
const SWELL_PEAK = (() => {
  const tPeak = Math.log(SWELL_KA / SWELL_KR) / (SWELL_KA - SWELL_KR);
  return Math.exp(-SWELL_KR * tPeak) - Math.exp(-SWELL_KA * tPeak);
})();

export interface CrystalInputs {
  dtSec: number;
  onset: boolean;
  dropOnset: boolean;
  barPhase: number;
  tempoLock: number;
  low: number;
}

export interface CrystalOpts {
  /** Cuts slider: 0 never reframes on beats; otherwise every 4 / 2 / 1
   *  beats across the slider's thirds. */
  cuts: number;
  pulse: number;
  /** Flare slider: light-layer strength; 0 leaves the dark look alone. */
  flareAmt: number;
  hold: number;
  flicker: number;
  drift: number;
}

export interface CrystalOut {
  framing: number;
  gap: number;
  blobs: number;
  fan: number;
  red: number;
  edges: number;
  swell: number;
  flowPos: number;
}

/** Beats between reframing cuts for a Cuts value (0 = never). */
export function cutEveryBeats(cuts: number): number {
  if (cuts <= 0) return 0;
  return cuts < 1 / 3 ? 4 : cuts < 2 / 3 ? 2 : 1;
}

function light(st: CrystalState, layer: Layer, hold: number): void {
  layer.age = 0;
  layer.hold = hold;
  layer.seed = 1 + Math.floor(hash01(7, st.roll++) * 997);
}

/** One frame of the sequencer: counts beats toward the next reframing
 *  cut, fires cuts (new framing, black gap, a rolled set of layers) on
 *  that count and on drops, strobes the blob ring on bar wraps, lights the
 *  fan on drops, pulses the red on beats; advances every envelope, the
 *  beat swell and the flow. Pure apart from `st`; exported for
 *  tests/crystal.test.ts. */
export function advanceCrystal(st: CrystalState, input: CrystalInputs, opts: CrystalOpts): CrystalOut {
  const dt = input.dtSec;
  const locked = input.tempoLock > 0.5;
  const barWrap = locked && input.barPhase < st.prevBarPhase - 0.5;
  st.prevBarPhase = input.barPhase;
  const drop = input.dropOnset && !st.prevDropOnset;
  st.prevDropOnset = input.dropOnset;
  const layersOn = opts.flareAmt > 0;

  for (const l of [st.blobs, st.fan, st.red, st.edges]) l.age += dt;
  st.gap = Math.max(0, st.gap - dt);

  if (input.onset) st.beatCount++;
  const every = cutEveryBeats(opts.cuts);
  const cutOnBeat = every > 0 && input.onset && st.beatCount % every === 0;
  if (cutOnBeat || drop) {
    // A new framing, never the same one twice.
    const step = 1 + Math.floor(hash01(3, st.roll++) * (FRAMINGS.length - 1));
    st.framing = (st.framing + step) % FRAMINGS.length;
    st.gap = GAP_MIN_SEC + (GAP_MAX_SEC - GAP_MIN_SEC) * hash01(5, st.roll++);
    if (layersOn) {
      const r = hash01(11, st.roll++);
      if (r < CUT_ROLL[0]) {
        /* plain dark */
      } else if (r < CUT_ROLL[1]) light(st, st.red, opts.hold * 1.5);
      else if (r < CUT_ROLL[2]) light(st, st.edges, opts.hold * 2);
      else if (r < CUT_ROLL[3]) light(st, st.blobs, opts.hold);
      else light(st, st.fan, opts.hold);
    }
  }
  const barLike = barWrap || (!locked && input.onset && st.beatCount % UNLOCKED_BAR_BEATS === 0);
  if (layersOn && barLike && st.blobs.age > STROBE_REFRACTORY_SEC) light(st, st.blobs, opts.hold);
  if (layersOn && drop) light(st, st.fan, opts.hold * 1.5);

  const fl = opts.flicker;
  const blobs = layerEnvelope(st.blobs.age, STROBE_ATTACK_SEC, st.blobs.hold, STROBE_RELEASE_SEC, fl, st.blobs.seed);
  const fan = layerEnvelope(st.fan.age, STROBE_ATTACK_SEC, st.fan.hold, STROBE_RELEASE_SEC, fl, st.fan.seed);
  const red = layerEnvelope(st.red.age, RED_ATTACK_SEC, st.red.hold, RED_RELEASE_SEC, 0, st.red.seed);
  const edges = layerEnvelope(st.edges.age, EDGE_ATTACK_SEC, st.edges.hold, EDGE_RELEASE_SEC, fl * 0.5, st.edges.seed);

  if (input.onset) {
    st.rel = Math.min(st.rel + opts.pulse, SWELL_STACK_CAP);
    st.att = Math.min(st.att + opts.pulse, SWELL_STACK_CAP);
  }
  st.rel *= Math.exp(-dt * SWELL_KR);
  st.att *= Math.exp(-dt * SWELL_KA);
  const swell = Math.max(0, st.rel - st.att) / SWELL_PEAK;

  const flowRate = (FLOW_RATE_MIN + (FLOW_RATE_MAX - FLOW_RATE_MIN) * opts.drift) * (1 + FLOW_BASS_GAIN * input.low);
  st.flowPos += dt * flowRate;

  const amt = Math.max(0, opts.flareAmt);
  return {
    framing: st.framing,
    gap: st.gap > 0 ? 1 : 0,
    blobs: blobs * amt,
    fan: fan * amt,
    red: red * amt,
    edges: edges * amt,
    swell,
    flowPos: st.flowPos,
  };
}

const SETTINGS: SceneSetting[] = [
  {
    key: "tiling",
    label: "Tiling",
    description: "Scale of every framing: below 1 more, smaller cells; above 1 fewer, bigger.",
    group: "Form",
    min: 0.5,
    max: 2.0,
    step: 0.05,
    default: 1.0,
    // Framing geometry the user picks, like kaleido's Symmetry.
  },
  {
    key: "star",
    label: "Star",
    description: "Size of the faceted star at each centre.",
    group: "Form",
    min: 0.5,
    max: 1.5,
    step: 0.05,
    default: 1.0,
    auto: { density: 0.2 },
  },
  {
    key: "cuts",
    label: "Cuts",
    description: "How often a beat hard-cuts to a new framing: never, every 4, every 2, every beat.",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { tempo: 0.2, dynamics: 0.2 },
    reads: ["feature.onset"],
  },
  {
    key: "pulse",
    label: "Beat pulse",
    description: "Brightness pop on each beat, and the push it gives the marks.",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    auto: { pulse: 0.3, attack: 0.2 },
    reads: ["feature.onset"],
  },
  {
    key: "flare",
    label: "Flare",
    description: "Strength of the light layers: the ice blobs strobing in on every bar, the fan on drops, the red and the edge lines a cut lights.",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.8,
    auto: { dynamics: 0.3, loudness: 0.2 },
    reads: ["anim.dropOnset"],
  },
  {
    key: "hold",
    label: "Light hold",
    description: "How long a lit layer stays before it decays, in seconds.",
    group: "Motion",
    min: 0.1,
    max: 2.0,
    step: 0.05,
    default: 0.35,
    auto: { tempo: -0.3 },
  },
  {
    key: "flicker",
    label: "Strobe",
    description: "How much a layer stutters on its way up.",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.7,
    auto: { attack: 0.3 },
  },
  {
    key: "drift",
    label: "Drift",
    description: "How fast the facets and the lattice breathe.",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.3,
    auto: { tempo: 0.3, loudness: 0.2 },
  },
  {
    key: "glow",
    label: "Glow",
    description: "Halo width and strength around the lit shapes.",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { brightness: 0.25 },
  },
  {
    key: "neon",
    label: "Neon",
    description: "The red neon lines, dots and rings.",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.7,
    auto: { loudness: 0.2, brightness: -0.15 },
  },
  {
    key: "ground",
    label: "Ground",
    description: "Brightness of the dark faceted surface between the shapes.",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.3,
    auto: { brightness: 0.2 },
  },
];

const FRAG = `
const float PI = 3.14159265;
const float SQRT3 = 1.7320508;

// Measured reference strokes, in screen half-heights at 720p: neon stroke
// 3.8 px, edge-lit outline 4.6 px, glow e-fold 13 px dark / 25 px lit,
// halo/core 0.1 dark, 0.5 lit.
const float STROKE_HH = 0.0106;
const float EDGE_HH = 0.0128;
const float GLOW_DARK_HH = 0.037;
const float GLOW_LIT_HH = 0.07;
const float HALO_DARK = 0.12;
const float HALO_LIT = 0.5;

const vec3 NEON_RED = vec3(1.0, 0.10, 0.09);
const vec3 ICE = vec3(0.72, 0.86, 1.0);
const vec3 EDGE_WHITE = vec3(0.92, 0.96, 1.0);
const vec3 STAR_GREY = vec3(0.55, 0.60, 0.68);
const vec3 PLATE_GREY = vec3(0.30, 0.36, 0.44);
const vec3 GROUND_DARK = vec3(0.020, 0.016, 0.019);
const vec3 GROUND_LIT = vec3(0.10, 0.13, 0.16);

float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x),
    f.y);
}

// Nearest centre of the triangular lattice with spacing 1 along x
// (neighbours at (±1, 0) and (±0.5, ±sqrt3/2)); returns the offset from it.
vec2 hexLocal(vec2 p) {
  vec2 r = vec2(1.0, SQRT3);
  vec2 h = r * 0.5;
  vec2 a = mod(p, r) - h;
  vec2 b = mod(p - h, r) - h;
  return dot(a, a) < dot(b, b) ? a : b;
}

float sdSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

float sdHexagon(vec2 p, float rr) {
  const vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
  p = abs(p);
  p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
  p -= vec2(clamp(p.x, -k.z * rr, k.z * rr), rr);
  return length(p) * sign(p.y);
}

vec2 polar(float rr, float ang) {
  return rr * vec2(cos(ang), sin(ang));
}

// A stroke: solid core of half-width hs plus an exponential halo; the
// core fades with soft (a lit layer has no sharp line anywhere).
vec3 stroke(float d, float px, float hs, float glowW, float halo, vec3 col, float soft) {
  float core = 1.0 - smoothstep(hs - px, hs + px, d);
  float glow = exp(-max(d - hs, 0.0) / glowW);
  return col * (core * (1.0 - 0.9 * soft) + halo * glow);
}

void main() {
  vec2 p = (roomUv(vUv) - 0.5) * 2.0;
  p.x *= uResolution.x / uResolution.y;

  // Framing: lattice (nearest cell) or single centre. n mirror axes make
  // 2n wedges of S = PI/n; af is the angle folded into one wedge (the
  // fundamental domain, so anything drawn in it tiles), and afS folds once
  // more about the wedge's bisector for the motifs that have twice the
  // symmetry: the 2n-tip star and the 2n spokes. A motif placed on the
  // bisector (angle S/2) is mirrored onto itself, so it appears once per
  // wedge — 2n copies per centre — and one on a wedge ray appears n times.
  float scale = uFrameScale * uTiling * (1.0 + 0.04 * sin(uFlowPos * 0.9));
  vec2 pc = p / scale;
  float px = (2.0 / uResolution.y) / scale;
  bool lattice = uFrameMode < 0.5;
  vec2 q = lattice ? hexLocal(pc) : pc;
  float n = uFrameFold;
  float S = PI / n;
  float r = length(q);
  float a = atan(q.y, q.x);
  float af = abs(mod(a, 2.0 * S) - S);
  float afS = S * 0.5 - abs(af - S * 0.5);
  vec2 w = polar(r, af);
  vec2 wS = polar(r, afS);
  float lit = 0.5 + 0.5 * cos(a - 2.2);

  float blobs = clamp(uBlobs, 0.0, 1.0);
  float fan = clamp(uFan, 0.0, 1.0);
  float red = clamp(uRed, 0.0, 1.0) * uNeon;
  float edges = clamp(uEdges, 0.0, 1.0);
  float litAny = max(blobs, fan);
  // The reference never shows red and ice in one frame: a lit ring or fan
  // takes the red with it.
  red *= 1.0 - litAny;
  float glowW = mix(GLOW_DARK_HH, GLOW_LIT_HH, litAny) * mix(0.6, 1.6, uGlow) / scale;
  float halo = mix(HALO_DARK, HALO_LIT, litAny) * mix(0.5, 1.5, uGlow);
  float hs = 0.5 * STROKE_HH / scale;

  // ---- ground: dark crystal panels, lifted under the blob ring -----------
  float nz = vnoise(w * 6.0 + uFlowPos * 0.25) * 0.65 + vnoise(w * 13.0 - uFlowPos * 0.4) * 0.35;
  float facet = 0.5 + 0.8 * (floor(nz * 4.0) / 4.0);
  float groundGain = 0.4 + 2.0 * uGround;
  // The red look is red on black: it pulls the ground and plates down.
  float redDim = 1.0 - 0.6 * red;
  vec3 col = mix(GROUND_DARK, GROUND_LIT, blobs * 0.4) * facet * groundGain * redDim;

  // ---- thin edge web (grey); the edge layer lights it white -------------
  float dWeb = min(sdSegment(w, polar(0.20, S * 0.2), polar(0.53, S * 0.8)), sdSegment(w, polar(0.27, S), polar(0.50, S * 0.15)));
  float web = 1.0 - smoothstep(0.5 * px, 1.5 * px, dWeb);
  col += vec3(0.30, 0.34, 0.40) * web * (0.25 + 0.4 * lit) * groundGain * (1.0 - 0.8 * litAny);
  float ehs = 0.5 * EDGE_HH / scale;
  col += stroke(dWeb, px, ehs, glowW * 0.8, 0.35, EDGE_WHITE, 0.0) * edges * (0.7 + 0.3 * lit);

  // ---- plates: the ring of soft petals the blobs are — radially elongated
  // ellipses that stay clear of both mirror rays, so the mirrored copies
  // sit with dark seams between them instead of fusing into a ring.
  // Centred on the bisector (S / 2), so the wedge's mirrors map a plate
  // onto its neighbours' copies: one per wedge, 2n per centre.
  vec2 plateC = polar(0.40, S * 0.5);
  vec2 plate2C = polar(0.66, S * 0.5);
  vec2 rad = normalize(plateC);
  vec2 tan = vec2(-rad.y, rad.x);
  float halfW = 0.5 * plateC.y;
  vec2 d1 = w - plateC;
  float dPlate = length(vec2(dot(d1, rad) / 1.8, dot(d1, tan))) - halfW;
  vec2 d2 = w - plate2C;
  float dPlate2 = length(vec2(dot(d2, rad) / 1.6, dot(d2, tan))) - 0.5 * plate2C.y;
  float plateIn = 1.0 - smoothstep(-px, 0.03, dPlate);
  float plate2In = 1.0 - smoothstep(-px, 0.03, dPlate2);
  vec3 plateCol = PLATE_GREY * (0.06 + 0.12 * lit) * groundGain;
  col = mix(col, plateCol * redDim, max(plateIn, plate2In) * (1.0 - blobs));
  float blobW = mix(0.7, 1.5, uGlow) * plateC.y;
  float blob = exp(-max(dPlate, 0.0) / (0.45 * blobW)) + 0.7 * exp(-max(dPlate2, 0.0) / (0.4 * blobW));
  col += mix(ICE, vec3(1.0), 0.4) * blob * blobs * 0.9;

  // ---- the star: 2n tips, faceted grey, dark core, bright rim ------------
  float rs = 0.21 * uStar;
  float ri = rs * 0.52;
  vec2 tip = vec2(rs, 0.0);
  vec2 inner = polar(ri, S * 0.25);
  vec2 e = inner - tip;
  vec2 nrm = normalize(vec2(e.y, -e.x));
  if (dot(nrm, -tip) > 0.0) nrm = -nrm;
  float sdStar = dot(wS - tip, nrm);
  float starIn = 1.0 - smoothstep(-px, px, sdStar);
  float core = 1.0 - smoothstep(ri * 0.55, ri * 0.75, r);
  vec3 starCol = STAR_GREY * mix(0.45, 0.2, litAny) * (0.55 + 0.6 * lit) * redDim;
  starCol = mix(starCol, starCol * 0.25, core);
  col = mix(col, starCol, starIn);
  float rim = 1.0 - smoothstep(0.0, 2.0 * px, abs(sdStar));
  col += mix(EDGE_WHITE * 0.5, EDGE_WHITE, edges) * rim * (0.35 + 0.5 * edges) * (0.6 + 0.4 * lit);

  // ---- hex rings, red hearts (edge look), red dots -------------------------
  vec2 hexC = polar(0.30, S * 0.5);
  float dHex = abs(sdHexagon(w - hexC, 0.028 * uStar));
  col += stroke(dHex, px, hs * 0.7, glowW * 0.6, halo * 0.4, mix(vec3(0.42, 0.50, 0.60), EDGE_WHITE, edges), litAny) * 0.35;
  float dHeart = length(w - polar(0.25, S * 0.5)) - 0.012;
  col += NEON_RED * (1.0 - smoothstep(-px, px, dHeart)) * edges * 0.9;
  float dDot = min(length(w - polar(0.50, S * 0.5)), length(w - polar(0.56, S * 0.15))) - 0.007;
  col += stroke(max(dDot, 0.0), px, hs * 0.5, glowW, halo, NEON_RED, 0.0) * red * 1.3;

  // ---- red neon: dashed ray, chevron, ring around the core -----------------
  float push = 0.03 * uBeatSwell * uPulse;
  float redGain = red * (1.3 + 0.6 * uBeatSwell * uPulse);
  float dash = step(0.5, fract(r * 14.0 - uFlowPos * 0.5));
  float dRay = sdSegment(wS, vec2(0.24, 0.0), vec2(0.56, 0.0));
  col += stroke(dRay, px, hs, glowW, halo, NEON_RED, 0.0) * redGain * dash;
  float rc = 0.40 + push;
  float dChev = sdSegment(wS, vec2(rc, 0.0), polar(rc - 0.09, S * 0.32));
  col += stroke(dChev, px, hs * 1.15, glowW, halo, NEON_RED, 0.0) * redGain;
  float dRing = abs(r - ri * 1.25);
  float ringDash = step(0.35, fract(af / S * 2.0));
  col += stroke(dRing, px, hs, glowW, halo, NEON_RED, 0.0) * redGain * ringDash * 0.8;

  // ---- the fan: 2n bright spokes along the tip rays ------------------------
  float spoke = exp(-afS / (S * 0.28)) * smoothstep(0.62, 0.15, r) * smoothstep(rs * 0.9, rs * 1.6, r);
  col += ICE * spoke * (0.04 + 0.75 * fan);

  // Beat pulse lifts everything a little; the cut gap blacks it out.
  col *= 1.0 + 0.2 * uBeatSwell * uPulse;
  col *= 1.0 - clamp(uGap, 0.0, 1.0);

  outColor = vec4(col, 1.0);
}
`;

export const crystalScene = createFullscreenScene("crystal", "Crystal Wall", FRAG, {
  settings: SETTINGS,
  extraUniformDecls: [
    "uniform float uFrameMode;",
    "uniform float uFrameScale;",
    "uniform float uFrameFold;",
    "uniform float uGap;",
    "uniform float uBlobs;",
    "uniform float uFan;",
    "uniform float uRed;",
    "uniform float uEdges;",
    "uniform float uBeatSwell;",
    "uniform float uFlowPos;",
  ].join("\n"),
  extraUniforms: (() => {
    const st = createCrystalState();
    return (_frame, anim, getSetting) => {
      // anim.onset / anim.dropOnset, not frame.*: the render cap can skip
      // the tick a feature fired on (see renderLatch.ts).
      const out = advanceCrystal(
        st,
        { dtSec: anim.dtSec, onset: anim.onset, dropOnset: anim.dropOnset, barPhase: anim.barPhase, tempoLock: anim.tempoLock, low: anim.low },
        {
          cuts: getSetting("cuts"),
          pulse: getSetting("pulse"),
          flareAmt: getSetting("flare"),
          hold: getSetting("hold"),
          flicker: getSetting("flicker"),
          drift: getSetting("drift"),
        },
      );
      const fr = FRAMINGS[out.framing];
      return {
        uFrameMode: fr.mode,
        uFrameScale: fr.scale,
        uFrameFold: fr.fold,
        uGap: out.gap,
        uBlobs: out.blobs,
        uFan: out.fan,
        uRed: out.red,
        uEdges: out.edges,
        uBeatSwell: out.swell,
        uFlowPos: out.flowPos,
      };
    };
  })(),
});
