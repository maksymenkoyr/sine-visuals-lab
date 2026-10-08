import { NUM_BANDS } from "../../audio/types.ts";
import { MIN_HZ, MAX_HZ_CAP } from "../../audio/bandScale.ts";
import { createProgram, createFullscreenQuad, drawFullscreenQuad, type GLProgram } from "../gl.ts";
import type { SceneSetting } from "../sceneSettings.ts";
import { resolveSceneSetting, resolveSceneSettingUnscaled } from "../autoTune.ts";
import type { Scene, SceneContext } from "../scene.ts";
import { COMMON_UNIFORMS_GLSL, DRIVE_GLSL, ROOM_UV_GLSL, settingUniformName, uploadCommonUniforms } from "../sceneCommon.ts";
import { FLOAT_HASH_GLSL } from "../noiseHash.ts";
import { PASSTHROUGH_DRIVES } from "../drives.ts";
import {
  FREEZE_REF,
  HOP_RATE,
  LIFT_THRESHOLD,
  PULL_BIAS,
  rawPlateDrive,
  SNAP_REF,
  ZONE_AXIS_MAX,
  ZONE_DRIVE_GLSL,
} from "./chladniSand.ts";
import {
  FUNDAMENTAL_ORDER,
  MODE_TABLE,
  PLATE_SHAPES,
  SQUARE,
  bakePlate,
  plateArea,
  plateModeTable,
  plateOutline,
  type PlateMode,
} from "./chladniPlates.ts";

import { GRIT_CHALK, GRIT_RAMP_LO, GRIT_RAMP_SPAN, powderInk } from "./chladniPowder.ts";
import {
  ZOOM_LAYERS,
  ZOOM_SAND_MARGIN,
  zoomFinestScale,
  zoomLayers,
  zoomPhaseStep,
  zoomRespawnShare,
  zoomShrink,
  type ZoomLayer,
} from "./chladniZoom.ts";

export { MAX_ORDER, MODE_TABLE, buildModeTable, type PlateMode } from "./chladniPlates.ts";

// A Chladni plate, simulated rather than painted: a plate whose resonant
// modes are each driven by the music's energy at that mode's own resonant
// frequency, with a bed of sand grains that get kicked wherever the plate
// moves (the antinodes) and come to rest where it doesn't (the nodal
// lines). The classic figures aren't drawn anywhere in this file — they
// *emerge* from grain motion, and re-form grain by grain when a different
// mode takes over. Contrast cymatics.ts, which is an analytic circular-plate
// sum rendered per pixel; this one has state.
//
// The plate. Plate space is p in [-1,1]^2. The square's mode shape is the
// standard square-plate approximation
//     chladni(p; n, m, s) = cos(n pi x) cos(m pi y) + s cos(m pi x) cos(n pi y)
// with s = +/-1 picking one of the two symmetry families (the mixing of the
// two degenerate modes is real physics — it's where the diagonal symmetry
// of square-plate figures comes from). n == m with s = -1 is identically
// zero, so buildModeTable only holds pairs with n < m, sorted by n^2 + m^2,
// which is also each mode's resonant frequency relative to the fundamental.
//
// Other plates. The Plate setting picks one of PLATE_SHAPES; chladniPlates.ts
// has each shape's figures and their physics (the round plate is a true free
// plate; the polygons are free-edge membranes, the usual stand-in where no
// plate solution exists; Clamped is the square with held edges). The square
// stays analytic in the shader, exactly as before. Every other shape's
// figures are baked when the shape is picked (or at init if a saved look
// picked it; only the plate on screen keeps its atlas), into a TEXTURE_2D_ARRAY (one layer per figure;
// R = f, G,B = its gradient, at ATLAS_SIDE texels a side over plate space,
// RGBA16F uploaded from floats: filterable in core WebGL2, and never
// rendered into, so no float-colour extension is needed), and field() sums
// the active layers instead of the cosines; uModes then carries each active
// figure's layer. Each layer peaks at |f| = 2 like one square mode, so the
// sand rule below needs no change per plate. Each shape gets its own createPlateResponse (switching
// shape starts that shape's response fresh). A non-square plate always keeps
// its true shape, fitted like the square plate (SQUARE_PLATE_HALF) and
// centred; True shape (key squarePlate, kept for saved looks) only chooses
// between that and the stretched full-screen square. Zoom scales every plate
// (plateHalf), and above 1 the drawn grains with it, a closer look (so the
// fixed grain pool still covers the plate). Sand respawns evenly over the shape's area (respawnOnPlate)
// and spills off its true rim (insidePlate); the plate surface, glow and rim
// follow the true outline (plateGauge).
//
// Zoom out (the square plate only; chladniZoom.ts has the layers and why).
// An endless pull-back, which no real plate can do: a Shepard-style
// illusion. The plate rings its music-picked blend at ZOOM_LAYERS sizes an
// octave apart (zoomField, weights summing to 1 so |f| <= 2 as before), each
// growing finer as the zoom runs while a bell hands the plate from the finer
// layers to the coarser ones, and the set repeats after every octave. While
// it runs the plate has no edge: the cosines carry on past [-1,1]^2, which
// is the plate mirrored across its edges, and it fills the frame at its true
// aspect (Zoom still sets the base size; True shape doesn't apply; no rim).
// So the sand lies on the frame instead of the plate, grown by
// ZOOM_SAND_MARGIN past every edge: grains are stored in grain space, that
// area as [-1,1]^2 (GRAIN_TO_PLATE), the sim steps them in plate space, and
// the toss's landings use that area as the square's outline (its throw
// still a plate distance). Each frame every grain shrinks toward the centre
// by the zoom's step, so a formed figure shrinks as one piece with the
// field; the share of the bed that shrink frees goes to the strip it opened
// at the edges; a grain that hops off the area comes back in at that edge
// (foldIntoPlate) rather than anywhere on it, since an even respawn would
// feed the middle, where the shrink piles sand up; together they keep the
// bed even. The sand still finding its lines near the edge, and any turned
// back there, reads brighter than the settled bed: the margin keeps it off
// screen. A half-step dither keeps packPos's rounding from
// eating a slow shrink. Whether the zoom is on reads the slider before the
// Master card's Scale (zoomWanted), which sets only its speed, so Scale 0
// can't flip the framing. The zoom is compiled in as its own programs
// (ZOOM_OUT, makePrograms): without it the shaders are the source as it
// was, so the plate is bit for bit what it was and pays nothing.
//
// The response. A real plate under broadband music answers as a sum of
// every mode near any energy in the signal, each ringing with its own
// damping — a pure tone gives one clean figure, a chord blurs neighbours
// together. createPlateResponse models exactly that: each table mode has a
// resonant frequency f1 * (n^2 + m^2) / FUNDAMENTAL_ORDER on the square, f1
// times its table ratio on the other plates (Pattern complexity sets f1 —
// physically the plate's size), is excited by the band energy under a
// resonance window at that frequency (Resonance sets the window's
// sharpness), and rings with a fast attack and a Ring-controlled release.
// One departure from a real plate: the excitation is that band energy less
// most of its own running average, because music is always loudest in the
// bass (and a room mic adds a floor of its own), and a plate that answered
// absolute energy showed its lowest mode nearly all the time. How much of
// the average comes off is the Loud ↔ New setting (`newness`, default
// SURPRISE_SHARE): at 0 the plate answers each band's level as it arrives,
// so the loudest part wins; at 1 only the part above the average counts, so
// a steady sound stops scoring at all. The bands arrive already evened out
// by the analyser's per-band auto-gain (audio/features.ts), so Loud doesn't
// simply mean bass: on the tempo-eval tracks it mostly made the figure
// change less (docs/scenes/chladni.md, Measurements).
// The strongest few modes by response are summed in the shader, weighted
// by that response, so mode changes are the plate's own dynamics rather
// than a scripted crossfade.
// Figure hold sets how much stronger a new mode must ring to take the plate:
// the mode on top last frame counts holdMargin times its real response, 1
// at 0 (exactly the model above) up to 1 + HOLD_MARGIN_MAX. A margin, not a
// timer: a challenger that clears it takes over at once, and silence still
// freezes. It only goes one way because the plain model is already as eager
// as the music allows — a shorter running average or a larger surprise
// share were both measured on the tempo-eval tracks and changed the figure
// no more often (docs/scenes/chladni.md, Measurements).
//
// The sand. Grain positions live in a ping-pong pair of RGBA8 textures,
// 16-bit fixed point per axis (R,G = x, B,A = y), beside a pair holding each
// grain's memory (see the sand colour paragraph below). RGBA8 is renderable on
// every WebGL2 device with no EXT_color_buffer_float dependency (the
// webOS/Tizen targets vite.config.ts builds for), and 1/65535 of the plate
// is sub-pixel even at 4K; half-float would be *too coarse* for positions,
// so the packing is the design, not a fallback. Per rendered frame the sim
// fragment shader steps every grain the way a real grain moves. The plate's
// local acceleration is the amplitude a = |field|/2 times how hard the music
// drives the plate. Below the lift threshold a grain only rattles in place,
// in proportion to that acceleration; above it the grain bounces a random
// distance that grows with the excess (a soft knee, not a wall — quiet
// plates shimmer, loud ones throw the sand). Migration toward the nodal
// lines is a second-order effect of the bouncing, as on a real plate: each
// bounce lands a small fraction of its length downhill of |field| (the
// analytic gradient), and that fraction itself fades to nothing where the
// plate barely moves. So sand in the quiet zones beside a line jiggles but
// never migrates — the sand lying between the figures on a real plate —
// while sand on the antinodes dances its way to the lines over seconds. A
// louder drive narrows the quiet zones into crisp lines. Nothing slides:
// every move is a bounce. The drive the sand feels passes through the Sand
// zones' remap first (Freeze edge and Snap edge — see chladniSand.ts, which
// also holds the rule's constants so the panel gauge moves grains by them). A grain that bounces off the plate edge respawns
// at a random spot — a real plate spills sand; refilling keeps the count
// constant. Silence drives nothing, so the figure freezes in place.
//
// Grain weight. Every grain has its own weight, from fine powder (0) to heavy
// grit (1): the bed's Grain weight spread by Size mix over a fixed per-grain
// draw (grainWeightAt), and the same weight sets both how big the grain is
// drawn (grainSizeFactor) and how it moves, so what you see is what sorts.
// Heavier grains bounce further and lift off at a lower plate acceleration
// (fine powder clings to the plate); their bounces are what walk them to the
// lines. Light grains barely hop, and instead the air does the moving: a
// vibrating plate sets the air over it streaming toward the antinodes, which
// carries fine powder there into heaps (Faraday, 1831, with lycopodium). The
// streaming is modelled as a drift up the gradient of the plate's squared
// motion, faded out by weight (grainLightness), so a mixed bed sorts itself —
// grit draws the lines, dust gathers in the cells between them. At
// WEIGHT_REF every weight factor is exactly 1, which is the plate as it was
// before grains had a weight.
//
// Powder colour shows that sorting. Grains lighter than POWDER_SPLIT (the
// weight where, on a CPU port of the sim, grains stop ending up on the lines
// and start heaping between them) are drawn in a second colour, with a soft
// edge POWDER_EDGE wide so a mixed bed reads as two materials. The colour is
// one per palette, picked in chladniPowder.ts to stand apart from every colour
// grit takes. At 0 the grain colour is exactly what it was; the default bed
// has almost no grains that light, so the dial shows only on a light, mixed
// bed (the setting's description says how to get one). Powder is never
// clipped toward white by brightness, which would wash it into the grit's
// colour: it is scaled back so its brightest shade just fits, so past that
// point Grain brightness stops brightening it (only Flash and a toss still
// clip it, briefly). The colour is drawing only: the sim never reads it.
//
// More sand colour, all of it off (or the plate as it was) by default.
// Thrown colour and Thrown to (THROWN_TO) say how far a thrown grain's colour
// moves and where: up the ramp toward white, as it always did, to the second
// colour, through the palette's inks, or dark. Toward white arrives early,
// because the brightness gain clips the ramp's bright end to white, so the
// others follow a curve (THROWN_REACH) to keep pace. Two sides colours a grain
// by the sign of the plate's value under it, which side of the still line it
// lies by (the plate moves one way on one side while the other side moves the
// other way), and tints the plate's glow the same. Spectrum rings colours the
// sand from a history of the bands, a ring-buffer texture written SPEC_RATE
// rows a second, each band as a share of its own recent peak: distance from
// the centre is how long ago, the angle is pitch. Glitter treats each shard's
// rotation as the way it faces: a light circling once a bar flashes the
// grains facing it, and thrown grains tumble to new angles. Those four are
// stateless. Embers and Beat waves need each grain to remember something,
// and the positions have no spare bits, so the sim writes a second RGBA8
// texture beside them (MEMORY_GLSL), ping-ponged through the same
// framebuffers: a heat that hops raise and rest lets fall over Ember fade,
// and the ink the last beat wave dyed it (advanceWave: each fired edge of the
// jack runs a ring out from the centre, dyeing what it passes). Embers draws
// a hot grain at its own hue's full strength, never clipped to white, with a
// halo on a share of the grains, and a cold one nearly dark.
//
// The toss. Sand on a nodal line never hops, so no kick can disturb a formed
// figure; at a drop (the Toss jack's edge, the app's Drop signal by default)
// the whole bed is thrown up instead, lands scattered, and the next figure
// grows out of an even spread. It doesn't rebuild faster than the plain
// drift; it changes how the change looks. nextToss starts one, at most once
// per TOSS_REFRACTORY_SEC, with the Toss setting as its power, and never
// while the audio clock is younger than TOSS_ARM_SEC: frame.time is the
// capture's clock, restarted at 0 by every new source, and the app's Drop
// fires right as the first figure forms. advanceToss steps it per frame and
// drops it if that clock goes back past its start, so an old toss can never
// replay on a new source's clock. The shaders' copy of the flight constants is
// printed at full precision (glslFloat) so it lands every grain the TS
// tossLongestFlight window covers. The flight is
// stateless, because the RGBA8 positions have no spare bits: a toss is a
// time and a seed, and each grain's flight time, height and landing offset
// are hashed from its texel and that seed (tossFlight), so the sim and the
// point pass agree without storing anything. While a grain is in the air
// the sim leaves its stored spot alone (where it took off); on the one sim
// pass where its flight ends it is put down at its landing spot
// (tossLanding, which keeps it on the plate's true outline, whatever the
// shape: a landing past the rim is reflected back in across it,
// foldIntoPlate, before any fallback). The point pass draws it along
// the arc between the two: sideways on the square of the flight's progress,
// so the bed lifts off as one shape and spreads on the way down; up the
// screen on a parabola; bigger and brighter the higher it is. Grit in the
// air runs up the palette's ramp; a powder grain keeps its powder colour,
// lifted only POWDER_THROWN_LIFT of the way to white, so the two stay apart
// in flight.
//
// Grains never interact — the sim has no notion of a grain's radius, so
// nothing stops two from occupying the same spot. Rendered at a fixed count,
// a big Grain size therefore just paints over itself: covered area grows
// with size^2 while the sand drawn stays fixed, so past MAX_BED_COVERAGE
// every pixel is whichever grain landed on top last, and both the grain
// texture and the figure underneath stop reading. drawnGrainCount treats the
// bed as a fixed amount of sand instead — bigger grains, fewer of them drawn
// — while the sim keeps stepping every grain regardless, so the drawn subset
// is a stable prefix rather than a re-seeded bed each time the slider moves.
// Sand amount is the user-facing half of that same budget, and it is real
// sand, not just visibility: the grain pool is SAND_AMOUNT_MAX times the
// quality tier's count, and the sim steps only the texture rows the drawn
// prefix occupies. 0 leaves the plate bare; above 1 there is genuinely more
// sand on the plate, and the coverage cap grows with the amount so the extra
// sand piles onto the figure rather than being clipped back to the 1× bed.
// Grains past the prefix sit where they were left, so raising the amount
// scatters them back in as if poured on (no reallocation, no re-seed).
//
// dt for the sim comes from frame.time deltas, not anim.dtSec: the anim
// clock advances every rAF tick while render() is frame-pace-capped, so
// dtSec under-counts the wall time a rendered frame actually covers.
const ID = "chladni";

