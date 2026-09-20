import { NUM_BANDS } from "../../audio/types.ts";
import { createProgram, createFullscreenQuad, drawFullscreenQuad, type GLProgram } from "../gl.ts";
import type { SceneSetting } from "../sceneSettings.ts";
import { resolveSceneSetting } from "../autoTune.ts";
import type { Scene, SceneContext } from "../scene.ts";
import { COMMON_UNIFORMS_GLSL, ROOM_UV_GLSL, settingUniformName, uploadCommonUniforms } from "../sceneCommon.ts";
import type { QualityPreset } from "../quality.ts";

// Pour: an acrylic paint pour, driven by music.
//
// The reference is a single measured still, not a video — a macro shot of
// an acrylic pour: a pale lavender-pink cell mosaic (Ground, in the display
// pass below), crimson ink rivers pooling into a dark network, a couple of
// glass beads, a few olive oily streaks, and a faint scatter of white
// speckle. Because there is no clip to watch, only the *picture* was
// measured — this file's constants are where that measurement landed
// (named rather than tabulated, per CLAUDE.md's rule against writing down
// counts: see CELL_A/CELL_B/CELL_C, INK_STOP1..3, SPECKLE_BASE and friends
// below). Every *motion* and every audio mapping — how a beat becomes a
// drop, how the dye flows, what breathes on a bar — is this file's own
// authored choice, the same honesty petri.ts's header states for its six
// silent references: there is nothing to measure a motion or a mapping
// against, so don't pretend otherwise.
//
// Structure: two ping-pong RGBA8 "dye" textures (R = crimson ink density,
// G = olive/oil density, B = freshness — a stamp is glossy and bright for a
// few seconds, then dries dark and matte, A unused) on a square sim-space
// torus, LINEAR + REPEAT — see physarum.ts's header for why CLAMP_TO_EDGE
// would smear a wrapping field's own seam into the picture instead of
// letting it wrap cleanly. A third scratch texture (dyeTemp) holds the
// advection predictor's output. dyeSide(), like physarum.ts's trailSide(),
// sizes that square from the quality preset and is re-checked every frame
// (ensureDyeTargets) because the quality governor moves renderScale (and so
// the canvas' own backing-store size) at runtime, not because the preset
// label itself changes mid-session.
//
// Advection is two-pass MacCormack, not one: a single pass that back-traces
// and resamples its OWN source is plain semi-Lagrangian wearing
// MacCormack's name, and it smears every thin line soft — the lesson Neon
// Fluid's header already paid for. Real MacCormack needs the backward
// trace's result held somewhere a second pass can still see while it
// retraces forward from it, so SIM_PREDICTOR_FRAG writes phiHat = A(dye)
// (dye sampled at the back-traced departure point) into dyeTemp, and
// SIM_CORRECTOR_FRAG alone advances the dye texture: it reads dyeTemp at
// the fragment's own position (phiHat) and at the position one step
// forward (phiTilde — the "what would phiHat look like if we undid the
// trace" check), corrects toward `phiHat + 0.5*(dye - phiTilde)`, then
// clamps that correction to the min/max of the four dye texels around the
// back-traced departure point — the limiter that keeps a MacCormack
// overshoot from ringing a channel out of its 0..1 range. Fade and the
// beat's stamps ride along inside that same corrector pass, since both are
// per-texel effects that need no second sample of their own.
//
// velocity() (shared by both sim passes) has no memory of the dye at all —
// every term is a pure function of position and the render clock. Three
// terms sum together: a slow curl-noise stir (`stir`), a pull toward the
// Ground's own cushion-cell borders (`lacing`, along -grad(F2-F1) of the
// same warped Voronoi cushionVor() the display pass paints the mosaic from,
// so veins and borders coincide), and a short-lived radial shove from the
// last crimson drop (`shove`). The balance between the first two is the
// look. The stir must dominate: a steady incompressible flow carries a blob
// round its streamlines, and that is what stretches a drop into a river and
// winds its tip into the reference's spiral curls. The lacing pull is
// deliberately NOT divergence-free — a pour's ink thins in the middle of a
// cell and piles up along the seams — but it is direction-only, slower than
// the stir (LACING_SPEED against STIR_BASE_SPEED) and confined to a narrow
// band beside each border (LACING_TRAP). The first build had it an order of
// magnitude stronger and reaching across the whole cell: every border became
// a wall the flow could not cross, and ink filled cells as hard-edged
// polygons with no rivers at all. The shove is kept weak for a related
// reason: a diverging flow under semi-Lagrangian advection manufactures dye,
// so a strong one balloons the pool on every kick.
//
// Everything procedural is tileable (vnoiseT/fbmT/voronoiT take a period,
// and every frequency is a whole number of periods across the field):
// the dye wraps on a torus and the camera pans across that wrap, so any
// non-periodic noise shows as a seam on screen and as a velocity jump in
// the sim.
//
// The Ground is two layers: warped-Voronoi cushions, and beside some of
// their borders a band of foam (finer cells, lighter, where the speckle
// lives). Two warp scales matter — without the fine, per-cell one every
// border is a ruled line and the mosaic reads as cracked glass.
//
// The drain is slower where the ink is thin (STAIN_FADE_FLOOR), so a river
// leaves a rose stain behind it rather than vanishing edge-first; that
// stain is where the reference's broad band of rose midtones comes from.
//
// Fades (ink and freshness alike) are dithered subtractive steps —
// `if (hash21(...) < prob) c -= 1/255` — never a multiply and never a bare
// small subtract. RGBA8 rounds to nearest on write: a multiplicative decay
// stalls the instant `round(c * decay) == c`, and a fixed subtract below
// one quantisation step rounds straight back to where it started, so
// either way an old drop leaves a permanent stain that never clears
// (physarum.ts's evaporation comment fights the same failure). Dithering
// *whether* to take a whole step, rather than shrinking the step itself, is
// what lets the drain stay gentle without ever stalling.
//
// Every stamp (createDropGate) is gated the way shards/layout.ts's
// minHoldSec learned to gate cuts: firing a drop on every kick reads about
// twice as busy as a pour actually behaves, so a crimson drop respects a
// minimum gap — tempo-derived once a beat is locked, a flat floor
// otherwise — and a silent-audio fallback timer keeps a beatless room from
// staying blank forever. nozzlePosition() gives successive drops a slowly
// wandering, not-scattered, landing point, so the flow has a chance to draw
// them into one river network rather than confetti.
const ID = "pour";

const TWO_PI = Math.PI * 2;

// --- Dye field sizing (dyeSide) ---------------------------------------
// One square side per quality preset, clamped down to whatever the actual
// canvas backing store can show — no point simulating a field bigger than
// the screen that will ever sample it (physarum.ts's trailSide is the same
// shape, against agent density instead of a fixed preset table).
const DYE_SIDE_TABLE: Record<QualityPreset, number> = { high: 1024, mid: 768, low: 512, floor: 384 };
/** Absolute floor regardless of how small the screen is. */
export const DYE_SIDE_MIN = 128;

export function dyeSide(preset: QualityPreset, maxDim: number): number {
  const table = DYE_SIDE_TABLE[preset] ?? DYE_SIDE_TABLE.floor;
  const cap = Number.isFinite(maxDim) && maxDim > 0 ? Math.floor(maxDim) : table;
  return Math.max(DYE_SIDE_MIN, Math.min(table, cap));
}

// --- Drop gate (createDropGate) ---------------------------------------
const CRIMSON_MIN_GAP_FLOOR_SEC = 0.25;
const CRIMSON_MIN_GAP_BEAT_FRAC = 0.6;
const CRIMSON_MIN_GAP_UNLOCKED_SEC = 0.35;
const CRIMSON_TEMPO_LOCK_MIN = 0.35;
/** No crimson stamp in this long -> stamp anyway, so silence or a beatless
 *  synthetic track can't leave the pour blank forever. */
export const FALLBACK_STAMP_SEC = 8;
/** Olive is an accent (a rounding error of the reference's area), so high
 *  onsets closer together than this are ignored. */
export const OLIVE_MIN_GAP_SEC = 4;

export interface DropGate {
  /** Advances the gate by `dt` seconds and decides whether this frame
   *  stamps crimson (gated on `lowOnset`, the tempo-derived minimum gap,
   *  `dropsAmount`'s probability, and the silent fallback) and/or olive
   *  (on `highOnset`, no more often than OLIVE_MIN_GAP_SEC — an accent). `rng` is injected so the probability roll is testable;
   *  callers pass Math.random. */
  advance(
    dt: number,
    lowOnset: boolean,
    highOnset: boolean,
    tempoLock: number,
    bpm: number,
    dropsAmount: number,
    rng: () => number,
  ): { crimson: boolean; olive: boolean };
}

function crimsonMinGapSec(tempoLock: number, bpm: number): number {
  if (tempoLock >= CRIMSON_TEMPO_LOCK_MIN && bpm > 0) {
    return Math.max(CRIMSON_MIN_GAP_FLOOR_SEC, CRIMSON_MIN_GAP_BEAT_FRAC * (60 / bpm));
  }
  return CRIMSON_MIN_GAP_UNLOCKED_SEC;
}

