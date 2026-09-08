import { createFullscreenScene } from "../fullscreenScene.ts";
import type { SceneSetting } from "../sceneSettings.ts";

// Crystal Wall: one continuously evolving picture — a hexagonal
// three-mirror kaleidoscope (p6m) of dark faceted panels, a faceted star,
// a ring of soft plates, hex rings and thin edge lines, with light layers
// that fade up and down over it. Built with `/ref` from an LED-wall VJ
// loop (_RsNDsibqgc: 1011 s, then three random 10 s clips at 810, 1027 and
// 1472 s, each decoded at every source frame) whose picture was measured
// rather than eyeballed: 8 change events in 10 s, each spread over
// 0.5–1.7 s, no single frame carrying more than 12% of a transition, dark
// passages fading over 0.07–0.37 s — a picture that keeps turning under
// changing light, never one that switches or drops to black. What the
// three clips agree on: the same geometry sits under every look (the star
// and facets hold still while a ring of azure blobs lights up over about
// half a second, then dims); light layers move independently — the ice
// blob ring (glow e-fold 13–29 px at 720p, halo/core up to 0.5), a
// twelve-spoke fan, red neon lines and dots (a look that is 97% red at
// under 1% lit area, rising over about half a second) and white edge-lit
// outlines with small red hearts (4.6 px strokes); ground stays at 2%
// luminance and lifts to ~13% under the blobs.
//
// The loop is silent, so every one of those is a timer in the reference.
// Here (advanceCrystal): a wandering camera stands in for the reference's
// changing look — a smooth log-zoom and pan (zoomT/panT, seconds of
// travel through two bounded, incommensurate sine sums) that a beat surge
// nudges the *speed* of, decaying over ~0.18 s, so a beat never displaces
// the picture on the tick it lands, only speeds up where it was already
// headed. A morph clock (uMorphPos) breathes the motif radii, sizes and
// the facet light direction between beats, so the picture keeps changing
// even at rest. The blob ring fades in on bar wraps (every 4th onset
// stands in when the tempo isn't locked), the fan on drops; a slow mood
// cycle (~one turn per 16 s) decides how much of a beat goes to the red
// neon look versus the white edge-lit look — never both at once (see
// `litAny` below) but which one it favours only ever glides. Every layer
// only restarts its fade once it has faded low enough that the restart
// itself is invisible (RELIGHT_GATE below) — nothing here resets to black.
//
// The fold: `hexLocal` finds the nearest lattice point (spacing 1 along x,
// apothem 0.5, vertices at 0.577); the angle is folded into the wedge
// between two mirror lines (S = PI / 6, six axes fixed — only the
// lattice's scale wanders now, via the camera's zoom), the fundamental
// domain, so whatever is drawn there tiles; the star and the spokes fold
// once more about the wedge's bisector for their doubled symmetry. main()
// says where a motif has to sit to appear once per wedge. Hex edges are
// mirror lines of p6m, so the lattice tiles seamlessly.

/** Light-layer envelope times, seconds — attacks in [0.12, 0.25], releases
 *  in [0.45, 0.9]. RELIGHT_GATE (below) is what actually keeps a re-trigger
 *  from being visible, not these numbers by themselves: light() always
 *  resets a layer's age to 0, and layerEnvelope(0, …) is always 0, so
 *  restarting a layer whose output hasn't faded low enough would show up
 *  as a same-frame drop — a cut in everything but name. */
const LIGHT_ATTACK_SEC = 0.18;
const LIGHT_RELEASE_SEC = 0.6;
const RED_ATTACK_SEC = 0.2;
const RED_RELEASE_SEC = 0.7;
const EDGE_ATTACK_SEC = 0.15;
const EDGE_RELEASE_SEC = 0.5;
/** A layer only restarts once its current (envelope × amp) output has
 *  faded under this. */
const RELIGHT_GATE = 0.15;
/** A bar wrap can't be told from a tempo lock; without one, every fourth
 *  onset stands in for the bar. */
const UNLOCKED_BAR_BEATS = 4;
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