/** Side of the square position texture that holds `count` grains. */
export function grainTextureSide(count: number): number {
  return Math.max(1, Math.ceil(Math.sqrt(Math.max(1, count))));
}

// The plate's fundamental — its lowest table mode's resonance, the square's
// (1, 2) — across the Pattern complexity slider. Every mode sits at its
// `ratio` times the fundamental ((n^2 + m^2) / FUNDAMENTAL_ORDER on the
// square), so complexity slides the whole table across the band
// ladder: a small stiff plate (0) needs treble to reach even its low modes,
// a big plate (1) has its finest lattices ringing already in the mids.
export const FUNDAMENTAL_HZ_SMALL = 560;
export const FUNDAMENTAL_HZ_LARGE = MIN_HZ;

/** Resonant frequency of `mode` on a plate at `complexity` (0..1). */
export function modeFrequencyHz(mode: PlateMode, complexity: number): number {
  const c = Math.max(0, Math.min(1, complexity));
  const f1 = FUNDAMENTAL_HZ_SMALL * Math.pow(FUNDAMENTAL_HZ_LARGE / FUNDAMENTAL_HZ_SMALL, c);
  // The square's own arithmetic, bit for bit as it always was; the baked
  // plates carry their ratio.
  if (mode.layer < 0) return (f1 * (mode.n * mode.n + mode.m * mode.m)) / FUNDAMENTAL_ORDER;
  return f1 * mode.ratio;
}

/** Where `hz` falls on the band ladder, in band units: MIN_HZ -> 0,
 *  MAX_HZ_CAP -> NUM_BANDS, band i's centre at i + 0.5. Unclamped. */
export function bandPosition(hz: number): number {
  return (NUM_BANDS * Math.log(Math.max(1e-3, hz) / MIN_HZ)) / Math.log(MAX_HZ_CAP / MIN_HZ);
}

export interface PlateResponseInputs {
  /** Pattern complexity setting, [0,1] — sets the fundamental, see above. */
  complexity: number;
  /** Resonance setting, [0,1]: 0 = damped plate (wide window, neighbours
   *  blur together), 1 = high Q (one mode wins cleanly). */
  resonance: number;
  /** Ring setting, [0,1]: how long a mode keeps ringing after its tone stops. */
  ring: number;
  /** Figure hold setting, [0,1]: how much stronger a new mode must ring to
   *  take the plate — see holdMargin. Omitted = 0, the plain model. */
  figureHold?: number;
  /** Loud ↔ New setting, [0,1]: the share of each mode's running average
   *  taken off its excitation — 0 = each band's level as it arrives, the
   *  loudest part wins; 1 = only what is above its average counts.
   *  Omitted = SURPRISE_SHARE. */
  newness?: number;
}

export interface ActiveMode extends PlateMode {
  /** This mode's share of the plate's motion; the active set sums to 1. */
  weight: number;
}

/** How many modes the shader sums. The response is sharpened enough that
 *  the rest carry a negligible share. */
export const ACTIVE_MODES = 4;

/** Resonance window width in band units across the Resonance slider. */
const WINDOW_BANDS_DAMPED = 1.6;
const WINDOW_BANDS_SHARP = 0.35;
/** Response-sharpening exponent across the Resonance slider — a high-Q
 *  plate's dominant mode wins by a wide margin. */
const SHARPEN_DAMPED = 1;
const SHARPEN_SHARP = 4;
/** Ring slider -> release seconds; attack is a fixed fraction of it. */
const RING_SEC_MIN = 0.1;
const RING_SEC_MAX = 1.5;
const ATTACK_FRACTION = 0.15;
const ATTACK_SEC_MIN = 0.03;
/** Below this summed response the plate isn't being excited at all: the
 *  last active set holds, so silence freezes the figure rather than
 *  collapsing it to nothing. */
const RESPONSE_FLOOR = 1e-9;
/** Each mode is excited by its band energy minus a share of that energy's
 *  own running average over BASELINE_SEC — see createPlateResponse. The
 *  share is the Loud ↔ New setting; SURPRISE_SHARE is its default. */
const BASELINE_SEC = 4;
export const SURPRISE_SHARE = 0.8;
/** The top mode's head start at full Figure hold. */
const HOLD_MARGIN_MAX = 3;
/** Figure hold's curve: on the tempo-eval tracks most of the effect sits in
 *  the low margins, so a squared slider spreads it across the travel. */
const HOLD_CURVE = 2;

/** The top mode's response multiplier across the Figure hold slider: 1 at
 *  0, 1 + HOLD_MARGIN_MAX at 1. */
export function holdMargin(figureHold: number): number {
  const h = Math.max(0, Math.min(1, figureHold));
  return 1 + HOLD_MARGIN_MAX * Math.pow(h, HOLD_CURVE);
}

export function ringSeconds(ring: number): number {
  return RING_SEC_MIN + Math.max(0, Math.min(1, ring)) * (RING_SEC_MAX - RING_SEC_MIN);
}

export interface PlateResponse {
  /** Steps every mode's ringing amplitude by this frame's band energies and
   *  returns the ACTIVE_MODES strongest, weights normalised to sum 1,
   *  strongest first. The returned array is reused between calls. */
  advance(dtSec: number, bands: ArrayLike<number>, inputs: PlateResponseInputs): readonly ActiveMode[];
  /** Per-table-mode ringing amplitude, for tests and the probe. */
  readonly amplitudes: Float32Array;
}

export function createPlateResponse(table: readonly PlateMode[] = MODE_TABLE): PlateResponse {
  const amplitudes = new Float32Array(table.length);
  const baseline = new Float32Array(table.length).fill(NaN);
  const sharpened = new Float32Array(table.length);
  const order = table.map((_, i) => i);
  /** Table index of the mode on top last frame — the one Figure hold's
   *  margin favours. */
  let top = 0;
  const active: ActiveMode[] = [];
  for (let k = 0; k < ACTIVE_MODES; k++) {
    const mode = table[Math.min(k, table.length - 1)];
    active.push({ ...mode, weight: k === 0 ? 1 : 0 });
  }

  return {
    amplitudes,
    advance(dtSec, bands, inputs) {
      const dt = Number.isFinite(dtSec) && dtSec > 0 ? dtSec : 0;
      const resonance = Math.max(0, Math.min(1, inputs.resonance));
      const sigma = WINDOW_BANDS_DAMPED + (WINDOW_BANDS_SHARP - WINDOW_BANDS_DAMPED) * resonance;
      const sharpen = SHARPEN_DAMPED + (SHARPEN_SHARP - SHARPEN_DAMPED) * resonance;
      const release = ringSeconds(inputs.ring);
      const attack = Math.max(ATTACK_SEC_MIN, release * ATTACK_FRACTION);
      const margin = holdMargin(inputs.figureHold ?? 0);
      const surprise = Math.max(0, Math.min(1, inputs.newness ?? SURPRISE_SHARE));
      const bandCount = Math.min(bands.length, NUM_BANDS);

      for (let k = 0; k < table.length; k++) {
        const pos = bandPosition(modeFrequencyHz(table[k], inputs.complexity));
        // Excitation: band energy under a normalised Gaussian window at
        // this mode's resonance. A mode past the top of the ladder sees
        // only the tail of the last band.
        let num = 0;
        // Normalised by the window's full mass, not the in-range sum, so a
        // resonance off the end of the ladder only sees the tail of the
        // last band instead of being renormalised up to full strength.
        const den = sigma * Math.sqrt(2 * Math.PI);
        for (let i = 0; i < bandCount; i++) {
          const d = (i + 0.5 - pos) / sigma;
          const w = Math.exp(-0.5 * d * d);
          num += w * Math.max(0, bands[i]);
        }
        const raw = num / den;
        // Measured against this mode's own running average, so a constant
        // spectral tilt — the music's bass-heavy balance, or a mic's noise
        // floor — can't hand one mode the plate for good: what wins is the
        // mode whose part of the spectrum is busier than usual right now. A
        // held tone keeps 1 - surprise of its level, so below New's end of
        // the slider it still holds its figure rather than fading to nothing.
        if (Number.isNaN(baseline[k])) baseline[k] = raw;
        baseline[k] += (raw - baseline[k]) * (1 - Math.exp(-dt / BASELINE_SEC));
        const excitation = Math.max(0, raw - surprise * baseline[k]);
        const tau = excitation > amplitudes[k] ? attack : release;
        amplitudes[k] += (excitation - amplitudes[k]) * (1 - Math.exp(-dt / tau));
        sharpened[k] = Math.pow(k === top ? amplitudes[k] * margin : amplitudes[k], sharpen);
      }

      order.sort((a, b) => sharpened[b] - sharpened[a]);
      let sum = 0;
      for (let k = 0; k < ACTIVE_MODES; k++) sum += sharpened[order[k]];
      if (sum < RESPONSE_FLOOR) return active;

      for (let k = 0; k < ACTIVE_MODES; k++) {
        const mode = table[order[k]];
        const slot = active[k];
        slot.n = mode.n;
        slot.m = mode.m;
        slot.sign = mode.sign;
        slot.ratio = mode.ratio;
        slot.cells = mode.cells;
        slot.layer = mode.layer;
        slot.desc = mode.desc;
        slot.weight = sharpened[order[k]] / sum;
      }
      top = order[0];
      return active;
    },
  };
}

/** Per-grain brightness gain so a sparse floor-quality bed reads about as
 *  bright as a dense high-quality one. Anchored at the top quality tier's
 *  grain count = gain 1, so no preset renders dimmer than the best one. */
export const REFERENCE_GRAINS = 200_000;
export function grainGain(count: number): number {
  return Math.max(0.5, Math.min(6, Math.sqrt(REFERENCE_GRAINS / Math.max(1, count))));
}

/** Top of the Sand amount slider: the grain pool is this many times the
 *  quality tier's count, allocated once at init. */
export const SAND_AMOUNT_MAX = 5;

/** The bed may cover at most this fraction of the plate at Sand amount 1
 *  (the cap scales with the amount above that). Past it, every
 *  pixel is the topmost grain and both the sand and the figure stop
 *  reading — see the file header. */
export const MAX_BED_COVERAGE = 0.55;

/** The grain weight at which every weight factor in SIM_FRAG is 1 and a grain
 *  is drawn at exactly Grain size — the plate as it was before grains had a
 *  weight, and Grain weight's default. See the file header. */
export const WEIGHT_REF = 0.7;
/** Drawn size doubles every 1/SIZE_PER_WEIGHT of weight: dust is about a
 *  third the size of the heaviest grit. */
export const SIZE_PER_WEIGHT = 1.6;
/** Size mix's default: about the ±25% size scatter grains had before they
 *  had a weight. */
export const SIZE_MIX_DEFAULT = 0.45;
/** Grains at least this heavy are too heavy for the air streaming to carry
 *  (grainLightness in CHLADNI_GLSL). Below WEIGHT_REF, so the default bed
 *  is all sand except its lightest few grains. */
const GRAIN_HEAVY = 0.6;
/** Powder colour: grains lighter than POWDER_SPLIT are drawn as powder, with a
 *  soft edge POWDER_EDGE either side so a mixed bed reads as two materials,
 *  not a gradient. The split is where the sorting flips: on a CPU port of
 *  SIM_FRAG, lighter grains end up heaped on the antinodes and heavier ones
 *  on the lines, at every drive from near the freeze edge to the snap edge
 *  (docs/scenes/chladni.md, Measurements). */
export const POWDER_SPLIT = 0.45;
export const POWDER_EDGE = 0.05;
/** A thrown powder grain runs this far toward white, as thrown grit runs up
 *  to the ramp's bright end. */
const POWDER_THROWN_LIFT = 0.2;
/** Every grain's fixed shade runs from SHADE_LO to SHADE_LO + SHADE_SPAN
 *  times the bed's brightness, so a pile reads as grains (POINT_VERT). */
const SHADE_LO = 0.8;
const SHADE_SPAN = 0.4;

/** Thrown to's choices, in value order: where a thrown grain's colour goes
 *  (Thrown colour sets how far). See the file header's sand colour section. */
export const THROWN_TO = ["Toward white", "Second colour", "Through the palette", "Into shadow"] as const;
/** Into shadow: a fully thrown grain keeps this share of its brightness. */
const SHADOW_KEEP = 0.12;
/** The share of a full throw by which the Thrown to choices other than
 *  Toward white have arrived (measured on Neon: Toward white reads white
 *  from about a quarter of a throw, its ramp clipped by the brightness gain). */
const THROWN_REACH = 0.4;
/** Two sides: the width either side of a still line, in field units (|f| <= 2),
 *  over which a grain's colour changes sides. */
const SIDE_EDGE = 0.04;
/** Two sides on the plate's glow: the second colour scaled to sit near the
 *  ramp's middle, where the glow's own colour sits. */
const SIDE_GLOW_INK = 0.6;
/** Embers: the heat a fully thrown grain gains per second (heat runs 0..1);
 *  Ember fade sets how fast rest cools it. */
export const EMBER_HEAT_RATE = 4;
/** Embers at 1: a cold grain keeps this share of its brightness. */
const EMBER_COLD = 0.05;
/** Embers: how a grain's heat turns into glow — a square root, so sand
 *  rattling on a line under loud music still glows faintly instead of
 *  reading as cold as sand in silence. */
const EMBER_GLOW_POWER = 0.5;
/** One grain in EMBER_HALO_ONE_IN (times the Sand amount above 1, as the
 *  Glow's glints) carries the ember halo, for the fill-rate reason the
 *  Glow's glints give. */
const EMBER_HALO_ONE_IN = 6;
/** The heat a halo carrier starts to glow at, the heat its halo is full at,
 *  and how strong a full halo is (a Glow glint's is 1). Below 1 because a
 *  toss heats the whole bed at once: at 1, one carrier in three flooded the
 *  screen with colour on a real drop. */
const EMBER_HALO_FROM = 0.15;
const EMBER_HALO_FULL = 0.8;
const EMBER_HALO_MAX = 0.6;
/** Spectrum rings: history rows written per second, rows kept, and how fast
 *  a ring runs out from the centre (plate units per second). The history
 *  must outlast a ring's run to the square's corner. */
export const SPEC_RATE = 60;
export const SPEC_ROWS = 128;
export const SPEC_SPEED = 0.8;
/** Each band is written as its share of its own recent peak (decaying over
 *  SPEC_PEAK_SEC, never below SPEC_PEAK_FLOOR), as a spectrogram's colour
 *  scale adapts: the music is always loudest in the bass, and absolute
 *  levels left the treble side of the plate dark. */