export function createDropGate(): DropGate {
  let sinceCrimson = 0;
  let hasStamped = false;
  let sinceOlive = OLIVE_MIN_GAP_SEC;
  return {
    advance(dt, lowOnset, highOnset, tempoLock, bpm, dropsAmount, rng) {
      const d = Number.isFinite(dt) && dt > 0 ? dt : 0;
      sinceCrimson += d;
      // Nothing stamped yet means there's no prior drop to be "too close"
      // to — the very first kick must always be allowed through.
      const gapOk = !hasStamped || sinceCrimson >= crimsonMinGapSec(tempoLock, bpm);
      let crimson = false;
      if (lowOnset === true && gapOk && dropsAmount > 0 && rng() < dropsAmount) {
        crimson = true;
      } else if (sinceCrimson >= FALLBACK_STAMP_SEC) {
        crimson = true;
      }
      if (crimson) {
        sinceCrimson = 0;
        hasStamped = true;
      }
      sinceOlive += d;
      const olive = highOnset === true && sinceOlive >= OLIVE_MIN_GAP_SEC;
      if (olive) sinceOlive = 0;
      return { crimson, olive };
    },
  };
}

// --- Nozzle wander (nozzlePosition) -----------------------------------
// A slowly wandering point: a big, slow Lissajous carries it around the
// field over NOZZLE_PERIOD_SEC, and a small hash jitter keyed on the gate's
// epoch (how many crimson stamps have landed so far) nudges it a little at
// each new drop. Because the jitter is small next to how far the Lissajous
// itself moves between two drops a beat apart, consecutive drops land near
// each other — close enough for the flow to draw them into one network
// instead of scattering them like confetti.
const NOZZLE_PERIOD_SEC = 40;
const NOZZLE_CENTER = 0.5;
const NOZZLE_RADIUS_X = 0.28;
const NOZZLE_RADIUS_Y = 0.24;
const NOZZLE_RATE_X = 1;
const NOZZLE_RATE_Y = 0.63; // incommensurate with RATE_X so the path never retraces itself
const NOZZLE_PHASE_Y = 1.7;
const NOZZLE_JITTER = 0.07;

/** A generic shader-style scalar hash, independent of the GLSL hash21 this
 *  file copies from kaleido/glsl.ts below — this one only ever runs in JS,
 *  seeded by an integer epoch rather than a screen position. */
function hashScalar(n: number, salt: number): number {
  const x = Math.sin(n * 12.9898 + salt * 78.233) * 43758.5453123;
  return x - Math.floor(x);
}

function wrap01(v: number): number {
  return v - Math.floor(v);
}

export function nozzlePosition(t: number, epoch: number): [number, number] {
  const time = Number.isFinite(t) ? t : 0;
  const ep = Number.isFinite(epoch) ? epoch : 0;
  const phase = (time / NOZZLE_PERIOD_SEC) * TWO_PI;
  const cx = NOZZLE_CENTER + NOZZLE_RADIUS_X * Math.sin(phase * NOZZLE_RATE_X);
  const cy = NOZZLE_CENTER + NOZZLE_RADIUS_Y * Math.sin(phase * NOZZLE_RATE_Y + NOZZLE_PHASE_Y);
  const jx = hashScalar(ep, 1);
  const jy = hashScalar(ep, 2);
  return [wrap01(cx + (jx - 0.5) * NOZZLE_JITTER), wrap01(cy + (jy - 0.5) * NOZZLE_JITTER)];
}

// --- Glass beads (beadPositions) --------------------------------------
/** Uniform-array budget in DISPLAY_FRAG; beadPositions never exceeds it. */
export const BEAD_MAX = 4;
const BEAD_RING_CENTER = 0.5;
const BEAD_RING_RADII = [0.16, 0.22, 0.28, 0.34];
const BEAD_RING_RATES = [0.012, 0.016, 0.02, 0.024]; // rad/s — a slow wander, physarum.ts's attractorPositions shape
/** Sim-space fraction — the reference's beads read roughly this large
 *  against the frame's half-height. */
const BEAD_RADIUS_UNIT = 0.016;
const BEAD_RADIUS_JITTER = 0.25;

export interface BeadPos {
  x: number;
  y: number;
  r: number;
  seed: number;
}

export function beadPositions(t: number, count: number): BeadPos[] {
  const time = Number.isFinite(t) ? t : 0;
  const n = Math.max(0, Math.min(BEAD_MAX, Math.round(Number.isFinite(count) ? count : 0)));
  const out: BeadPos[] = [];
  for (let i = 0; i < n; i++) {
    const ph = time * BEAD_RING_RATES[i] + (i * TWO_PI) / BEAD_MAX;
    const x = wrap01(BEAD_RING_CENTER + Math.cos(ph) * BEAD_RING_RADII[i]);
    const y = wrap01(BEAD_RING_CENTER + Math.sin(ph) * BEAD_RING_RADII[i]);
    const r = BEAD_RADIUS_UNIT * (1 - BEAD_RADIUS_JITTER / 2 + BEAD_RADIUS_JITTER * hashScalar(i, 3.7));
    out.push({ x, y, r, seed: i / BEAD_MAX });
  }
  return out;
}

// --- Stamp shape/injection (shared by JS packing and the corrector shader) ---
/** Slots in the corrector's uStamps array — a crimson drop and an olive
 *  drop can coexist in the same frame, never more than one of each. */
const STAMP_MAX = 2;
const STAMP_KIND_CRIMSON = 0;
const STAMP_KIND_OLIVE = 1;
/** Radius = dropSize * (DROP_RADIUS_FLOOR + DROP_RADIUS_PULSE_GAIN * lowPulse).
 *  Small relative to a cushion cell (cellFreq() ~ 8 cells across the field,
 *  so a cell is roughly 0.125 wide) on purpose: a drop is a small dot the
 *  flow then draws into a vein, not a blob already the size of a cell. */
const DROP_RADIUS_BASE = 0.035;
const DROP_RADIUS_FLOOR = 0.6;
const DROP_RADIUS_PULSE_GAIN = 0.8;
const OLIVE_RADIUS_BASE = 0.012;
const STAMP_CORE_FRAC = 0.35; // inner edge as a fraction of the outer, for the soft falloff
const STAMP_INK_GAIN = 0.7;
// Small: olive is "an accent, not a channel to fill" (the file header) —
// a highOnset-gated stamp fires far more often than a lowOnset-gated one,
// so its per-stamp weight has to be proportionally lighter.
const STAMP_OLIVE_GAIN = 0.16;
/** The olive channel (G) drains faster than ink (R) — see the file
 *  header's "accent, not a channel to fill". */
const OLIVE_FADE_MULT = 6;
const JAG_FREQ = 5;
const JAG_AMOUNT = 0.35;
const JAG_SEED_SCALE = 23;
const OLIVE_ELONGATION = 2.4;

// --- Shove (beat radial push) -----------------------------------------
const SHOVE_SPEED = 0.06;
const SHOVE_RADIUS = 0.08;
const SHOVE_DECAY_PER_SEC = 1.1; // exponential decay — a shove lasts a couple of seconds

// --- Velocity field: stir (slow eddies) -------------------------------
const STIR_BASE_SPEED = 0.02; // "order 0.02 field/s" — see the file header
const STIR_SECTION_GAIN = 1;
const SWIRL_FREQ = 3;
const CURL_EPS = 0.01;

// --- Velocity field: lacing (converging pull to cell borders) --------
const CELL_FREQ_BASE = 18;
const SUBCELL_MULT = 4;
const WARP_FREQ = 3;
const WARP_AMOUNT = 0.1;
const DRIFT_VX = 0.017;
const DRIFT_VY = 0.012;
const GRAD_EPS = 0.003;
// The second, finer warp scale — see cushionWarp() in POUR_GLSL.
const WARP_FINE_FREQ = 2;
const WARP_FINE_AMOUNT = 0.55;
// Period handed to the non-tiling fbm() wrapper: large enough never to
// repeat on screen, small enough that mod() stays exact in a float.
const FBM_FREE_PERIOD = 4096;
// Wide enough that most of a cell's interior (not just the sliver right
// against its border) feels a pull toward the nearest seam — too narrow a
// trap leaves ink stamped mid-cell with nothing to migrate on, so it just
// sits and grows into a blob instead of draining into a vein.
const LACING_TRAP = 0.18;
const LACING_SPEED = 0.02;

// --- Fade (dithered subtractive drain — see the file header) ---------
const FADE_RATE_MAX = 9; // per-second dither-check rate at fade = 1
const FRESH_FADE_MULT = 10;
const STAIN_FADE_FLOOR = 0.2; // see the corrector's fade block // freshness fades roughly this much faster than ink

// --- Camera pan (drift) and zoom breathe ------------------------------
const PAN_RATE = 0.05; // phase-accumulator rate at drift = 1 — petri.ts's driftAngle shape
const PAN_FREQ_X = 1;
const PAN_FREQ_Y = 0.7;
const PAN_PHASE_Y = 1.3;
const PAN_AMOUNT = 0.12;
const BREATHE_SWING = 0.06;

