import { createFullscreenScene } from "../fullscreenScene.ts";
import type { SceneSetting } from "../sceneSettings.ts";

// Rebuilt 2026-09-11 from thedotisblack's "Moiré Pattern Art | Horizontal
// lines with noise" (Part 2, the video's second chapter) — a Processing
// piece of plain horizontal line gratings on a light ground. Scan-line
// measurement (reflook found nothing useful on this light ground; this was
// measured by hand) turned up the actual mechanism: two gratings share one
// line period, but the second is displaced from the first by a smoothly
// varying noise field. Wherever that displacement lands the two grates in
// anti-phase, the light gaps of one grating fill with the other's ink,
// reading as a dark, roughly circular "cloud" against the paler ground
// elsewhere — moiré by phase, not by angle or frequency mismatch the way
// moire2.ts's three rotated gratings work. The field itself doesn't drift so
// much as re-roll: each fresh sample barely correlates with the last, a
// stochastic shimmer rather than smooth motion (the frame-doubled-video CUTS
// finding, see the reference-video-analysis memory).
//
// None of this is audio-reactive in the source (Processing's own timers, not
// a beat detector), so every mapping below is ours, onto a signal our
// runtime can actually see — see the plan this shipped from
// (hazy-discovering-plum.md) for the underlying reference measurements:
//  - `flicker` is the field's re-roll rate in Hz; at 0 the fresh component
//    glides continuously instead of stepping (see advanceFlicker's "smooth
//    mode"), so turning it down never just freezes the picture.
//  - `depth` is scaled by an intro ramp (introRamp, over this scene's own
//    elapsed time — the reference's scripted fade-in from a flat grating)
//    and by the current energy, with `beatDip` briefly dipping it on each
//    beat — the reference's own early contrast pulses.
//  - `blackout` is the chance a bass hit (never an ordinary broadband onset)
//    also fires the whole-field half-period phase jump the reference's rare
//    dark frames show; a section drop always fires it (advanceBlackout).
//  - `curtain` is how readily a sustained quiet passage — sectionIntensity
//    held under a curtain-scaled threshold for a while — lifts the grating
//    off the bottom of the frame, ground only, the way the reference's
//    closing section does; going loud again or a drop pulls it back down
//    faster than it rose (advanceCurtain). 0 disables it outright.
//
// Shader-side: the grating is drawn in screen pixels off gl_FragCoord (the
// riso.ts halftone-grid idiom) so the reference's fixed line spacing holds
// at any canvas size, with `lines` as the only knob on how many periods fit
// down the frame's height. The noise field instead samples room-space `p`
// (roomUv, in half-heights) scaled by `scale`, so a cloud's size is a room
// property, not a per-device one. `duty` is each grating's own ink width.
// Value noise (hash + smooth blend, `fbm` below) is written from scratch,
// not ported — see CLAUDE.md's standing rule on independent scene work.
// Anti-aliasing follows the fwidth idiom this file's neighbors already use,
// plus one guard of its own: once the line period shrinks under a few
// pixels, both gratings fade to their own mean (`duty`) instead of aliasing
// into a moiré against the pixel grid itself.
//
// `uBlackout`/`uCurtain` — the uniforms the `blackout`/`curtain` settings
// auto-declare — are deliberately never read in FRAG: like caustics.ts's
// `uDrift` (the raw Drift-speed slider, vs. the JS-accumulated uDriftPhase
// it feeds), the raw slider value is only ever consumed on the JS side,
// while the shader reads the already-processed signal under its own name
// (uBlackoutPhase / uCurtainLevel) — see extraUniformDecls below.

// Noise / grating look -------------------------------------------------
const WOBBLE = 0.15; // periods of small along-the-line undulation baked into phiA itself, independent of Warp depth's displacement
const FRESH_MIX = 0.65; // how much of the field is the fast-reseeding component vs. the slow persistent one
const NOISE_BASE_FREQ = 0.55; // lattice cells per half-height at Cloud size 1 — measured so a cloud's half-correlation length lands in the reference's band
const INK_A = 0.87; // the fixed grating's ink strength: its lines read near-black but not clipped, as the reference's do
const INK_B = 0.75; // the displaced grating's — measured lighter: where it fills the fixed grating's gaps they go grey, not black, so a dark cloud bottoms out well above ink-on-ink
const AA_FADE_LOW_PX = 1.5; // at/below this line period both gratings are fully faded to their own mean (duty)
const AA_FADE_HIGH_PX = 3.0; // at/above this period the gratings render at full contrast