export const SPEC_PEAK_SEC = 4;
const SPEC_PEAK_FLOOR = 0.05;
/** A ring's brightness over that share: stretched from SPEC_QUIET (dark) to
 *  SPEC_LOUD (full), so a band's rise and fall reads as a ring rather than a
 *  steady wash; a quiet floor keeps the figure visible. */
const SPEC_QUIET = 0.45;
const SPEC_LOUD = 1.0;
const SPEC_FLOOR = 0.1;
const SPEC_GAIN = 1.5;
/** Beat waves: how fast a wave runs out from the centre (plate units per
 *  second: about a beat at 120 BPM to the plate's edge, so the last wave's
 *  colour still shows outside the new one) and how far it goes before it
 *  stops dyeing (past the square's corner). */
export const WAVE_SPEED = 2;
export const WAVE_REACH = 1.5;
/** Glitter: how narrowly a shard must face the light to flash, the flash's
 *  brightness and growth, how much it dims the rest of the sand at 1 (so the
 *  flashes stand out), and how often a thrown grain tumbles to a new angle
 *  (per second), from a hop of TUMBLE_MOTION up. */
const GLINT_POWER = 48;
const GLITTER_GAIN = 2.4;
const GLITTER_GROW = 1.5;
const GLITTER_DIM = 0.55;
const TUMBLE_HZ = 10;
const TUMBLE_MOTION = 0.08;

/** A beat wave: how many have started (the id the sim stamps on the sand it
 *  dyes) and when the last one did (frame.time, seconds). */
export interface WaveState {
  count: number;
  at: number;
}

/** Steps the beat wave by one rendered frame: a fired edge starts the next
 *  one from the centre. `radius` is how far the wave in play has run, or -1
 *  while none is (it has run past WAVE_REACH, none has started, or the audio
 *  clock went back past its start, a new source). */
export function advanceWave(last: WaveState, now: number, fired: boolean): { wave: WaveState; radius: number } {
  const wave = fired ? { count: last.count + 1, at: now } : last;
  const radius = (now - wave.at) * WAVE_SPEED;
  return { wave, radius: wave.count > 0 && now >= wave.at && radius <= WAVE_REACH ? radius : -1 };
}

/** How much a grain of weight `w` is drawn in the powder colour at Powder
 *  colour 1. Mirrors powderShare in CHLADNI_GLSL. */
export function powderShare(w: number): number {
  const t = Math.max(0, Math.min(1, (w - (POWDER_SPLIT - POWDER_EDGE)) / (2 * POWDER_EDGE)));
  return 1 - t * t * (3 - 2 * t);
}

/** One grain's weight in [0,1] (0 = fine powder, 1 = heavy grit), from its
 *  fixed per-grain draw `u` in [0,1]: the bed's Grain weight, spread by Size
 *  mix (1 = half the range either side). Mirrors grainWeight in CHLADNI_GLSL. */
export function grainWeightAt(u: number, weight: number, mix: number): number {
  return Math.max(0, Math.min(1, weight + mix * (u - 0.5)));
}

/** Drawn size of a grain of weight `w` relative to Grain size. Mirrors
 *  grainSizeFactor in CHLADNI_GLSL. */
export function grainSizeFactor(w: number): number {
  return 2 ** (SIZE_PER_WEIGHT * (w - WEIGHT_REF));
}

/** E[grainSizeFactor^2] over the bed's grains (u ~ Uniform(0,1)) — the mean
 *  covered area per grain relative to one drawn at Grain size, for
 *  drawnGrainCount. A midpoint sum, since the clamp in grainWeightAt has no
 *  tidy closed form. */
export function grainSizeMoment(weight: number, mix: number): number {
  const SAMPLES = 32;
  let sum = 0;
  for (let i = 0; i < SAMPLES; i++) sum += grainSizeFactor(grainWeightAt((i + 0.5) / SAMPLES, weight, mix)) ** 2;
  return sum / SAMPLES;
}

/** How many of `count` grains to draw so the bed stays under
 *  MAX_BED_COVERAGE: bigger grains mean fewer of them, as with a fixed
 *  amount of real sand rather than a fixed grain count. `grainPx` is the
 *  on-screen grain diameter (Grain size after the resolution scale
 *  POINT_VERT applies, before the shard-area and halo growth also applied
 *  there — both roughly wash out between the shard and the disc it
 *  replaced), `platePx2` the plate's area in pixels. `count` is the
 *  quality tier's grain count and `amount` (the Sand amount setting,
 *  clamped to [0, SAND_AMOUNT_MAX]) scales it; the coverage cap then
 *  applies, itself scaled by the amount above 1 so more sand really means a
 *  denser bed. 0 draws nothing (a bare plate). `sizeM2` is the bed's mean
 *  squared size factor (grainSizeMoment), so a bed of dust fits more grains
 *  than one of grit. */
export function drawnGrainCount(
  count: number,
  grainPx: number,
  platePx2: number,
  amount = 1,
  sizeM2 = grainSizeMoment(WEIGHT_REF, SIZE_MIX_DEFAULT),
): number {
  const a = Math.max(0, Math.min(SAND_AMOUNT_MAX, amount));
  const desired = Math.round(count * a);
  if (desired === 0) return 0;
  const areaPerGrain = (Math.PI / 4) * grainPx * grainPx * sizeM2;
  const fits = Math.floor((MAX_BED_COVERAGE * Math.max(1, a) * platePx2) / Math.max(1e-6, areaPerGrain));
  return Math.max(1, Math.min(desired, fits));
}

// Glow's default wires: the slewed treble level and the treble onset pulse,
// summed with these weights. POINT_VERT's vGlow sum uses the same pair, so
// the default patch draws exactly what the old built-in reaction did.
const GLOW_LEVEL_WEIGHT = 0.8;
const GLOW_HIT_WEIGHT = 1.4;

/** After a toss, further toss edges are ignored for this long, so one drop
 *  throws the bed once. Longer than any flight (tossLongestFlight). */
export const TOSS_REFRACTORY_SEC = 4;
/** No toss while the audio clock is younger than this. frame.time is the
 *  capture's AudioContext clock, which starts at 0 for every new source
 *  (page load, clicking Mic, a new input), and the app's Drop fires about
 *  half a second into any music, just as the first figure forms: without
 *  this, every start would throw that figure into the air. */
export const TOSS_ARM_SEC = 2;
/** A grain's flight time at full Toss, for the mean grain; each grain's own
 *  is spread by TOSS_TIME_SPREAD around it, and a weaker toss is shorter
 *  (tossLaunch). */
export const TOSS_FLIGHT_SEC = 0.9;
/** Spread of the grains' flight times, as a fraction of the mean: narrow,
 *  so the bed rises and lands as one shape. */
const TOSS_TIME_SPREAD = 0.06;
/** tossLaunch at Toss 0+: the weakest toss still flies this share of a
 *  full one's time. */
const TOSS_LAUNCH_MIN = 0.4;
/** Peak height of the mean grain's arc at full Toss, in plate half-heights,
 *  drawn as a lift up the screen. Ballistic: it grows with the square of
 *  the flight time. */
const TOSS_LIFT = 0.6;
/** Radius of the disc a grain lands in around where it took off, in plate
 *  units (the plate is 2 across) at full Toss; scales with the power. */
const TOSS_SPREAD = 0.8;
/** How much bigger a grain is drawn at the top of a full toss's arc (divided
 *  by the Sand amount above 1, as TOSS_BRIGHT is). */
const TOSS_GROW = 0.6;
/** How much brighter a grain is drawn at the top of a full toss's arc. */
const TOSS_BRIGHT = 0.5;
/** The arc height (relative to a full toss's mean peak) at which a grain in
 *  the air is drawn at the palette ramp's brightest end, as a thrown grain. */
const TOSS_WHITE_RISE = 0.5;
/** The ages the shaders get while no toss is in the air: past every
 *  flight, so no grain reads as airborne or landing. */
export const TOSS_IDLE_AGE = 1e4;

/** One toss: when it started (frame.time, seconds), the seed every grain's
 *  flight is hashed from, and its power (the Toss setting when it fired). */
export interface TossEvent {
  at: number;
  seed: number;
  power: number;
}

/** A new toss, or null for none: only on a fired edge, only with Toss above
 *  0, only once the audio clock is TOSS_ARM_SEC old, and only
 *  TOSS_REFRACTORY_SEC after the last one. */
export function nextToss(
  last: TossEvent | null,
  now: number,
  fired: boolean,
  toss: number,
  seed: number,
): TossEvent | null {
  if (!fired) return null;
  if (now < TOSS_ARM_SEC) return null;
  const power = Math.max(0, Math.min(1, toss));
  if (power <= 0) return null;
  // A clock that went backwards (a new audio source) ends the refractory
  // rather than holding it until the clock catches up.
  if (last && now >= last.at && now - last.at < TOSS_REFRACTORY_SEC) return null;
  return { at: now, seed, power };
}

/** How hard a toss of `power` launches the sand, relative to a full one:
 *  flight time scales with it, height with its square. Mirrored by tossFlight
 *  in TOSS_GLSL. */
export function tossLaunch(power: number): number {
  return TOSS_LAUNCH_MIN + (1 - TOSS_LAUNCH_MIN) * Math.max(0, Math.min(1, power));
}

/** The longest any grain stays in the air, at full Toss. */
export function tossLongestFlight(): number {
  return TOSS_FLIGHT_SEC * tossLaunch(1) * (1 + TOSS_TIME_SPREAD);
}

/** A rendered frame's toss: the toss in play (null for none) and the ages
 *  the shaders get, seconds since it started on this frame and the one
 *  before, both TOSS_IDLE_AGE while nothing of it is in the air. */
export interface TossFrame {
  toss: TossEvent | null;
  age: number;
  prevAge: number;
}

/** Steps the toss by one rendered frame: drops it if the audio clock went
 *  back past its start (a new source restarts frame.time at 0, so the old
 *  toss is over and must never play again when the new clock reaches it),
 *  starts a new one if nextToss says so (drawing its seed only then, so an
 *  ignored edge takes nothing from Math.random), and works out the ages. */
export function advanceToss(
  last: TossEvent | null,
  now: number,
  prevFrameTime: number | null,
  fired: boolean,
  power: number,
  drawSeed: () => number,
): TossFrame {
  let toss = last && now < last.at ? null : last;
  const started = nextToss(toss, now, fired, power, 0);
  if (started) toss = { ...started, seed: drawSeed() };
  if (!toss) return { toss, age: TOSS_IDLE_AGE, prevAge: TOSS_IDLE_AGE };
  // The frame the toss starts on has no "before": -1 puts it before every
  // flight's end.
  const prevAge = prevFrameTime === null || prevFrameTime < toss.at ? -1 : prevFrameTime - toss.at;
  if (prevAge > tossLongestFlight()) return { toss, age: TOSS_IDLE_AGE, prevAge: TOSS_IDLE_AGE };
  return { toss, age: Math.min(now - toss.at, TOSS_IDLE_AGE), prevAge };
}

/** A number as a GLSL float literal at full precision, so a shader's copy of
 *  a constant is the TS value exactly (toFixed would round a retune). */
export function glslFloat(x: number): string {
  const s = String(x);
  return /[.eE]/.test(s) ? s : `${s}.0`;
}