// --- Ground: cushion + subcell shading --------------------------------
const CUSHION_RIM_WIDTH = 0.3;
const CUSHION_CENTRE_LIFT = 1.06;
const CUSHION_RIM_DARKEN = 0.91;
const CELL_MAUVE_SHARE = 0.12;
const CELL_MAUVE_MIX = 0.3;
const MOTTLE_FREQ = 64;
const MOTTLE_LUMA_GAIN = 0.04;
const LACING_WIDTH_PX = 2;
// Foam: bands of sub-cells that replace the cushion beside some borders —
// the reference's froth of tiny cells and white specks between the big ones.
// FOAM_NOISE_* gates where a band exists at all; FOAM_WIDTH is its reach
// into the cushion, in cushion-cell units.
const FOAM_NOISE_FREQ = 5;
const FOAM_NOISE_LO = 0.5;
const FOAM_NOISE_HI = 0.8;
const FOAM_WIDTH = 0.2;
const FOAM_RIM_DARKEN = 0.9;
const FOAM_CENTRE_LIFT = 1.05;
const FOAM_SPECKLE_FLOOR = 0.12; // speckle share outside the foam, relative to inside
// Emboss: the cushion rim lit from the top-left, so a cell reads as a soft
// pillow rather than a flat tile.
const EMBOSS_GAIN = 0.05;
const EMBOSS_CLAMP = 1.5;
// Nucleus: the pink blot sitting at the middle of many reference cells.
const NUCLEUS_SHARE = 0.5;
const NUCLEUS_R = 0.24;
const NUCLEUS_MIX = 0.55;
// Beads: lens magnification at the centre, and the caustic crescent on the
// side away from the light.
const BEAD_LENS_CENTRE = 0.45;
const BEAD_CRESCENT_GAIN = 0.22;
const LACING_MIN_WIDTH = 0.0015;
const LACING_DARKEN = 0.2;

// --- Ink composite -----------------------------------------------------
const INK_STOP1 = 0.15;
const INK_STOP2 = 0.5;
const INK_STOP3 = 0.85;
const FRESH_LIFT = 0.35;

// --- Speckle -------------------------------------------------------------
const SPECKLE_FREQ = 220;
// Tuned against measure_pour.py's speckle_share (reference ~0.24% of
// pixels) — the first pass at 0.06 landed over 10x too high.
const SPECKLE_BASE = 0.1;
const SPECKLE_SPARKLE_GAIN = 0.01;

// --- Bubbles (fresh, saturated ink only) --------------------------------
const BUBBLE_FREQ = 34;
const BUBBLE_BASE = 0.05;
const BUBBLE_HIGH_GAIN = 0.6;
const BUBBLE_INK_MIN = 0.7;
const BUBBLE_FRESH_MIN = 0.4;
const BUBBLE_R = 0.34;
const BUBBLE_RING_W = 0.08;
const BUBBLE_SPEC_R = 0.09;

// --- Olive rim -----------------------------------------------------------
const OLIVE_RIM_GAIN = 3;

// --- Wet rim (gloss) -----------------------------------------------------
const WETRIM_GRAD_SCALE = 10;
const WETRIM_SPEC_POWER = 10;
const WETRIM_SPEC_GAIN = 0.4;
const WETRIM_DARK_GAIN = 0.25;

// --- Beads (display) ------------------------------------------------------
const BEAD_BRIGHTEN = 1.08;
const BEAD_RIM_FRAC = 0.12; // as a fraction of the bead's own radius

function normalize3(x: number, y: number, z: number): [number, number, number] {
  const m = Math.hypot(x, y, z) || 1;
  return [x / m, y / m, z / m];
}
const WETRIM_LIGHT = normalize3(-0.5, 0.6, 0.55);

// Measured/authored colours (see the file header for why these are named
// constants rather than a table): the pale cushion ground, the crimson ink
// ramp, freshness, olive, and the ground's own lacing tint.
const CELL_A: [number, number, number] = [0.7529, 0.7216, 0.9176]; // #c0b8ea
const CELL_B: [number, number, number] = [0.6549, 0.5961, 0.8039]; // #a798cd
const CELL_C: [number, number, number] = [0.62, 0.55, 0.74]; // #8a759c
const CELL_MAUVE: [number, number, number] = [0.4863, 0.3608, 0.4902]; // #7c5c7d
const LACING_TINT: [number, number, number] = [0.42, 0.4, 0.38];
const FOAM_A: [number, number, number] = [0.86, 0.83, 0.95];
const FOAM_B: [number, number, number] = [0.76, 0.71, 0.89];
const NUCLEUS_COL: [number, number, number] = [0.66, 0.31, 0.44]; // #a8506f
const CRIMSON_LOW: [number, number, number] = [0.87, 0.58, 0.62]; // translucent pink-magenta multiply tint (authored)
const CRIMSON_MID: [number, number, number] = [0.4863, 0.1647, 0.2275]; // #7c2a3a
const CRIMSON_DARK: [number, number, number] = [0.1725, 0.0392, 0.0941]; // #2c0a18
const FRESH_RED: [number, number, number] = [0.5451, 0.102, 0.1647]; // #8b1a2a-ish
const OLIVE_COL: [number, number, number] = [0.4314, 0.3843, 0.2196]; // #6e6238
const OLIVE_RIM_COL: [number, number, number] = [0.85, 0.8, 0.35];

function settingFor(key: string): SceneSetting {
  const s = SETTINGS.find((x) => x.key === key);
  if (!s) throw new Error(`pour: unknown setting ${key}`);
  return s;
}

const SETTINGS: SceneSetting[] = [
  // --- Form ---
  {
    key: "cellScale",
    label: "Cell size",
    description: "Zooms the pale cushion mosaic the ink pools between",
    group: "Form",
    min: 0.5,
    max: 2,
    step: 0.05,
    default: 1,
    auto: { density: -0.25 },
  },
  {
    key: "dropSize",
    label: "Drop size",
    description: "How big a stamp lands on each gated kick",
    group: "Form",
    min: 0.3,
    max: 2,
    step: 0.05,
    default: 1,
    auto: { loudness: 0.3, dynamics: 0.2 },
  },
  {
    key: "lacing",
    label: "Lacing",
    description: "How strongly the flow gathers ink into veins along the cell borders",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { density: 0.2 },
  },
  {
    key: "beads",
    label: "Glass beads",
    description: "How many glass beads sit in the pour",
    group: "Form",
    min: 0,
    max: BEAD_MAX,
    step: 1,
    default: 2,
    advanced: true,
  },
  // --- Motion ---
  {
    key: "stir",
    label: "Stir",
    description: "Speed of the slow eddies moving through the pour",
    group: "Motion",
    min: 0,
    max: 2,
    step: 0.05,
    default: 0.8,
    auto: { dynamics: 0.3, tempo: 0.25 },
  },
  {
    key: "drops",
    label: "Drops",
    description: "How often a gated kick actually lands a drop, from never to every one",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.7,
    reads: ["anim.lowOnset"],
    auto: { pulse: 0.3, attack: 0.25 },
  },
  {
    key: "shove",
    label: "Shove",
    description: "How hard a fresh drop pushes the flow outward",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { attack: 0.35 },
  },
  {
    key: "fade",
    label: "Fade",
    description: "How fast old ink drains back to bare ground",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.35,
    advanced: true,
  },
  // --- Look ---
  {
    key: "ink",
    label: "Ink",
    description: "Opacity and darkness of the crimson and olive dye",
    group: "Look",
    min: 0,
    max: 1.5,
    step: 0.05,
    default: 1,
    auto: { loudness: 0.25 },
  },
  {
    key: "gloss",
    label: "Gloss",
    description: "Wet specular rim on the ink and the glass beads",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    auto: { brightness: 0.3 },
  },
  {
    key: "speckle",
    label: "Speckle",
    description: "White speckle scattered over the pale ground",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    advanced: true,
    auto: { brightness: 0.2 },
  },
  // --- Camera ---
  {
    key: "zoom",
    label: "Zoom",
    description: "Base framing on the pour",
    group: "Camera",
    min: 0.6,
    max: 1.6,
    step: 0.05,
    default: 1,
  },
  {
    key: "drift",
    label: "Drift",
    description: "Pan speed as the camera wanders slowly over the pour",
    group: "Camera",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.4,
    auto: { tempo: 0.2 },
  },
  {
    key: "breathe",
    label: "Breathe",
    description: "A small zoom pulse once per bar",
    group: "Camera",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.3,
    auto: { pulse: 0.25 },
  },
];

const SETTINGS_UNIFORMS_GLSL = SETTINGS.map((s) => `uniform float ${settingUniformName(s.key)};`).join("\n");

