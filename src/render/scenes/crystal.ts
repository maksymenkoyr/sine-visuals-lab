import { createFullscreenScene } from "../fullscreenScene.ts";
import type { SceneSetting } from "../sceneSettings.ts";

// Crystal Wall: a full-plane three-mirror kaleidoscope (the p6m wallpaper
// group — a hexagonal lattice of cells, each a twelve-fold mirror rosette)
// of a rendered crystal texture: a faceted grey star at every cell centre,
// hex-ring outlines and red neon chevrons around it on a near-black ground.
// Built with `/ref` from an LED-wall VJ loop (_RsNDsibqgc at 16:51) whose
// picture was measured rather than eyeballed: six mirror axes, stroke
// about four pixels at 720p with a thirteen-pixel glow e-fold, hues split
// between red neon and azure, ground brightness two percent — and, most
// of the clip's motion, a *flare*: the same tiling flickers up over about
// ten frames into a soft white-azure bloom with radial spokes, holds a
// moment, decays back to the dark look and dips near black. The loop is
// silent, so in the reference every flare is a timer; here it fires on the
// bar (the beat clock's bar wrap while the tempo is locked) and on section
// drops, with beats giving the smaller brightness pulses the bright holds
// show. `flareEnvelope` owns the shape; `advanceCrystal` the triggering.
//
// How the fold works: `hexCenter` finds the nearest lattice point (spacing
// 1 along x, so the cell's apothem is 0.5 and its vertices sit at 0.577);
// the local angle is folded twice — into the 30° sector between a vertex
// ray and an edge-midpoint ray, then about that sector's bisector — so the
// texture is drawn once in a 15° wedge whose two rays are both star-tip
// directions. Hex edges are mirror lines of p6m, so whatever is drawn in
// the wedge tiles the plane seamlessly with no continuity fix.
//
// Everything is drawn in cell units (lattice spacing 1) and scaled by
// Tiling, so strokes measured in half-heights are divided by Tiling to
// stay the same size on screen at any tiling.

/** Flare envelope timing, in seconds: the flicker-in attack (the reference
 *  climbs over ten frames at 30 fps), the release after the hold, and the
 *  blackout dip that follows the release — its delay after the hold ends
 *  and its width. FLICKER_SLOT is one flicker frame; the reference's holds
 *  between its flash frames were 33–100 ms. */
const FLARE_ATTACK_SEC = 0.3;
const FLARE_RELEASE_SEC = 0.3;
const DIP_DELAY_SEC = 0.55;
const DIP_WIDTH_SEC = 0.25;
const DIP_DEPTH = 0.85;
const FLICKER_SLOT_SEC = 0.05;
/** A bar wrap can't re-fire a flare sooner than this (a wobbling tempo
 *  lock can wrap twice), and without a tempo lock an onset stands in for
 *  the reference's timer only after this long a quiet stretch. */
const FLARE_REFRACTORY_SEC = 0.8;
const FLARE_UNLOCKED_GAP_SEC = 3.0;
/** A drop holds longer than a bar flare — the reference's longest bright
 *  holds (3 s) come with its biggest picture changes. */
const DROP_HOLD_GAIN = 1.6;
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