const SETTINGS: SceneSetting[] = [
  {
    key: "complexity",
    label: "Pattern complexity",
    description: "In effect the plate's size: a bigger plate's resonances sit lower, so the music reaches finer figures",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    // Bright, busy mixes reach the plate's finer modes.
    auto: { brightness: 0.35, density: 0.2 },
  },
  {
    key: "resonance",
    label: "Resonance",
    description: "How sharply the plate picks one figure: high = one clean mode wins, low = a damped plate blurs neighbouring modes together",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    // A dense mix needs a sharper plate to stay legible.
    auto: { density: 0.2, pulse: 0.15 },
  },
  {
    key: "ring",
    label: "Ring",
    description: "How long a figure keeps ringing after its tone stops",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.4,
    // Fast, percussive music wants a quicker-decaying plate.
    auto: { tempo: -0.25, attack: -0.15 },
  },
  {
    key: "figureHold",
    label: "Figure hold",
    description: "How firmly the plate keeps its figure: 0, the figure follows whichever part of the music is busiest right now; higher, a new figure must ring clearly stronger than the one on the plate to take over",
    // Manual — how restless the plate should look is a taste call, not a
    // property of the track.
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0,
  },
  {
    key: "newness",
    label: "Loud ↔ New",
    description: "Which part of the music takes the plate: toward Loud, whichever part is loudest right now; toward New, whichever part just got louder than usual",
    // Manual, like Figure hold: how the plate should listen is a taste call,
    // not a property of the track.
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: SURPRISE_SHARE,
  },
  {
    key: "plateShape",
    label: "Plate",
    description: "The plate the sand lies on; each shape rings its own figures. Clamped is the square held at its edges",
    // Manual, like every enum: which plate is a choice, not a property of the track.
    group: "Form",
    min: 0,
    max: PLATE_SHAPES.length - 1,
    step: 1,
    default: SQUARE,
    type: "enum",
    options: PLATE_SHAPES,
  },
  {
    // The key predates the other plates; saved looks and share codes carry it.
    key: "squarePlate",
    label: "True shape",
    description: "For the square plate only. On, it keeps its square shape in the middle of the screen; off, it stretches to fill the screen. The other plates always keep their shape",
    group: "Form",
    min: 0,
    max: 1,
    step: 1,
    default: 0,
    type: "boolean",
  },
  {
    key: "plateZoom",
    label: "Zoom",
    description: "How big the plate is: 1 fits it on screen, higher looks closer into its middle, lower shrinks it",
    // Manual: framing is taste.
    group: "Form",
    min: 0.5,
    max: 3,
    step: 0.05,
    default: 1,
    // Framing, not an amount: the Master dial must not crop the plate.
    masterScale: false,
  },
  {
    key: "grainSize",
    label: "Grain size",
    description: "Size of each sand grain on screen",
    group: "Form",
    min: 0.5,
    max: 3,
    step: 0.1,
    default: 1.8,
  },
  {
    key: "sandAmount",
    label: "Sand amount",
    description: "How much sand lies on the plate — 0 leaves it bare, 1 is the classic bed, more piles thicker lines; per-grain brightness is unchanged",
    // Manual like Grain size — a taste dial, not something to retune per track.
    group: "Form",
    min: 0,
    max: SAND_AMOUNT_MAX,
    step: 0.05,
    default: 1,
  },
  {
    key: "grainWeight",
    label: "Grain weight",
    description: "Left fine powder, right heavy grit: heavy grains bounce to the still lines, light ones drift with the air into heaps where the plate moves most",
    // Manual like Grain size — what the plate is sprinkled with, a taste dial.
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: WEIGHT_REF,
  },
  {
    key: "sizeMix",
    label: "Size mix",
    description: "Left every grain alike, right a mix from dust to grit, which the plate sorts: grit draws the lines, dust gathers between them",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: SIZE_MIX_DEFAULT,
  },
  {
    key: "shake",
    label: "Vibration",
    description: "How hard the music shakes the plate — a quiet plate shimmers its sand, a loud one throws it",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    // A loud, dynamic room drives the plate harder.
    auto: { loudness: 0.3, dynamics: 0.15 },
    // uEnergy directly (inside the shake*(0.25+2.4*...) formula, SIM_FRAG) — a plain All level default.
    drive: { default: "anim.energy" },
  },
  {
    key: "kick",
    label: "Bass kick",
    description: "A bass hit throws the sand off its lines; the figure re-forms as it settles",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    // Dark, bass-heavy mixes carry more kick presence to throw on.
    auto: { brightness: -0.3, attack: 0.25 },
    // uLowPulse directly — a plain Bass hit default.
    drive: { default: "anim.lowOnset" },
  },
  {
    key: "toss",
    label: "Toss",
    description: "On a drop the bed is thrown up and lands scattered; higher throws it higher and wider; 0 never tosses",
    // Manual — how hard a drop throws the sand is taste, not a property of
    // the track. The jack's edge starts a toss (nextToss); the slider is its power.
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    drive: { default: "anim.dropOnset", hit: { reactionLabel: "toss" } },
  },
  {
    key: "zoomOut",
    label: "Zoom out",
    description: "Square plate only: the plate pulls back for ever, its figure shrinking as a bigger one grows in; higher is faster, 0 is off. While on, the plate fills the screen unstretched, so True shape does nothing",
    // Manual: how fast to drift is taste. Speed is the slider times its jack
    // (zoomPhaseStep), so silence stops the zoom as it freezes the figure.
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0,
    drive: { default: "anim.energy" },
  },
  {
    key: "freezeEdge",
    label: "Freeze edge",
    description: "Plate drive below which the sand holds still and the figure stays put",
    // Drawn as a handle on the Sand zones gauge (sandZones widget), not a row.
    // Manual: the gauge shows stored edges, so Auto would make it lie.
    group: "Motion",
    min: 0.05,
    max: ZONE_AXIS_MAX - 0.2,
    step: 0.05,
    default: FREEZE_REF,
  },
  {
    key: "snapEdge",
    label: "Snap edge",
    description: "Plate drive above which the sand jumps onto a new figure within a beat or two",
    group: "Motion",
    min: 0.15,
    max: ZONE_AXIS_MAX,
    step: 0.05,
    default: SNAP_REF,
  },
  {
    key: "fieldGlow",
    label: "Plate glow",
    description: "A faint glow where the plate is moving, under the sand",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.25,
    // A louder room lights the plate a little more.
    auto: { loudness: 0.2 },
    // uEnergy directly (BG_FRAG) — a plain All level default.
    drive: { default: "anim.energy" },
  },
  {
    key: "grainGlow",
    label: "Grain brightness",
    description: "How bright the sand is; piles on the lines add up",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    auto: { loudness: 0.15 },
  },
  {
    key: "powderColour",
    label: "Powder colour",
    description: "Draws the light grains, which the air heaps between the lines, in a second colour. Shows only when the bed has light grains: move Grain weight left and Size mix right",
    // Manual like Grain weight: which colours the sand comes in is taste.
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0,
  },
  {
    key: "thrownColour",
    label: "Thrown colour",
    description: "How far a grain's colour moves while it is thrown: 0 keeps its resting colour, 1 is the usual, 2 moves it at the lightest hop. Thrown to picks where it goes",
    // Manual like Powder colour: how the sand is coloured is taste.
    group: "Look",
    family: "thrown",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
  },
  {
    key: "thrownTo",
    label: "Thrown to",
    description: "Where a thrown grain's colour goes: up the palette to white, to the second colour, through the palette's colours, or dark",
    group: "Look",
    family: "thrown",
    min: 0,
    max: THROWN_TO.length - 1,
    step: 1,
    default: 0,
    type: "enum",
    options: THROWN_TO,
  },
  {
    key: "twoSides",
    label: "Two sides",
    description: "Colours each grain by its side of the still line it lies by: the plate moves up on one side while the other goes down. One side keeps the sand colour, the other takes the second colour, and the plate's glow shows the same checkerboard",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0,
  },
  {
    key: "embers",
    label: "Embers",
    description: "Hops heat the sand and rest cools it: hot sand glows in pure colour like neon, with a halo, and sand that has rested goes nearly dark. 0 is off",
    group: "Look",
    family: "embers",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0,
  },
  {
    key: "emberFade",
    label: "Ember fade",
    description: "Seconds hot sand takes to cool: short, only the sand being thrown right now glows; long, the lines a loud part left behind keep glowing",
    group: "Look",
    family: "embers",
    min: 0.25,
    max: 8,
    step: 0.25,
    default: 2,
    // A time, not an amount: the Master dial must not change it.
    masterScale: false,
  },
  {
    key: "spectrumRings",
    label: "Spectrum rings",
    description: "Colours the sand with the music's spectrum flowing out from the centre in rings: around the plate is pitch, bass at the top and treble at the bottom; further out is longer ago",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0,
  },
  {
    key: "beatWaves",
    label: "Beat waves",
    description: "On each beat a wave runs out from the centre and dyes the sand it passes in the next palette colour; the sand carries the dye as it moves, until the next wave",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0,
    // The jack's edge starts a wave (advanceWave); the slider is how much of the dye shows.
    drive: { default: "feature.onset", hit: { flatOnly: "A wave either runs or it doesn't, so it can't be sized.", reactionLabel: "wave" } },
  },
  {
    key: "glitter",
    label: "Glitter",
    description: "Each grain is a flat shard: a light circles the plate once a bar, and the grains facing it flash in the palette's colours. Thrown grains tumble and twinkle",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0,
  },
  {
    key: "highGlow",
    label: "Glow",
    description: "Each grain blooms with a soft halo when its wires light up — the treble (hats and cymbals) to start",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    // Directly the hats/cymbals dial, as caustics' sparkle.
    auto: { brightness: 0.35, attack: 0.15 },
    // Two real wires (the slewed high level and its onset pulse), weighted
    // as POINT_VERT's vGlow sum — never a built-in, so nothing shows as a
    // ghost wire: it's either plugged in or not.
    drive: {
      default: {
        mix: "add",
        sources: [
          { choice: "anim.high", weight: GLOW_LEVEL_WEIGHT },
          { choice: "anim.highOnset", weight: GLOW_HIT_WEIGHT },
        ],
      },
    },
  },
  {
    key: "beatFlash",
    label: "Flash",
    description: "Brightness punch on each beat — the sand and the plate both flare",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    // Same reasoning as caustics' flash: punches read on punchy, uncluttered material.
    auto: { attack: 0.3, pulse: 0.2, density: -0.15 },
    // uBeatPulse directly, at both sites it's used (BG_FRAG's plate flash
    // and POINT_FRAG's grain brightness) — a plain Beat default.
    drive: { default: "feature.onset" },
  },
];

function settingFor(key: string): SceneSetting {
  const s = SETTINGS.find((x) => x.key === key);
  if (!s) throw new Error(`chladni: unknown setting ${key}`);
  return s;
}

const SETTINGS_UNIFORMS_GLSL = SETTINGS.map((s) => `uniform float ${settingUniformName(s.key)};`).join("\n");
const DRIVE_UNIFORMS_GLSL = DRIVE_GLSL(SETTINGS);

/** Fraction of the room's shorter axis the square plate's half-side spans. */
const SQUARE_PLATE_HALF = 0.46;

// Shared by all three programs so the plate function, its gradient, the
// plate-to-room mapping and the position packing can't drift apart.
const CHLADNI_GLSL = `
const int ACTIVE_MODES = ${ACTIVE_MODES};
// Square: n, m, sign, weight. A baked plate: atlas layer, 0, 0, weight.
uniform vec4 uModes[ACTIVE_MODES];
// The plate's outline (chladniPlates.ts's PlateOutline): centre, apothem,
// sides (0 = a circle, 4 = the square [-1,1]^2), and the angle of the first
// edge's outward normal from +y.
uniform vec4 uOutline;
uniform float uOutlineTurn;
// A baked plate's figures, one layer each: R = f, G,B = df/dx, df/dy.
uniform highp sampler2DArray uPlateAtlas;
#ifdef ZOOM_OUT
// Zoom out's layers (chladniZoom.ts), coarsest first: x = scale, y = weight
// (summing to 1).
uniform vec2 uZoomLayer[${ZOOM_LAYERS}];
#endif
const float PI = 3.14159265;

float chladni(vec2 p, vec4 mode) {
  float n = mode.x, m = mode.y;
  return cos(n * PI * p.x) * cos(m * PI * p.y) + mode.z * cos(m * PI * p.x) * cos(n * PI * p.y);
}

vec2 chladniGrad(vec2 p, vec4 mode) {
  float n = mode.x, m = mode.y;
  vec2 g1 = vec2(-n * PI * sin(n * PI * p.x) * cos(m * PI * p.y),
                 -m * PI * cos(n * PI * p.x) * sin(m * PI * p.y));
  vec2 g2 = vec2(-m * PI * sin(m * PI * p.x) * cos(n * PI * p.y),
                 -n * PI * cos(m * PI * p.x) * sin(n * PI * p.y));
  return g1 + mode.z * g2;
}

// A baked plate's active figures at p, summed by weight: f, df/dx, df/dy.
// Each layer peaks at |f| = 2 like one square mode (chladniPlates.ts).
vec3 atlasField(vec2 p) {
  vec2 uv = p * 0.5 + 0.5;
  vec3 s = vec3(0.0);
  for (int k = 0; k < ACTIVE_MODES; k++) {
    if (uModes[k].w > 0.0) s += uModes[k].w * texture(uPlateAtlas, vec3(uv, uModes[k].x)).rgb;
  }
  return s;
}

#ifdef ZOOM_OUT
// Zoom out: the square's active modes at every layer's scale, summed by the
// layers' weights (which sum to 1, so |f| <= 2 still); the gradient by the
// chain rule. Off the plate's [-1,1]^2 the cosines just carry on, which is
// the plate mirrored across its edges: an unbounded plate.
vec3 zoomField(vec2 p) {
  vec3 s = vec3(0.0);
  for (int j = 0; j < ${ZOOM_LAYERS}; j++) {
    vec2 layer = uZoomLayer[j];
    if (layer.y <= 0.0) continue;
    vec2 q = p * layer.x;
    vec3 f = vec3(0.0);
    for (int k = 0; k < ACTIVE_MODES; k++) f += uModes[k].w * vec3(chladni(q, uModes[k]), chladniGrad(q, uModes[k]));
    s += layer.y * vec3(f.x, layer.x * f.yz);
  }
  return s;
}
#endif

// The plate's motion: the active modes summed by their share of the
// response. Weights sum to 1, so |field| <= 2 and amp() stays in [0,1].
// uPlateShape 0 is the square, analytic as it always was.
float field(vec2 p) {
  if (uPlateShape > 0.5) return atlasField(p).x;
#ifdef ZOOM_OUT
  return zoomField(p).x;
#else
  float f = 0.0;
  for (int k = 0; k < ACTIVE_MODES; k++) f += uModes[k].w * chladni(p, uModes[k]);
  return f;
#endif
}
vec2 fieldGrad(vec2 p) {
  if (uPlateShape > 0.5) return atlasField(p).yz;
#ifdef ZOOM_OUT
  return zoomField(p).yz;
#else
  vec2 g = vec2(0.0);
  for (int k = 0; k < ACTIVE_MODES; k++) g += uModes[k].w * chladniGrad(p, uModes[k]);
  return g;
#endif
}
// Both at once: one atlas read (or one pass over the zoom's layers) per
// figure instead of two.
vec3 fieldWithGrad(vec2 p) {
  if (uPlateShape > 0.5) return atlasField(p);
#ifdef ZOOM_OUT
  return zoomField(p);
#else
  return vec3(field(p), fieldGrad(p));
#endif
}
float amp(vec2 p) { return abs(field(p)) * 0.5; }

// Half-extent of the plate's [-1,1]^2 in room uv, times Zoom. The square
// with True shape on, every other plate, and the square while Zoom out runs:
// fits the shorter axis with a margin, centred. The square with it off: the
// whole frame.
vec2 plateHalf() {
  float aspect = uResolution.x / uResolution.y;
  float h = ${SQUARE_PLATE_HALF.toFixed(2)};
  vec2 square = aspect >= 1.0 ? vec2(h / aspect, h) : vec2(h, h * aspect);
#ifdef ZOOM_OUT
  return square * uPlateZoom;
#else
  return (uSquarePlate > 0.5 || uPlateShape > 0.5 ? square : vec2(0.5)) * uPlateZoom;
#endif
}

// Where grains live. Normally that is plate space itself. While Zoom out runs
// the plate has no edge, so the sand lies on the whole frame instead, grown
// by ZOOM_SAND_MARGIN on every side: grain space [-1,1]^2 is that area, and
// a grain's plate point is its grain point times the area's half-extent in
// plate units (true aspect, no stretch). insidePlate, respawnOnPlate and the
// toss's landing all work in grain space, where that area is the square's
// outline. Macros, so the shaders without the zoom read exactly as they did
// before it.
#ifdef ZOOM_OUT
// Grain space's half-extent in room uv.
#define GRAIN_HALF vec2(${glslFloat(0.5 * (1 + ZOOM_SAND_MARGIN))})
vec2 grainExtent() { return GRAIN_HALF / plateHalf(); }
#define GRAIN_TO_PLATE(q) ((q) * grainExtent())
#define PLATE_TO_GRAIN(p) ((p) / grainExtent())
// Zoom's grain growth (POINT_VERT): none, the sand covers the frame at any Zoom.
#define GRAIN_ZOOM 1.0
#else
#define GRAIN_TO_PLATE(q) q
#define GRAIN_HALF plateHalf()
#define GRAIN_ZOOM uPlateZoom
#endif

// <= 1 on the plate, 1 on its rim (the outline's gauge). Mirrors plateGauge
// in chladniPlates.ts.
float plateGauge(vec2 p) {
  float sides = uOutline.w;
  if (sides > 3.5 && sides < 4.5) return max(abs(p.x), abs(p.y));
  vec2 q = p - uOutline.xy;
  if (sides < 0.5) return length(q) / uOutline.z;
  float k = PI / sides;
  float a = atan(q.x, q.y) - uOutlineTurn;
  return length(q) * cos(mod(a + k, 2.0 * k) - k) / uOutline.z;
}
bool insidePlate(vec2 p) { return plateGauge(p) <= 1.0; }

// 16-bit fixed point per axis across RGBA8 — see file header.
vec2 unpackPos(vec4 c) {
  vec4 b = floor(c * 255.0 + 0.5);
  vec2 v = vec2(b.r * 256.0 + b.g, b.b * 256.0 + b.a) / 65535.0;
  return v * 2.0 - 1.0;
}

vec4 packPos(vec2 p) {
  vec2 v = clamp(p * 0.5 + 0.5, 0.0, 1.0) * 65535.0;
  vec2 hi = floor(v / 256.0);
  vec2 lo = floor(v - hi * 256.0 + 0.5);
  return vec4(hi.x, lo.x, hi.y, lo.y) / 255.0;
}

${FLOAT_HASH_GLSL}

// A fresh spot for spilled sand, spread evenly over the plate's area. Mirrors
// respawnPoint in chladniPlates.ts: a polygon picks one of its equal
// centre-to-edge triangles and folds the unit square onto it, so no draw is
// ever thrown away.
vec2 respawnOnPlate(vec2 seed) {
  vec2 u = hash22(seed);
  float sides = uOutline.w;
  if (sides > 3.5 && sides < 4.5) return u * 2.0 - 1.0;
  if (sides < 0.5) {
    float r = sqrt(u.x) * uOutline.z;
    float a = 2.0 * PI * u.y;
    return uOutline.xy + r * vec2(sin(a), cos(a));
  }
  float s = u.x * sides;
  float i = min(floor(s), sides - 1.0);
  vec2 ab = vec2(s - i, u.y);
  if (ab.x + ab.y > 1.0) ab = 1.0 - ab;
  float k = PI / sides;
  float r = uOutline.z / cos(k);
  float t = uOutlineTurn + 2.0 * k * i;
  return uOutline.xy + r * (ab.x * vec2(sin(t - k), cos(t - k)) + ab.y * vec2(sin(t + k), cos(t + k)));
}

// A grain's weight, 0 = fine powder .. 1 = heavy grit, from a fixed per-grain
// draw keyed by its texel — the sim and the point pass read the same one, so
// a grain's size and its physics are one property. Mirrors grainWeightAt.
float grainWeight(vec2 texel) {
  float u = hash22(texel * 0.731 + 3.17).x;
  return clamp(uGrainWeight + uSizeMix * (u - 0.5), 0.0, 1.0);
}
// Drawn size relative to Grain size. Mirrors grainSizeFactor.
float grainSizeFactor(float w) {
  return exp2(${SIZE_PER_WEIGHT.toFixed(2)} * (w - ${WEIGHT_REF.toFixed(2)}));
}
// How much the air streaming carries a grain: all of fine powder, none of
// anything at least as heavy as GRAIN_HEAVY.
float grainLightness(float w) {
  return 1.0 - smoothstep(0.0, ${GRAIN_HEAVY.toFixed(2)}, w);
}
// How much a grain is drawn as powder at full Powder colour. Mirrors powderShare.
float powderShare(float w) {
  return 1.0 - smoothstep(${(POWDER_SPLIT - POWDER_EDGE).toFixed(2)}, ${(POWDER_SPLIT + POWDER_EDGE).toFixed(2)}, w);
}
`;