// Shared by every pass: the canonical hash21/vnoise/fbm/voronoi this repo
// already settled on, copied verbatim from src/render/scenes/kaleido/glsl.ts
// (KALEIDO_COMMON_GLSL) rather than re-derived, per physarum.ts's own
// precedent for reusing this exact family. Everything from slowDrift()
// downward — the swirl/curl, the cushion warp/Voronoi, and velocity() — is
// this scene's own, written from the plan's definitions, never ported.
const POUR_GLSL = `
const float TWO_PI = ${TWO_PI.toFixed(6)};
const float FBM_FREE_PERIOD = ${FBM_FREE_PERIOD.toFixed(1)};

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// Tileable variants: every lattice lookup wraps at a whole period, so the
// square torus the dye lives on has no seam in the ground or the flow.
// Every frequency fed to these must therefore be a whole number of periods
// across the field.
float vnoiseT(vec2 p, float per) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash21(mod(i, per));
  float b = hash21(mod(i + vec2(1.0, 0.0), per));
  float c = hash21(mod(i + vec2(0.0, 1.0), per));
  float d = hash21(mod(i + vec2(1.0, 1.0), per));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

vec2 vnoise2T(vec2 p, float per) {
  return vec2(vnoiseT(p, per), vnoiseT(p + vec2(37.0, 11.0), per));
}

// Lacunarity is exactly two and the per-octave offset is whole, so the
// period simply doubles with the frequency.
float fbmT(vec2 p, float per) {
  float v = 0.0;
  float amp = 0.5;
  int oct = uDetail < 0.5 ? 3 : 4;
  for (int i = 0; i < 4; i++) {
    if (i >= oct) break;
    v += amp * vnoiseT(p, per);
    p = p * 2.0 + vec2(17.0, 9.0);
    per *= 2.0;
    amp *= 0.5;
  }
  return v / (1.0 - amp);
}

float fbm(vec2 p) { return fbmT(p, FBM_FREE_PERIOD); }

// Jittered-grid Voronoi, tileable at per cells: (F1, F2, cell hash) — F1/F2
// are true distances (already sqrt'd), not squared.
vec3 voronoiT(vec2 q, float per) {
  vec2 i = floor(q);
  vec2 f = fract(q);
  float f1 = 8.0;
  float f2 = 8.0;
  float id = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int k = -1; k <= 1; k++) {
      vec2 g = vec2(float(k), float(j));
      vec2 c = mod(i + g, per);
      vec2 o = vec2(hash21(c), hash21(c + 19.7));
      vec2 dd2 = g + o - f;
      float dd = dot(dd2, dd2);
      if (dd < f1) { f2 = f1; f1 = dd; id = hash21(c + 7.3); }
      else if (dd < f2) { f2 = dd; }
    }
  }
  return vec3(sqrt(f1), sqrt(f2), id);
}

// Torus-shortest offset — the field is a torus, so any displacement should
// take the short way around the wrap.
vec2 shortest(vec2 d) { return d - round(d); }

ivec2 wrapTexel(ivec2 t, int side) {
  return ivec2(mod(vec2(t), vec2(float(side))));
}

// Aspect of the whole room-space canvas, and a cover-fit of the square dye
// field across it — physarum.ts's roomAspect()/coverUv() exactly, so a
// Panorama pairing keeps every device sampling the same field and cropping
// a torus is free (no edge to expose).
float roomAspect() {
  return (uResolution.x * uViewport.w) / max(uResolution.y * uViewport.z, 1e-4);
}
vec2 coverUv(vec2 ruv) {
  float aspect = roomAspect();
  float s = max(aspect, 1.0);
  vec2 rectSize = vec2(aspect, 1.0);
  return (ruv * rectSize + (vec2(s) - rectSize) * 0.5) / s;
}

// --- This scene's own: velocity field + the shared cushion Voronoi -----

const float STIR_BASE_SPEED = ${STIR_BASE_SPEED.toFixed(5)};
const float STIR_SECTION_GAIN = ${STIR_SECTION_GAIN.toFixed(4)};
const float SWIRL_FREQ = ${SWIRL_FREQ.toFixed(4)};
const float CURL_EPS = ${CURL_EPS.toFixed(5)};
const float CELL_FREQ_BASE = ${CELL_FREQ_BASE.toFixed(4)};
const float SUBCELL_MULT = ${SUBCELL_MULT.toFixed(4)};
const float WARP_FREQ = ${WARP_FREQ.toFixed(4)};
const float WARP_AMOUNT = ${WARP_AMOUNT.toFixed(5)};
const float WARP_FINE_FREQ = ${WARP_FINE_FREQ.toFixed(4)};
const float WARP_FINE_AMOUNT = ${WARP_FINE_AMOUNT.toFixed(5)};
const float DRIFT_VX = ${DRIFT_VX.toFixed(5)};
const float DRIFT_VY = ${DRIFT_VY.toFixed(5)};
const float GRAD_EPS = ${GRAD_EPS.toFixed(5)};
const float LACING_TRAP = ${LACING_TRAP.toFixed(4)};
const float LACING_SPEED = ${LACING_SPEED.toFixed(4)};
const float SHOVE_SPEED = ${SHOVE_SPEED.toFixed(4)};
const float SHOVE_RADIUS = ${SHOVE_RADIUS.toFixed(4)};

// Large-scale drift shared by the swirl's psi and the Ground's cushion
// warp (see the file header: "the same slow drift the velocity's psi
// uses"), so cells and ink drift together rather than sliding past each
// other. Driven by uFlowPhase (the audio-warped clock), not raw uTime.
vec2 slowDrift() {
  return vec2(uFlowPhase * DRIFT_VX, uFlowPhase * DRIFT_VY);
}

float psi(vec2 p) {
  return fbmT(p * SWIRL_FREQ + slowDrift(), SWIRL_FREQ);
}

// curl(psi) = (d psi/dy, -d psi/dx), by central differences — written from
// the definition, not from any curl-noise implementation.
vec2 curlPsi(vec2 p) {
  float pyp = psi(p + vec2(0.0, CURL_EPS));
  float pym = psi(p - vec2(0.0, CURL_EPS));
  float pxp = psi(p + vec2(CURL_EPS, 0.0));
  float pxm = psi(p - vec2(CURL_EPS, 0.0));
  return vec2((pyp - pym) / (2.0 * CURL_EPS), -(pxp - pxm) / (2.0 * CURL_EPS));
}

// Domain warp applied before the cushion Voronoi lookup, at two scales: the
// coarse one stretches and squeezes whole neighbourhoods (the reference's
// wide spread of cell sizes), the fine one wobbles each border so no edge
// reads as a ruled line. Single-octave on purpose — velocity() evaluates
// this several times per texel. Fixed in sim space: the cells are the paint
// the ink sits on, so they must not slide under it.
vec2 cushionWarp(vec2 p, float freq) {
  vec2 coarse = (vnoise2T(p * WARP_FREQ, WARP_FREQ) - 0.5) * WARP_AMOUNT;
  // The fine scale rides the cell frequency (WARP_FINE_FREQ wobbles per
  // cell, WARP_FINE_AMOUNT in cell widths), so borders bend the same way
  // whatever Cell size is set to.
  float ff = freq * WARP_FINE_FREQ;
  vec2 fine = (vnoise2T(p * ff, ff) - 0.5) * (WARP_FINE_AMOUNT / freq);
  return coarse + fine;
}

// Whole cells per field side, so the mosaic tiles across the torus wrap.
float cellFreq() { return max(2.0, floor(CELL_FREQ_BASE / max(0.05, uCellScale) + 0.5)); }
float subcellFreq() { return cellFreq() * SUBCELL_MULT; }

// The cushion-layer Voronoi (F1, F2, id) at sim-space p, at the given
// frequency — shared by velocity()'s lacing pull and the display pass's
// Ground, so the cell network is fixed relative to the dye.
vec3 cushionVor(vec2 p, float freq) {
  return voronoiT((p + cushionWarp(p, freq)) * freq, freq);
}
float cushionDelta(vec2 p, float freq) {
  vec3 c = cushionVor(p, freq);
  return c.y - c.x;
}
// Forward differences: one fewer Voronoi lookup per texel than central, and
// the pull only needs a direction.
vec2 gradCushionDelta(vec2 p, float freq, float d0) {
  float dx = cushionDelta(p + vec2(GRAD_EPS, 0.0), freq);
  float dy = cushionDelta(p + vec2(0.0, GRAD_EPS), freq);
  return vec2(dx - d0, dy - d0) / GRAD_EPS;
}

// v = stir*curl(psi) + lacing*(-grad d)*smoothstep(trap,0,d) + shove — see
// the file header for why this has no memory of the dye texture at all.
vec2 velocity(vec2 p) {
  float sectionFactor = 1.0 + STIR_SECTION_GAIN * (uSectionIntensity - 0.5);
  vec2 stirV = uStir * STIR_BASE_SPEED * sectionFactor * curlPsi(p);

  float freq = cellFreq();
  float d = cushionDelta(p, freq);
  // Direction only: the pull is a fixed speed inside a narrow band beside
  // each border, well under the stir, so a border draws passing ink into a
  // vein without ever acting as a wall the flow cannot cross.
  vec2 gd = gradCushionDelta(p, freq, d);
  float gdLen = length(gd);
  vec2 gdir = gdLen > 1e-4 ? gd / gdLen : vec2(0.0);
  vec2 laceV = uLacing * LACING_SPEED * (-gdir) * smoothstep(LACING_TRAP, 0.0, d);

  vec2 sd = shortest(p - uShoveOrigin);
  float r = length(sd);
  vec2 dir = r > 1e-5 ? sd / r : vec2(0.0);
  vec2 shoveV = uShove * uShoveEnv * SHOVE_SPEED * exp(-r / SHOVE_RADIUS) * dir;

  return stirV + laceV + shoveV;
}
`;

const SIM_PREDICTOR_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
${COMMON_UNIFORMS_GLSL}
${SETTINGS_UNIFORMS_GLSL}
uniform sampler2D uDyeIn;
uniform float uSimDt;
uniform vec2 uShoveOrigin;
uniform float uShoveEnv;
${POUR_GLSL}