// Flicker (uSeed) --------------------------------------------------------
const SEED_STEP = 43.27; // a jump large enough that consecutive fresh fields don't correlate; picked off any noise-lattice period
const SEED_WRAP = 512; // uSeed is kept in [0, SEED_WRAP): a seed in the thousands leaves fract(p) in the shader with too few bits and the smooth blend steps — not a multiple of SEED_STEP, so the wrapped sequence doesn't repeat quickly
const LATTICE_WRAP = 256; // the shader folds lattice corners into [0, LATTICE_WRAP) before hashing, for the same precision reason
const SEED_SMOOTH_RATE = 0.15; // per second at Drift speed=1 — the flicker=0 fallback's continuous glide rate
const SLOW_RATE = 0.12; // per second at Drift speed=1 — accumulation rate of the persistent (uSlowT) noise component

// Intro ramp ---------------------------------------------------------------
const INTRO_SEC = 6; // elapsed seconds since this scene mounted before the warp reaches full depth
const ENERGY_DEPTH_FLOOR = 0.6; // share of Warp depth kept at zero energy; the rest follows frame.energy, so quiet passages pale the clouds without flattening them

// Blackout (a whole-field half-period phase jump) ---------------------------
const BLACKOUT_SEC = 0.05; // how long the phase jump holds before releasing
const BLACKOUT_PHASE_OFFSET = 0.5; // half a period — flips every gap to ink and every ink run to a gap
const LOW_ONSET_BLACKOUT_CHANCE = 0.015; // per-lowOnset base chance at blackout=1, kept small so these stay as rare as the reference's

// Curtain (quiet-passage reveal) --------------------------------------------
const QUIET_HOLD_SEC = 4; // how long sectionIntensity must stay under threshold before the curtain starts rising
const CURTAIN_UP_PER_SEC = 0.045; // matches the reference's measured reveal rate
const CURTAIN_DOWN_PER_SEC = 0.15; // dropping back onto loud material snaps the curtain shut faster than it rose
const CURTAIN_QUIET_THRESHOLD_SCALE = 0.4; // curtain (0..1) scaled into a sectionIntensity threshold; 0 -> threshold 0 -> never quiet enough
const CURTAIN_EDGE_GAIN = 1.05; // slight overshoot past 1 so a full reveal finishes covering the very top edge
const CURTAIN_EDGE_WOBBLE = 0.03; // small fbm-driven waviness on the reveal edge, matching the reference's uneven boundary