// The lift knee, hop rate and pull bias live in chladniSand.ts, beside the
// Sand zones they define.
// A step may never cross more than this fraction of one nodal cell, so high
// modes can't overshoot a line and oscillate.
const STEP_CELL_FRACTION = 0.25;
// Grain weight (see the file header), each a change per unit of weight away
// from WEIGHT_REF, where all three factors are 1. Air drag cuts a light
// grain's hop short; fine powder clings, so it needs a harder plate to lift.
const HOP_PER_WEIGHT = 1.0;
const LIFT_PER_WEIGHT = 1.0;
// Air streaming toward the antinodes: a fully light grain's drift, in plate
// units per second, per unit of drive^2 times the gradient of the plate's
// squared motion across one nodal cell.
const STREAM_RATE = 0.3;
// A grain hopping this far (grainHopScale x grainBounce) is drawn at the
// palette ramp's brightest end: an antinode under a loud drive or a kick.
const MOTION_FULL = 1.0;
// Glow (see POINT_VERT / POINT_FRAG): hats make the sand glint. One
// grain in GLINT_ONE_IN (times the Sand amount above 1, so piling on sand
// doesn't pile on bloom) carries a halo of HALO_PX pixels (at 720p) — a
// fixed pixel radius, not a multiple of the grain size, so the halo is a
// bloom around the grain and never a bigger grain. Spreading the light over
// a few grains instead of all of them keeps each halo above the 8-bit
// framebuffer's quantisation floor and the fill-rate cost down.
const HALO_PX = 10.0;
const GLINT_ONE_IN = 8;
// Bloom a fully glowing line reaches, summed over its glinting grains.
const HALO_GAIN = 11.0;

// How hard the music drives the plate, and how far a grain of weight w hops
// on it — shared by the sim, which moves the grain by it, and the point pass,
// which colours the grain by it, so a grain is drawn as thrown only while it
// really is (not merely for lying on an antinode, where powder heaps).
const GRAIN_MOTION_GLSL = `
${ZONE_DRIVE_GLSL}
// Sustained energy plus a bass-onset kick; silence -> ~0 -> the figure
// freezes. Vibration on a sub-linear curve so the low half of the slider is a
// usable whisper while the top of the slider still throws sand hard. Then the
// Sand zones' remap (chladniSand.ts). Mirrored by rawPlateDrive for probe().
float plateDrive() {
  float shake = pow(uShake, 1.5) * 2.0;
  return zoneDrive(shake * (0.25 + 2.4 * shakeDrive(uEnergy)) + uKick * kickDrive(uLowPulse) * 1.5);
}
// Weight (see file header): air drag cuts a light grain's hop short, and fine
// powder clings, so it needs a harder plate to lift.
float grainHopScale(float w) {
  return 1.0 + ${HOP_PER_WEIGHT.toFixed(2)} * (w - ${WEIGHT_REF.toFixed(2)});
}
float grainLift(float w) {
  return ${LIFT_THRESHOLD.toFixed(2)} * (1.0 - ${LIFT_PER_WEIGHT.toFixed(2)} * (w - ${WEIGHT_REF.toFixed(2)}));
}
// A soft lift on the local plate acceleration: accel^2 / T below the knee (a
// rattle in place), accel - T above it (a free bounce).
float grainBounce(float accel, float lift) {
  return accel * accel / (accel + lift);
}
`;

// The toss (see the file header): every grain's flight is hashed from its
// texel and the toss's seed, so the sim (which lands it) and the point pass
// (which draws it in the air) agree with nothing stored. The ages are
// seconds since the toss on this rendered frame and the one before; both sit
// at TOSS_IDLE_AGE while nothing is in the air.
const TOSS_GLSL = `
uniform float uTossAge;
uniform float uTossPrevAge;
uniform float uTossPower;
uniform float uTossSeed;
// Is any grain of the current toss still in the air (or landing) at this age?
bool tossLive(float age) {
  return age < ${glslFloat(tossLongestFlight())};
}
// x: flight time (s), y: peak height (plate half-heights), zw: where it
// lands relative to where it took off (plate units; grain space while Zoom
// out runs). Mirrors tossLaunch.
vec4 tossFlight(vec2 texel) {
  vec2 a = hash22(texel * 0.613 + uTossSeed);
  vec2 b = hash22(texel * 1.37 + uTossSeed * 1.91 + 5.3);
  float launch = ${glslFloat(TOSS_LAUNCH_MIN)} + ${glslFloat(1 - TOSS_LAUNCH_MIN)} * uTossPower;
  float t = ${glslFloat(TOSS_FLIGHT_SEC)} * launch * (1.0 + ${glslFloat(TOSS_TIME_SPREAD)} * (a.x - 0.5) * 2.0);
  float rel = t / ${glslFloat(TOSS_FLIGHT_SEC)};
  float lift = ${glslFloat(TOSS_LIFT)} * rel * rel;
  // Uniform over a disc: sqrt of the draw for the radius.
  float r = ${glslFloat(TOSS_SPREAD)} * uTossPower * sqrt(b.x);
  float ang = b.y * 6.2831853;
#ifdef ZOOM_OUT
  // Grains lie in grain space while Zoom out runs: the throw is a plate
  // distance, so it lands as far, and as round, as on the true-shape plate.
  return vec4(t, lift, vec2(r * cos(ang), r * sin(ang)) / grainExtent());
#else
  return vec4(t, lift, r * cos(ang), r * sin(ang));
#endif
}
// A point past the plate's rim reflected back in across the rim it crossed
// (uOutline, as plateGauge reads it): the square folds each axis, the circle
// folds its radius, a polygon reflects across the edge facing the point. Near
// a corner the result can still be outside; tossLanding then falls back.
vec2 foldIntoPlate(vec2 q) {
  float sides = uOutline.w;
  if (sides > 3.5 && sides < 4.5) {
    if (q.x > 1.0) q.x = 2.0 - q.x;
    if (q.x < -1.0) q.x = -2.0 - q.x;
    if (q.y > 1.0) q.y = 2.0 - q.y;
    if (q.y < -1.0) q.y = -2.0 - q.y;
    return q;
  }
  vec2 d = q - uOutline.xy;
  float r = length(d);
  if (sides < 0.5) return r > uOutline.z ? uOutline.xy + d * ((2.0 * uOutline.z - r) / r) : q;
  float k = PI / sides;
  float i = floor((atan(d.x, d.y) - uOutlineTurn + k) / (2.0 * k));
  float t = uOutlineTurn + 2.0 * k * i;
  vec2 n = vec2(sin(t), cos(t));
  float past = dot(d, n) - uOutline.z;
  return past > 0.0 ? q - 2.0 * past * n : q;
}
// Where a grain that took off at p comes down: the plain landing, else
// reflected back off the plate's edge, else straight back across where it
// started, else (last resort) a seeded spot on the plate.
vec2 tossLanding(vec2 p, vec2 disp, vec2 texel) {
  vec2 q = p + disp;
  if (insidePlate(q)) return q;
  vec2 m = foldIntoPlate(q);
  if (insidePlate(m)) return m;
  vec2 back = p - disp;
  if (insidePlate(back)) return back;
  return respawnOnPlate(texel * 0.37 + uTossSeed);
}
`;

// The grain memory (see the file header): a second RGBA8 texture beside the
// positions. R,A = heat in 16-bit fixed point (8 bits would stall a slow
// fade: one step of rounding outweighs a frame's cooling), G = the beat-wave
// dye, an ink index over 3, B = the id (mod 256) of the last wave that dyed it.
const MEMORY_GLSL = `
uniform sampler2D uMemTex;
float memHeat(vec4 mem) {
  return (floor(mem.r * 255.0 + 0.5) * 256.0 + floor(mem.a * 255.0 + 0.5)) / 65535.0;
}
int memInk(vec4 mem) {
  return int(floor(mem.g * 3.0 + 0.5));
}
`;

const SIM_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outMemory;
${COMMON_UNIFORMS_GLSL}
${SETTINGS_UNIFORMS_GLSL}
${DRIVE_UNIFORMS_GLSL}
uniform sampler2D uPosTex;
uniform float uSimDt;
uniform float uSeed;
uniform float uMaxOrder; // highest m among the active modes (times the finest zoom layer's scale), for the step cap
// Embers: this frame's cooling factor, exp(-dt / Ember fade).
uniform float uEmberCool;
// Beat waves (advanceWave): the wave in play's id mod 256 (-1 for none), how
// far it has run from the centre (plate units), and its ink index.
uniform float uWaveId;
uniform float uWaveRadius;
uniform float uWaveInk;
${CHLADNI_GLSL}
${GRAIN_MOTION_GLSL}
${TOSS_GLSL}
${MEMORY_GLSL}

// One frame of a grain's memory: hops heat it (motion is how far it is being
// thrown, as the point pass reads it) and rest cools it; a beat wave dyes it
// once as it passes. plateP is where it lies, in plate space.
vec4 stepMemory(vec4 mem, vec2 plateP, float motion) {
  float heat = clamp(memHeat(mem) * uEmberCool + ${glslFloat(EMBER_HEAT_RATE)} * motion * uSimDt, 0.0, 1.0);
  float v = floor(heat * 65535.0 + 0.5);
  float hi = floor(v / 256.0);
  mem.r = hi / 255.0;
  mem.a = (v - hi * 256.0) / 255.0;
  if (uWaveId >= 0.0 && floor(mem.b * 255.0 + 0.5) != uWaveId && length(plateP - uOutline.xy) < uWaveRadius) {
    mem.g = uWaveInk / 3.0;
    mem.b = uWaveId / 255.0;
  }
  return mem;
}

#ifdef ZOOM_OUT
// Zoom out (chladniZoom.ts): this frame's shrink toward the centre, and the
// share of the bed moved to the strip it freed.
uniform float uZoomShrink;
uniform float uZoomRespawn;

// A spot in the strip the zoom's shrink freed at the frame's edges (grain
// space [-1,1]^2 less the shrunk [-c,c]^2), evenly over its area: the top and
// bottom strips hold 1 / (1 + c) of it, the side strips the rest.
vec2 respawnInRim(vec2 seed, float c) {
  vec2 u = hash22(seed);
  vec2 v = hash22(seed + 4.13);
  float side = v.y < 0.5 ? -1.0 : 1.0;
  float depth = c + (1.0 - c) * u.y;
  if (u.x * (1.0 + c) < 1.0) return vec2(v.x * 2.0 - 1.0, side * depth);
  return vec2(side * depth, (v.x * 2.0 - 1.0) * c);
}
#endif