// Predictor: phiHat(x) = dye sampled at the back-traced departure point —
// plain semi-Lagrangian. The corrector below is what turns this into real
// MacCormack (see the file header).
void main() {
  vec2 p = vUv;
  vec2 v = velocity(p);
  vec2 back = fract(p - v * uSimDt);
  outColor = texture(uDyeIn, back);
}
`;

const SIM_CORRECTOR_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
${COMMON_UNIFORMS_GLSL}
${SETTINGS_UNIFORMS_GLSL}
uniform sampler2D uDyeIn;
uniform sampler2D uDyeTempIn;
uniform float uSide;
uniform float uSimDt;
uniform vec2 uShoveOrigin;
uniform float uShoveEnv;
uniform float uNoiseSeed;
uniform vec4 uStamps[${STAMP_MAX}];
uniform float uStampCount;
${POUR_GLSL}

const float FADE_RATE_MAX = ${FADE_RATE_MAX.toFixed(4)};
const float FRESH_FADE_MULT = ${FRESH_FADE_MULT.toFixed(4)};
const float STAIN_FADE_FLOOR = ${STAIN_FADE_FLOOR.toFixed(4)};
const float OLIVE_FADE_MULT = ${OLIVE_FADE_MULT.toFixed(4)};
const float STAMP_CORE_FRAC = ${STAMP_CORE_FRAC.toFixed(4)};
const float STAMP_INK_GAIN = ${STAMP_INK_GAIN.toFixed(4)};
const float STAMP_OLIVE_GAIN = ${STAMP_OLIVE_GAIN.toFixed(4)};
const float JAG_FREQ = ${JAG_FREQ.toFixed(4)};
const float JAG_AMOUNT = ${JAG_AMOUNT.toFixed(4)};
const float JAG_SEED_SCALE = ${JAG_SEED_SCALE.toFixed(4)};
const float OLIVE_ELONGATION = ${OLIVE_ELONGATION.toFixed(4)};
const float STAMP_KIND_OLIVE = ${STAMP_KIND_OLIVE.toFixed(1)};

void main() {
  vec2 p = vUv;
  vec2 v = velocity(p);
  vec2 back = fract(p - v * uSimDt);
  vec2 fwd = fract(p + v * uSimDt);

  vec4 phiN = texture(uDyeIn, p);
  vec4 phiHat = texture(uDyeTempIn, p);
  vec4 phiTilde = texture(uDyeTempIn, fwd);
  vec4 corrected = phiHat + 0.5 * (phiN - phiTilde);

  // Limiter: clamp to the min/max of the 4 dye texels around the
  // back-traced departure point (see the file header).
  int side = int(uSide);
  vec2 backTexel = back * uSide - 0.5;
  ivec2 base = ivec2(floor(backTexel));
  vec4 c00 = texelFetch(uDyeIn, wrapTexel(base, side), 0);
  vec4 c10 = texelFetch(uDyeIn, wrapTexel(base + ivec2(1, 0), side), 0);
  vec4 c01 = texelFetch(uDyeIn, wrapTexel(base + ivec2(0, 1), side), 0);
  vec4 c11 = texelFetch(uDyeIn, wrapTexel(base + ivec2(1, 1), side), 0);
  vec4 loC = min(min(c00, c10), min(c01, c11));
  vec4 hiC = max(max(c00, c10), max(c01, c11));
  vec4 dye = clamp(corrected, loC, hiC);

  // Fade: dithered subtractive drain — see the file header for why a plain
  // multiply or a fixed small subtract both stall on 8-bit values.
  vec2 seedP = p * uSide + uNoiseSeed;
  float fadeProb = clamp(uFade * FADE_RATE_MAX * uSimDt, 0.0, 1.0);
  float oliveFadeProb = clamp(fadeProb * OLIVE_FADE_MULT, 0.0, 1.0);
  float freshFadeProb = clamp(fadeProb * FRESH_FADE_MULT, 0.0, 1.0);
  float step8 = 1.0 / 255.0;
  // Thin ink drains slower than thick (STAIN_FADE_FLOOR of the rate at zero
  // density): a river leaves a pink stain behind it, which is where the
  // reference's wide band of rose midtones comes from.
  float inkFadeProb = fadeProb * (STAIN_FADE_FLOOR + (1.0 - STAIN_FADE_FLOOR) * dye.r);
  if (hash21(seedP) < inkFadeProb) dye.r = max(0.0, dye.r - step8);
  if (hash21(seedP + 17.0) < oliveFadeProb) dye.g = max(0.0, dye.g - step8);
  if (hash21(seedP + 31.0) < freshFadeProb) dye.b = max(0.0, dye.b - step8);

  // Injection: up to STAMP_MAX splats, jagged by fbm — a splat, not a
  // circle. Crimson adds R and sets B (freshness); olive is a small
  // elongated splat adding G.
  for (int i = 0; i < ${STAMP_MAX}; i++) {
    if (float(i) >= uStampCount) break;
    vec4 st = uStamps[i];
    vec2 sd = shortest(p - st.xy);
    float ang = atan(sd.y, sd.x);
    float jag = fbm(vec2(cos(ang), sin(ang)) * JAG_FREQ + st.xy * JAG_SEED_SCALE);
    float edge = st.z * (1.0 - JAG_AMOUNT + JAG_AMOUNT * jag);
    if (st.w < 0.5) {
      float mask = 1.0 - smoothstep(edge * STAMP_CORE_FRAC, edge, length(sd));
      dye.r = clamp(dye.r + mask * STAMP_INK_GAIN, 0.0, 1.0);
      dye.b = max(dye.b, mask);
    } else {
      float axisAngle = hash21(st.xy * 13.7) * TWO_PI;
      vec2 axis = vec2(cos(axisAngle), sin(axisAngle));
      vec2 across = vec2(-axis.y, axis.x);
      float along = dot(sd, axis) / OLIVE_ELONGATION;
      float perp = dot(sd, across);
      float ell = length(vec2(along, perp));
      float mask = 1.0 - smoothstep(edge * STAMP_CORE_FRAC, edge, ell);
      dye.g = clamp(dye.g + mask * STAMP_OLIVE_GAIN, 0.0, 1.0);
    }
  }

  outColor = vec4(clamp(dye.rgb, 0.0, 1.0), 1.0);
}
`;

const DISPLAY_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
${COMMON_UNIFORMS_GLSL}
${SETTINGS_UNIFORMS_GLSL}
${ROOM_UV_GLSL}
uniform sampler2D uDye;
uniform float uSide;
uniform vec2 uCamPan;
uniform vec4 uBeadPos[${BEAD_MAX}];
uniform float uBeadCount;
// velocity() (below, via POUR_GLSL) is never called from this pass, but its
// body still references these — GLSL must compile every identifier in the
// translation unit regardless of whether the function is ever invoked.
uniform vec2 uShoveOrigin;
uniform float uShoveEnv;
${POUR_GLSL}

const vec3 CELL_A = vec3(${CELL_A[0].toFixed(4)}, ${CELL_A[1].toFixed(4)}, ${CELL_A[2].toFixed(4)});
const vec3 CELL_B = vec3(${CELL_B[0].toFixed(4)}, ${CELL_B[1].toFixed(4)}, ${CELL_B[2].toFixed(4)});
const vec3 CELL_C = vec3(${CELL_C[0].toFixed(4)}, ${CELL_C[1].toFixed(4)}, ${CELL_C[2].toFixed(4)});
const vec3 CELL_MAUVE = vec3(${CELL_MAUVE[0].toFixed(4)}, ${CELL_MAUVE[1].toFixed(4)}, ${CELL_MAUVE[2].toFixed(4)});
const vec3 LACING_TINT = vec3(${LACING_TINT[0].toFixed(4)}, ${LACING_TINT[1].toFixed(4)}, ${LACING_TINT[2].toFixed(4)});
const vec3 CRIMSON_LOW = vec3(${CRIMSON_LOW[0].toFixed(4)}, ${CRIMSON_LOW[1].toFixed(4)}, ${CRIMSON_LOW[2].toFixed(4)});
const vec3 CRIMSON_MID = vec3(${CRIMSON_MID[0].toFixed(4)}, ${CRIMSON_MID[1].toFixed(4)}, ${CRIMSON_MID[2].toFixed(4)});
const vec3 CRIMSON_DARK = vec3(${CRIMSON_DARK[0].toFixed(4)}, ${CRIMSON_DARK[1].toFixed(4)}, ${CRIMSON_DARK[2].toFixed(4)});
const vec3 FRESH_RED = vec3(${FRESH_RED[0].toFixed(4)}, ${FRESH_RED[1].toFixed(4)}, ${FRESH_RED[2].toFixed(4)});
const vec3 OLIVE_COL = vec3(${OLIVE_COL[0].toFixed(4)}, ${OLIVE_COL[1].toFixed(4)}, ${OLIVE_COL[2].toFixed(4)});
const vec3 OLIVE_RIM_COL = vec3(${OLIVE_RIM_COL[0].toFixed(4)}, ${OLIVE_RIM_COL[1].toFixed(4)}, ${OLIVE_RIM_COL[2].toFixed(4)});
const vec3 WETRIM_LIGHT = vec3(${WETRIM_LIGHT[0].toFixed(4)}, ${WETRIM_LIGHT[1].toFixed(4)}, ${WETRIM_LIGHT[2].toFixed(4)});