const SETTINGS: SceneSetting[] = [
  {
    key: "lines",
    label: "Lines",
    description: "How many grating lines fit down the frame's height",
    group: "Form",
    min: 40,
    max: 180,
    step: 1,
    default: 90,
    // A busy mix reads better with a finer grid — no single line dominates.
    auto: { density: 0.2 },
  },
  {
    key: "scale",
    label: "Cloud size",
    description: "How large the dark clouds read against the frame",
    group: "Form",
    min: 0.4,
    max: 3,
    step: 0.05,
    default: 1,
    // Dense, busy music reads better with several small clouds than one dominant one.
    auto: { density: -0.2 },
  },
  {
    key: "depth",
    label: "Warp depth",
    description: "How far the second grating displaces from the first, in periods",
    group: "Form",
    min: 0,
    max: 6,
    step: 0.05,
    // Several periods, not one: the phase has to wrap across a cloud for
    // broad anti-phase (dark) regions to form — at about one period the dark
    // state is only reached along thin contours and the picture stays pale.
    default: 2.6,
    // Loud, dynamic passages warrant deeper, more contrasty clouds.
    auto: { loudness: 0.3, dynamics: 0.2 },
  },
  {
    key: "duty",
    label: "Ink width",
    description: "Fraction of each period drawn as ink",
    group: "Form",
    min: 0.3,
    max: 0.8,
    step: 0.05,
    default: 0.5,
    // A real, tunable constant most people will only ever leave alone.
    advanced: true,
  },
  {
    key: "flicker",
    label: "Re-roll rate",
    description: "How often the noise field re-rolls, in Hz — 0 drifts smoothly instead of stepping",
    group: "Motion",
    min: 0,
    max: 60,
    step: 1,
    default: 30,
    // A locked tempo reads as a faster shimmer; without one this sits at its default.
    auto: { tempo: 0.3 },
  },
  {
    key: "drift",
    label: "Drift speed",
    description: "Speed of the field's slow, persistent component — and of the smooth glide when Re-roll rate is 0",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.2,
    auto: { tempo: 0.2 },
  },
  {
    key: "beatDip",
    label: "Beat dip",
    description: "Each beat briefly dips the warp depth, then recovers",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { pulse: 0.3 },
  },
  {
    key: "blackout",
    label: "Blackout chance",
    description: "How often a bass hit flips the whole field to its opposite phase; a section drop always does",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    auto: { attack: 0.2 },
  },
  {
    key: "curtain",
    label: "Curtain",
    description: "How readily a sustained quiet passage lifts the grating off the bottom of the frame; 0 = never",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { dynamics: 0.2 },
  },
  {
    key: "tint",
    label: "Tint",
    description: "Mixes the ink toward the palette color instead of flat black",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0,
  },
  {
    key: "ground",
    label: "Ground",
    description: "Brightness of the paper the lines sit on",
    group: "Look",
    min: 0.7,
    max: 1,
    step: 0.01,
    default: 0.91,
    advanced: true,
  },
];

const FRAG = `
// Lattice-corner hash. The corner is folded into a bounded range before any
// large multiply: the fresh field's coordinates carry uSeed, and a fract() of
// a coordinate in the thousands times a constant in the hundreds has no
// mantissa left — that showed up as hard vertical seams along lattice edges.
float hash12(vec2 i) {
  vec2 p = mod(i, ${LATTICE_WRAP.toFixed(1)}) / ${LATTICE_WRAP.toFixed(1)};
  p = fract(p * vec2(419.2, 371.9));
  p += dot(p, p + 19.19);
  return fract(p.x * p.y);
}

// Standard value noise: hash the lattice corners, smooth-blend between them.
// Independent implementation (own hash constants, own blend), not ported.
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 2.0 - 1.0; // [-1, 1]
}

// Two octaves only, the second held well down: the reference's clouds carry
// one or two broad rings each, and every extra octave of detail in the
// displacement adds a wrap — a third octave drew a thicket of thin contours.
float fbm(vec2 p) {
  return 0.7 * vnoise(p) + 0.3 * vnoise(p * 2.03 + 7.7);
}

// A single grating's ink at phase phi: dark (1) for the first uDuty share of
// each period, light (0) the rest, anti-aliased by the phase's own screen
// derivative rather than a fixed pixel width.
float grating(float phi) {
  float aa = max(fwidth(phi), 0.0008);
  return 1.0 - smoothstep(uDuty - aa, uDuty + aa, fract(phi));
}

void main() {
  vec2 uv = roomUv(vUv);
  vec2 aspect = vec2(uResolution.x / uResolution.y, 1.0);
  vec2 p = (uv - 0.5) * aspect * 2.0; // half-heights: |p.y| == 1 at the top/bottom edge

  // Screen pixels, like riso.ts's halftone grid, so the line spacing stays
  // physically fixed to the display regardless of the room canvas size.
  float periodPx = uResolution.y / uLines;

  float wobble = ${WOBBLE.toFixed(3)} * fbm(vec2(p.x * 0.6, uSlowT * 0.3));
  float phiA = gl_FragCoord.y / periodPx + wobble;

  // The displaced grating: a slow persistent component (uSlowT) blended with
  // a fast-reseeding one (uSeed) — see advanceFlicker for how uSeed steps or
  // glides.
  vec2 q = p * uScale * ${NOISE_BASE_FREQ.toFixed(2)};
  float slow = fbm(q + vec2(0.0, uSlowT));
  float fresh = fbm(q * 1.3 + vec2(uSeed, -uSeed * 0.7));
  float n = mix(slow, fresh, ${FRESH_MIX.toFixed(2)});

  float phiB = phiA + uDepth * uDepthEnv * n + uBlackoutPhase;

  // Below a few pixels per period the grating aliases against the pixel
  // grid itself; fade both toward their own mean (duty) instead.
  float aaFade = smoothstep(${AA_FADE_LOW_PX.toFixed(1)}, ${AA_FADE_HIGH_PX.toFixed(1)}, periodPx);
  float inkA = mix(uDuty, grating(phiA), aaFade);
  float inkB = mix(uDuty, grating(phiB), aaFade);

  float shade = (1.0 - inkA * ${INK_A.toFixed(2)}) * (1.0 - inkB * ${INK_B.toFixed(2)});
  vec3 monoCol = vec3(uGround) * shade;
  vec3 tintCol = palette(0.5, uPalA, uPalB, uPalC, uPalD);
  // At uTint=0 this is bit-identical to monoCol — the measured monochrome look.
  vec3 col = mix(monoCol, mix(vec3(uGround), tintCol, 1.0 - shade), uTint);

  // Curtain: below curtainTop (measured up from the frame's bottom, uv.y=0)
  // the lines give way to plain ground, the reveal's edge softened by fwidth
  // and given a small waviness of its own.
  float curtainWobble = ${CURTAIN_EDGE_WOBBLE.toFixed(3)} * fbm(vec2(p.x * 0.5, uSlowT * 0.2));
  // The waviness only exists once the curtain is actually up: unscaled it
  // left a thin strip of bare ground along the bottom edge at level 0.
  curtainWobble *= smoothstep(0.0, 0.05, uCurtainLevel);
  float curtainTop = clamp(uCurtainLevel * ${CURTAIN_EDGE_GAIN.toFixed(2)} + curtainWobble, 0.0, 1.3);
  float edgeAA = max(fwidth(uv.y), 0.0015) * 1.5;
  float groundMix = smoothstep(-edgeAA, edgeAA, curtainTop - uv.y);

  vec3 finalColor = mix(col, vec3(uGround), groundMix);
  outColor = vec4(finalColor, 1.0);
}
`;