void main() {
  ivec2 texel = ivec2(gl_FragCoord.xy);
  vec4 stored = texelFetch(uPosTex, texel, 0);
  vec2 p = unpackPos(stored);
  vec2 seed = gl_FragCoord.xy * 0.173 + uSeed;
  vec4 mem = texelFetch(uMemTex, texel, 0);
#ifdef ZOOM_OUT
  // The bed shrinks with the field, as one piece (a grain in the air too:
  // where it took off shrinks under it).
  p *= uZoomShrink;
#endif

  // Tossed (see TOSS_GLSL): in the air the plate can't move a grain, so its
  // stored spot stays where it took off; on the one pass its flight ends it
  // comes down at its landing spot. A grain in the air is thrown as hard as
  // a grain can be, so it heats as one.
  if (tossLive(uTossPrevAge)) {
    vec4 fl = tossFlight(vec2(texel));
    if (uTossAge >= 0.0 && uTossAge < fl.x) {
#ifdef ZOOM_OUT
      outColor = packPos(p);
#else
      outColor = stored;
#endif
      outMemory = stepMemory(mem, GRAIN_TO_PLATE(p), 1.0);
      return;
    }
    if (uTossPrevAge < fl.x && fl.x <= uTossAge) {
      vec2 landed = tossLanding(p, fl.zw, vec2(texel));
      outColor = packPos(landed);
      outMemory = stepMemory(mem, GRAIN_TO_PLATE(landed), 1.0);
      return;
    }
  }

#ifdef ZOOM_OUT
  // A share of the bed moves to the freed strip at the edges, so the shrink
  // doesn't pile the sand up in the middle. It then steps like every other
  // grain: had it come in from past the frame it would have been shaking
  // too, and if it sat still while the rest hopped out into the strip, the
  // strip would end up denser than the bed.
  if (hash21(seed * 1.31 + 4.7) < uZoomRespawn) p = respawnInRim(seed + 2.9, uZoomShrink);
  // The sim steps in plate space; grain space is the frame, not to plate scale.
  p = GRAIN_TO_PLATE(p);
#endif
  float drive = plateDrive();

  vec3 fg = fieldWithGrad(p);
  float f = fg.x;
  float a = abs(f) * 0.5;

  // This grain's weight (see file header): how far it hops, how hard the
  // plate must shake to lift it, and how readily its bounces walk it to a line.
  float w = grainWeight(vec2(texel));
  float hopScale = grainHopScale(w);
  float lift = grainLift(w);
  float pullScale = w / ${WEIGHT_REF.toFixed(2)};

  float accel = a * drive;
  float bounce = grainBounce(accel, lift);

  // Random bounce. sqrt(dt) so the random walk diffuses at the same rate at
  // any frame pace; the step is HOP_RATE-sized at the 60 fps reference.
  float step = ${HOP_RATE.toFixed(2)} * hopScale * bounce * sqrt(uSimDt * 60.0) / 60.0;
  vec2 hop = (hash22(seed) - 0.5) * 2.0 * step;

  // Drift toward the line, second-order in the bounce: nothing where the
  // plate barely moves, a small fraction of the bounce on an antinode. A
  // velocity, so it scales with dt. Capped per step so a high mode can't
  // overshoot a line.
  vec2 g = fg.yz;
  vec2 dir = g / (length(g) + 1e-4) * sign(f);
  float cells = max(uMaxOrder, 1.0);
  float stepCap = ${STEP_CELL_FRACTION.toFixed(2)} * 2.0 / cells;
  float bias = ${PULL_BIAS.toFixed(2)} * pullScale * smoothstep(0.0, 3.0 * lift, accel);
  float pull = min(stepCap, ${HOP_RATE.toFixed(2)} * hopScale * bounce * bias * uSimDt);

  // Air streaming carries light grains the other way, up the gradient of
  // the plate's squared motion — d(a^2)/dp = (f / 2) g — so it vanishes on
  // the lines and at the antinode tops, where the powder heaps. Measured
  // per nodal cell so a fine lattice streams as fast as a coarse one.
  vec2 stream = ${STREAM_RATE.toFixed(2)} * grainLightness(w) * drive * drive * 0.5 * f * g / cells * uSimDt;
  float streamLen = length(stream);
  if (streamLen > stepCap) stream *= stepCap / streamLen;

  p += hop - dir * pull + stream;
  // How far this grain is being thrown, as the point pass measures it (vMotion).
  outMemory = stepMemory(mem, p, clamp(hopScale * bounce / ${MOTION_FULL.toFixed(2)}, 0.0, 1.0));
#ifdef ZOOM_OUT
  p = PLATE_TO_GRAIN(p);
#endif

  // Off the edge: spilled. Respawn somewhere on the plate.
  if (!insidePlate(p)) {
#ifdef ZOOM_OUT
    // While Zoom out runs the plate has no edge, so what hops off the sand's
    // area comes back in at that edge (reflected across it). A respawn over
    // the whole area would carry sand from the edges to the middle, where
    // the shrink then piles it up.
    p = clamp(foldIntoPlate(p), -1.0, 1.0);
#else
    p = respawnOnPlate(seed + 7.31);
#endif
  }

#ifdef ZOOM_OUT
  // packPos rounds to the nearest 16-bit step, which would round a slow
  // shrink away for a grain lying still on a line. Half a step of random
  // dither either way makes the rounding fair, so the shrink survives on average.
  p += (hash22(seed + 9.71) - 0.5) * (2.0 / 65535.0);
#endif
  outColor = packPos(p);
}
`;

const BG_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
${COMMON_UNIFORMS_GLSL}
${SETTINGS_UNIFORMS_GLSL}
${DRIVE_UNIFORMS_GLSL}
${ROOM_UV_GLSL}
${CHLADNI_GLSL}
uniform vec3 uPowderInk; // powderInk(palette), chladniPowder.ts: Two sides' second colour

void main() {
  vec2 uv = roomUv(vUv);
  vec2 ph = plateHalf();
  vec2 p = (uv - 0.5) / ph;
  float border = plateGauge(p);
  float aa = fwidth(border) * 1.5 + 1e-4;
#ifdef ZOOM_OUT
  // While Zoom out runs the plate has no edge: it fills the frame.
  float inside = 1.0;
#else
  float inside = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, border);
#endif

  float f = field(p);
  float a = abs(f) * 0.5;
  vec3 plate = vec3(0.030, 0.031, 0.036);
  // The middle of the room palette's ramp: bright enough to read on the
  // plate, darker than the grains that sit on top of it.
  vec3 glowHue = palRamp(0.35 + 0.3 * a);
  // Two sides: the cells where the plate moves the way the sand's second
  // colour marks glow in that colour, so the plate shows the checkerboard the
  // sand is sorted by. Scaled down to sit near the ramp's middle.
  if (uTwoSides > 0.0) glowHue = mix(glowHue, uPowderInk * ${glslFloat(SIDE_GLOW_INK)}, uTwoSides * smoothstep(-0.12, 0.12, f));
  vec3 glow = glowHue * a * a * uFieldGlow * 0.75 * (0.3 + fieldGlowDrive(uEnergy));
  // A faint rim along the plate's true outline, the same width in plate
  // units on every shape (one minus the gauge, times the apothem, is the
  // distance to the nearest edge). The stretched full-frame square has no
  // edge to show, nor does the square while Zoom out runs.
#ifdef ZOOM_OUT
  float rimOn = 0.0;
#else
  float rimOn = uPlateShape > 0.5 ? 1.0 : uSquarePlate;
#endif
  float rim = (1.0 - smoothstep(0.0, 0.012, (1.0 - border) * uOutline.z)) * rimOn;
  vec3 col = (plate + glow + rim * 0.10) * inside;
  // The plate is near black, so a gain alone barely shows: the flash also
  // lifts it toward the palette's middle.
  float flash = uBeatFlash * beatFlashDrive(uBeatPulse);
  col = col * (1.0 + flash) + palRamp(0.5) * 0.12 * flash * inside;
  outColor = vec4(col, 1.0);
}
`;

const POINT_VERT = `#version 300 es
precision highp float;
${COMMON_UNIFORMS_GLSL}
${SETTINGS_UNIFORMS_GLSL}
${DRIVE_UNIFORMS_GLSL}
uniform sampler2D uPosTex;
uniform float uSide;
uniform float uGrainGain;
uniform vec3 uPowderInk; // powderInk(palette), chladniPowder.ts
// Spectrum rings: the band history (NUM_BANDS across, SPEC_ROWS rows, a
// ring buffer written SPEC_RATE rows a second) and where its newest row is.
uniform sampler2D uSpecTex;
uniform float uSpecNewest;
${CHLADNI_GLSL}
${GRAIN_MOTION_GLSL}
${TOSS_GLSL}
${MEMORY_GLSL}

// A colour lit as Powder colour is: times the grain's brightness, but scaled
// back so the bed's brightest shade just fits, so it keeps its hue instead of
// clipping toward white.
vec3 litHue(vec3 c, float bright, float brightBase) {
  return c * bright / max(1.0, max(c.r, max(c.g, c.b)) * brightBase * ${glslFloat(SHADE_LO + SHADE_SPAN)});
}
// The palette's inks in order, t = 0 the first and 1 the last.
vec3 inkWalk(float t) {
  float x = clamp(t, 0.0, 1.0) * 3.0;
  int i = int(min(floor(x), 2.0));
  return mix(uPalInk[i], uPalInk[i + 1], x - float(i));
}
// The palette's inks round a loop, u in [0,1) once round.
vec3 inkLoop(float u) {
  float x = fract(u) * 4.0;
  int i = int(floor(x));
  return mix(uPalInk[i], uPalInk[(i + 1) % 4], x - float(i));
}
// The band level at pitch (0 = lowest band, 1 = highest) ageSec ago, from the
// history; linear between rows and bands, the rows wrapping round the buffer.
// The newest row is a row behind the clock, so nothing reads the row being
// filled next.
float specLevel(float pitch, float ageSec) {
  float row = uSpecNewest - ageSec * ${glslFloat(SPEC_RATE)};
  float band = clamp(pitch, 0.0, 1.0) * ${(NUM_BANDS - 1).toFixed(1)};
  return texture(uSpecTex, vec2((band + 0.5) / ${NUM_BANDS.toFixed(1)}, (row + 0.5) / ${SPEC_ROWS.toFixed(1)})).r;
}
out float vMotion;
out float vGlow;
out float vSizePx;
out float vScale;
out float vShade;
out float vFacets;
out float vRot;
out vec3 vCol;
out vec3 vHaloCol;

void main() {
  int side = int(uSide);
  ivec2 texel = ivec2(gl_VertexID % side, gl_VertexID / side);
  vec2 p = unpackPos(texelFetch(uPosTex, texel, 0));
  // Tossed (see TOSS_GLSL): drawn along its arc from where it took off (its
  // stored spot until it lands) to where it comes down, lifted up the screen
  // on a parabola, and bigger and brighter the higher it is. 0 on the plate.
  float tossRise = 0.0;
  bool airborne = false;
  if (tossLive(uTossAge) && uTossAge >= 0.0) {
    vec4 fl = tossFlight(vec2(texel));
    if (uTossAge < fl.x) {
      float u = uTossAge / fl.x;
      // Sideways on u^2, not u: the bed rises as one shape and spreads on
      // the way down (a kick from below throws mostly up).
      p = mix(p, tossLanding(p, fl.zw, vec2(texel)), u * u);
      tossRise = 4.0 * u * (1.0 - u) * fl.y;
      airborne = true;
    }
  }
  // Grain space to the room (the frame and its margin while Zoom out runs).
  vec2 room = 0.5 + p * GRAIN_HALF;
  room.y += tossRise * GRAIN_HALF.y;
  // The arc's height relative to the top of a full toss's mean arc.
  float rise = tossRise / ${glslFloat(TOSS_LIFT)};
  // The growth and brightness a rising grain gains, divided by the Sand
  // amount above 1 as the glints are: a thick bed already covers the plate,
  // and grown it would white out the screen.
  float riseGrow = rise / max(1.0, uSandAmount);
  vec2 dev = (room - uViewport.xy) / uViewport.zw;
  gl_Position = vec4(dev * 2.0 - 1.0, 0.0, 1.0);
  // No two grains of sand are alike: a fixed per-grain size (its weight —
  // grainWeight reads .x of this same hash) and shade so a pile reads as
  // grains rather than a smooth blob.
  vec2 jitter = hash22(vec2(texel) * 0.731 + 3.17);
  float w = grainWeight(vec2(texel));
  // The plate's value under the grain: its sign is the side of the line the
  // grain lies by (Two sides), its size how hard the plate moves there.
  float fHere = field(GRAIN_TO_PLATE(p));
  // How far this grain is being thrown right now — see GRAIN_MOTION_GLSL.
  vMotion = clamp(grainHopScale(w) * grainBounce(abs(fHere) * 0.5 * plateDrive(), grainLift(w)) / ${MOTION_FULL.toFixed(2)}, 0.0, 1.0);
  // A grain in the air runs up the ramp the higher it is, to its brightest
  // end by TOSS_WHITE_RISE.
  if (airborne) vMotion = max(vMotion, clamp(rise / ${glslFloat(TOSS_WHITE_RISE)}, 0.0, 1.0));
  vShade = ${glslFloat(SHADE_LO)} + ${glslFloat(SHADE_SPAN)} * jitter.y;
  // Each grain is a faceted shard (3 or 4 sides, POINT_FRAG), not a disc —
  // real sand is angular. Random facet count and rotation per grain, same
  // hash family as the size/shade jitter above.
  vec2 shard = hash22(vec2(texel) * 0.911 + 5.7);
  vFacets = shard.x < 0.5 ? 3.0 : 4.0;
  vRot = shard.y * 6.2832;
  // Glitter: the shard's angle is the way it faces. A thrown grain tumbles:
  // TUMBLE_HZ times a second it lands at a new random angle (each grain on
  // its own beat), so it twinkles, while sand at rest keeps its angle and
  // flashes only when the circling light reaches it. The light goes round
  // once a bar. Grains facing it flash and grow.
  float sparkle = 0.0;
  if (uGlitter > 0.0) {
    float tumble = smoothstep(${glslFloat(TUMBLE_MOTION)}, ${glslFloat(4 * TUMBLE_MOTION)}, vMotion);
    vRot += tumble * 6.2832 * hash21(vec2(texel) * 0.29 + floor(uTime * ${glslFloat(TUMBLE_HZ)} + shard.x * 7.0));
    sparkle = pow(max(cos(vRot - uBarPhase * 6.2832), 0.0), ${glslFloat(GLINT_POWER)}) * uGlitter;
  }
  // The grain's memory (Embers' heat, Beat waves' dye), from the sim.
  vec4 mem = texelFetch(uMemTex, texel, 0);
  float heat = memHeat(mem);
  // Glow: the sprite grows by a fixed pixel margin to make room for
  // a halo (see POINT_FRAG), mostly on the hat/cymbal onset pulse so it
  // flashes rather than fogs.
  float glint = step(1.0 - 1.0 / (${GLINT_ONE_IN.toFixed(1)} * max(1.0, uSandAmount)), hash21(vec2(texel) * 0.517 + 9.1));
  float glintGlow = glint * clamp(uHighGlow * highGlowDrive(${GLOW_LEVEL_WEIGHT.toFixed(2)} * uHigh + ${GLOW_HIT_WEIGHT.toFixed(2)} * uHighPulse), 0.0, 1.0);
  // Embers' neon halo: carried by one grain in EMBER_HALO_ONE_IN, growing
  // with its heat.
  float emberGlow = 0.0;
  if (uEmbers > 0.0) {
    float carrier = step(1.0 - 1.0 / (${EMBER_HALO_ONE_IN.toFixed(1)} * max(1.0, uSandAmount)), hash21(vec2(texel) * 0.389 + 2.3));
    emberGlow = carrier * uEmbers * ${glslFloat(EMBER_HALO_MAX)} * smoothstep(${glslFloat(EMBER_HALO_FROM)}, ${glslFloat(EMBER_HALO_FULL)}, heat);
  }
  vGlow = clamp(glintGlow + emberGlow, 0.0, 1.0);
  float resScale = max(1.0, uResolution.y / 720.0);
  // A shard inscribed in the old disc covers less area than it (a triangle
  // 0.41x, a square 0.64x); grow the size by the matching factor so a faceted
  // bed reads as bright as the round one it replaced.
  float shardGrow = vFacets < 3.5 ? 1.556 : 1.253;
  // Zoom above 1 is a closer look, so the grains grow with the plate (see
  // drawnGrainCount's caller); below 1 they keep their size and fewer are
  // drawn. Not while Zoom out runs: the sand then covers the frame at any Zoom.
  float size = uGrainSize * shardGrow * grainSizeFactor(w) * resScale * max(1.0, GRAIN_ZOOM)
    * (1.0 + ${glslFloat(TOSS_GROW)} * riseGrow);
  if (sparkle > 0.0) size *= 1.0 + ${glslFloat(GLITTER_GROW)} * sparkle;
  vSizePx = size + 2.0 * ${HALO_PX.toFixed(1)} * resScale * vGlow;
  vScale = vSizePx / size;
  gl_PointSize = vSizePx;
  // Everything about a grain's colour is per grain, so it is worked out here
  // once rather than by every fragment of its sprite — a glint's sprite is
  // mostly halo ring, and those fragments need only vHaloCol.
  // Grains take the bright half of the room palette's ramp, which every
  // palette keeps bright (see palette.ts): settled grains sit in its middle,
  // thrown grains run up to its brightest end.
  // Thrown colour sets how far a thrown grain's colour moves (1: by its hop,
  // as it always did) and Thrown to where (THROWN_TO). Toward white is the
  // ramp below; the others start from the resting colour (the ramp at 0) and
  // move further down.
  float thrown = clamp(vMotion * uThrownColour, 0.0, 1.0);
  int thrownTo = int(uThrownTo + 0.5);
  float rampMotion = thrownTo == 0 ? thrown : 0.0;
  // chladniPowder.ts's gritColour mirrors these two lines.
  vec3 col = palRamp(${GRIT_RAMP_LO.toFixed(2)} + ${GRIT_RAMP_SPAN.toFixed(2)} * rampMotion);
  // Settled sand is chalkier than the palette; thrown grains keep its full hue.
  col = mix(col, vec3(dot(col, vec3(0.299, 0.587, 0.114))), ${GRIT_CHALK.toFixed(2)} * (1.0 - rampMotion));
  // The bed's brightness (Grain brightness on this quality tier), then this
  // grain's shade, the beat's flash and the toss's lift on top.
  float brightBase = (0.8 + 1.7 * uGrainGlow) * uGrainGain;
  float bright = brightBase * vShade * (1.0 + uBeatFlash * beatFlashDrive(uBeatPulse) * 2.0)
    * (1.0 + ${glslFloat(TOSS_BRIGHT)} * riseGrow);
  // Powder colour: the light grains, which the air heaps between the lines,
  // in the palette's second sand colour (chladniPowder.ts), running toward
  // white when thrown. Grit's brightness gain clips it toward white, which
  // would wash the two colours into one; powder is scaled back so that the
  // bed's brightest shade sits just in range, so it keeps its hue at any
  // Grain brightness while its shades still differ, and only a flash or a
  // throw clips it toward white, briefly, as grit. At 0 both mixes take
  // nothing from the powder: the grit colour, unchanged.
  float powder = uPowderColour * powderShare(w);
  vec3 dust = mix(uPowderInk, vec3(1.0), ${POWDER_THROWN_LIFT.toFixed(2)} * rampMotion);
  float dustTop = max(dust.r, max(dust.g, dust.b)) * brightBase * ${glslFloat(SHADE_LO + SHADE_SPAN)};
  vec3 dustLit = dust * bright / max(1.0, dustTop);
  vCol = mix(col * bright, dustLit, powder);

  // The rest of Thrown to: to the second colour (Powder colour's), through
  // the palette's inks, or dark. Toward white gets there early, because the
  // grain's brightness gain clips the bright end of the ramp to white well
  // before a full throw; these colours are lit to keep their hue, so they
  // take reach, a curve that arrives by THROWN_REACH of a throw, to move
  // as readily.
  float reach = smoothstep(0.0, ${glslFloat(THROWN_REACH)}, thrown);
  if (thrownTo == 1) vCol = mix(vCol, litHue(uPowderInk, bright, brightBase), reach);
  else if (thrownTo == 2) vCol = mix(vCol, litHue(inkWalk(reach), bright, brightBase), smoothstep(0.0, 0.3, reach));
  else if (thrownTo == 3) vCol *= 1.0 - ${glslFloat(1 - SHADOW_KEEP)} * reach;

  // Two sides: the second colour on the side of the line where the plate's
  // value is positive (the up side, at this instant of the cycle).
  if (uTwoSides > 0.0) {
    vCol = mix(vCol, litHue(uPowderInk, bright, brightBase), uTwoSides * smoothstep(${glslFloat(-SIDE_EDGE)}, ${glslFloat(SIDE_EDGE)}, fHere));
  }

  // Beat waves: the ink the last wave over this grain dyed it (the sim).
  if (uBeatWaves > 0.0) vCol = mix(vCol, litHue(uPalInk[memInk(mem)], bright, brightBase), uBeatWaves);

  // Spectrum rings: the spectrum ageSec ago, where ageSec is how long a ring
  // takes to run out this far from the centre, pitch round the plate (bass
  // at the top, mirrored so the plate stays symmetric). Coloured by pitch
  // along the palette's inks, brighter the louder that band was; faded out
  // before the history runs out.
  if (uSpectrumRings > 0.0) {
    vec2 q = GRAIN_TO_PLATE(p) - uOutline.xy + vec2(0.0, 1e-5);
    float age = length(q) / ${glslFloat(SPEC_SPEED)};
    float pitch = abs(atan(q.x, q.y)) / PI;
    float level = smoothstep(${glslFloat(SPEC_QUIET)}, ${glslFloat(SPEC_LOUD)}, specLevel(pitch, age));
    float maxAge = ${glslFloat((SPEC_ROWS - 2) / SPEC_RATE)};
    float keep = 1.0 - smoothstep(0.85 * maxAge, maxAge, age);
    vec3 ring = litHue(inkWalk(pitch), bright, brightBase) * (${glslFloat(SPEC_FLOOR)} + ${glslFloat(SPEC_GAIN)} * level);
    vCol = mix(vCol, ring, uSpectrumRings * keep);
  }

  // Embers: whatever colour the grain has by now, at full strength while hot
  // (its hue with the brightest channel pinned at 1, as a neon tube: never
  // clipped toward white) and nearly dark once rested.
  vec3 neon = vCol / max(max(vCol.r, max(vCol.g, vCol.b)), 1e-4);
  if (uEmbers > 0.0) {
    vec3 hot = neon * min(max(vCol.r, max(vCol.g, vCol.b)), 1.0);
    vCol = mix(vCol, mix(vCol * ${glslFloat(EMBER_COLD)}, hot, pow(heat, ${glslFloat(EMBER_GLOW_POWER)})), uEmbers);
  }

  // Glitter: the rest of the sand dims so the flashes stand out, and a
  // facing grain flashes in the ink its angle picks round the palette, so
  // the flashes run through the inks once a bar with the light.
  if (uGlitter > 0.0) vCol *= 1.0 - ${glslFloat(GLITTER_DIM)} * uGlitter;
  if (sparkle > 0.0) vCol += litHue(inkLoop(vRot / 6.2832), bright, brightBase) * sparkle * ${glslFloat(GLITTER_GAIN)};

  // The halo's tint and its area normalisation (see POINT_FRAG), without the
  // falloff across the sprite: the fragment only multiplies that in. The
  // Glow's glints' halo runs toward white; the embers' keeps the grain's hue.
  float haloNorm = ${HALO_GAIN.toFixed(1)} * resScale * resScale / (vSizePx * vSizePx);
  vec3 haloTint = mix(mix(col, dust, powder), vec3(1.0), 0.45);
  if (emberGlow > 0.0) haloTint = mix(haloTint, neon, emberGlow / (glintGlow + emberGlow));
  vHaloCol = haloTint * haloNorm * bright;
}
`;