const float CUSHION_RIM_WIDTH = ${CUSHION_RIM_WIDTH.toFixed(4)};
const float CUSHION_CENTRE_LIFT = ${CUSHION_CENTRE_LIFT.toFixed(4)};
const float CUSHION_RIM_DARKEN = ${CUSHION_RIM_DARKEN.toFixed(4)};
const float CELL_MAUVE_SHARE = ${CELL_MAUVE_SHARE.toFixed(4)};
const float CELL_MAUVE_MIX = ${CELL_MAUVE_MIX.toFixed(4)};
const float MOTTLE_FREQ = ${MOTTLE_FREQ.toFixed(4)};
const float MOTTLE_LUMA_GAIN = ${MOTTLE_LUMA_GAIN.toFixed(4)};
const float LACING_WIDTH_PX = ${LACING_WIDTH_PX.toFixed(4)};
const float LACING_MIN_WIDTH = ${LACING_MIN_WIDTH.toFixed(5)};
const float LACING_DARKEN = ${LACING_DARKEN.toFixed(4)};
const float INK_STOP1 = ${INK_STOP1.toFixed(4)};
const float INK_STOP2 = ${INK_STOP2.toFixed(4)};
const float INK_STOP3 = ${INK_STOP3.toFixed(4)};
const float FRESH_LIFT = ${FRESH_LIFT.toFixed(4)};
const float SPECKLE_FREQ = ${SPECKLE_FREQ.toFixed(4)};
const float SPECKLE_BASE = ${SPECKLE_BASE.toFixed(4)};
const float SPECKLE_SPARKLE_GAIN = ${SPECKLE_SPARKLE_GAIN.toFixed(4)};
const float BUBBLE_FREQ = ${BUBBLE_FREQ.toFixed(4)};
const float BUBBLE_BASE = ${BUBBLE_BASE.toFixed(4)};
const float BUBBLE_HIGH_GAIN = ${BUBBLE_HIGH_GAIN.toFixed(4)};
const float BUBBLE_INK_MIN = ${BUBBLE_INK_MIN.toFixed(4)};
const float BUBBLE_FRESH_MIN = ${BUBBLE_FRESH_MIN.toFixed(4)};
const float BUBBLE_R = ${BUBBLE_R.toFixed(4)};
const float BUBBLE_RING_W = ${BUBBLE_RING_W.toFixed(4)};
const float BUBBLE_SPEC_R = ${BUBBLE_SPEC_R.toFixed(4)};
const float OLIVE_RIM_GAIN = ${OLIVE_RIM_GAIN.toFixed(4)};
const float WETRIM_GRAD_SCALE = ${WETRIM_GRAD_SCALE.toFixed(4)};
const float WETRIM_SPEC_POWER = ${WETRIM_SPEC_POWER.toFixed(4)};
const float WETRIM_SPEC_GAIN = ${WETRIM_SPEC_GAIN.toFixed(4)};
const float WETRIM_DARK_GAIN = ${WETRIM_DARK_GAIN.toFixed(4)};
const float BEAD_BRIGHTEN = ${BEAD_BRIGHTEN.toFixed(4)};
const float BEAD_RIM_FRAC = ${BEAD_RIM_FRAC.toFixed(4)};
const float BREATHE_SWING = ${BREATHE_SWING.toFixed(4)};
const vec3 FOAM_A = vec3(${FOAM_A[0].toFixed(4)}, ${FOAM_A[1].toFixed(4)}, ${FOAM_A[2].toFixed(4)});
const vec3 FOAM_B = vec3(${FOAM_B[0].toFixed(4)}, ${FOAM_B[1].toFixed(4)}, ${FOAM_B[2].toFixed(4)});
const vec3 NUCLEUS_COL = vec3(${NUCLEUS_COL[0].toFixed(4)}, ${NUCLEUS_COL[1].toFixed(4)}, ${NUCLEUS_COL[2].toFixed(4)});
const float FOAM_NOISE_FREQ = ${FOAM_NOISE_FREQ.toFixed(4)};
const float FOAM_NOISE_LO = ${FOAM_NOISE_LO.toFixed(4)};
const float FOAM_NOISE_HI = ${FOAM_NOISE_HI.toFixed(4)};
const float FOAM_WIDTH = ${FOAM_WIDTH.toFixed(4)};
const float FOAM_RIM_DARKEN = ${FOAM_RIM_DARKEN.toFixed(4)};
const float FOAM_CENTRE_LIFT = ${FOAM_CENTRE_LIFT.toFixed(4)};
const float FOAM_SPECKLE_FLOOR = ${FOAM_SPECKLE_FLOOR.toFixed(4)};
const float EMBOSS_GAIN = ${EMBOSS_GAIN.toFixed(4)};
const float EMBOSS_CLAMP = ${EMBOSS_CLAMP.toFixed(4)};
const float NUCLEUS_SHARE = ${NUCLEUS_SHARE.toFixed(4)};
const float NUCLEUS_R = ${NUCLEUS_R.toFixed(4)};
const float NUCLEUS_MIX = ${NUCLEUS_MIX.toFixed(4)};
const float BEAD_LENS_CENTRE = ${BEAD_LENS_CENTRE.toFixed(4)};
const float BEAD_CRESCENT_GAIN = ${BEAD_CRESCENT_GAIN.toFixed(4)};

// Sim-space size of one screen pixel, set once at the top of main() from the
// continuous (pre-wrap) coordinate — fwidth() of the wrapped coordinate
// spikes along the torus seam, and derivatives are not defined inside the
// bead branch that re-enters shade().
float gPx;

// The pale mosaic the ink sits on. Cushions: a warped Voronoi, each cell
// tinted from its own hash, shaded as a pillow (dark rim, lifted centre, rim
// embossed from the top-left), many carrying a pink nucleus. Foam: beside
// some borders the cushion gives way to a band of sub-cells, lighter and
// finer, where the speckle lives. foamOut hands that band to the caller.
vec3 groundColor(vec2 p, bool emboss, out float foamOut) {
  float fq = cellFreq();
  vec3 big = cushionVor(p, fq);
  float dB = big.y - big.x;
  float pxB = gPx * fq; // one screen pixel, in cushion-cell units
  float lwB = max(pxB * LACING_WIDTH_PX, LACING_MIN_WIDTH);

  float foamGate = smoothstep(FOAM_NOISE_LO, FOAM_NOISE_HI, fbmT(p * FOAM_NOISE_FREQ, FOAM_NOISE_FREQ));
  float foamW = FOAM_WIDTH * foamGate;
  float dEdge = dB - foamW; // signed distance to the cushion's visible edge
  float foam = (1.0 - smoothstep(-0.5 * lwB, 0.5 * lwB, dEdge)) * step(1e-3, foamW);

  float idr = big.z;
  vec3 cellCol = idr < 0.34
    ? mix(CELL_A, CELL_B, idr / 0.34)
    : idr < 0.67
      ? mix(CELL_B, CELL_C, (idr - 0.34) / 0.33)
      : mix(CELL_C, CELL_A, (idr - 0.67) / 0.33);
  float mauveMask = step(1.0 - CELL_MAUVE_SHARE, hash21(vec2(idr * 91.7, 3.1)));
  cellCol = mix(cellCol, CELL_MAUVE, mauveMask * CELL_MAUVE_MIX);

  // A slow rose drift across the ground, so neighbouring cushions are not
  // flat swatches.
  float rose = fbmT(p * FOAM_NOISE_FREQ + vec2(3.0, 7.0), FOAM_NOISE_FREQ);
  cellCol = mix(cellCol, cellCol * vec3(1.06, 0.9, 0.98), smoothstep(0.35, 0.75, rose));

  float nucRoll = hash21(vec2(idr * 57.3, 8.9));
  float nucR = NUCLEUS_R * (0.5 + nucRoll);
  float nuc = step(1.0 - NUCLEUS_SHARE, hash21(vec2(idr * 13.1, 4.4))) * (1.0 - smoothstep(0.0, nucR, big.x));
  cellCol = mix(cellCol, NUCLEUS_COL, nuc * nuc * NUCLEUS_MIX);

  float rimB = smoothstep(0.0, CUSHION_RIM_WIDTH, max(dEdge, 0.0));
  vec3 bigCol = cellCol * mix(CUSHION_RIM_DARKEN, CUSHION_CENTRE_LIFT, rimB);
  if (emboss) {
    vec2 g = vec2(dFdx(dEdge), dFdy(dEdge)) / max(pxB, 1e-6);
    float e = clamp(dot(-g, vec2(-0.7071, 0.7071)), -EMBOSS_CLAMP, EMBOSS_CLAMP);
    bigCol *= 1.0 + EMBOSS_GAIN * e * (1.0 - rimB);
  }
  float lineB = 1.0 - smoothstep(0.0, lwB, abs(dEdge));

  vec3 sm = cushionVor(p, subcellFreq());
  float dS = sm.y - sm.x;
  float lwS = max(pxB * SUBCELL_MULT * LACING_WIDTH_PX * 0.75, LACING_MIN_WIDTH);
  vec3 foamCol = mix(FOAM_A, FOAM_B, sm.z) * mix(FOAM_RIM_DARKEN, FOAM_CENTRE_LIFT, smoothstep(0.0, CUSHION_RIM_WIDTH, dS));
  float lineS = 1.0 - smoothstep(0.0, lwS, dS);

  vec3 col = mix(bigCol, foamCol, foam);
  float line = max(lineB, lineS * foam);

  float mot = fbmT(p * MOTTLE_FREQ, MOTTLE_FREQ) - 0.5;
  col *= 1.0 + mot * MOTTLE_LUMA_GAIN;
  col = mix(col, col * (1.0 - LACING_DARKEN) + LACING_TINT * LACING_DARKEN, line);
  foamOut = foam;
  return col;
}