export interface FlickerState {
  seed: number;
  timer: number;
}

export function createFlickerState(): FlickerState {
  return { seed: 0, timer: 0 };
}

/**
 * Advances uSeed. At rateHz>0 this is a pure step accumulator: seed jumps by
 * SEED_STEP every 1/rateHz seconds — the measured re-roll cadence — and
 * holds flat between jumps. At rateHz<=0 ("smooth mode") there is no timer
 * at all: seed instead advances continuously at SEED_SMOOTH_RATE*driftSpeed,
 * so turning Re-roll rate down to 0 stops the jump-cuts without freezing the
 * field outright. Pure aside from `st`; exported for tests/moire.test.ts.
 */
export function advanceFlicker(st: FlickerState, dtSec: number, rateHz: number, driftSpeed: number): number {
  if (rateHz <= 0) {
    st.timer = 0;
    st.seed = (st.seed + dtSec * driftSpeed * SEED_SMOOTH_RATE) % SEED_WRAP;
    return st.seed;
  }
  const period = 1 / rateHz;
  st.timer += dtSec;
  while (st.timer >= period) {
    st.timer -= period;
    st.seed = (st.seed + SEED_STEP) % SEED_WRAP;
  }
  return st.seed;
}

/**
 * 0 at scene start, ramping linearly to 1 over INTRO_SEC and clamped there
 * after — the reference's own scripted amplitude ramp (see file header),
 * reproduced on this scene's own elapsed-time clock rather than the track's.
 * Pure, stateless.
 */
export function introRamp(elapsedSec: number): number {
  if (elapsedSec <= 0) return 0;
  const t = elapsedSec / INTRO_SEC;
  return t >= 1 ? 1 : t;
}

export interface BlackoutState {
  timer: number;
}

export function createBlackoutState(): BlackoutState {
  return { timer: 0 };
}