/** Camera wander: zoomT/panT are seconds of travel fed through smooth
 *  bounded functions — never a switch. `wander` sums two incommensurate
 *  sines (period ratio the golden ratio, so it never settles into a short
 *  repeat) into a range within ±1. With ZOOM_MID = log(1.6) and
 *  ZOOM_AMP = log(1.9), the lattice's cell spacing wanders between ~0.85
 *  and ~3 screen half-heights — the "many small cells" and "one rosette
 *  fills the screen" looks of the reference, reached by travel, never a
 *  switch. */
const ZOOM_RATE_MAX = 0.75;
export const ZOOM_MID = Math.log(1.6);
export const ZOOM_AMP = Math.log(1.9);
const ZOOM_SECTION_GAIN = 0.4;
/** A beat nudges the zoom's travel speed (not its position) by this much
 *  per unit Beat pulse, decaying over ZOOM_SURGE_TAU_SEC — the same
 *  damped-velocity shape as kaleido/index.ts's advanceBeatSurge, copied
 *  rather than imported (scenes don't import each other). The impulse
 *  lands after this frame's travel is computed, so a beat only speeds up
 *  where the camera was already headed starting next frame — never a jump
 *  on the tick it fires. */
const ZOOM_SURGE_IMPULSE = 1.8;
const ZOOM_SURGE_TAU_SEC = 0.18;
const ZOOM_SURGE_VEL_CAP = 6;
const PAN_RATE = 0.6;
/** Morph clock: radians per second at Drift = 0 and 1, and the extra
 *  factor the bass adds — moves motif radii/sizes and the facet light
 *  direction (FRAG below), never their placement on the wedge bisector. */
const MORPH_RATE_MIN = 0.15;
const MORPH_RATE_MAX = 0.5;
const MORPH_BASS_GAIN = 0.5;
/** Mood: a slow continuous cycle deciding how much of a beat's red/edges
 *  split goes to each look — never a coin flip, always a glide. */
const MOOD_RATE = (2 * Math.PI) / 16;

/** A tiny deterministic hash, seed × k -> [0, 1). Exported for
 *  tests/crystal.test.ts. Nothing here needs per-frame randomness anymore
 *  (the old flicker dropout that used to consume it is gone) — kept as a
 *  small pure utility rather than deleted along with the feature. */