const POINT_FRAG = `#version 300 es
precision highp float;
in float vMotion;
in float vGlow;
in float vSizePx;
in float vScale;
in float vShade;
in float vFacets;
in float vRot;
in vec3 vCol; // the grain's colour times its brightness (POINT_VERT)
in vec3 vHaloCol; // the halo's colour times its brightness and area normalisation
out vec4 outColor;
${COMMON_UNIFORMS_GLSL}
${SETTINGS_UNIFORMS_GLSL}
${DRIVE_UNIFORMS_GLSL}
const float PI = 3.14159265;

void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d);
  if (r2 > 0.25) discard;
  // The sprite was enlarged by vScale for the halo; the grain itself keeps
  // its own size at the centre, so measure the core in grain radii.
  float r = sqrt(r2) * vScale;
  // Glow: a soft halo across the enlarged sprite, tinted toward
  // white, falling to zero at the sprite edge. Normalised by sprite area
  // (in 720p pixels) so the bloom a line reaches depends on how many grains
  // glint there, not on grain size or resolution.
  float halo = 1.0 - 4.0 * r2;
  halo = halo * halo * vGlow;
  // Outside the grain's own radius the shard below contributes nothing (rn >=
  // r always, so core is exactly 0 from r = 0.5 out): only the halo is left,
  // and that is most of a glint's sprite.
  if (r >= 0.5) {
    outColor = vec4(vHaloCol * halo, 0.0);
    return;
  }
  // A hard-edged faceted shard (3 or 4 sides, random rotation, see
  // POINT_VERT): a regular-polygon distance field, radius in the facet's own
  // direction rather than the disc's. rn >= r always (the polygon is
  // inscribed in the disc, touching it only at the corners), so the shard
  // sits inside the disc's r2 > 0.25 discard above and never gets clipped by it.
  float ang = atan(d.y, d.x) + vRot;
  float k = PI / vFacets;
  float rn = r * cos(mod(ang + k, 2.0 * k) - k) / cos(k);
  // The anti-aliased rim is one pixel wide on a big grain (so a big grain is
  // a grain, not a blur) and never more than a fraction of the radius on a
  // small one, which keeps a one-pixel grain's centre bright. Divided by
  // cos(k) to match rn's steeper gradient (vs. the disc's r), so a triangle's
  // facets don't come out aliased relative to a square's.
  float edge = min(vScale / (cos(k) * max(vSizePx, 1.0)), 0.22);
  float core = 1.0 - smoothstep(0.5 - edge, 0.5, rn);
  // At Grain size's chunky end, overlapping grains of the same hue would
  // merge into one flat patch (no grain-grain collision keeps them from
  // spreading apart — see file header): shade each facet distinctly and
  // darken a rim just inside the edge, so a big shard reads as a chunk of
  // grit rather than a paint blob. A one- or two-pixel grain stays flat
  // (chunky -> 0) so it doesn't dither away.
  float grainPx = vSizePx / vScale;
  float chunky = smoothstep(3.0, 7.0, grainPx);
  float facetIndex = floor(mod(ang + PI, 2.0 * PI) / (2.0 * k));
  float facetShade = 0.75 + 0.45 * fract(sin(facetIndex * 12.9898 + vRot * 78.233) * 43758.5453);
  float rim = smoothstep(0.5 - edge * 4.0, 0.5 - edge * 0.6, rn) * chunky;
  float chunkShade = mix(1.0, facetShade, chunky) * (1.0 - 0.35 * rim);
  // Premultiplied alpha: the grain is opaque (alpha = core) and occludes
  // whatever lies under it, like real sand; the halo carries no alpha, so
  // it adds. Overlapping big grains stay hard-edged instead of summing
  // into a smear.
  outColor = vec4(vCol * chunkShade * core + vHaloCol * halo, core);
}
`;

function seedPositions(side: number): Uint8Array {
  const data = new Uint8Array(side * side * 4);
  for (let i = 0; i < side * side; i++) {
    const x = Math.floor(Math.random() * 65536);
    const y = Math.floor(Math.random() * 65536);
    data[i * 4] = x >> 8;
    data[i * 4 + 1] = x & 255;
    data[i * 4 + 2] = y >> 8;
    data[i * 4 + 3] = y & 255;
  }
  return data;
}

/** The scene's three programs, and where each grain pass reads positions. */
interface Programs {
  sim: GLProgram;
  bg: GLProgram;
  point: GLProgram;
  simPos: WebGLUniformLocation | null;
  pointPos: WebGLUniformLocation | null;
}

/** The programs with Zoom out compiled in (the shaders' ZOOM_OUT blocks) or
 *  without it, which is the shader source exactly as it was before the zoom:
 *  a separate build rather than a runtime switch, so the plate without the
 *  zoom renders bit for bit as before and pays nothing for it. */
function makePrograms(gl: WebGL2RenderingContext, zoom: boolean): Programs {
  const src = (s: string) => (zoom ? s.replace("#version 300 es\n", "#version 300 es\n#define ZOOM_OUT\n") : s);
  const sim = createProgram(gl, src(SIM_FRAG));
  const bg = createProgram(gl, src(BG_FRAG));
  const point = createProgram(gl, src(POINT_FRAG), src(POINT_VERT));
  // The atlas sits on unit 1 in all three programs (uPosTex has unit 0), the
  // grain memory on unit 2 in the two grain passes, and the spectrum history
  // on unit 3 in the point pass.
  for (const prog of [sim, bg, point]) {
    prog.use();
    gl.uniform1i(gl.getUniformLocation(prog.program, "uPlateAtlas"), 1);
  }
  for (const prog of [sim, point]) {
    prog.use();
    gl.uniform1i(gl.getUniformLocation(prog.program, "uMemTex"), 2);
  }
  point.use();
  gl.uniform1i(gl.getUniformLocation(point.program, "uSpecTex"), 3);
  return {
    sim,
    bg,
    point,
    simPos: gl.getUniformLocation(sim.program, "uPosTex"),
    pointPos: gl.getUniformLocation(point.program, "uPosTex"),
  };
}

function disposePrograms(p: Programs | null): void {
  p?.sim.dispose();
  p?.bg.dispose();
  p?.point.dispose();
}