/**
 * A drop always fires the phase jump; an ordinary lowOnset fires it with a
 * small chance scaled by `blackout` (0 disables it outright, without ever
 * consulting `rng`) — see LOW_ONSET_BLACKOUT_CHANCE. `dropOnset`/`lowOnset`
 * are read as the already edge-latched booleans animClock.ts hands scenes,
 * the same contract caustics.ts's advanceLurch uses for its own `fired`
 * parameter — no re-detection here. `rng` defaults to Math.random and exists
 * to be overridden by tests, the same reason ambience.ts's pools take one.
 * Pure aside from `st`.
 */
export function advanceBlackout(
  st: BlackoutState,
  dtSec: number,
  dropOnset: boolean,
  lowOnset: boolean,
  blackout: number,
  rng: () => number = Math.random,
): number {
  const fire = dropOnset || (lowOnset && blackout > 0 && rng() < blackout * LOW_ONSET_BLACKOUT_CHANCE);
  if (fire) st.timer = BLACKOUT_SEC;
  else st.timer = Math.max(0, st.timer - dtSec);
  return st.timer > 0 ? BLACKOUT_PHASE_OFFSET : 0;
}

export interface CurtainState {
  level: number;
  quietSec: number;
}

export function createCurtainState(): CurtainState {
  return { level: 0, quietSec: 0 };
}

/**
 * uCurtainLevel: 0 until sectionIntensity has sat under a curtain-scaled
 * threshold for QUIET_HOLD_SEC, then rises at CURTAIN_UP_PER_SEC. Going loud
 * again — or a drop, regardless of how quiet the room reads at that exact
 * instant — pulls it back down at the faster CURTAIN_DOWN_PER_SEC. `curtain`
 * at 0 scales the threshold itself to 0, so nothing short of true silence
 * ever reads as quiet — the setting's own "0 = never" contract falls out of
 * that with no special case needed here. Pure aside from `st`.
 */
export function advanceCurtain(
  st: CurtainState,
  dtSec: number,
  sectionIntensity: number,
  curtain: number,
  dropOnset: boolean,
): number {
  const threshold = curtain * CURTAIN_QUIET_THRESHOLD_SCALE;
  const quiet = sectionIntensity < threshold;
  st.quietSec = quiet ? st.quietSec + dtSec : 0;

  if (dropOnset || !quiet) {
    st.level = Math.max(0, st.level - CURTAIN_DOWN_PER_SEC * dtSec);
  } else if (st.quietSec >= QUIET_HOLD_SEC) {
    st.level = Math.min(1, st.level + CURTAIN_UP_PER_SEC * dtSec);
  }
  return st.level;
}

export const moireScene = createFullscreenScene("moire", "Moiré", FRAG, {
  settings: SETTINGS,
  extraUniformDecls: `uniform float uSeed;\nuniform float uSlowT;\nuniform float uDepthEnv;\nuniform float uBlackoutPhase;\nuniform float uCurtainLevel;`,
  extraUniforms: (() => {
    let elapsedSec = 0;
    let slowT = 0;
    const flicker = createFlickerState();
    const blackout = createBlackoutState();
    const curtain = createCurtainState();

    return (frame, anim, getSetting) => {
      elapsedSec += anim.dtSec;
      const drift = getSetting("drift");
      slowT += anim.dtSec * drift * SLOW_RATE;

      const seed = advanceFlicker(flicker, anim.dtSec, getSetting("flicker"), drift);
      const depthEnv =
        introRamp(elapsedSec) * (ENERGY_DEPTH_FLOOR + (1 - ENERGY_DEPTH_FLOOR) * frame.energy) * (1 - getSetting("beatDip") * anim.beatPulse);
      const blackoutPhase = advanceBlackout(blackout, anim.dtSec, anim.dropOnset, anim.lowOnset, getSetting("blackout"));
      const curtainLevel = advanceCurtain(curtain, anim.dtSec, anim.sectionIntensity, getSetting("curtain"), anim.dropOnset);

      return {
        uSeed: seed,
        uSlowT: slowT,
        uDepthEnv: depthEnv,
        uBlackoutPhase: blackoutPhase,
        uCurtainLevel: curtainLevel,
      };
    };
  })(),
});