export function hash01(seed: number, k: number): number {
  const x = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** Sum of two incommensurate sines, bounded within ±1 for any t — the
 *  shape the camera's log-zoom rides so it never settles into a short
 *  repeat, however fast or slow t itself is moving. */
function wander(t: number): number {
  return 0.6 * Math.sin(t) + 0.4 * Math.sin(1.618 * t + 1.3);
}

/** A light layer `ageSec` after it was switched on: a ramp over
 *  `attackSec`, a hold at 1, an exponential release. Pure, exported for
 *  tests/crystal.test.ts. */
export function layerEnvelope(ageSec: number, attackSec: number, holdSec: number, releaseSec: number): number {
  if (!(ageSec >= 0)) return 0;
  const holdEnd = attackSec + Math.max(0, holdSec);
  if (ageSec < attackSec) return ageSec / attackSec;
  if (ageSec < holdEnd) return 1;
  return Math.exp(-(ageSec - holdEnd) / releaseSec);
}

interface Layer {
  /** Seconds since switched on; Infinity while off. */
  age: number;
  hold: number;
  /** Scales the envelope: 1 for blobs/fan, the mood weight for red/edges. */
  amp: number;
}

const offLayer = (): Layer => ({ age: Infinity, hold: 0, amp: 1 });

/** Reads a layer's current (envelope × amp) output without mutating it —
 *  used both to gate a restart (RELIGHT_GATE) and to report the frame's
 *  output, so the two never disagree. */
function layerOut(layer: Layer, attackSec: number, releaseSec: number): number {
  return layerEnvelope(layer.age, attackSec, layer.hold, releaseSec) * layer.amp;
}

function light(layer: Layer, hold: number, amp = 1): void {
  layer.age = 0;
  layer.hold = hold;
  layer.amp = amp;
}

export interface CrystalState {
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
  /** Camera wander: seconds of travel, and the beat surge's velocity
   *  (added to the zoom's travel speed, decaying). */
  zoomT: number;
  zoomVel: number;
  panT: number;
  /** Morph clock's position. */
  morphPos: number;
  /** Mood cycle's phase. */
  moodT: number;
}

export function createCrystalState(): CrystalState {
  return {
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
    zoomT: 0,
    zoomVel: 0,
    panT: 0,
    morphPos: 0,
    moodT: 0,
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
  sectionIntensity: number;
}

export interface CrystalOpts {
  /** Travel slider: how fast the camera's log-zoom and pan wander. */
  zoom: number;
  pulse: number;
  /** Flare slider: light-layer strength; 0 leaves the dark look alone. */
  flareAmt: number;
  hold: number;
  drift: number;
}

export interface CrystalOut {
  logZoom: number;
  pan: [number, number];
  morphPos: number;
  blobs: number;
  fan: number;
  red: number;
  edges: number;
  swell: number;
  flowPos: number;
}

/** One frame of the sequencer: advances the camera's wander (zoom + pan),
 *  the morph clock and the mood cycle, then fades the light layers up on
 *  bar wraps / drops / beats and down on their own. Pure apart from `st`;
 *  exported for tests/crystal.test.ts. */
export function advanceCrystal(st: CrystalState, input: CrystalInputs, opts: CrystalOpts): CrystalOut {
  const dt = input.dtSec;
  const locked = input.tempoLock > 0.5;
  const barWrap = locked && input.barPhase < st.prevBarPhase - 0.5;
  st.prevBarPhase = input.barPhase;
  const drop = input.dropOnset && !st.prevDropOnset;
  st.prevDropOnset = input.dropOnset;

  for (const l of [st.blobs, st.fan, st.red, st.edges]) l.age += dt;
  if (input.onset) st.beatCount++;

  // Camera wander: this frame's travel uses last frame's surge velocity;
  // only after advancing does the velocity decay and pick up this tick's
  // impulse, so an onset speeds up next frame's travel, never this one's.
  st.zoomT += dt * (ZOOM_RATE_MAX * opts.zoom * (1 + ZOOM_SECTION_GAIN * input.sectionIntensity) + st.zoomVel);
  st.zoomVel *= Math.exp(-dt / ZOOM_SURGE_TAU_SEC);
  if (input.onset) st.zoomVel = Math.min(st.zoomVel + opts.pulse * ZOOM_SURGE_IMPULSE, ZOOM_SURGE_VEL_CAP);
  const logZoom = ZOOM_MID + ZOOM_AMP * wander(st.zoomT);

  st.panT += dt * PAN_RATE * opts.drift;
  const pan: [number, number] = [0.35 * Math.sin(0.7 * st.panT), 0.35 * Math.sin(0.53 * st.panT + 2.0)];

  st.morphPos += dt * (MORPH_RATE_MIN + MORPH_RATE_MAX * opts.drift) * (1 + MORPH_BASS_GAIN * input.low);

  st.moodT += dt * MOOD_RATE;
  const mood = 0.5 + 0.5 * Math.sin(st.moodT);

  const layersOn = opts.flareAmt > 0;
  const barLike = barWrap || (!locked && input.onset && st.beatCount % UNLOCKED_BAR_BEATS === 0);
  if (layersOn && barLike && layerOut(st.blobs, LIGHT_ATTACK_SEC, LIGHT_RELEASE_SEC) < RELIGHT_GATE) {
    light(st.blobs, opts.hold);
  }
  if (layersOn && drop && layerOut(st.fan, LIGHT_ATTACK_SEC, LIGHT_RELEASE_SEC) < RELIGHT_GATE) {
    light(st.fan, opts.hold * 1.5);
  }
  if (layersOn && input.onset && layerOut(st.red, RED_ATTACK_SEC, RED_RELEASE_SEC) < RELIGHT_GATE) {
    light(st.red, opts.hold * 1.5, mood);
  }
  if (layersOn && input.onset && layerOut(st.edges, EDGE_ATTACK_SEC, EDGE_RELEASE_SEC) < RELIGHT_GATE) {
    light(st.edges, opts.hold * 2, 1 - mood);
  }

  const blobs = layerOut(st.blobs, LIGHT_ATTACK_SEC, LIGHT_RELEASE_SEC);
  const fan = layerOut(st.fan, LIGHT_ATTACK_SEC, LIGHT_RELEASE_SEC);
  const red = layerOut(st.red, RED_ATTACK_SEC, RED_RELEASE_SEC);
  const edges = layerOut(st.edges, EDGE_ATTACK_SEC, EDGE_RELEASE_SEC);

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
    logZoom,
    pan,
    morphPos: st.morphPos,
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
    description: "Scale of the lattice: below 1 more, smaller cells; above 1 fewer, bigger.",
    group: "Form",
    min: 0.5,
    max: 2.0,
    step: 0.05,
    default: 1.0,
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
    key: "zoom",
    label: "Travel",
    description: "How fast the camera wanders through the crystal — zooming and sliding, never cutting.",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.4,
    auto: { tempo: 0.25, loudness: 0.15 },
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
    description:
      "Strength of the light layers: the ice blobs fading in on every bar, the fan on drops, and the red / edge-lit looks a slow mood alternates between.",
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
    key: "drift",
    label: "Drift",
    description: "How fast the picture drifts: the camera panning, the motifs breathing, and the facets' light turning.",
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
// Six mirror axes, fixed: only the lattice's scale (uLogZoom) wanders now.
const float S = PI / 6.0;

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

  // The camera wanders continuously: uLogZoom sets the lattice's scale (a
  // beat surge nudges its travel speed, not its position — see
  // advanceCrystal), uPanX/uPanY slide it. hexLocal always finds the
  // nearest lattice point; n mirror axes make 2n wedges of S = PI/n
  // (n = 6, fixed), and af is the angle folded into one wedge (the
  // fundamental domain, so anything drawn in it tiles). A motif placed on
  // the bisector (angle S/2) is mirrored onto itself, so it appears once
  // per wedge — 2n copies per centre — and one on a wedge ray appears n
  // times. Only radii and sizes move with uMorphPos below — never a
  // motif off the bisector or its ray.
  float scale = exp(uLogZoom) * uTiling;
  vec2 q = hexLocal(p / scale + vec2(uPanX, uPanY));
  float m = uMorphPos;
  float r = length(q);
  float a = atan(q.y, q.x);
  float af = abs(mod(a, 2.0 * S) - S);
  float afS = S * 0.5 - abs(af - S * 0.5);
  vec2 w = polar(r, af);
  vec2 wS = polar(r, afS);
  float px = (2.0 / uResolution.y) / scale;
  // Facets brighten and dim as if the scene turned under a lamp.
  float lit = 0.5 + 0.5 * cos(a - 2.2 - 0.3 * m);

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

  // ---- thin edge web (grey); the edge layer lights it white; endpoints
  // drift a little with the morph clock -----------------------------------
  float dWeb = min(
    sdSegment(w, polar(0.20 + 0.03 * sin(0.8 * m), S * 0.2), polar(0.53 - 0.03 * sin(0.6 * m + 0.7), S * 0.8)),
    sdSegment(w, polar(0.27 + 0.03 * sin(0.5 * m + 1.4), S), polar(0.50 - 0.03 * sin(0.7 * m), S * 0.15)));
  float web = 1.0 - smoothstep(0.5 * px, 1.5 * px, dWeb);
  col += vec3(0.30, 0.34, 0.40) * web * (0.25 + 0.4 * lit) * groundGain * (1.0 - 0.8 * litAny);
  float ehs = 0.5 * EDGE_HH / scale;
  col += stroke(dWeb, px, ehs, glowW * 0.8, 0.35, EDGE_WHITE, 0.0) * edges * (0.7 + 0.3 * lit);

  // ---- plates: the ring of soft petals the blobs are — radially elongated
  // ellipses that stay clear of both mirror rays, so the mirrored copies
  // sit with dark seams between them instead of fusing into a ring.
  // Centred on the bisector (S / 2), so the wedge's mirrors map a plate
  // onto its neighbours' copies: one per wedge, 2n per centre. Ring radii
  // breathe with the morph clock.
  vec2 plateC = polar(0.40 + 0.05 * sin(0.7 * m), S * 0.5);
  vec2 plate2C = polar(0.66 + 0.04 * sin(0.5 * m + 1.0), S * 0.5);
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

  // ---- the star: 2n tips, faceted grey, dark core, bright rim; size
  // breathes with the morph clock ------------------------------------------
  float rs = 0.21 * uStar * (1.0 + 0.15 * sin(0.45 * m + 2.0));
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

  // ---- hex ring, red heart (edge look), red dots — radius/angle drift
  // with the morph clock -----------------------------------------------------
  vec2 hexC = polar(0.30 + 0.02 * sin(0.6 * m), S * 0.5 + 0.02 * sin(0.4 * m + 0.5));
  float dHex = abs(sdHexagon(w - hexC, 0.028 * uStar));
  col += stroke(dHex, px, hs * 0.7, glowW * 0.6, halo * 0.4, mix(vec3(0.42, 0.50, 0.60), EDGE_WHITE, edges), litAny) * 0.35;
  float dHeart = length(w - polar(0.25, S * 0.5)) - 0.012;
  col += NEON_RED * (1.0 - smoothstep(-px, px, dHeart)) * edges * 0.9;
  float dDot = min(length(w - polar(0.50, S * 0.5)), length(w - polar(0.56, S * 0.15))) - 0.007;
  col += stroke(max(dDot, 0.0), px, hs * 0.5, glowW, halo, NEON_RED, 0.0) * red * 1.3;

  // ---- red neon: dashed ray, chevron, ring around the core — chevron
  // radius breathes with the morph clock ---------------------------------
  float push = 0.03 * uBeatSwell * uPulse;
  float redGain = red * (1.3 + 0.6 * uBeatSwell * uPulse);
  float dash = step(0.5, fract(r * 14.0 - uFlowPos * 0.5));
  float dRay = sdSegment(wS, vec2(0.24, 0.0), vec2(0.56, 0.0));
  col += stroke(dRay, px, hs, glowW, halo, NEON_RED, 0.0) * redGain * dash;
  float rc = 0.40 + push + 0.04 * sin(0.9 * m);
  float dChev = sdSegment(wS, vec2(rc, 0.0), polar(rc - 0.09, S * 0.32));
  col += stroke(dChev, px, hs * 1.15, glowW, halo, NEON_RED, 0.0) * redGain;
  float dRing = abs(r - ri * 1.25);
  float ringDash = step(0.35, fract(af / S * 2.0));
  col += stroke(dRing, px, hs, glowW, halo, NEON_RED, 0.0) * redGain * ringDash * 0.8;

  // ---- the fan: 2n bright spokes along the tip rays ------------------------
  float spoke = exp(-afS / (S * 0.28)) * smoothstep(0.62, 0.15, r) * smoothstep(rs * 0.9, rs * 1.6, r);
  col += ICE * spoke * (0.04 + 0.75 * fan);

  // Beat pulse lifts everything a little — the only sharp edge anywhere is
  // a stroke's own antialiasing, never the whole frame.
  col *= 1.0 + 0.2 * uBeatSwell * uPulse;

  outColor = vec4(col, 1.0);
}
`;

export const crystalScene = createFullscreenScene("crystal", "Crystal Wall", FRAG, {
  settings: SETTINGS,
  extraUniformDecls: [
    "uniform float uLogZoom;",
    "uniform float uPanX;",
    "uniform float uPanY;",
    "uniform float uMorphPos;",
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
        {
          dtSec: anim.dtSec,
          onset: anim.onset,
          dropOnset: anim.dropOnset,
          barPhase: anim.barPhase,
          tempoLock: anim.tempoLock,
          low: anim.low,
          sectionIntensity: anim.sectionIntensity,
        },
        {
          zoom: getSetting("zoom"),
          pulse: getSetting("pulse"),
          flareAmt: getSetting("flare"),
          hold: getSetting("hold"),
          drift: getSetting("drift"),
        },
      );
      return {
        uLogZoom: out.logZoom,
        uPanX: out.pan[0],
        uPanY: out.pan[1],
        uMorphPos: out.morphPos,
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