vec3 crimsonRamp(float x) {
  x = clamp(x, 0.0, 1.0);
  if (x < INK_STOP1) return mix(vec3(1.0), CRIMSON_LOW, x / INK_STOP1);
  if (x < INK_STOP2) return mix(CRIMSON_LOW, CRIMSON_MID, (x - INK_STOP1) / (INK_STOP2 - INK_STOP1));
  return mix(CRIMSON_MID, CRIMSON_DARK, clamp((x - INK_STOP2) / (INK_STOP3 - INK_STOP2), 0.0, 1.0));
}

// Everything but the beads, at one sim-space point — main() shades the
// pixel with it, and each bead re-enters it at a lens-displaced point.
vec3 shade(vec2 simUv, bool emboss) {
  float foam;
  vec3 col = groundColor(simUv, emboss, foam);

  vec2 texel = vec2(1.0 / uSide);
  vec4 dyeC = texture(uDye, simUv);
  vec4 dyeL = texture(uDye, fract(simUv - vec2(texel.x, 0.0)));
  vec4 dyeR = texture(uDye, fract(simUv + vec2(texel.x, 0.0)));
  vec4 dyeD = texture(uDye, fract(simUv - vec2(0.0, texel.y)));
  vec4 dyeU = texture(uDye, fract(simUv + vec2(0.0, texel.y)));
  float ink = dyeC.r;
  float olive = dyeC.g;
  float fresh = dyeC.b;

  // Speckle: round white flecks of mixed size, mostly in the foam, only
  // over pale (low-ink) ground.
  vec2 sc = simUv * SPECKLE_FREQ;
  vec2 sci = mod(floor(sc), SPECKLE_FREQ);
  vec2 scf = fract(sc);
  float speckRoll = hash21(sci + 41.0);
  vec2 speckCtr = 0.3 + 0.4 * vec2(hash21(sci + 3.1), hash21(sci + 8.7));
  float speckRad = 0.1 + 0.28 * hash21(sci + 5.5);
  float speckDot = 1.0 - smoothstep(speckRad * 0.55, speckRad, length(scf - speckCtr));
  float speckWhere = FOAM_SPECKLE_FLOOR + (1.0 - FOAM_SPECKLE_FLOOR) * foam;
  float speckProb = clamp((SPECKLE_BASE * uSpeckle + uHigh * SPECKLE_SPARKLE_GAIN) * speckWhere, 0.0, 1.0);
  float speck = step(1.0 - speckProb, speckRoll) * speckDot * (1.0 - smoothstep(0.1, 0.15, ink));
  col = mix(col, vec3(1.0), speck * 0.9);

  // Crimson ramp: white (no tint) toward the dark ink core; freshness
  // lifts toward a brighter, more saturated red.
  col *= crimsonRamp(clamp(ink * uInk, 0.0, 1.0));
  col = mix(col, FRESH_RED, fresh * smoothstep(INK_STOP1, INK_STOP2, ink) * FRESH_LIFT);

  // Tiny bubble cluster inside fresh, saturated ink.
  vec2 bubCell = mod(floor(simUv * BUBBLE_FREQ), BUBBLE_FREQ);
  float bubRoll = hash21(bubCell + 91.0);
  float bubDensity = clamp(BUBBLE_BASE * (1.0 + uHigh * BUBBLE_HIGH_GAIN), 0.0, 1.0);
  if (bubRoll < bubDensity && ink > BUBBLE_INK_MIN && fresh > BUBBLE_FRESH_MIN) {
    vec2 local = fract(simUv * BUBBLE_FREQ) - 0.5;
    float distC = length(local);
    float ring = clamp(
      smoothstep(BUBBLE_R, BUBBLE_R - BUBBLE_RING_W, distC) -
        smoothstep(BUBBLE_R - BUBBLE_RING_W, BUBBLE_R - 2.0 * BUBBLE_RING_W, distC),
      0.0, 1.0
    );
    float spec = smoothstep(BUBBLE_SPEC_R, 0.0, length(local - vec2(-0.12, 0.12)));
    col = mix(col, vec3(0.04, 0.02, 0.02), ring * 0.85);
    col = mix(col, vec3(1.0), spec);
  }

  // Olive: a small accent, with a bright rim. The rim is a bounded edge
  // mask, not a raw gradient magnitude — an unclamped additive term here
  // washed a whole smeared-out olive front to yellow-white instead of
  // rimming just its sharp edge.
  vec2 oliveRimV = vec2(dyeR.g - dyeL.g, dyeU.g - dyeD.g);
  float oliveEdge = clamp(length(oliveRimV) * OLIVE_RIM_GAIN, 0.0, 1.0);
  col = mix(col, OLIVE_COL, clamp(olive * uInk, 0.0, 1.0));
  col = mix(col, OLIVE_RIM_COL, oliveEdge * 0.6);

  // Wet rim: the ink's own density gradient lit from the top-left, plus a
  // thin dark edge on the opposite side — what makes this read as paint
  // rather than a marbling shader.
  vec2 densGrad = vec2(dyeR.r - dyeL.r, dyeU.r - dyeD.r) * WETRIM_GRAD_SCALE;
  vec3 normal = normalize(vec3(-densGrad, 1.0));
  float spec2 = pow(max(dot(normal, WETRIM_LIGHT), 0.0), WETRIM_SPEC_POWER);
  float darkEdge = clamp(dot(densGrad, normalize(vec2(0.6, -0.6))), 0.0, 4.0);
  col += spec2 * uGloss * WETRIM_SPEC_GAIN * smoothstep(0.0, 0.3, length(densGrad));
  col = mix(col, col * (1.0 - WETRIM_DARK_GAIN), clamp(darkEdge * uGloss, 0.0, 1.0));
  return col;
}