function hash01(seed: number, k: number): number {
  const x = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** The flare `ageSec` after it fired, as two numbers: `flare`, the bright
 *  look's weight (0 = the dark look) — a flicker-in ramp over
 *  FLARE_ATTACK_SEC whose frames drop out at random when `flicker` is up,
 *  a hold of `holdSec` at 1, an exponential release — and `dip`, the
 *  blackout that follows the release, a gaussian bump. `seed` fixes which
 *  flicker frames drop so the pattern is stable across ticks. Pure,
 *  exported for tests/crystal.test.ts. */
export function flareEnvelope(ageSec: number, holdSec: number, flicker: number, seed: number): { flare: number; dip: number } {
  if (!(ageSec >= 0)) return { flare: 0, dip: 0 };
  const flick = Math.min(1, Math.max(0, flicker));
  const holdEnd = FLARE_ATTACK_SEC + Math.max(0, holdSec);
  let flare: number;
  if (ageSec < FLARE_ATTACK_SEC) {
    const base = ageSec / FLARE_ATTACK_SEC;
    const slot = Math.floor(ageSec / FLICKER_SLOT_SEC);
    const on = hash01(seed, slot) < 0.4 ? 0.12 : 1;
    // A dropped frame drops less as the ramp nears the top: the reference's
    // last attack frames are all bright.
    flare = base * (1 - flick * (1 - base) * (1 - on));
  } else if (ageSec < holdEnd) {
    flare = 1;
  } else {
    flare = Math.exp(-(ageSec - holdEnd) / FLARE_RELEASE_SEC);
  }
  const dt = (ageSec - holdEnd - DIP_DELAY_SEC) / DIP_WIDTH_SEC;
  const dip = DIP_DEPTH * Math.exp(-dt * dt);
  return { flare, dip };
}

export interface CrystalState {
  /** Seconds since the last flare fired; Infinity before the first. */
  flareAge: number;
  flareSeed: number;
  /** Hold of the flare in flight, seconds (drops hold longer). */
  flareHold: number;
  prevBarPhase: number;
  prevDropOnset: boolean;
  /** Beat swell's two exponentials (release minus attack). */
  rel: number;
  att: number;
  flowPos: number;
}

export function createCrystalState(): CrystalState {
  return { flareAge: Infinity, flareSeed: 1, flareHold: 0, prevBarPhase: 0, prevDropOnset: false, rel: 0, att: 0, flowPos: 0 };
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

/** One frame of the scene's timing: fires a flare on a bar wrap while the
 *  tempo is locked, on a section drop, or — unlocked, the reference's
 *  timer stand-in — on an onset after a quiet stretch; advances the flare
 *  age, the beat swell and the flow. `hold` is the Flare hold slider in
 *  seconds, `flareAmt` the Flare slider (0 disables flares). Returns the
 *  uniforms. Pure apart from `st`; exported for tests/crystal.test.ts. */
export function advanceCrystal(
  st: CrystalState,
  input: CrystalInputs,
  opts: { pulse: number; flareAmt: number; hold: number; flicker: number; drift: number },
): { flare: number; dip: number; swell: number; flowPos: number } {
  const locked = input.tempoLock > 0.5;
  const barWrap = locked && input.barPhase < st.prevBarPhase - 0.5;
  st.prevBarPhase = input.barPhase;
  const drop = input.dropOnset && !st.prevDropOnset;
  st.prevDropOnset = input.dropOnset;
  st.flareAge += input.dtSec;
  const fireBar = barWrap && st.flareAge > FLARE_REFRACTORY_SEC;
  const fireTimer = !locked && input.onset && st.flareAge > FLARE_UNLOCKED_GAP_SEC;
  if (opts.flareAmt > 0 && (drop || fireBar || fireTimer)) {
    st.flareAge = 0;
    st.flareSeed = (st.flareSeed * 7 + 3) % 1000;
    st.flareHold = opts.hold * (drop ? DROP_HOLD_GAIN : 1);
  }
  const env = flareEnvelope(st.flareAge, st.flareHold, opts.flicker, st.flareSeed);

  if (input.onset) {
    st.rel = Math.min(st.rel + opts.pulse, SWELL_STACK_CAP);
    st.att = Math.min(st.att + opts.pulse, SWELL_STACK_CAP);
  }
  st.rel *= Math.exp(-input.dtSec * SWELL_KR);
  st.att *= Math.exp(-input.dtSec * SWELL_KA);
  const swell = Math.max(0, st.rel - st.att) / SWELL_PEAK;

  const flowRate = (FLOW_RATE_MIN + (FLOW_RATE_MAX - FLOW_RATE_MIN) * opts.drift) * (1 + FLOW_BASS_GAIN * input.low);
  st.flowPos += input.dtSec * flowRate;

  return { flare: env.flare * opts.flareAmt, dip: env.dip * opts.flareAmt, swell, flowPos: st.flowPos };
}

const SETTINGS: SceneSetting[] = [
  {
    key: "tiling",
    label: "Tiling",
    description: "Cell spacing, in screen half-heights: how many star cells fit across.",
    group: "Form",
    min: 0.8,
    max: 3.0,
    step: 0.05,
    default: 1.7,
    // Framing geometry the user picks, like kaleido's Symmetry.
  },
  {
    key: "star",
    label: "Star",
    description: "Size of the faceted star at each cell centre.",
    group: "Form",
    min: 0.5,
    max: 1.5,
    step: 0.05,
    default: 1.0,
    auto: { density: 0.2 },
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
    key: "pulse",
    label: "Beat pulse",
    description: "Brightness pop on each beat, and the push it gives the chevrons.",
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
    description: "The bright bloomed look that flickers in on every bar and section drop, then dips to black.",
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
    label: "Flare hold",
    description: "How long the bright look stays before it decays, in seconds.",
    group: "Motion",
    min: 0.1,
    max: 2.0,
    step: 0.05,
    default: 0.35,
    auto: { tempo: -0.3 },
  },
  {
    key: "flicker",
    label: "Flicker",
    description: "How much the flare stutters on its way up.",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.7,
    auto: { attack: 0.3 },
  },
  {
    key: "glow",
    label: "Glow",
    description: "Halo width and strength around the neon strokes.",
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
    description: "The red neon chevrons and star outline.",
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

// Measured reference strokes, in screen half-heights (720p frame: stroke
// 3.8 px, glow e-fold 13 px dark / 15 px bright, halo/core 0.12 dark,
// 0.63 bright).
const float STROKE_HH = 0.0106;
const float GLOW_DARK_HH = 0.037;
const float GLOW_BRIGHT_HH = 0.10;
const float HALO_DARK = 0.15;
const float HALO_BRIGHT = 0.2;

const vec3 NEON_RED = vec3(1.0, 0.10, 0.09);
const vec3 NEON_ICE = vec3(0.72, 0.86, 1.0);
const vec3 STAR_DARK = vec3(0.55, 0.60, 0.68);
const vec3 STAR_ICE = vec3(0.86, 0.93, 1.0);
const vec3 GROUND_DARK = vec3(0.027, 0.020, 0.024);
const vec3 GROUND_ICE = vec3(0.04, 0.06, 0.08);
const vec3 RIM = vec3(0.8, 0.86, 0.95);

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

// A neon stroke: solid core of width STROKE plus an exponential halo.
// d is the distance to the stroke's centre line, px the pixel size; the
// core fades with soft (the bright look has no sharp line anywhere).
vec3 neon(float d, float px, float halfStroke, float glowW, float halo, vec3 col, float soft) {
  float core = 1.0 - smoothstep(halfStroke - px, halfStroke + px, d);
  float glow = exp(-max(d - halfStroke, 0.0) / glowW);
  return col * (core * (1.0 - 0.9 * soft) + halo * glow);
}

void main() {
  vec2 p = (roomUv(vUv) - 0.5) * 2.0;
  p.x *= uResolution.x / uResolution.y;

  float flare = clamp(uFlareEnv, 0.0, 1.0);
  // Drift: the lattice breathes slowly and the facet noise streams.
  float tiling = uTiling * (1.0 + 0.05 * sin(uFlowPos * 0.9));
  vec2 pc = p / tiling;
  float px = (2.0 / uResolution.y) / tiling;
  float halfStroke = 0.5 * STROKE_HH / tiling;
  float glowW = mix(GLOW_DARK_HH, GLOW_BRIGHT_HH, flare) * mix(0.6, 1.6, uGlow) / tiling;
  float halo = mix(HALO_DARK, HALO_BRIGHT, flare) * mix(0.5, 1.5, uGlow);

  vec2 q = hexLocal(pc);
  float r = length(q);
  float a = atan(q.y, q.x);
  // Fold into the 30° sector between a vertex ray and an edge-midpoint
  // ray, then about its bisector: both wedge rays are star-tip directions.
  float af = abs(mod(a, PI / 3.0) - PI / 6.0);
  float af2 = PI / 12.0 - abs(af - PI / 12.0);
  vec2 w = polar(r, af2);

  // Facet shading follows the unfolded angle so the star reads as lit from
  // one side, the way the reference's rendered crystal does.
  float lit = 0.5 + 0.5 * cos(a - 2.2);

  // ---- ground: dark crystal panels with a thin grey edge web ---------------
  float n = vnoise(w * 6.0 + uFlowPos * 0.25) * 0.65 + vnoise(w * 13.0 - uFlowPos * 0.4) * 0.35;
  float facet = 0.4 + 1.2 * (floor(n * 4.0) / 4.0);
  float groundGain = 0.4 + 2.0 * uGround;
  vec3 col = mix(GROUND_DARK, GROUND_ICE, flare) * facet * groundGain;
  float dWeb = min(sdSegment(w, polar(0.20, 0.05), polar(0.53, 0.20)), sdSegment(w, polar(0.27, 0.25), polar(0.50, 0.04)));
  dWeb = min(dWeb, sdSegment(w, vec2(0.19, 0.0), vec2(0.56, 0.0)));
  float web = 1.0 - smoothstep(0.5 * px, 1.5 * px, dWeb);
  col += vec3(0.30, 0.34, 0.40) * web * (0.35 + 0.5 * lit) * groundGain * (1.0 - 0.9 * flare);

  // ---- the star: twelve tips, faceted grey, dark core, bright rim ---------
  float rs = 0.17 * uStar;
  float ri = rs * 0.52;
  vec2 tip = vec2(rs, 0.0);
  vec2 inner = polar(ri, PI / 12.0);
  vec2 e = inner - tip;
  vec2 nrm = normalize(vec2(e.y, -e.x));
  if (dot(nrm, -tip) > 0.0) nrm = -nrm;
  float sdStar = dot(w - tip, nrm);
  float aa = mix(px, 0.03, flare);
  float starIn = 1.0 - smoothstep(-aa, aa, sdStar);
  float core = 1.0 - smoothstep(ri * 0.55, ri * 0.75, r);
  // Bright look: the star goes dark — a hole in the bloom — with a lit rim.
  vec3 starCol = mix(STAR_DARK, STAR_ICE * 0.5, flare) * mix(0.28, 0.35, flare) * (0.55 + 0.6 * lit);
  starCol = mix(starCol, starCol * 0.25, core);
  col = mix(col, starCol, starIn);
  float rim = 1.0 - smoothstep(0.0, 2.0 * px + 0.006 * flare, abs(sdStar));
  col += mix(RIM, vec3(1.0, 0.8, 0.8), flare) * rim * mix(0.35, 0.5, flare) * (0.6 + 0.4 * lit);

  // ---- hex-ring outlines and the small red dots ---------------------------
  vec2 hexC = polar(0.33, 0.20);
  float dHex = abs(sdHexagon(w - hexC, 0.028 * uStar));
  col += neon(dHex, px, halfStroke * 0.7, glowW * 0.6, halo * 0.4, mix(vec3(0.42, 0.50, 0.60), NEON_ICE, flare), flare) * 0.6;
  float dDot = length(w - polar(0.45, 0.11)) - 0.007;
  col += neon(max(dDot, 0.0), px, halfStroke * 0.5, glowW, halo, mix(NEON_RED, NEON_ICE, flare), flare) * mix(uNeon, 1.0, flare);

  // ---- red neon: chevrons pointing out along the tips, big star outline ---
  float push = 0.03 * uBeatSwell * uPulse;
  // The red pumps with the bass and the beat: the reference's dark look
  // swings between sparse red marks and bold red chevrons.
  float neonGain = uNeon * (0.55 + 0.6 * uLow + 0.35 * uBeatSwell * uPulse);
  vec3 neonCol = mix(NEON_RED, NEON_ICE, flare) * mix(neonGain, 1.0, flare);
  float rc = 0.40 + push;
  vec2 chevC = vec2(rc, 0.0);
  float dChev = sdSegment(w, chevC, polar(rc - 0.07, 0.21));
  col += neon(dChev, px, halfStroke * 1.15, glowW, halo, neonCol, flare);
  vec2 outC = vec2(0.52 + push, 0.0);
  float dOut = sdSegment(w, outC, polar(0.43 + push, 0.14));
  col += neon(dOut, px, halfStroke * 0.8, glowW, halo * (1.0 - 0.6 * flare), neonCol, flare) * 0.55;

  // ---- the bright look: soft blobs where the marks are, and radial spokes -
  // Blob widths in cell units; the reference's biggest bright blobs are a
  // quarter of a half-height across, on the chevron ring.
  float blobW = mix(0.9, 1.8, uGlow);
  float blob = exp(-dot(w - chevC, w - chevC) / (0.09 * 0.09 * blobW))
    + 0.5 * exp(-dot(w - hexC, w - hexC) / (0.055 * 0.055 * blobW))
    + 0.6 * exp(-dot(w - outC, w - outC) / (0.075 * 0.075 * blobW));
  float spoke = exp(-af2 / 0.16) * smoothstep(0.5, 0.12, r) * smoothstep(rs * 0.9, rs * 1.6, r);
  col += NEON_ICE * (blob * 0.7 + spoke * 0.3) * flare;

  // Beat pulse lifts everything a little; the blackout dip pulls it down.
  col *= 1.0 + 0.2 * uBeatSwell * uPulse;
  float dip = clamp(uDipEnv, 0.0, 1.0);
  col *= 1.0 - dip;

  outColor = vec4(col, 1.0);
}
`;

export const crystalScene = createFullscreenScene("crystal", "Crystal Wall", FRAG, {
  settings: SETTINGS,
  extraUniformDecls: `uniform float uFlareEnv;\nuniform float uDipEnv;\nuniform float uBeatSwell;\nuniform float uFlowPos;`,
  extraUniforms: (() => {
    const st = createCrystalState();
    return (_frame, anim, getSetting) => {
      // anim.onset / anim.dropOnset, not frame.*: the render cap can skip
      // the tick a feature fired on (see renderLatch.ts).
      const out = advanceCrystal(
        st,
        { dtSec: anim.dtSec, onset: anim.onset, dropOnset: anim.dropOnset, barPhase: anim.barPhase, tempoLock: anim.tempoLock, low: anim.low },
        { pulse: getSetting("pulse"), flareAmt: getSetting("flare"), hold: getSetting("hold"), flicker: getSetting("flicker"), drift: getSetting("drift") },
      );
      return { uFlareEnv: out.flare, uDipEnv: out.dip, uBeatSwell: out.swell, uFlowPos: out.flowPos };
    };
  })(),
});