function createChladniScene(): Scene {
  // Without Zoom out, and with it (built the first time it's asked for).
  let plain: Programs | null = null;
  let zoomed: Programs | null = null;
  let quadVao: WebGLVertexArrayObject | null = null;
  let pointVao: WebGLVertexArrayObject | null = null;
  const posTex: (WebGLTexture | null)[] = [null, null];
  // The grain memory (MEMORY_GLSL), ping-ponged with the positions: each
  // posFbo writes both, the second as COLOR_ATTACHMENT1.
  const memTex: (WebGLTexture | null)[] = [null, null];
  const posFbo: (WebGLFramebuffer | null)[] = [null, null];
  // Spectrum rings' band history: one R8 row of NUM_BANDS per 1 / SPEC_RATE
  // seconds, a ring buffer SPEC_ROWS long. specClock counts the rows owed
  // since the last one written; specNewest is that row's index.
  let specTex: WebGLTexture | null = null;
  const specRow = new Uint8Array(NUM_BANDS);
  const specPeak = new Float32Array(NUM_BANDS);
  let specNewest = 0;
  let specClock = 0;
  // Beat waves: the last wave to start — see advanceWave.
  let wave: WaveState = { count: 0, at: 0 };
  let read = 0;
  let side = 1;
  let grainCount = 0;
  let response: PlateResponse | null = null;
  let lastFrameTime: number | null = null;
  // The plate's drive before the Sand zones' remap, as of the last render —
  // the Sand zones gauge's needle (probe()).
  let lastRawDrive = 0;
  // The last toss, null before the first — see nextToss and TOSS_GLSL.
  let toss: TossEvent | null = null;
  const bandsBuf = new Float32Array(NUM_BANDS);
  // The plate on the screen (an index into PLATE_SHAPES) and its atlas, if it
  // is a baked plate (see the file header): only the plate on screen keeps
  // one, so picking through the plates never holds every atlas at once. A
  // 1-texel stand-in sits on the atlas unit while the square shows, so no
  // sampler ever points at an empty unit.
  let shape = -1;
  const atlases = new Map<number, { tex: WebGLTexture; bytes: number }>();
  let blankAtlas: WebGLTexture | null = null;
  // How long the last bake took on this thread, and the GPU memory the
  // atlases hold, for probe().
  let lastBakeMs = 0;
  let atlasBytes = 0;
  const powderBuf = new Float32Array(3);
  // Zoom out's phase in octaves (its fractional part is all the field needs;
  // the total is for probe()), and the layer stack it gives.
  let zoomPhase = 0;
  let zoomTotal = 0;
  const zoomBuf: ZoomLayer[] = [];

  function setModes(prog: GLProgram, modes: readonly ActiveMode[]): void {
    for (let k = 0; k < ACTIVE_MODES; k++) {
      const mode = modes[k];
      if (mode.layer < 0) prog.setV4(`uModes[${k}]`, mode.n, mode.m, mode.sign, mode.weight);
      else prog.setV4(`uModes[${k}]`, mode.layer, 0, 0, mode.weight);
    }
  }

  function setZoom(prog: GLProgram, layers: readonly ZoomLayer[]): void {
    for (let k = 0; k < ZOOM_LAYERS; k++) prog.setV2(`uZoomLayer[${k}]`, layers[k].scale, layers[k].weight);
  }

  function setOutline(prog: GLProgram): void {
    const o = plateOutline(shape);
    prog.setV4("uOutline", o.cx, o.cy, o.apothem, o.sides);
    prog.setF("uOutlineTurn", o.turn);
  }

  /** The atlas array for a baked plate, made when it's first asked for. */
  function atlasFor(gl: WebGL2RenderingContext, s: number): WebGLTexture | null {
    if (s === SQUARE) return blankAtlas;
    let tex = atlases.get(s)?.tex;
    if (!tex) {
      const t0 = performance.now();
      const bake = bakePlate(s);
      tex = gl.createTexture()!;
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
      gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA16F, bake.side, bake.side, bake.layers, 0, gl.RGBA, gl.FLOAT, bake.data);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
      gl.activeTexture(gl.TEXTURE0);
      const bytes = bake.side * bake.side * bake.layers * 8;
      atlases.set(s, { tex, bytes });
      atlasBytes += bytes;
      lastBakeMs = performance.now() - t0;
    }
    return tex;
  }

  /** Puts `s` on the screen: its atlas (the previous plate's is let go), and
   *  a fresh response over its table. */
  function usePlate(gl: WebGL2RenderingContext, s: number): void {
    for (const [other, atlas] of atlases) {
      if (other === s) continue;
      gl.deleteTexture(atlas.tex);
      atlasBytes -= atlas.bytes;
      atlases.delete(other);
    }
    atlasFor(gl, s);
    shape = s;
    response = createPlateResponse(plateModeTable(s));
  }

  function plateSetting(): number {
    const v = Math.round(resolveSceneSetting(ID, settingFor("plateShape")));
    return Math.max(0, Math.min(PLATE_SHAPES.length - 1, v));
  }

  /** Is Zoom out on (its programs and frame in use)? The slider before the
   *  Master card's Scale, which only sets its speed. */
  function zoomWanted(): boolean {
    return shape === SQUARE && resolveSceneSettingUnscaled(ID, settingFor("zoomOut")) > 0;
  }

  return {
    id: ID,
    name: "Chladni",
    settings: SETTINGS,
    panel: [
      {
        widget: "sandZones",
        title: "Sand zones",
        hint: "How the sand answers the plate's drive: still, drifting to a new figure, or snapping onto it. Drag an edge to move it.",
        settings: ["freezeEdge", "snapEdge"],
      },
    ],

    probe() {
      return { drive: lastRawDrive, bakeMs: lastBakeMs, atlasMB: atlasBytes / 1e6, zoomOctaves: zoomTotal };
    },

    init(ctx: SceneContext) {
      const { gl } = ctx;
      plain = makePrograms(gl, false);
      quadVao = createFullscreenQuad(gl);
      // The point pass has no vertex attributes at all — every grain is
      // addressed by gl_VertexID into the position texture — so it draws
      // from an empty VAO rather than the quad's (whose 3-vertex buffer a
      // 200k-vertex draw would read past).
      pointVao = gl.createVertexArray();

      grainCount = Math.max(1, Math.floor(ctx.quality.maxParticles));
      side = grainTextureSide(grainCount * SAND_AMOUNT_MAX);
      const seed = seedPositions(side);
      for (let i = 0; i < 2; i++) {
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, side, side, 0, gl.RGBA, gl.UNSIGNED_BYTE, seed);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        // The memory starts at zero: cold sand, dyed the first ink, no wave yet.
        const mem = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, mem);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, side, side, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, mem, 0);
        gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
        posTex[i] = tex;
        memTex[i] = mem;
        posFbo[i] = fbo;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      // Rows wrap (REPEAT on t) as the ring buffer does; bands don't (CLAMP on s).
      specTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, specTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, NUM_BANDS, SPEC_ROWS, 0, gl.RED, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      specNewest = 0;
      specClock = 0;
      specPeak.fill(0);
      wave = { count: 0, at: 0 };
      gl.bindTexture(gl.TEXTURE_2D, null);

      blankAtlas = gl.createTexture();
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, blankAtlas);
      gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA16F, 1, 1, 1, 0, gl.RGBA, gl.FLOAT, new Float32Array(4));
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
      gl.activeTexture(gl.TEXTURE0);

      read = 0;
      // A plate picked in saved settings is baked now, not on the first frame,
      // and a zoom turned on in them is built now too.
      usePlate(gl, plateSetting());
      if (zoomWanted()) zoomed = makePrograms(gl, true);
      lastFrameTime = null;
      toss = null;
      zoomPhase = 0;
      zoomTotal = 0;
    },

    render(ctx, frame, viewport, palette, anim, drives = PASSTHROUGH_DRIVES) {
      if (!plain || !quadVao || !pointVao || !response) return;
      const { gl } = ctx;

      // See file header for why frame.time and not anim.dtSec.
      const dt = lastFrameTime === null ? 1 / 60 : Math.max(0, Math.min(0.1, frame.time - lastFrameTime));
      const prevFrameTime = lastFrameTime;
      lastFrameTime = frame.time;

      const picked = plateSetting();
      if (picked !== shape) usePlate(gl, picked);
      const atlas = atlasFor(gl, shape);

      // Toss: asked every frame so the jack's edge is consumed even while the
      // refractory or the arm time ignores it. The seed is only drawn when a
      // toss really starts (advanceToss), so a seeded bench run that never
      // tosses stays the same as before the toss existed.
      const tossFired = drives.fired("toss", anim.dropOnset);
      const tossStep = advanceToss(toss, frame.time, prevFrameTime, tossFired, resolveSceneSetting(ID, settingFor("toss")) * drives.hitSize("toss"), () => Math.random() * 100);
      toss = tossStep.toss;
      const setToss = (prog: GLProgram): void => {
        prog.setF("uTossAge", tossStep.age);
        prog.setF("uTossPrevAge", tossStep.prevAge);
        prog.setF("uTossPower", toss?.power ?? 0);
        prog.setF("uTossSeed", toss?.seed ?? 0);
      };

      // Beat waves: asked every frame, as the toss is, so the jack's edge is
      // consumed whatever the slider says.
      const waveStep = advanceWave(wave, frame.time, drives.fired("beatWaves", anim.onset));
      wave = waveStep.wave;
      const setWave = (prog: GLProgram): void => {
        prog.setF("uWaveId", waveStep.radius >= 0 ? wave.count % 256 : -1);
        prog.setF("uWaveRadius", waveStep.radius);
        prog.setF("uWaveInk", wave.count % 4);
      };

      // Spectrum rings: each band as a share of its own recent peak (see
      // SPEC_PEAK_SEC), then the rows owed since the last frame (all the
      // same, this frame's; a long stall writes at most the whole buffer).
      const peakFall = Math.exp(-dt / SPEC_PEAK_SEC);
      for (let i = 0; i < NUM_BANDS; i++) {
        const level = Math.max(0, Math.min(1, frame.bands[i] ?? 0));
        specPeak[i] = Math.max(level, specPeak[i] * peakFall, SPEC_PEAK_FLOOR);
        specRow[i] = Math.round((level / specPeak[i]) * 255);
      }
      specClock += dt * SPEC_RATE;
      const owed = Math.min(SPEC_ROWS, Math.floor(specClock));
      if (owed > 0 && specTex) {
        gl.activeTexture(gl.TEXTURE3);
        gl.bindTexture(gl.TEXTURE_2D, specTex);
        for (let k = 0; k < owed; k++) {
          specNewest = (specNewest + 1) % SPEC_ROWS;
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, specNewest, NUM_BANDS, 1, gl.RED, gl.UNSIGNED_BYTE, specRow);
        }
        gl.activeTexture(gl.TEXTURE0);
        specClock -= Math.floor(specClock);
      }

      const modes = response!.advance(dt, frame.bands, {
        complexity: resolveSceneSetting(ID, settingFor("complexity")),
        resonance: resolveSceneSetting(ID, settingFor("resonance")),
        ring: resolveSceneSetting(ID, settingFor("ring")),
        figureHold: resolveSceneSetting(ID, settingFor("figureHold")),
        newness: resolveSceneSetting(ID, settingFor("newness")),
      });
      let maxOrder = 1;
      for (const mode of modes) if (mode.weight > 0.05) maxOrder = Math.max(maxOrder, mode.cells);

      // Zoom out (chladniZoom.ts): the square plate only. Speed is the
      // slider times its jack, so silence stops it. Whether it is on at all
      // changes the framing, so that reads the slider before the Master
      // card's Scale: Scale 0 stops the zoom but keeps its frame.
      const zoomSetting = resolveSceneSetting(ID, settingFor("zoomOut"));
      const zoomOn = zoomWanted();
      const zoomStep = zoomOn ? zoomPhaseStep(dt, zoomSetting, drives.value("zoomOut", frame.energy)) : 0;
      zoomPhase = (zoomPhase + zoomStep) % 1;
      zoomTotal += zoomStep;
      const layers = zoomLayers(zoomPhase, zoomBuf);
      // The step cap must count the finest layer still showing.
      if (zoomOn) maxOrder *= zoomFinestScale(layers);
      lastRawDrive = rawPlateDrive(
        resolveSceneSetting(ID, settingFor("shake")),
        drives.value("shake", frame.energy),
        resolveSceneSetting(ID, settingFor("kick")),
        drives.value("kick", anim.lowPulse),
      );

      gl.disable(gl.BLEND);

      // How many grains lie on the plate — see drawnGrainCount.
      const resScale = Math.max(1, gl.drawingBufferHeight / 720);
      // The plate's real area on screen at this Zoom: its share of the fitted
      // (or stretched) square, as plateHalf() places it. Above Zoom 1 the
      // grains are drawn bigger by the same factor (POINT_VERT), a closer
      // look rather than a thinner bed: the grain pool is fixed, so with
      // grains of a fixed size it would run out of sand to cover the plate.
      const zoom = resolveSceneSetting(ID, settingFor("plateZoom"));
      // While Zoom out runs the sand covers the frame, at any Zoom.
      const grainPx = resolveSceneSetting(ID, settingFor("grainSize")) * resScale * Math.max(1, zoomOn ? 1 : zoom);
      const fitted = shape !== SQUARE || resolveSceneSetting(ID, settingFor("squarePlate")) > 0.5;
      const squarePx2 = fitted
        ? (2 * SQUARE_PLATE_HALF * Math.min(gl.drawingBufferWidth, gl.drawingBufferHeight)) ** 2
        : gl.drawingBufferWidth * gl.drawingBufferHeight;
      // While Zoom out runs the sand covers the frame and its margin: that
      // much more area, and that many more grains for it (from the
      // SAND_AMOUNT_MAX pool), so the bed on screen is as dense as on the
      // plate without the zoom.
      const sandArea = zoomOn ? (1 + ZOOM_SAND_MARGIN) ** 2 : 1;
      const platePx2 = zoomOn
        ? gl.drawingBufferWidth * gl.drawingBufferHeight * sandArea
        : ((squarePx2 * plateArea(plateOutline(shape))) / 4) * zoom * zoom;
      const sandAmount = resolveSceneSetting(ID, settingFor("sandAmount"));
      const sizeM2 = grainSizeMoment(
        resolveSceneSetting(ID, settingFor("grainWeight")),
        resolveSceneSetting(ID, settingFor("sizeMix")),
      );
      // Never past the pool (only a Sand amount near the top under the zoom reaches it).
      const drawn = Math.min(side * side, drawnGrainCount(grainCount * sandArea, grainPx, platePx2, sandAmount, sizeM2));

      // Sim pass: step the drawn prefix from posTex[read] into posTex[write].
      // The scissor keeps it to the rows that prefix occupies (the sim
      // indexes grains by gl_FragCoord), so the SAND_AMOUNT_MAX pool only
      // costs what is actually on the plate.
      const progs = zoomOn ? (zoomed ??= makePrograms(gl, true)) : plain;
      const { sim: simProg, bg: bgProg, point: pointProg } = progs;
      const write = 1 - read;
      // The plate's atlas on unit 1 for all three passes (the stand-in on
      // the square, which never reads it).
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, atlas);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, posFbo[write]);
      gl.viewport(0, 0, side, side);
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(0, 0, side, Math.max(1, Math.ceil(drawn / side)));
      simProg.use();
      uploadCommonUniforms(simProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf, drives);
      setModes(simProg, modes);
      setOutline(simProg);
      if (zoomOn) {
        setZoom(simProg, layers);
        simProg.setF("uZoomShrink", zoomShrink(zoomStep));
        simProg.setF("uZoomRespawn", zoomRespawnShare(zoomStep));
      }
      simProg.setF("uMaxOrder", maxOrder);
      simProg.setF("uSimDt", dt);
      simProg.setF("uSeed", Math.random() * 100);
      setToss(simProg);
      setWave(simProg);
      simProg.setF("uEmberCool", Math.exp(-dt / Math.max(1e-3, resolveSceneSetting(ID, settingFor("emberFade")))));
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, memTex[read]);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, posTex[read]);
      gl.uniform1i(progs.simPos, 0);
      drawFullscreenQuad(gl, quadVao);
      gl.disable(gl.SCISSOR_TEST);
      // Both hosts (app.ts / tv.ts) size the viewport to the drawing buffer
      // and only re-set it on resize; the gallery preview sets it per frame.
      // Either way the drawing buffer is the right thing to restore to.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      read = write;

      // Plate.
      bgProg.use();
      uploadCommonUniforms(bgProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf, drives);
      setModes(bgProg, modes);
      setOutline(bgProg);
      if (zoomOn) setZoom(bgProg, layers);
      powderBuf.set(powderInk(palette));
      bgProg.setV3v("uPowderInk", powderBuf);
      drawFullscreenQuad(gl, quadVao);

      // Sand: one point per grain, up to drawnGrainCount — see file header
      // for why a fixed grain count can't just render bigger at Grain size.
      // Premultiplied blend — opaque grain cores occlude, halos add (see
      // POINT_FRAG).

      pointProg.use();
      uploadCommonUniforms(pointProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf, drives);
      setModes(pointProg, modes);
      setOutline(pointProg);
      if (zoomOn) setZoom(pointProg, layers);
      pointProg.setF("uSide", side);
      pointProg.setF("uGrainGain", grainGain(grainCount));
      setToss(pointProg);
      pointProg.setV3v("uPowderInk", powderBuf);
      pointProg.setF("uSpecNewest", specNewest - 1 + specClock);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, memTex[read]);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, specTex);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, posTex[read]);
      gl.uniform1i(progs.pointPos, 0);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindVertexArray(pointVao);
      gl.drawArrays(gl.POINTS, 0, drawn);
      gl.bindVertexArray(null);

      // The gallery renders every scene into one shared context each tick —
      // must not leak blend state or a bound texture onto the next tile.
      gl.disable(gl.BLEND);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.activeTexture(gl.TEXTURE0);
    },

    dispose(ctx: SceneContext) {
      const { gl } = ctx;
      disposePrograms(plain);
      disposePrograms(zoomed);
      if (quadVao) gl.deleteVertexArray(quadVao);
      if (pointVao) gl.deleteVertexArray(pointVao);
      for (let i = 0; i < 2; i++) {
        if (posFbo[i]) gl.deleteFramebuffer(posFbo[i]);
        if (posTex[i]) gl.deleteTexture(posTex[i]);
        if (memTex[i]) gl.deleteTexture(memTex[i]);
        posFbo[i] = null;
        posTex[i] = null;
        memTex[i] = null;
      }
      if (specTex) gl.deleteTexture(specTex);
      specTex = null;
      for (const atlas of atlases.values()) gl.deleteTexture(atlas.tex);
      atlases.clear();
      atlasBytes = 0;
      if (blankAtlas) gl.deleteTexture(blankAtlas);
      blankAtlas = null;
      shape = -1;
      plain = null;
      zoomed = null;
      quadVao = null;
      pointVao = null;
      response = null;
      lastFrameTime = null;
      toss = null;
    },
  };
}

export const chladniScene = createChladniScene();