void main() {
  vec2 ruv = roomUv(vUv);
  vec2 cov = coverUv(ruv);
  vec2 centered = cov - 0.5;
  float bar = 0.5 - 0.5 * cos(TWO_PI * uBarPhase);
  float zoomEff = max(0.05, uZoom * (1.0 + uBreathe * BREATHE_SWING * bar));
  vec2 cont = centered / zoomEff;
  gPx = max(length(dFdx(cont)), length(dFdy(cont)));
  vec2 simUv = fract(cont + 0.5 + uCamPan);

  vec3 col = shade(simUv, true);

  // Glass beads: a small lens over the pour — the scene magnified inside, a
  // dark rim, a white glint toward the light and a soft caustic crescent
  // on the far side.
  for (int i = 0; i < ${BEAD_MAX}; i++) {
    if (float(i) >= uBeadCount) break;
    vec4 b = uBeadPos[i];
    vec2 bd = shortest(simUv - b.xy);
    float bdist = length(bd);
    if (bdist < b.z) {
      float t = bdist / b.z;
      vec2 dir = bdist > 1e-5 ? bd / bdist : vec2(0.0);
      vec2 lensUv = fract(b.xy + bd * (BEAD_LENS_CENTRE + (1.0 - BEAD_LENS_CENTRE) * t * t));
      vec3 refr = shade(lensUv, false) * BEAD_BRIGHTEN;
      float edgeDist = b.z - bdist;
      float rimW = b.z * BEAD_RIM_FRAC;
      float rim = 1.0 - smoothstep(0.0, rimW, edgeDist);
      float crescent = smoothstep(0.55, 0.85, t) * (1.0 - smoothstep(0.85, 1.0, t)) * max(dot(dir, vec2(0.7071, -0.7071)), 0.0);
      vec2 specOff = vec2(-0.38, 0.38) * b.z;
      float bspec = smoothstep(rimW * 2.0, rimW * 0.5, length(bd - specOff));
      col = refr + crescent * BEAD_CRESCENT_GAIN * uGloss;
      col = mix(col, vec3(0.05, 0.03, 0.05), rim * 0.75);
      col = mix(col, vec3(1.0), bspec * (0.4 + 0.6 * uGloss));
    }
  }

  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

function createPourScene(): Scene {
  let predictorProg: GLProgram | null = null;
  let correctorProg: GLProgram | null = null;
  let displayProg: GLProgram | null = null;
  let quadVao: WebGLVertexArrayObject | null = null;

  const dyeTex: (WebGLTexture | null)[] = [null, null];
  const dyeFbo: (WebGLFramebuffer | null)[] = [null, null];
  let dyeTempTex: WebGLTexture | null = null;
  let dyeTempFbo: WebGLFramebuffer | null = null;

  const samplerLocs = new Map<string, WebGLUniformLocation | null>();
  let dyeRead = 0;
  let sideCur = 0;
  let presetAtInit: QualityPreset = "mid";
  let lastFrameTime: number | null = null;
  let dropGate: DropGate | null = null;
  let nozzleEpoch = 0;
  let panPhase = 0;
  let shoveOriginX = 0.5;
  let shoveOriginY = 0.5;
  let shoveEnv = 0;
  const bandsBuf = new Float32Array(NUM_BANDS);
  const stampsBuf = new Float32Array(STAMP_MAX * 4);
  const beadsBuf = new Float32Array(BEAD_MAX * 4);

  function samplerLoc(
    gl: WebGL2RenderingContext,
    prog: GLProgram,
    key: string,
    name: string,
  ): WebGLUniformLocation | null {
    let l = samplerLocs.get(key);
    if (l === undefined) {
      l = gl.getUniformLocation(prog.program, name);
      samplerLocs.set(key, l);
    }
    return l;
  }

  /** LINEAR — the advection samples between texels — and REPEAT, because
   *  the dye field is a torus (see the file header). */
  function makeDyeTexture(gl: WebGL2RenderingContext, side: number, data: Uint8Array): WebGLTexture | null {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, side, side, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    return tex;
  }

  function makeFbo(gl: WebGL2RenderingContext, tex: WebGLTexture | null, label: string): WebGLFramebuffer {
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`pour: ${label} framebuffer incomplete (0x${status.toString(16)})`);
    }
    return f!;
  }

  function freeDyeTargets(gl: WebGL2RenderingContext): void {
    for (let i = 0; i < 2; i++) {
      if (dyeFbo[i]) gl.deleteFramebuffer(dyeFbo[i]);
      if (dyeTex[i]) gl.deleteTexture(dyeTex[i]);
      dyeFbo[i] = null;
      dyeTex[i] = null;
    }
    if (dyeTempFbo) gl.deleteFramebuffer(dyeTempFbo);
    if (dyeTempTex) gl.deleteTexture(dyeTempTex);
    dyeTempFbo = null;
    dyeTempTex = null;
  }

  /** Rebuilds the dye field, and reseeds it to zero (bare ground, no ink),
   *  only when its size actually changes — see the file header. */
  function ensureDyeTargets(gl: WebGL2RenderingContext): void {
    const side = dyeSide(presetAtInit, Math.max(gl.drawingBufferWidth, gl.drawingBufferHeight));
    if (side === sideCur && dyeFbo[0] && dyeFbo[1] && dyeTempFbo) return;
    freeDyeTargets(gl);
    sideCur = side;
    const zero = new Uint8Array(side * side * 4);
    for (let i = 3; i < zero.length; i += 4) zero[i] = 255; // A = 1
    for (let i = 0; i < 2; i++) {
      dyeTex[i] = makeDyeTexture(gl, side, zero);
      dyeFbo[i] = makeFbo(gl, dyeTex[i], `dye${i}`);
    }
    dyeTempTex = makeDyeTexture(gl, side, zero);
    dyeTempFbo = makeFbo(gl, dyeTempTex, "dyeTemp");
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    dyeRead = 0;
  }

  return {
    id: ID,
    name: "Pour",
    settings: SETTINGS,

    init(ctx: SceneContext) {
      const { gl } = ctx;
      predictorProg = createProgram(gl, SIM_PREDICTOR_FRAG);
      correctorProg = createProgram(gl, SIM_CORRECTOR_FRAG);
      displayProg = createProgram(gl, DISPLAY_FRAG);
      samplerLocs.clear();
      quadVao = createFullscreenQuad(gl);

      presetAtInit = ctx.quality.preset;
      sideCur = 0;
      ensureDyeTargets(gl);

      dyeRead = 0;
      lastFrameTime = null;
      dropGate = createDropGate();
      nozzleEpoch = 0;
      panPhase = 0;
      shoveOriginX = 0.5;
      shoveOriginY = 0.5;
      shoveEnv = 0;
    },

    render(ctx, frame, viewport, palette, anim) {
      if (!predictorProg || !correctorProg || !displayProg || !quadVao || !dropGate) return;
      const { gl } = ctx;
      ensureDyeTargets(gl);

      // See the file header (and physarum.ts's/petri.ts's) for why
      // frame.time and not anim.dtSec.
      const dt = lastFrameTime === null ? 1 / 60 : Math.max(0, Math.min(0.05, frame.time - lastFrameTime));
      lastFrameTime = frame.time;

      const dropSizeAmt = resolveSceneSetting(ID, settingFor("dropSize"));
      const dropsAmt = resolveSceneSetting(ID, settingFor("drops"));
      const driftAmt = resolveSceneSetting(ID, settingFor("drift"));
      const beadsAmt = resolveSceneSetting(ID, settingFor("beads"));

      const gateResult = dropGate.advance(dt, anim.lowOnset, anim.highOnset, anim.tempoLock, frame.bpm, dropsAmt, Math.random);

      stampsBuf.fill(0);
      let stampCount = 0;
      if (gateResult.crimson) {
        const [nx, ny] = nozzlePosition(anim.timeSec, nozzleEpoch);
        nozzleEpoch++;
        const radius = DROP_RADIUS_BASE * dropSizeAmt * (DROP_RADIUS_FLOOR + DROP_RADIUS_PULSE_GAIN * anim.lowPulse);
        stampsBuf[stampCount * 4] = nx;
        stampsBuf[stampCount * 4 + 1] = ny;
        stampsBuf[stampCount * 4 + 2] = radius;
        stampsBuf[stampCount * 4 + 3] = STAMP_KIND_CRIMSON;
        stampCount++;
        shoveOriginX = nx;
        shoveOriginY = ny;
        shoveEnv = 1;
      }
      if (gateResult.olive && stampCount < STAMP_MAX) {
        const [ox, oy] = nozzlePosition(anim.timeSec, nozzleEpoch);
        const radius = OLIVE_RADIUS_BASE * dropSizeAmt;
        stampsBuf[stampCount * 4] = ox;
        stampsBuf[stampCount * 4 + 1] = oy;
        stampsBuf[stampCount * 4 + 2] = radius;
        stampsBuf[stampCount * 4 + 3] = STAMP_KIND_OLIVE;
        stampCount++;
      }
      shoveEnv *= Math.exp(-dt * SHOVE_DECAY_PER_SEC);

      panPhase += dt * PAN_RATE * driftAmt;
      const panX = Math.sin(panPhase * PAN_FREQ_X) * PAN_AMOUNT;
      const panY = Math.sin(panPhase * PAN_FREQ_Y + PAN_PHASE_Y) * PAN_AMOUNT;

      beadsBuf.fill(0);
      const beadCount = Math.max(0, Math.min(BEAD_MAX, Math.round(beadsAmt)));
      const beads = beadPositions(anim.timeSec, beadCount);
      for (let i = 0; i < beads.length; i++) {
        beadsBuf[i * 4] = beads[i].x;
        beadsBuf[i * 4 + 1] = beads[i].y;
        beadsBuf[i * 4 + 2] = beads[i].r;
        beadsBuf[i * 4 + 3] = beads[i].seed;
      }

      gl.disable(gl.BLEND);

      // 1. Predictor: dyeRead -> dyeTemp.
      gl.bindFramebuffer(gl.FRAMEBUFFER, dyeTempFbo);
      gl.viewport(0, 0, sideCur, sideCur);
      predictorProg.use();
      uploadCommonUniforms(predictorProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf);
      predictorProg.setF("uSimDt", dt);
      predictorProg.setV2("uShoveOrigin", shoveOriginX, shoveOriginY);
      predictorProg.setF("uShoveEnv", shoveEnv);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, dyeTex[dyeRead]);
      gl.uniform1i(samplerLoc(gl, predictorProg, "pred.uDyeIn", "uDyeIn"), 0);
      drawFullscreenQuad(gl, quadVao);

      // 2. Corrector: dyeRead + dyeTemp -> dyeWrite (advection correction,
      //    fade, then injection — see the file header for why these three
      //    share one pass).
      const dyeWrite = 1 - dyeRead;
      gl.bindFramebuffer(gl.FRAMEBUFFER, dyeFbo[dyeWrite]);
      gl.viewport(0, 0, sideCur, sideCur);
      correctorProg.use();
      uploadCommonUniforms(correctorProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf);
      correctorProg.setF("uSide", sideCur);
      correctorProg.setF("uSimDt", dt);
      correctorProg.setV2("uShoveOrigin", shoveOriginX, shoveOriginY);
      correctorProg.setF("uShoveEnv", shoveEnv);
      correctorProg.setF("uNoiseSeed", Math.random() * 100);
      correctorProg.setV4v("uStamps", stampsBuf);
      correctorProg.setF("uStampCount", stampCount);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, dyeTex[dyeRead]);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, dyeTempTex);
      gl.uniform1i(samplerLoc(gl, correctorProg, "corr.uDyeIn", "uDyeIn"), 0);
      gl.uniform1i(samplerLoc(gl, correctorProg, "corr.uDyeTempIn", "uDyeTempIn"), 1);
      drawFullscreenQuad(gl, quadVao);
      dyeRead = dyeWrite;

      // 3. Display: composite to the default framebuffer.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      displayProg.use();
      uploadCommonUniforms(displayProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf);
      displayProg.setF("uSide", sideCur);
      displayProg.setV2("uCamPan", panX, panY);
      displayProg.setV4v("uBeadPos", beadsBuf);
      displayProg.setF("uBeadCount", beads.length);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, dyeTex[dyeRead]);
      gl.uniform1i(samplerLoc(gl, displayProg, "disp.uDye", "uDye"), 0);
      drawFullscreenQuad(gl, quadVao);

      // 4. The gallery renders every scene into one shared context each
      //    tick — must not leak a bound texture onto the next tile.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      for (let unit = 1; unit >= 0; unit--) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, null);
      }
    },

    dispose(ctx: SceneContext) {
      const { gl } = ctx;
      predictorProg?.dispose();
      correctorProg?.dispose();
      displayProg?.dispose();
      if (quadVao) gl.deleteVertexArray(quadVao);
      freeDyeTargets(gl);
      samplerLocs.clear();
      predictorProg = null;
      correctorProg = null;
      displayProg = null;
      quadVao = null;
      lastFrameTime = null;
      dropGate = null;
      sideCur = 0;
    },
  };
}

export const pourScene = createPourScene();
