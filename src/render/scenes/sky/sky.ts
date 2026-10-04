import { createProgram, createFullscreenQuad, drawFullscreenQuad, type GLProgram } from "../../gl.ts";
import type { SceneSetting } from "../../sceneSettings.ts";
import { resolveSceneSetting } from "../../autoTune.ts";
import type { Scene, SceneContext } from "../../scene.ts";
import { COMMON_UNIFORMS_GLSL, DRIVE_GLSL, ROOM_UV_GLSL, settingUniformName, uploadCommonUniforms } from "../../sceneCommon.ts";
import { NUM_BANDS } from "../../../audio/types.ts";
import { PASSTHROUGH_DRIVES } from "../../drives.ts";
import { NOISE_HASH_GLSL, NOISE_MASK, wrapFlow } from "../../noiseHash.ts";
import { createBeatListener, type HoldBeats } from "../../beatListener.ts";
import {
  createFluidSim,
  detectSimFormat,
  simIoGlsl,
  simResolutionFor,
  sameSimSize,
  MIRROR_OFF,
  type FluidSim,
  type SimFormat,
  type Splat,
} from "../fluidSim.ts";

// Sky: a real 2D fluid sim driving cloud cover, with three vision illusions
// layered on top — floaters (in waves), Haidinger's brush and blue-field
// sprites. Picked from the "Open Sky Illusions" preview artifact. The blue
// field entoptic phenomenon was in the first pass, cut as noise, and came
// back at the user's request as sprites with motion (spritesAt): darting
// comets with tails that surge on the beat, sparse at the centre of view.
// Vection, Troxler fading, afterimage, the autokinetic effect and
// pareidolia are deliberately NOT built here, not even as disabled
// settings.
//
// The Rainbow setting splits the beat light waves into a spectrum across
// the ring's width and gives the floaters' rims a faint prism fringe that
// drifts through the spectrum along a streak (spectrumAt; see the
// SWEEP_SPECTRUM_SPAN and FLOATER_DISPERSION comments). Gradient dither adds
// about one 8-bit step of noise as the last step, so the sky gradient
// doesn't band.
//
// The fluid sim is Neon Fluid's stable-fluids solver, fluidSim.ts, shared:
// Sky passes its own splat-slot count (SKY_SPLAT_SLOTS, one per cloud
// drifter) and turns the edge pass off, since only dyeTexture() is read.
// This scene runs it in MIRROR_OFF mode only — full screen, no kaleidoscope fold — the one
// path that needs no adaptation. Cloud drift's own clock is deliberately
// NOT audio-reactive: DRIFTER_SEEDS.length slow, gently
// meandering ambient splats (driftCenter, a real-time clock, never warped by
// anim.flowPhase or frame.energy — the sim step below always passes energy:
// 0, and no port changes that) keep the sky
// moving on its own regardless of what's plugged into any jack; the two
// illusions are what carry the music connection most directly, matching the
// brief's own framing. The ambient amounts (Cloud cover, Flow
// speed, Turbulence, and the Look-side brightness/visibility knobs) each
// carry a patch-bay jack whose default now rides a real source (Section/All
// level/Bass level/Mid level/Treble level — see SETTINGS below) as a lift on
// top of the slider (liftByDrive/skyLift: `amount + (1-amount)*k*drive` —
// drives.ts's header's "Nothing plugged in" paragraph): a loud passage
// lifts the amount above its slider, while a quiet one — or an unplugged
// jack, or every source muted — shows exactly the slider's own sky, never
// a collapsed or reversed one. Free-slip walls are kept as-is (no wrap
// boundary) —
// a possible follow-up, not a v1 blocker, since the drift is slow enough
// that a wall never reads as one in a normal viewing session.
//
// Display is one hand-rolled pass (not createFullscreenScene, which only
// supports a single pass with no texture of its own to sample) reading the
// sim's dyeTexture() through fluidSim.ts's simIoGlsl(format) codec —
// the same reason petri.ts hand-rolls its display pass. Compositing order,
// sky gradient at the bottom, illusions on top:
//   sky gradient -> cloud (contrast-shaped extinction blend off dye
//   density, cross-eroded by a self-written fbm bump for cauliflower
//   texture and continuous morphing, plus a cheap lit-top/shadowed-bottom
//   shade from the density gradient — a thin slab, not Storm's Gas-mode
//   raymarch, which is private to storm.ts) -> Haidinger's brush (faint,
//   added onto the sky+cloud, swelling on each beat) -> blue-field sprites
//   -> floaters (drawn last, on top of everything, since they're the
//   viewer's own eye artifact) -> gradient dither.
// The sky/cloud sample the shared room-space canvas (roomUv) since the
// fluid is one world shared across a Panorama's devices, same as every
// other world-simulating scene; the illusions instead centre on *this
// device's own* screen (vUv, not roomUv) — each is a viewer's own eye
// artifact, not shared room content, so it has to track the screen the
// viewer is actually looking at rather than a hypothetical shared-canvas
// centre that might sit off this device's own slice entirely.
//
// Floaters are hollow, near-transparent refractive tubes: a real floater is
// a strand of vitreous gel refracting the sky behind it, so floaterProfile
// turns the signed distance to a floater's own edge into a faint bright rim,
// a thin dark fringe just outside it and a barely-lifted see-through
// interior, applied as a multiplicative modulation of whatever is behind.
// Strand paths come from floaterPath, which integrates a heading forward at
// a fixed step, so a strand's arc length always comes out exactly right and
// a sharp corner can't form. Dots read the same profile around a disk.
//
// They arrive as short-lived stamps, one per spawn event, each laid out
// like the user's two text-grid references: a streak of cells on a fixed
// grid (FLOATER_CELL), where the reference's ">" body becomes aligned
// strands (all following the streak's slant), its "_" fringe becomes short
// flat strands low in the cell, and its "o" hotspot becomes dots. A streak
// is a slanted ellipse of density (streakDensity), frayed row by row so
// each row's run starts and ends at its own column, the references'
// stair-stepped rows. Every pixel of a cell reads the density at the cell's
// centre and the cell's own hash fixes its floater's shape. Floater glide
// sets whether the grid stays put (a drifting streak then moves by floaters
// switching on and off across it) or rides along with each stamp, so its
// floaters glide with the wind; with the grids differing, a pixel draws the
// two densest streaks so overlapping ones don't cut each other off. Its
// envelope is subtracted from the density rather than multiplied in, so a
// streak pops in fringe-first and dissolves cell by cell (body strand to
// fringe strand to nothing). FLOATER_CELL is sized so a floater plus its
// fringe fits in one cell, since a pixel only evaluates its own cell (of
// each streak's grid).
//
// Where and when they arrive is one mechanism — the floater brush (an
// invisible spawn point the scene owns, stepBrush; NOT Haidinger's bowtie,
// which has its own phase far below). On each spawn event the brush steps
// first (its stride is the Brush move setting), then the stamp lands in a
// small ring around it — pickSwarmCenter nudges to the clearest spot, so a
// trail of streaks traces the brush's path across the sky and wraps at the
// edges. What counts as an event, and how many floaters a stamp lays down,
// is the Floaters setting's drive (the row's jack, src/render/drives.ts):
// drives.fired() gates the event — at Scene that's the shared beat
// listener, one stamp per beat — and drives.value() grades the count
// (floaterCountFromEnergy at Scene: quiet passages sparser, loud ones
// denser; a wired source replaces both wholesale, so a frequent source
// stamps more often and its reading sets the count). spawnFloaters refuses
// a stamp while the Floaters amount product reads 0, and the shader's own
// off-gate in buildDisplayFrag stops any stamp already live at the same
// instant — one param, from trigger to count to off.
//
// Streaks keep off the real clouds twice over: pickSwarmCenter scores the
// candidates around the brush against the cloud drifters' current centres,
// and in the shader a cell over cloud (cloudBumpedAt, the exact field the
// cloud pass thresholds) draws nothing, with a per-pixel cloudAlpha
// backstop. Per pixel the cost is one density evaluation per live stamp
// (MAX_WAVE_BURSTS, each skipped outright when the cell is out of its
// reach) plus one floater, so no quality-tier gating is needed.
//
// Stamps reuse powder.ts's stateless chunk-pool idiom (createWavePool
// below): a small JS pool of (t0, strength, seed, x, y) slots, uploaded as
// flat uniform arrays (uBurstT0/uBurstAmp/uBurstSeed/uBurstX/uBurstY —
// named distinctly from every setting's own auto-generated u<Key>
// uniform), each slot's whole streak evaluated analytically from its age
// in the shader.
//
// On each beat (the same shared beatListener's edge, gated through the
// Light waves drive in render()) a thin ring of pale light ripples quickly
// out from near the centre of view (lightWaveAt), tinted from the sky's own
// lavender, rose and pale-cyan tones and pulled toward a spectrum by
// Rainbow, and it lights only the floaters' own tubes and a pixel or two
// around them: the sky and clouds away from them never change, so the wave
// is only seen as a glint passing through a streak. The same beat swells
// Haidinger's brush for a moment (brushSwell).
//
// Floater visibility (floaterGain) scales the tubes' contrast, and Floater
// sustain (waveLifeSec) sets how long each stamp stays; each keeps the
// life it was given when it fired (uBurstLife), so moving the slider never
// stretches or cuts short a streak already on screen.
//
// The sky runs on its own 24-hour clock. Time of day sets where it sits,
// Day drift how fast it moves on from there (advanceDayOffset, a scene-owned
// accumulator like brushPhase, so moving Time of day never resets the
// drift). The shader lights everything off the sun's elevation (sin of the
// day angle): sky gradient, sun colour and cloud lit/shade tones all blend
// between keys at the horizon glow, golden hour, early evening and midday
// (DAY_KEY_E), mornings warmed toward peach where evenings run pink. There
// is deliberately no night sky (the user asked to skip it): elevation is
// floored at the horizon-glow key (DAY_E_FLOOR), so between sunset and
// sunrise the sky holds a soft twilight glow, and with Day drift on the
// scene hurries through those hours (nightSpeedup) while the sun's halo
// slips under the horizon from right to left. A soft sun halo tracks across
// the frame (rising left, setting right), the horizon warms on the sun's
// side around sunrise and sunset, the clouds' shadow taps point toward the
// sun's side (swinging back through overhead while it's down), and
// Haidinger's brush dims with the daylight it depends on. The default Time
// of day lands on the early-evening key, which is exactly the fixed look the
// scene had before the day cycle existed.
//
// Haidinger's brush rotates on brushPhase, a plain per-frame accumulator
// (advanceBrushPhase) owned by this scene — never anim.barPhase, which
// wraps every bar and would make the brush visibly snap; storm.ts's own
// scene-local morphPhase/advanceMorphPhase is the precedent for owning a
// continuously-increasing accumulator instead of reading an unwrapped beat
// count (animClock.ts's beatClock keeps one internally, but doesn't expose
// it on AnimFrame). Rotation runs at a fixed real-time rate rather than
// tempo-locked — the plan's own explicitly-offered alternative, taken here
// as the simpler of the two: tempo-locking a slow, ambient rotation adds
// complexity (re-deriving a rate from bpm/tempoLock, handling the unlocked
// case) for a difference that's unlikely to read as anything but "slightly
// different speed" at this speed (implementer's call, not eye-verified
// against the tempo-locked alternative).
const ID = "sky";

// --- Floater-wave budget (a compile-time loop bound in the display shader). ---
export const MAX_WAVE_BURSTS = 8; // concurrent floater stamps — one per beat by default, and with a long Floater sustain several stay up at once

// --- Fluid sim tuning. Fixed rather than exposed as settings — the plan's
// settings list is representative, not exhaustive, and these aren't part of
// either illusion. Dye rate raised and dissipation lowered from the first
// pass, which built up too thin and too slowly to read as real cloud cover
// against a real-sky reference (a still frame of open sky runs 40-50% cloud
// coverage with a near-white core, not the soft low-alpha wash the first
// pass produced). ---
const SIM_VISCOSITY = 0.3;
const DYE_DISSIPATION = 0.34; // high enough that old puffs thin out instead of piling into one mass
const SIM_DT_MAX = 1 / 30; // clamps a slow-frame dt so the sim never destabilises

// --- Ambient cloud drift (not audio-reactive — see file header). Many small
// sources, each wandering around its own home spot spread across the whole
// frame (driftCenter) and puffing on and off (drifterPuff), so the cover
// reads as separate airy puffs scattered over the sky. ---
export const DRIFTER_SEEDS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
/** Splat slots Sky asks fluidSim.ts for (Neon Fluid's default is 4): one
 *  cloud source per DRIFTER_SEEDS entry, with headroom — every drifter past
 *  this count would be silently dropped by the sim. tests/sky.test.ts checks
 *  DRIFTER_SEEDS fits. */
export const SKY_SPLAT_SLOTS = 12;
const DRIFT_TANGENT_EPS = 0.08; // finite-difference step used only to find the drift's own heading
const DRIFTER_SIGMA_MIN = 0.045; // splat radius range, sim uv — varied per seed so puffs aren't all one size
const DRIFTER_SIGMA_MAX = 0.085;
const DRIFTER_FORCE = 10; // texels/s^2 at FORCE_REF_ROWS — see fluidSim.ts's header; strong enough that the flow shears puffs into drifting shapes rather than leaving round balls where they were laid
const DRIFTER_DYE_RATE = 1.05; // density/s at the splat centre while puffing, before Cloud cover scales it
const DRIFTER_PUFF_RATE = 0.45; // rad/s of each source's on/off cycle (~14s per puff) — a long "on" phase grows one puff into a big blob

// --- Floater stamps (streaks of floaters on a grid — see the file
// header). One stamp per spawn event, laid where the floater brush stands:
// the brush steps first, the stamp follows, so a trail of streaks traces
// its path across the sky. ---
export const WAVE_LIFE_SEC = 1.8; // a wave's life when none is given (createWavePool's trigger default)
const WAVE_LIFE_MIN_SEC = 0.8; // life at Sustain = 0
const WAVE_LIFE_MAX_SEC = 8; // life at Sustain = 1
const FLOATER_GAIN_MAX = 2.4; // floater contrast gain at Visibility = 1 (so the 0.5 default is 1.2x the tuned contrast)
export const WAVE_DEAD_T0 = -1e9;
const WAVE_FADE_IN_SEC = 0.15; // the streak's density ramps up this fast — floaters pop in, fringe first
const WAVE_FADE_OUT_SEC = 0.9; // and ramps back down over this long, so it dissolves ">" -> "_" -> gone

// --- The floater brush: the invisible spawn point that steps across the
// sky on each stamp (NOT Haidinger's bowtie, which has its own phase far
// below). `stepBrush` owns the motion; the scene owns the state. ---
const BRUSH_STRIDE_MAX = 0.35; // uv travelled per stamp at Brush move = 1
const BRUSH_TURN_MAX = 0.9; // radians of heading wander per stamp
const BRUSH_HEADING_INIT = 0.9; // starting heading, radians — reset in init()
const STAMP_CANDIDATES = 6; // spots around the brush pickSwarmCenter scores
const STAMP_JITTER = 0.1; // uv radius of that candidate ring

// --- Beat light waves: a thin, pale ring of light rippling out from near
// the centre of view on each beat, seen only where it passes through the
// floaters. A plain ring of slots — the oldest is always the one
// overwritten, and the shader retires any wave older than SWEEP_SEC on its
// own, so nothing needs expiring here. ---
export const MAX_SWEEPS = 3;
export const SWEEP_SEC = 0.7; // quick: a ripple, not a slow wipe
// At most one event per beat — the hold both scene listeners share: the
// light sweep and the floater brush stamp land on the same beat under Scene
// (render() advances the one listener once and hands the edge to both).
const ONE_BEAT_HOLD: HoldBeats = { beats: 1, fallbackSec: 0.4 };

/** Which ring slot the next sweep goes in, given how many have fired so
 *  far — always the oldest one. */
export function sweepSlot(fired: number): number {
  const n = Number.isFinite(fired) ? Math.max(0, Math.floor(fired)) : 0;
  return n % MAX_SWEEPS;
}

// --- Day cycle: the sky's own 24-hour clock (see the file header). ---
const DAY_PERIOD_FAST_SEC = 60; // one whole day per minute at Day drift = 1
const DAY_PERIOD_RANGE = 30; // ...and 30x slower (half an hour per day) just above Day drift = 0

/** Days per second at a Day drift setting: 0 holds the sky still at Time of
 *  day; above that, exponential from a half-hour day up to a one-minute day,
 *  so the low end of the slider still has fine control over slow drifts. */
export function dayRatePerSec(drift: number): number {
  const d = Number.isFinite(drift) ? clamp01(drift) : 0;
  if (d <= 0) return 0;
  return 1 / (DAY_PERIOD_FAST_SEC * Math.pow(DAY_PERIOD_RANGE, 1 - d));
}

const NIGHT_SPEEDUP = 12; // how much faster the drift runs while the sun is well below the horizon

/** How much faster than Day drift's own rate the sky moves at a day phase:
 *  1 while the sun is up, easing up to NIGHT_SPEEDUP once it's below the
 *  horizon. The scene has no night sky (the shader holds the sunset glow
 *  while the sun is down), so with drift on it hurries through those hours
 *  rather than sitting in one frozen twilight for half the cycle. Smooth,
 *  so the sun's glow slipping under the horizon never visibly lurches. */
export function nightSpeedup(dayPhase: number): number {
  const e = sunElevation(dayPhase);
  const k = clamp01((-0.02 - e) / 0.13); // 0 at the horizon glow key, 1 by e = -0.15
  return 1 + (NIGHT_SPEEDUP - 1) * k * k * (3 - 2 * k);
}

/** The day cycle's own accumulator — how far the sky has drifted past Time
 *  of day, in days, wrapped to [0, 1). Owned by the scene like brushPhase,
 *  so Time of day can move under it without the drift resetting. `dayPhase`
 *  is the sky's current phase (Time of day plus this offset), so the drift
 *  can hurry through the hours the sun is down (nightSpeedup). */
export function advanceDayOffset(prev: number, dtSec: number, drift: number, dayPhase = 0.5): number {
  const from = Number.isFinite(prev) ? prev : 0;
  const dt = Number.isFinite(dtSec) ? Math.max(0, dtSec) : 0;
  const next = from + dt * dayRatePerSec(drift) * nightSpeedup(dayPhase);
  return next - Math.floor(next);
}

/** Sun elevation, -1..1, at a day phase (0 midnight, 0.25 sunrise, 0.5
 *  noon, 0.75 sunset) — the same curve the display shader lights the sky by. */
export function sunElevation(dayPhase: number): number {
  const t = Number.isFinite(dayPhase) ? dayPhase : 0;
  return Math.sin(2 * Math.PI * (t - 0.25));
}

// --- Haidinger's brush. ---
const BRUSH_TURNS_PER_SEC = 0.045; // one full turn every ~22s
// How fast the brush's beat swell decays, per second: each light-wave sweep
// (the same beat) restarts it at 1, and the bowtie fades back to its resting
// opacity over a fraction of a beat.
const BRUSH_SWELL_DECAY = 3.5;

/** The brush's beat swell, 0..1, `sinceSweepSec` after the latest light-wave
 *  sweep fired: 1 on the beat, decaying back to 0. Never fired (or NaN)
 *  reads 0. */
export function brushSwell(sinceSweepSec: number): number {
  if (!(sinceSweepSec >= 0)) return 0;
  return Math.exp(-sinceSweepSec * BRUSH_SWELL_DECAY);
}

// --- Blue-field sprites (the blue field entoptic phenomenon): tiny bright
// specks darting along short curved paths all over the sky, the white blood
// cells in the retina's own capillaries seen against a bright sky. Each
// sprite runs one path per cycle on the scene's own sprite clock
// (advanceSpritePhase), which runs at a steady pace and surges forward on
// the Blue-field sprites jack's reading (spriteSpeed) — in the real
// phenomenon they pulse with the heartbeat, here with the beat. ---
/** The sprite clock wraps at this many seconds of base-pace travel. Every
 *  sprite's cycle rate is a whole number of cycles per period (the shader's
 *  SPRITE_CYCLES_MIN..MAX), so the wrap moves each sprite back by a whole
 *  number of cycles, and the shader hashes each path from its cycle index
 *  modulo that number: nothing on screen changes at the wrap, and the GPU
 *  never sees a growing clock (the seed-precision problem
 *  SHADER_SEED_PERIOD describes). */
export const SPRITE_PERIOD_SEC = 64;
const SPRITE_SURGE = 2.5; // extra speed at a jack reading of 1, on top of the steady pace

/** The sprite clock's speed multiplier at a jack reading: 1 (the steady
 *  pace) at 0, so an unplugged jack leaves the sprites darting at their own
 *  pace rather than freezing; up to 1 + SPRITE_SURGE as the beat pulse
 *  peaks. Negative or NaN readings count as 0. */
export function spriteSpeed(drive: number): number {
  const d = Number.isFinite(drive) ? Math.max(0, drive) : 0;
  return 1 + SPRITE_SURGE * d;
}

/** The sprite clock: seconds of base-pace travel, wrapped to
 *  [0, SPRITE_PERIOD_SEC). */
export function advanceSpritePhase(prev: number, dtSec: number, speed: number): number {
  const from = Number.isFinite(prev) ? prev : 0;
  const dt = Number.isFinite(dtSec) ? Math.max(0, dtSec) : 0;
  const k = Number.isFinite(speed) ? Math.max(0, speed) : 1;
  const next = from + dt * k;
  return next - Math.floor(next / SPRITE_PERIOD_SEC) * SPRITE_PERIOD_SEC;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// How far the ambient amounts below (Cloud cover, Flow speed, Turbulence,
// Cloud brightness, Floater visibility) lift above their own slider when
// their jack's drive reads 1 — drives.ts's header's "Nothing plugged in"
// paragraph: each of these is an amount that exists with no music at all,
// so its coupling has to be identity at drive 0 rather than a plain `slider
// * drive`, which would zero the amount out (or run it backwards) the
// instant a jack sits unplugged. `skyLift` (FRAG, below) is this formula's
// GLSL twin.
const SKY_DRIVE_LIFT = 0.5;

/** `amount` lifted toward 1 by `drive` — identity at drive 0
 *  (`liftByDrive(amount, 0) === amount`), monotone increasing in drive,
 *  never above 1. See SKY_DRIVE_LIFT's own comment. */
export function liftByDrive(amount: number, drive: number): number {
  const a = Number.isFinite(amount) ? clamp01(amount) : 0;
  const d = Number.isFinite(drive) ? drive : 0;
  return clamp01(a + (1 - a) * SKY_DRIVE_LIFT * d);
}

/** How long a floater wave stays, in seconds, at a Sustain setting: squared,
 *  so the short end (where a quick flicker vs a brief hold matters most)
 *  gets most of the slider. */
export function waveLifeSec(sustain: number): number {
  const s = Number.isFinite(sustain) ? clamp01(sustain) : 0;
  return WAVE_LIFE_MIN_SEC + (WAVE_LIFE_MAX_SEC - WAVE_LIFE_MIN_SEC) * s * s;
}

/** Floater contrast gain at a Visibility setting — 0 hides them, the 0.5
 *  default is 1.2x the tuned contrast, 1 is double that. */
export function floaterGain(visibility: number): number {
  const v = Number.isFinite(visibility) ? clamp01(visibility) : 0;
  return FLOATER_GAIN_MAX * v;
}

/** How many floaters a stamp lays down at Scene, from the room's loudness
 *  this tick: a gentle 0.45..1 grade, so quiet passages stamp sparsely and
 *  loud ones fill in — the signal deciding the count. This is the scene's
 *  own composite behind drives.value("floaterDensity", …); a re-patched
 *  source replaces it wholesale. */
export function floaterCountFromEnergy(energy: number): number {
  const e = Number.isFinite(energy) ? clamp01(energy) : 0;
  return 0.45 + 0.55 * e;
}

/** The spawn gate every floater stamp passes through (see the file header):
 *  the graded count comes back only while the Floaters amount product the
 *  shader draws with (the resolved amount already multiplied by its drive,
 *  so JS and GLSL gate on the identical number) and the count grade itself
 *  are above 0 — otherwise 0, and render() stamps nothing. NaN fails closed
 *  (`!(x > 0)`); live stamps stop drawing through the shader's own off-gate
 *  in buildDisplayFrag. */
export function spawnFloaters(amountProduct: number, count: number): number {
  if (!(amountProduct > 0 && count > 0)) return 0;
  return count;
}

/** Haidinger's brush's own accumulator: a plain, continuously increasing
 *  phase (never anim.barPhase — see file header) so the bowtie glides
 *  instead of snapping every bar. */
export function advanceBrushPhase(prev: number, dtSec: number): number {
  const from = Number.isFinite(prev) ? prev : 0;
  const dt = Number.isFinite(dtSec) ? Math.max(0, dtSec) : 0;
  return from + dt * BRUSH_TURNS_PER_SEC * Math.PI * 2;
}

/** One step of the floater brush — the invisible spawn point, not
 *  Haidinger's bowtie: the heading wanders by a hashed turn, the point
 *  advances `stride` uv along it and wraps toroidally, so a trail of stamps
 *  winds across the sky and keeps going past the edges. stride 0 (Brush
 *  move = 0) holds the position — stamps pile up — while the heading still
 *  wanders for when it is released. Pure and deterministic per seed, so
 *  it's testable without a GL context. */
export function stepBrush(
  pos: readonly [number, number],
  heading: number,
  stride: number,
  seed: number,
): { x: number; y: number; heading: number } {
  const s = Number.isFinite(seed) ? seed : 0;
  const fract = (v: number) => v - Math.floor(v);
  const turn = (fract(Math.sin(s * 21.987 + 3.7) * 43758.5453) - 0.5) * 2 * BRUSH_TURN_MAX;
  const h = (Number.isFinite(heading) ? heading : BRUSH_HEADING_INIT) + turn;
  const d = Number.isFinite(stride) ? Math.max(0, stride) : 0;
  const x0 = (Number.isFinite(pos[0]) ? pos[0] : 0.5) + Math.cos(h) * d;
  const y0 = (Number.isFinite(pos[1]) ? pos[1] : 0.5) + Math.sin(h) * d;
  return { x: x0 - Math.floor(x0), y: y0 - Math.floor(y0), heading: h };
}

/** The ambient drift's own slow meander, in sim uv space: each seed owns a
 *  home spot (golden-ratio / sqrt(2) low-discrepancy sequences, so
 *  consecutive integer seeds land evenly spread over the whole frame rather
 *  than clumped) and wanders a small
 *  Lissajous-ish loop around it. Pure and deterministic so it's testable
 *  without a GL context. render() also samples this at
 *  `tSec + DRIFT_TANGENT_EPS` to get a finite-difference heading for the
 *  splat's push direction. Stays within [0.04, 0.96] x [0.06, 0.94] — near
 *  enough to the edges that the sides of the frame get cloud too. */
export function driftCenter(seed: number, tSec: number): [number, number] {
  const s = Number.isFinite(seed) ? seed : 0;
  const t = Number.isFinite(tSec) ? tSec : 0;
  const fract = (v: number) => v - Math.floor(v);
  const hx = 0.1 + 0.8 * fract(0.1 + s * 0.6180339887);
  const hy = 0.12 + 0.76 * fract(0.35 + s * 0.4142135624);
  const a1 = 0.05 + (Math.abs(s * 0.017) % 0.02);
  const a2 = 0.07 + (Math.abs(s * 0.013) % 0.02);
  const x = hx + 0.06 * Math.sin(t * a1 + s * 2.1) * Math.cos(t * a2 * 0.6 + s);
  const y = hy + 0.06 * Math.cos(t * a2 + s * 1.3);
  return [x, y];
}

/** 0..1 dye gate for one source at time t: each seed breathes on and off on
 *  its own phase, so a source lays down separate puffs that drift apart
 *  instead of one continuous stream. */
export function drifterPuff(seed: number, tSec: number): number {
  const s = Number.isFinite(seed) ? seed : 0;
  const t = Number.isFinite(tSec) ? tSec : 0;
  const w = 0.5 + 0.5 * Math.sin(t * DRIFTER_PUFF_RATE * (0.8 + 0.07 * s) + s * 3.7);
  const e = clamp01((w - 0.35) / 0.4);
  return e * e * (3 - 2 * e);
}

/** Where a stamp lands, in screen uv: the clearest of STAMP_CANDIDATES
 *  hashed spots in a small ring around the brush (plus the brush's own
 *  spot), i.e. the one farthest from every obstacle — the cloud drifters'
 *  current centres, since clouds form around them. The brush's stepped
 *  position decides the region; this only nudges within it, so a trail
 *  stays a trail. Live waves are deliberately NOT obstacles — a trail is
 *  meant to accumulate. Pure and deterministic per seed, so it's testable
 *  without a GL context; the shader's per-floater cloud fade covers
 *  whatever this heuristic misses. */
export function pickSwarmCenter(
  seed: number,
  brush: readonly [number, number],
  obstacles: readonly (readonly [number, number])[],
): [number, number] {
  const s = Number.isFinite(seed) ? seed : 0;
  const fract = (v: number) => v - Math.floor(v);
  const bx = Number.isFinite(brush[0]) ? brush[0] : 0.5;
  const by = Number.isFinite(brush[1]) ? brush[1] : 0.5;
  let best: [number, number] = [bx, by];
  let bestScore = -Infinity;
  for (let i = 0; i < STAMP_CANDIDATES; i++) {
    let x = bx;
    let y = by;
    if (i > 0) {
      const a = fract(Math.sin(s * 12.9898 + i * 78.233) * 43758.5453) * Math.PI * 2;
      const r = (0.3 + 0.7 * fract(Math.sin(s * 39.3468 + i * 11.135) * 24634.6345)) * STAMP_JITTER;
      x = Math.min(0.97, Math.max(0.03, bx + Math.cos(a) * r));
      y = Math.min(0.97, Math.max(0.03, by + Math.sin(a) * r));
    }
    let score = Infinity;
    for (const [ox, oy] of obstacles) score = Math.min(score, Math.hypot(x - ox, y - oy));
    if (score > bestScore) {
      bestScore = score;
      best = [x, y];
    }
  }
  return best;
}

/** One live floater stamp: when it started, how many floaters it lays down
 *  (0..1, from floaterCountFromEnergy or a wired source's reading), the seed
 *  its streak's layout hashes from, where it landed (screen uv, from
 *  pickSwarmCenter at the brush) and how long it lives (from the Sustain
 *  setting at the moment it fired, so moving the slider never stretches or
 *  cuts short a streak already on screen). Same stateless-pool idiom as
 *  powder.ts's createChunkPool — see this file's header. */
export interface WaveBurst {
  t0: number;
  strength: number;
  seed: number;
  x: number;
  y: number;
  life: number;
}

export interface WavePool {
  /** Starts a wave at screen uv (x, y) living `life` seconds (default
   *  WAVE_LIFE_SEC), reusing a dead slot or displacing the oldest live one. */
  trigger(nowSec: number, strength: number, seed: number, x?: number, y?: number, life?: number): void;
  /** Retires every wave older than its own life. */
  tick(nowSec: number): void;
  /** How many waves are currently live. */
  alive(): number;
  /** Uploads the pool as uBurstT0/uBurstAmp/uBurstSeed/uBurstX/uBurstY/uBurstLife. */
  upload(prog: GLProgram): void;
  /** The raw slots, for tests. */
  readonly bursts: readonly WaveBurst[];
}

/** Period of the seeds the shader hashes (a stamp's uBurstSeed, a sweep's
 *  uSweepSeed). The shader's fract-based hash21 multiplies the seed by about
 *  123 before taking fract(), and fp32 keeps only 23 bits of that product, so
 *  an ever-growing seed leaves it fewer and fewer fractional bits (one stamp
 *  per beat runs it dry within hours of a gig) and every streak or sweep
 *  ends up with nearly the same hash. Wrapping what reaches the GPU keeps
 *  256 * 123 ~ 3.2e4, which still leaves about 8 fractional bits; the JS
 *  counters themselves (stepBrush, pickSwarmCenter) never wrap. */
export const SHADER_SEED_PERIOD = 256;

/** x reduced into [0, SHADER_SEED_PERIOD), in float64 — safe for fractions
 *  and negatives. */
export function wrapShaderSeed(x: number): number {
  const w = x - Math.floor(x / SHADER_SEED_PERIOD) * SHADER_SEED_PERIOD;
  return Number.isFinite(w) ? w : 0;
}

// --- Cloud bump drift. The bump and wisp fbm domains drift at
// CLOUD_BUMP_MORPH room-uv units per second — churn beyond plain advection.
// The drift offset is added to every octave's own noise coordinate by the JS
// side (cloudNoiseFlows), already wrapped into the lattice period, so the GPU
// never sees the ever-growing session time (noiseHash.ts's header). ---
const CLOUD_BUMP_MORPH = 0.05;
const CLOUD_FBM_OCTAVES = 3; // fbm2 below loops this many octaves
const CLOUD_FBM_LACUNARITY = 2.02;
/** uCloudFlow layout: per fbm octave, a vec4 [bump x, bump y, wisp x, wisp y]. */
export const CLOUD_FLOW_LEN = CLOUD_FBM_OCTAVES * 4;

/** Fills `out` with the drift offset each fbm octave of the cloud bump and
 *  wisp fields adds to its noise coordinate, wrapped into the lattice period.
 *  The shader used to add one offset to the coordinate before the octave
 *  loop, so octave k saw it scaled by CLOUD_FBM_LACUNARITY^k; the same scale
 *  is applied here in float64, and only then wrapped, in that octave's own
 *  lattice frame, where the wrap is a whole number of periods and so
 *  invisible. The bump drifts +x/+y at a fixed ratio, the wisp -x at 1.7
 *  times the bump's rate. */
export function cloudNoiseFlows(timeSec: number, out: Float32Array = new Float32Array(CLOUD_FLOW_LEN)): Float32Array {
  const t = Number.isFinite(timeSec) ? timeSec : 0;
  let scale = 1;
  for (let k = 0; k < CLOUD_FBM_OCTAVES; k++) {
    const o = k * 4;
    out[o] = wrapFlow(t * CLOUD_BUMP_MORPH * scale);
    out[o + 1] = wrapFlow(t * CLOUD_BUMP_MORPH * 0.6 * scale);
    out[o + 2] = wrapFlow(-t * CLOUD_BUMP_MORPH * 1.7 * scale);
    out[o + 3] = 0;
    scale *= CLOUD_FBM_LACUNARITY;
  }
  return out;
}

export function createWavePool(): WavePool {
  const bursts: WaveBurst[] = [];
  for (let i = 0; i < MAX_WAVE_BURSTS; i++) {
    bursts.push({ t0: WAVE_DEAD_T0, strength: 0, seed: 0, x: 0.5, y: 0.5, life: WAVE_LIFE_SEC });
  }
  const t0Buf = new Float32Array(MAX_WAVE_BURSTS);
  const ampBuf = new Float32Array(MAX_WAVE_BURSTS);
  const seedBuf = new Float32Array(MAX_WAVE_BURSTS);
  const xBuf = new Float32Array(MAX_WAVE_BURSTS);
  const yBuf = new Float32Array(MAX_WAVE_BURSTS);
  const lifeBuf = new Float32Array(MAX_WAVE_BURSTS);

  return {
    bursts,
    trigger(nowSec, strength, seed, x = 0.5, y = 0.5, life = WAVE_LIFE_SEC): void {
      let slot = 0;
      let oldest = Infinity;
      for (let i = 0; i < bursts.length; i++) {
        if (bursts[i].t0 === WAVE_DEAD_T0) {
          slot = i;
          oldest = -Infinity;
          break;
        }
        if (bursts[i].t0 < oldest) {
          oldest = bursts[i].t0;
          slot = i;
        }
      }
      const b = bursts[slot];
      b.t0 = Number.isFinite(nowSec) ? nowSec : 0;
      b.strength = clamp01(Number.isFinite(strength) ? strength : 0);
      b.seed = seed;
      b.x = Number.isFinite(x) ? x : 0.5;
      b.y = Number.isFinite(y) ? y : 0.5;
      b.life = Number.isFinite(life) && life > 0 ? life : WAVE_LIFE_SEC;
    },
    tick(nowSec): void {
      for (const b of bursts) {
        if (b.t0 !== WAVE_DEAD_T0 && nowSec - b.t0 > b.life) {
          b.t0 = WAVE_DEAD_T0;
          b.strength = 0;
        }
      }
    },
    alive(): number {
      let n = 0;
      for (const b of bursts) if (b.t0 !== WAVE_DEAD_T0) n++;
      return n;
    },
    upload(prog): void {
      for (let i = 0; i < bursts.length; i++) {
        const b = bursts[i];
        t0Buf[i] = b.t0;
        ampBuf[i] = b.strength;
        seedBuf[i] = wrapShaderSeed(b.seed);
        xBuf[i] = b.x;
        yBuf[i] = b.y;
        lifeBuf[i] = b.life;
      }
      prog.setFv("uBurstT0", t0Buf);
      prog.setFv("uBurstAmp", ampBuf);
      prog.setFv("uBurstSeed", seedBuf);
      prog.setFv("uBurstX", xBuf);
      prog.setFv("uBurstY", yBuf);
      prog.setFv("uBurstLife", lifeBuf);
    },
  };
}

// Every auto table below reproduces its plain `default` when all dials sit
// at NEUTRAL (musicProfile.ts) — nothing hand-biased; see
// tests/sky.test.ts. Weights follow autoTune.ts's convention (|weight| in
// ~0.15..0.5, per-setting sum under ~0.8).
const SETTINGS: SceneSetting[] = [
  // Form
  {
    key: "cloudCover",
    label: "Cloud cover",
    description: "How much dye the ambient drift injects into the sky — thin wisps at the low end, a fuller cover at the high end",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { density: 0.3 },
    // A plain Section default — a chorus gathers a little more cloud than a
    // verse does; lifted on top of the slider (liftByDrive in render()), so
    // an unplugged jack leaves Cloud cover exactly where its slider sits.
    drive: { default: "anim.sectionIntensity" },
  },
  // Motion
  {
    key: "flowSpeed",
    label: "Flow speed",
    description: "How fast the whole fluid evolves — a slow drift at the low end, a brisker roll at the high end",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { tempo: 0.25 },
    // A plain All level default — the room's own energy nudges the fluid to
    // roll a little faster (liftByDrive in render(), which is where the
    // drive actually moves the fluid, through the sim's own dt/force — the
    // streak-wind formula in FRAG deliberately reads the slider alone; see
    // that formula's own comment).
    drive: { default: "anim.energy" },
  },
  {
    key: "turbulence",
    label: "Turbulence",
    description: "How readily the drift curls into swirls and tendrils instead of a smooth roll",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.45,
    auto: { density: 0.2, tempo: 0.2 },
    // A plain Bass level default — a bass-heavy passage curls the drift into
    // a few more swirls (liftByDrive in render()).
    drive: { default: "anim.low" },
  },
  {
    key: "floaterDensity",
    label: "Floaters",
    description:
      "How many floaters each stamp lays down — a light touch at the low end, a dense cloud of them at the high end. The signal scales it beat by beat, and 0 stops the brush stamping entirely",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { density: 0.2, dynamics: 0.15 },
    // The one floater param: its jack owns the stamp trigger AND how many
    // floaters a stamp lays down (render(): spawnFloaters gates the spawn on
    // this amount's product, drives.value() grades the count). Scene
    // composite is the shared beat listener (one stamp per beat) with the
    // count riding loudness — see floaterCountFromEnergy — so sceneSources
    // names both halves a re-patch replaces.
    drive: { default: "scene", sceneLabel: "Scene: every beat, count rides loudness", sceneSources: ["feature.onset", "anim.energy"] },
  },
  {
    key: "brushMove",
    label: "Brush move",
    description: "How far the brush steps across the sky each time it stamps — held in place at 0 (stamps pile up), long hops toward the edges at 1",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.3,
  },
  {
    key: "floaterSustain",
    label: "Floater sustain",
    description: "How long each wave of floaters stays before it dissolves — a quick flicker at the low end, several seconds of hanging in the sky at the high end",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.35,
  },
  {
    key: "floaterGlide",
    label: "Floater glide",
    description:
      "How the floaters travel with their streak — snapping from cell to cell on a fixed screen grid at 0, gliding smoothly with the wind at 1",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 1,
  },
  {
    key: "dayDrift",
    label: "Day drift",
    description:
      "How fast the sky moves through its day — held still at 0, a slow daylight drift just above it, a quick one at 1. It hurries through the hours after sunset, since the scene has no night",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.3,
  },
  // Look
  {
    key: "timeOfDay",
    label: "Time of day",
    description:
      "Where in a 24-hour day the sky sits — 0.25 sunrise, 0.5 noon, 0.75 sunset; between sunset and sunrise it holds a soft twilight glow rather than going dark. With Day drift above zero the sky keeps moving on from here",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.71,
    // A position on a 24-hour clock, not an amount: the Master and Expansion
    // dials must not move the sun (see SceneSetting.masterScale).
    masterScale: false,
  },
  {
    key: "cloudBrightness",
    label: "Cloud brightness",
    description: "How brightly lit the cloud tops read against the sky",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    auto: { loudness: 0.2 },
    // A plain Mid level default — the cloud tops lift a little brighter with
    // the mids (skyLift in FRAG, the GLSL twin of liftByDrive).
    drive: { default: "anim.mid" },
  },
  {
    key: "brushOpacity",
    label: "Brush opacity",
    description: "Faintness of Haidinger's brush, the bowtie afterimage that turns slowly over the centre of view — dims a little further as the music gets louder",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.35,
    auto: { density: -0.2 },
    // A plain All level default: the shader dims the brush by
    // (1 - 0.4 * brushOpacityDrive(uEnergy)) (buildDisplayFrag's brush
    // term) — identity at drive 0, so an unplugged jack leaves the brush at
    // the slider's own opacity rather than making it vanish.
    drive: { default: "anim.energy" },
  },
  {
    key: "floaterVisibility",
    label: "Floater visibility",
    description: "How strongly the floaters stand out from the sky behind them — gone at 0, faint and glassy low, crisp and bold high",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    // A plain Treble level default — floaters stand out a little more with
    // the hats/cymbals (liftByDrive in render()).
    drive: { default: "anim.high" },
  },
  {
    key: "lightWaves",
    label: "Light waves",
    description: "How brightly the floaters glint in pale sky tints as a ring of light passes through them on each beat",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    // The beat sweep's spawn trigger (the brightness itself is this
    // slider's amount). Scene composite is the beat beatListener — its
    // one-per-beat hold still owns the cadence under Scene (see render());
    // its edge is the broadband onset, which is what sceneSources names.
    drive: { default: "scene", sceneLabel: "Scene: every beat", sceneSources: ["feature.onset"] },
  },
  {
    key: "rainbow",
    label: "Rainbow",
    description:
      "How much the light waves split into rainbow bands, and the floaters' rims into faint prism colours — the pale sky tints alone at 0, a clear spectrum at 1",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
  },
  {
    key: "sprites",
    label: "Blue-field sprites",
    description:
      "Tiny bright specks darting along short curved paths all over the sky, the way they do when you stare at a bright blue sky — none at 0, a busy field at 1. They thin out right at the centre of view, and the signal makes them surge forward",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.4,
    // A plain Beat default: each beat pulse surges the sprites forward
    // (spriteSpeed in render(), 1 at drive 0), like the real ones pulsing
    // with the heartbeat; an unplugged jack leaves them at their own pace.
    drive: { default: "feature.onset" },
  },
  {
    key: "dither",
    label: "Gradient dither",
    description:
      "Fine noise, about one brightness step, that hides the stripes a smooth sky gradient shows on an 8-bit screen — off at 0, two steps at 1",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
  },
];

function settingFor(key: string): SceneSetting {
  const s = SETTINGS.find((x) => x.key === key);
  if (!s) throw new Error(`sky: unknown setting ${key}`);
  return s;
}

const SETTINGS_UNIFORMS_GLSL = SETTINGS.map((s) => `uniform float ${settingUniformName(s.key)};`).join("\n");

// Per drive setting (see drives.ts's header): u<Key>Drive/u<Key>Custom plus
// the <key>Drive(sceneDefault) helper the display frag calls at each
// coupling's site — at Custom=0 (Scene) the helper returns sceneDefault
// bit-for-bit, so every call site below is unchanged until a source is
// picked.
const DRIVE_UNIFORMS_GLSL = DRIVE_GLSL(SETTINGS);

function buildDisplayFrag(format: SimFormat): string {
  return `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
${COMMON_UNIFORMS_GLSL}
${SETTINGS_UNIFORMS_GLSL}
${DRIVE_UNIFORMS_GLSL}
${ROOM_UV_GLSL}
${simIoGlsl(format)}
uniform sampler2D uDye;
uniform float uBrushPhase;
uniform float uBurstT0[${MAX_WAVE_BURSTS}];
uniform float uBurstAmp[${MAX_WAVE_BURSTS}];
uniform float uBurstSeed[${MAX_WAVE_BURSTS}];
uniform vec4 uCloudFlow[${CLOUD_FBM_OCTAVES}]; // per fbm octave: bump xy, wisp xy (cloudNoiseFlows)
uniform float uBurstX[${MAX_WAVE_BURSTS}];
uniform float uBurstY[${MAX_WAVE_BURSTS}];
uniform float uBurstLife[${MAX_WAVE_BURSTS}]; // each wave's own life, from Floater sustain when it fired
uniform float uSweepT0[${MAX_SWEEPS}];
uniform float uSweepSeed[${MAX_SWEEPS}];
uniform float uFloaterGain; // floaterGain(Floater visibility)
uniform float uDayPhase; // 0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset (see advanceDayOffset)
uniform float uBrushSwell; // brushSwell(): 1 on a light-wave beat, decaying back to 0
uniform float uSpritePhase; // advanceSpritePhase(): the sprite clock, wrapped to SPRITE_PERIOD_SEC
uniform float uSpriteSpeed; // spriteSpeed(): this tick's speed multiplier, which stretches the sprites' tails

const int MAX_WAVE_BURSTS_C = ${MAX_WAVE_BURSTS};
const float WAVE_FADE_IN = ${WAVE_FADE_IN_SEC.toFixed(3)};
const float WAVE_FADE_OUT = ${WAVE_FADE_OUT_SEC.toFixed(3)};
const int MAX_SWEEPS_C = ${MAX_SWEEPS};
const float SWEEP_SEC_C = ${SWEEP_SEC.toFixed(3)};
// A beat light wave (see the wave loop in main): a ring expanding from
// within SWEEP_ORIGIN_SPREAD of the centre of view, SWEEP_WIDTH thick in
// screen p-units (a thin front with a short soft trail), its edge rippled
// by SWEEP_WOBBLE in SWEEP_WOBBLE_LOBES lobes around the ring (a whole
// number, so the ripple closes up with no seam), easing out as it spreads
// like a ripple on water. Coloured only from pale tints already in the
// sky's own palette (SWEEP_TINT_*), drifting between them around the ring
// and across its width, and screen-blended at up to SWEEP_ALPHA (times the
// Light waves setting). The Rainbow setting pulls those tints toward a
// spectrum laid across the ring's width (spectrumAt over SWEEP_SPECTRUM_SPAN
// widths, red on the leading edge, violet in the trail), like a rainbow's
// own band order. The glint lights each floater's tube and a soft halo
// SWEEP_HALO_PX wide around it, so a tube a few pixels across still shows it.
const float SWEEP_WIDTH = 0.045;
const float SWEEP_WOBBLE = 0.02;
const float SWEEP_WOBBLE_LOBES = 5.0;
const float SWEEP_ORIGIN_SPREAD = 0.12;
const float SWEEP_EASE = 1.8; // >1 eases the ring out: fast from the centre, slowing as it spreads
const float SWEEP_ALPHA = 0.85;
const float SWEEP_HALO_PX = 1.5;
const float SWEEP_HALO = 0.45; // the halo's glint relative to the tube's own
const float SWEEP_SPECTRUM_SPAN = 2.6; // ring widths the spectrum spreads over, leading edge to trail
const float RAINBOW_SAT = 0.85; // spectrum saturation at Rainbow = 1 (1 = pure hues, which read as neon here)
const vec3 SWEEP_TINT_A = vec3(0.84, 0.80, 1.00); // lavender, the early-evening zenith lifted
const vec3 SWEEP_TINT_B = vec3(1.00, 0.86, 0.90); // rose, the sunset cloud tone lifted
const vec3 SWEEP_TINT_C = vec3(0.82, 0.94, 1.00); // pale cyan, the midday horizon lifted

// The day cycle's light, keyed on sun elevation (sin of the day angle, -1 at
// midnight to +1 at noon) rather than on clock time, so dawn and dusk share
// one set of keys and only differ where main() warms mornings toward peach.
// Keys, low to high: the glow right at the horizon, golden hour, early
// evening (the look this scene had before it had a day cycle, which the
// default Time of day lands on) and midday. There is deliberately no night:
// elevation is floored at the first key (DAY_E_FLOOR), so once the sun is
// down the sky holds its sunset glow until sunrise, and with Day drift on the
// scene hurries through those hours (nightSpeedup). Each colour blends
// between its two neighbouring keys (dayWeights). That first key is
// therefore the darkest the sky ever gets, and the user set it by a palette
// reference: one blue-violet family (hue ~224-244), deep saturated indigo
// through periwinkle to lavender-white, no warm tones. Its zenith and horizon
// are solved (docs/scenes/sky/scripts/solve_key.py) so that after
// SKY_SPREAD/SKY_LEVEL the top edge renders ~(0.24, 0.29, 0.68) and the
// bottom ~(0.84, 0.86, 0.975); the horizon is capped at 1.
const float DAY_KEY_E[4] = float[4](-0.02, 0.08, 0.25, 0.65);
const float DAY_E_FLOOR = -0.02;
const vec3 SKY_ZENITH[4] = vec3[4](
  vec3(0.245, 0.328, 0.984), vec3(0.300, 0.360, 0.600), vec3(0.370, 0.440, 0.650), vec3(0.260, 0.450, 0.780));
const vec3 SKY_HORIZON[4] = vec3[4](
  vec3(1.000, 1.000, 0.950), vec3(0.950, 0.720, 0.580), vec3(0.710, 0.700, 0.840), vec3(0.700, 0.800, 0.930));
const vec3 CLOUD_LIT_KEY[4] = vec3[4](
  vec3(0.900, 0.900, 1.000), vec3(1.000, 0.820, 0.660), vec3(0.980, 0.930, 0.950), vec3(1.000, 0.990, 0.970));
const vec3 CLOUD_SHADE_KEY[4] = vec3[4](
  vec3(0.400, 0.420, 0.720), vec3(0.500, 0.420, 0.520), vec3(0.540, 0.500, 0.640), vec3(0.580, 0.620, 0.720));
const vec3 SUN_KEY[4] = vec3[4](
  vec3(0.720, 0.700, 1.000), vec3(1.000, 0.700, 0.400), vec3(1.000, 0.880, 0.750), vec3(1.000, 0.970, 0.900));
const vec3 MORNING_WARMTH = vec3(1.04, 1.0, 0.86); // mornings lean peach/gold where evenings lean pink
// Two whole-sky trims applied on top of every key, after the sun's glow is
// added (see main): SKY_SPREAD pulls each sky pixel's hue and saturation
// toward the colour halfway between the keyed zenith and horizon while
// keeping its brightness, so the gradient spans fewer colours (1 = the keys
// as written; a sunset went navy to coral, over 120 degrees of hue);
// SKY_LEVEL then dims the whole sky. Clouds are untouched, so they stand out
// a little more against it.
const float SKY_SPREAD = 0.6;
const float SKY_LEVEL = 0.86;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
// The horizon-to-zenith gradient runs between these two heights, in screen
// uv.y (0 bottom, 1 top): LO below 0 means the bottom edge already carries a
// little of the zenith colour, and HI below 1 means the top tenth is pure zenith.
const float SKY_GRADIENT_LO = -0.1;
const float SKY_GRADIENT_HI = 0.9;
// The sun's place in the frame: it rises at the left, sets at the right, and
// is near the top of the frame at noon, horizon at the bottom edge. Its glow
// is a wide soft halo plus a tighter core (no hard disc), and around sunrise
// and sunset the horizon warms most on the sun's own side. SUN_DISTANCE then
// pushes that whole path outward from the frame's centre: at 1 the sun hugs
// the frame (on the top edge at noon, just past the right edge by early
// evening); above 1 it sits further out, so less of its glow reaches the frame.
const float SUN_X_SPAN = 0.62; // fraction of the frame's width the sun's path spans either side of centre
const float SUN_DISTANCE = 1.4;
const float SUN_HALO = 0.30;
const float SUN_CORE = 0.22;
const float HORIZON_WARM = 0.35;

const float CLOUD_LOW = 0.16; // bumped density below this reads as clear sky
const float CLOUD_HIGH = 0.55; // bumped density above this reads as a solid, opaque cloud body — a wide band, so edges fade through semi-transparent wisps (airy) rather than a hard cut-out
const float CLOUD_WISP_SCALE = 2.9; // second, finer bump octave, relative to CLOUD_BUMP_SCALE — frays the edges into wisps
const float CLOUD_WISP_AMOUNT = 0.35;
const float CLOUD_BUMP_SCALE = 11.0; // fbm frequency, room-uv units — the cauliflower texture
const float CLOUD_BUMP_AMOUNT = 0.65; // how hard the bump noise erodes/thickens the edge
// Two shadow taps toward the light (the sun, from
// whichever side of the frame it sits on; see main) — storm.ts's Gas
// mode's own two-tap technique (SUN_DIR + densityCheap/shape at 0.18/0.5,
// exp(-1.9*s1-1.15*s2), mixed as a colour ramp not a brightness scalar),
// ported from its 3D raymarch to a plain 2D density lookup. A single
// adjacent-texel check (the first pass's own shadeAmt) only ever sees
// edges; a wide cloud's flat interior has no local gradient at that scale,
// which is why v1 read as one flat tone instead of a folded mass.
const float CLOUD_SHADOW_TAP1 = 0.045;
const float CLOUD_SHADOW_TAP2 = 0.095;
// Calibrated against this scene's own measured density range (median ~0.8,
// p90 ~1.65 inside the cloud silhouette — much higher than storm.ts's own
// 3D density scale, which is why its 1.9/1.15 weights collapsed shadow to
// ~0 almost everywhere here on the first try, read directly off a debug
// render rather than re-guessed blind).
const float CLOUD_SHADOW_K1 = 0.85;
const float CLOUD_SHADOW_K2 = 0.52;
const float BRUSH_R_CORE = 0.03;
const float BRUSH_R_IN = 0.22;
const float BRUSH_R_OUT = 0.34;
const float BRUSH_BASE = 0.5;
const float BRUSH_SWELL = 1.0; // extra opacity the beat swell (uBrushSwell) adds at its peak
// Haidinger's brush is a yellow bowtie with faint blue in the gaps between
// its lobes. Each lobe adds light (a warm or a cool lift) rather than
// multiplying the sky by a tint: yellow multiplied into a blue sky only
// greys it toward olive.
const vec3 BRUSH_YELLOW = vec3(0.16, 0.13, 0.02);
const vec3 BRUSH_BLUE = vec3(-0.03, 0.01, 0.10);
// Blue-field sprites (see advanceSpritePhase in the JS above). Each
// SPRITE_CELL square of the screen may hold one sprite (more cells hold one
// as the Blue-field sprites setting rises, up to SPRITE_FILL of them). A
// sprite runs one short curved path per cycle, starting within
// SPRITE_START_JITTER cells of its cell's centre and travelling
// SPRITE_PATH_MIN..MAX cells, so it stays within reach of the 2x2 block of
// cells a pixel checks (spritesAt). Its rate is a whole number of cycles per SPRITE_PERIOD_SEC
// (SPRITE_CYCLES_MIN..MAX), so the clock's wrap is seamless. It fades in and
// out over each path (a sine envelope), trails a short tail that stretches
// with uSpriteSpeed, and keeps clear of the centre of view (SPRITE_GAP_R,
// the fovea has no capillaries) and mostly of the clouds (SPRITE_OVER_CLOUD).
const float SPRITE_CELL = 0.075;
const float SPRITE_FILL = 0.55;
const float SPRITE_START_JITTER = 0.25;
const float SPRITE_PATH_MIN = 0.35;
const float SPRITE_PATH_MAX = 0.6;
const float SPRITE_BEND = 2.4; // radians of turn over one path, at most (random sign)
const float SPRITE_PERIOD_C = ${SPRITE_PERIOD_SEC.toFixed(1)};
const float SPRITE_CYCLES_MIN = 48.0; // cycles per SPRITE_PERIOD_C, hashed per sprite
const float SPRITE_CYCLES_MAX = 96.0;
const float SPRITE_R = 0.0016; // head radius, screen p-units (floored at SPRITE_MIN_PX)
const float SPRITE_MIN_PX = 1.1;
const float SPRITE_TAIL = 0.07; // tail length in path fractions at the steady pace
const float SPRITE_GAIN = 0.75; // peak brightening toward white at the head
const float SPRITE_GAP_R = 0.07;
const float SPRITE_OVER_CLOUD = 0.35; // how visible a sprite stays over solid cloud
const vec3 SPRITE_TINT = vec3(0.97, 0.98, 1.0);
// The floaters' prism fringe at Rainbow = 1: the tube profile is read a
// little further out for red and further in for blue (FLOATER_DISPERSION,
// in units of the rim band's own width), so each rim splits into faint
// colour edges, and the rim's brightening drifts through the spectrum along
// the streak (FLOATER_IRIDESCENCE of its tint).
const float FLOATER_DISPERSION = 0.9;
const float FLOATER_IRIDESCENCE = 0.9;
// Gradient dither: triangular noise of up to DITHER_LSB 8-bit steps at
// Gradient dither = 1, independent per channel, added to the final colour.
const float DITHER_LSB = 2.0;
// Floater waves (see the file header): each wave is a streak of the small
// refractive-tube floaters laid out on a fixed grid, arranged like the
// user's text-grid references, where ">" fills a streak's body, "_" runs
// along its ragged fringe and an "o" sits inside some. Here a body cell
// holds an aligned strand, a fringe cell a short flat strand low in the
// cell, and a hotspot cell a round floater dot. FLOATER_CELL is sized so the
// longest strand plus its fringe fits inside one cell, since a pixel only
// ever evaluates the floater in its own cell.
// Every floater size below (and the grid cell with them) is multiplied by
// FLOATER_SCALE: the user asked for floaters 2.5x smaller than the
// reference-matched sizes, then 20% bigger again, with the grid scaling
// alongside so a streak keeps
// its extent and just holds more, finer floaters. At this scale the tube is
// only a few pixels across, so floaterProfile floors its bands at
// FLOATER_MIN_PX screen pixels rather than letting the rim alias away.
const float FLOATER_SCALE = 0.48;
const float FLOATER_MIN_PX = 0.8;
const vec2 FLOATER_CELL = vec2(0.06, 0.045) * FLOATER_SCALE;
const float CELL_T_BODY = 0.42; // streak density above this puts an aligned strand in the cell (the reference's ">")
const float CELL_T_FRINGE = 0.12; // between this and CELL_T_BODY, a short flat strand (the reference's "_"); below, nothing
const float CELL_T_HOT = 0.25; // hotspot field above this, inside the body, puts a dot there instead (the reference's "o")
const float FRINGE_DROP = -0.011 * FLOATER_SCALE; // the fringe strand sits this far below the cell centre, like "_" under ">"
// Streak shape, screen p-units: an ellipse of half-extent between
// STREAK_L_MIN and STREAK_L_MAX (by the wave's size), tilted up to the right
// by a hashed slant, frayed row by row by STREAK_RAG noise so each row's run
// starts and ends at its own column, the references' stair-stepped rows.
const vec2 STREAK_L_MIN = vec2(0.14, 0.04);
const vec2 STREAK_L_MAX = vec2(0.6, 0.13); // the long, thin reference streak runs ~1.0 x 0.2 of screen height
const float STREAK_SLANT_MIN = 0.12;
const float STREAK_SLANT_MAX = 0.45; // radians up to the right; the reference rises ~20 degrees
const float STREAK_RAG = 0.45;
// Squared cull radius in units of a stamp's own L.x: density is 1 - |e|^2 + rag
// at best (rag within +-STREAK_RAG/2, the envelope only lowers it), so beyond
// this a stamp can neither draw nor win (<= CELL_T_FRINGE). The 0.02 is a
// float margin. Valid because L.x >= L.y, which makes |e|^2 >= |d|^2 / L.x^2.
const float STREAK_CULL2 = 1.0 + 0.5 * STREAK_RAG - CELL_T_FRINGE + 0.02;
const float STREAK_HOT_CHANCE = 0.5; // fraction of streaks with a dot hotspot (one reference has one, the other none)
const vec2 STREAK_DRIFT = vec2(0.09, 0.012); // p-units/s, scaled by Flow speed; quick, since a streak only lives a couple of seconds by default (Floater sustain)
const int FLOATER_SEGMENTS = 10; // path points per strand (head at index 0), see floaterPath
const float BODY_LEN_MIN = 0.036 * FLOATER_SCALE; // body strand arc length, screen p-units, hashed per cell
const float BODY_LEN_MAX = 0.048 * FLOATER_SCALE;
const float FRINGE_LEN_MIN = 0.02 * FLOATER_SCALE; // fringe strands are short
const float FRINGE_LEN_MAX = 0.03 * FLOATER_SCALE;
const float BODY_HEADING_JITTER = 0.16; // radians around the streak's own slant, so body strands read as aligned
// floaterPath's heading theta(t) = B1*sin(2*pi*f1*t+p1) + B2*sin(2*pi*f2*t+p2):
// a dominant gentle bend (B1/f1) plus a much smaller, faster wobble (B2/f2),
// all hashed once per seed. Because heading is integrated forward rather
// than offsetting each point sideways by an independent function of t, arc
// length always comes out exactly right and the bend rate stays bounded; a
// real side-by-side against a floater reference showed per-point-independent
// kinks read as an angular zigzag, not the reference's smooth curve.
const float FLOATER_B1_MIN = 0.3; // dominant bend swing, radians (random sign per seed)
const float FLOATER_B1_MAX = 0.6;
const float FLOATER_F1_MIN = 0.5; // dominant bend's cycles over the strand
const float FLOATER_F1_MAX = 1.0;
const float FLOATER_B2_MIN = 0.1; // secondary wobble, radians; texture, not a second kink
const float FLOATER_B2_MAX = 0.2;
const float FLOATER_F2_MIN = 3.0;
const float FLOATER_F2_MAX = 5.0;
// The refractive-tube profile (floaterProfile below), measured off a
// brightness cross-section of a floater reference at sky luminance ~172: a
// thin dark fringe just outside the edge, a brighter rim just inside it, and
// a barely-lifted see-through interior, everything within about +-10% of the
// background, never a solid painted line.
const float FLOATER_R = 0.0028 * FLOATER_SCALE; // strand tube half-width, screen p-units
const float FLOATER_RIM_W = 0.0014 * FLOATER_SCALE; // bright-rim band width, just inside the edge
const float FLOATER_FRINGE_W = 0.0022 * FLOATER_SCALE; // dark-fringe band width, just outside the edge
const float FLOATER_INTERIOR = 0.02; // relative lum delta well inside the edge
const float FLOATER_RIM = 0.17; // relative lum delta at the rim peak — raised well past the measured 0.07 for contrast at the small size
const float FLOATER_FRINGE = 0.23; // relative lum delta (negative) at the fringe peak — raised from the measured 0.10 likewise
const float FLOATER_DOT_R_MIN = 0.005 * FLOATER_SCALE; // dot radius, screen p-units
const float FLOATER_DOT_R_MAX = 0.0068 * FLOATER_SCALE;
const vec3 FLOATER_COOL_TINT = vec3(0.94, 0.99, 1.06); // faint cool bias applied only to the rim's brightening (see main()); the fringe's darkening stays neutral

// skyLift's own GLSL twin of the JS liftByDrive above — same formula, same
// SKY_DRIVE_LIFT constant, for a drive coupling read straight in FRAG
// (cloudBrightness below) rather than resolved in render().
const float SKY_DRIVE_LIFT_C = ${SKY_DRIVE_LIFT.toFixed(2)};
float skyLift(float amount, float drive) {
  return clamp(amount + (1.0 - amount) * SKY_DRIVE_LIFT_C * drive, 0.0, 1.0);
}

${NOISE_HASH_GLSL}

// This scene's own small hash/noise family — independently written (the
// same fract/dot idiom every other scene's hash21 uses, CLAUDE.md's
// standing rule against porting), not shared with any other scene's.
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

vec2 hash22(vec2 p) {
  return vec2(hash21(p), hash21(p + 19.19));
}

// Value-noise fbm for the cloud's bump texture and the streaks' row fray —
// this scene's own, independently written (not shared with ink.ts/moire.ts/
// kaleido's own fbm functions; see the file header on the per-scene-copy
// pattern this repo already uses for noise). The lattice is hashed from the
// integer cell index (NOISE_HASH_GLSL, periodic in NOISE_PERIOD cells), and
// the drifting cloud fields are offset per octave from JS (cloudNoiseFlows),
// never by the raw session time: see noiseHash.ts's header for why.
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hashCell(i, ${NOISE_MASK}, 0u);
  float b = hashCell(i + vec2(1.0, 0.0), ${NOISE_MASK}, 0u);
  float c = hashCell(i + vec2(0.0, 1.0), ${NOISE_MASK}, 0u);
  float d = hashCell(i + vec2(1.0, 1.0), ${NOISE_MASK}, 0u);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// o0..o2 are each octave's drift offset in its own lattice frame
// (uCloudFlow, from cloudNoiseFlows), added after that octave's scaling.
float fbm2(vec2 p, vec2 o0, vec2 o1, vec2 o2) {
  float sum = 0.5 * vnoise(p + o0);
  p *= ${CLOUD_FBM_LACUNARITY.toFixed(2)};
  sum += 0.25 * vnoise(p + o1);
  p *= ${CLOUD_FBM_LACUNARITY.toFixed(2)};
  sum += 0.125 * vnoise(p + o2);
  return sum;
}

// The cloud pass's own pre-threshold field at a room uv: dye density eroded
// by the two bump octaves. Shared by the cloud pass and the floaters' "keep
// off the clouds" fade, so both agree exactly on where cloud is.
float cloudBumpedAt(vec2 uv) {
  float density = max(decodeDye(texture(uDye, uv)).x, 0.0);
  float bump = fbm2(uv * CLOUD_BUMP_SCALE, uCloudFlow[0].xy, uCloudFlow[1].xy, uCloudFlow[2].xy);
  float wisp = fbm2(uv * CLOUD_BUMP_SCALE * CLOUD_WISP_SCALE, uCloudFlow[0].zw, uCloudFlow[1].zw, uCloudFlow[2].zw);
  return density * mix(1.0 - CLOUD_BUMP_AMOUNT, 1.0 + CLOUD_BUMP_AMOUNT, bump) * mix(1.0 - CLOUD_WISP_AMOUNT, 1.0 + CLOUD_WISP_AMOUNT, wisp);
}

// Signed relative-luminance delta for a point at true signed distance s from
// a floater's own edge (negative inside, screen p-units): a small lift deep
// inside (FLOATER_INTERIOR), rising through a bright rim just inside the edge
// (FLOATER_RIM, peaking at s = -FLOATER_RIM_W/2) into a dark fringe just
// outside it (FLOATER_FRINGE, peaking at s = FLOATER_FRINGE_W/2), fading
// smoothly to exactly 0 by s = FLOATER_FRINGE_W*2.0. Shared by strands and
// dots; they differ only in how s is computed. Built from smooth bumps, not
// hard-edged bands, since the reference itself is a little soft.
float floaterProfile(float s) {
  float px = FLOATER_MIN_PX / max(uResolution.y, 1.0);
  float rimW = max(FLOATER_RIM_W, px);
  float fringeW = max(FLOATER_FRINGE_W, px);
  float interior = FLOATER_INTERIOR * (1.0 - smoothstep(-rimW, 0.0, s));
  float rimD = (s + rimW * 0.5) / (rimW * 0.5);
  float rim = FLOATER_RIM * exp(-rimD * rimD);
  float fringeD = (s - fringeW * 0.5) / (fringeW * 0.5);
  float fringe = -FLOATER_FRINGE * exp(-fringeD * fringeD);
  float cutoff = 1.0 - smoothstep(fringeW, fringeW * 2.0, s);
  return (interior + rim + fringe) * cutoff;
}

// Builds a strand's curved path of arc length 'len' into 'pts' (head at
// index 0, FLOATER_SEGMENTS points) by integrating a heading forward at a
// fixed step (see the FLOATER_B1_MIN..FLOATER_F2_MAX comment above), then
// re-centres it on its own average and rotates it so its chord (head to
// tail) points along 'heading', which is what lines strands up in parallel
// however each one curls along the way.
void floaterPath(float seed, float heading, float len, out vec2 pts[FLOATER_SEGMENTS]) {
  float thetaSign = hash21(vec2(seed, 26.0)) < 0.5 ? -1.0 : 1.0;
  float b1 = thetaSign * mix(FLOATER_B1_MIN, FLOATER_B1_MAX, hash21(vec2(seed, 21.0)));
  float f1 = mix(FLOATER_F1_MIN, FLOATER_F1_MAX, hash21(vec2(seed, 27.0)));
  float p1 = hash21(vec2(seed, 22.0)) * 6.28318;
  float b2 = mix(FLOATER_B2_MIN, FLOATER_B2_MAX, hash21(vec2(seed, 28.0)));
  float f2 = mix(FLOATER_F2_MIN, FLOATER_F2_MAX, hash21(vec2(seed, 23.0)));
  float p2 = hash21(vec2(seed, 24.0)) * 6.28318;
  float stepLen = len / float(FLOATER_SEGMENTS - 1);
  pts[0] = vec2(0.0);
  for (int i = 1; i < FLOATER_SEGMENTS; i++) {
    // Heading sampled at the segment's own midpoint t (midpoint-rule
    // integration of theta(t)).
    float tMid = (float(i) - 0.5) / float(FLOATER_SEGMENTS - 1);
    float theta = b1 * sin(6.28318 * f1 * tMid + p1) + b2 * sin(6.28318 * f2 * tMid + p2);
    pts[i] = pts[i - 1] + stepLen * vec2(cos(theta), sin(theta));
  }
  vec2 sum = vec2(0.0);
  for (int i = 0; i < FLOATER_SEGMENTS; i++) sum += pts[i];
  vec2 mid = sum / float(FLOATER_SEGMENTS);
  vec2 chord = pts[FLOATER_SEGMENTS - 1] - pts[0];
  float turn = heading - atan(chord.y, chord.x);
  mat2 rot = mat2(cos(turn), sin(turn), -sin(turn), cos(turn));
  for (int i = 0; i < FLOATER_SEGMENTS; i++) pts[i] = rot * (pts[i] - mid);
}

// A strand floater's signed distance at p (negative inside the tube): a
// hollow refractive tube of half-width FLOATER_R around the path
// floaterPath builds, centred on basePos. main() turns it into the tube's
// brightness (floaterProfile) and into where a light wave lights it.
float floaterStrand(vec2 p, vec2 basePos, float seed, float heading, float len) {
  vec2 pts[FLOATER_SEGMENTS];
  floaterPath(seed, heading, len, pts);
  vec2 pLocal = p - basePos;
  float dMin = 1.0e6;
  for (int i = 1; i < FLOATER_SEGMENTS; i++) {
    vec2 pa = pLocal - pts[i - 1];
    vec2 ba = pts[i] - pts[i - 1];
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1.0e-6), 0.0, 1.0);
    dMin = min(dMin, length(pa - ba * h));
  }
  return dMin - max(FLOATER_R, FLOATER_MIN_PX / max(uResolution.y, 1.0));
}

// Blend weights for the four day keys at sun elevation e: only the two keys
// either side of e carry weight, eased between (smoothstep) so the sky never
// shows a kink in its colour as it passes a key.
void dayWeights(float e, out float w[4]) {
  for (int i = 0; i < 4; i++) w[i] = 0.0;
  float ec = clamp(e, DAY_KEY_E[0], DAY_KEY_E[3]);
  for (int i = 0; i < 3; i++) {
    if (ec <= DAY_KEY_E[i + 1]) {
      float f = smoothstep(DAY_KEY_E[i], DAY_KEY_E[i + 1], ec);
      w[i] = 1.0 - f;
      w[i + 1] = f;
      return;
    }
  }
  w[3] = 1.0;
}

vec3 dayMix(float w[4], vec3 k[4]) {
  return w[0] * k[0] + w[1] * k[1] + w[2] * k[2] + w[3] * k[3];
}

// One stamp's streak density at cell centre c (screen p-units), its slant in
// 'slant', and its dot hotspot field in 'hot'. The envelope is subtracted
// from the density rather than multiplied into it, so a streak pops in
// fringe-first and dissolves cell by cell: each body strand gives way to a
// fringe strand, then each fringe strand to empty sky, not the whole streak
// fading at once.
// size is the Floaters amount (the one param) times this stamp's own count
// grade (render()'s spawnFloaters output — the signal deciding how many
// floaters the stamp lays down): the density product sets the ceiling, amp
// scales it per event, and the product gate in main()'s wave loop keeps any
// of it from drawing while the amount is 0.
// row is the cell's row in the grid the stamp reads (main's Floater glide
// shift), so a gliding streak keeps its own fray.
float streakDensity(vec2 c, float row, vec2 centre, float seed, float amp, float age, float life, out float slant, out float hot) {
  float size = clamp(uFloaterDensity * 1.3 * floaterDensityDrive(1.0), 0.1, 1.0) * clamp(amp, 0.0, 1.0);
  vec2 L = mix(STREAK_L_MIN, STREAK_L_MAX, size);
  slant = mix(STREAK_SLANT_MIN, STREAK_SLANT_MAX, hash21(vec2(seed, 51.0)));
  vec2 d = c - centre;
  float cs = cos(slant);
  float sn = sin(slant);
  vec2 q = vec2(cs * d.x + sn * d.y, -sn * d.x + cs * d.y);
  // Row fray: noise keyed on the grid row (and only coarsely on position
  // along the streak), so a whole row's run shifts together.
  float rag = (vnoise(vec2(row * 0.9 * FLOATER_SCALE + seed * 7.1, q.x / L.x * 2.2 + seed)) - 0.5) * STREAK_RAG;
  vec2 e = q / L;
  float fadeOut = min(WAVE_FADE_OUT, life * 0.5); // a short-sustain wave still gets a clean pop in and out
  float env = smoothstep(0.0, WAVE_FADE_IN, age) * (1.0 - smoothstep(life - fadeOut, life, age));
  hot = 0.0;
  if (hash21(vec2(seed, 52.0)) < STREAK_HOT_CHANCE) {
    vec2 hc = (hash22(vec2(seed, 53.0)) - 0.5) * vec2(0.9, 0.5) * L;
    vec2 he = (q - hc) / (L * vec2(0.3, 0.45));
    hot = (1.0 - dot(he, he)) * env;
  }
  return 1.0 - dot(e, e) + rag - (1.0 - env) * 1.1;
}

// A smooth hue wheel, h in turns (0 red, 1/3 green, 2/3 blue), pulled
// toward white by 1 - sat: the Rainbow setting's one colour source.
vec3 spectrumAt(float h, float sat) {
  vec3 hue = clamp(abs(fract(h + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
  return mix(vec3(1.0), hue, sat);
}

// Where a sprite's curved path is at fraction u of it: a constant-curvature
// arc of length len from start, leaving at heading h0 and turning by bend.
vec2 spriteArc(vec2 start, float h0, float bend, float len, float u) {
  if (abs(bend) < 1.0e-3) return start + len * u * vec2(cos(h0), sin(h0));
  float h1 = h0 + bend * u;
  return start + len / bend * vec2(sin(h1) - sin(h0), cos(h0) - cos(h1));
}

// The blue-field sprites' brightening at p (see the SPRITE_CELL comment):
// every sprite in the 2x2 cells nearest p, each a bright head with a fading
// tail along its own path at this moment of its cycle. A sprite reaches
// less than one cell from its own cell's centre along either axis (start
// jitter plus the longest path plus a head), and every cell the 2x2 block
// leaves out has its centre at least a cell away, so the block is enough.
// A sprite whose whole path is out of reach is skipped before any trig.
float spritesAt(vec2 p, float amount) {
  float px = 1.0 / max(uResolution.y, 1.0);
  float r = max(SPRITE_R, SPRITE_MIN_PX * px);
  vec2 base = floor(p / SPRITE_CELL - 0.5);
  float glow = 0.0;
  for (int j = 0; j <= 1; j++) {
    for (int i = 0; i <= 1; i++) {
      vec2 id = base + vec2(float(i), float(j));
      if (hash21(id * 0.917 + 3.1) > amount * SPRITE_FILL) continue;
      float cycles = floor(mix(SPRITE_CYCLES_MIN, SPRITE_CYCLES_MAX + 1.0, hash21(id * 1.31 + 7.7)));
      float t = uSpritePhase * cycles / SPRITE_PERIOD_C + hash21(id * 0.53 + 11.9);
      float u = fract(t);
      // The cycle's index taken modulo the sprite's own cycle count, so the
      // clock's wrap (t drops by exactly that count) changes nothing.
      float k = mod(floor(t), cycles);
      vec2 hk = hash22(id + k * 0.371);
      vec2 start = (id + 0.5 + (hk - 0.5) * 2.0 * SPRITE_START_JITTER) * SPRITE_CELL;
      if (length(p - start) > SPRITE_PATH_MAX * SPRITE_CELL + 3.0 * r) continue;
      float h0 = hash21(id * 1.7 + k * 0.913) * 6.28318;
      float bend = (hash21(id * 2.3 + k * 0.577) - 0.5) * 2.0 * SPRITE_BEND;
      float len = mix(SPRITE_PATH_MIN, SPRITE_PATH_MAX, hk.y) * SPRITE_CELL;
      vec2 head = spriteArc(start, h0, bend, len, u);
      vec2 tail = spriteArc(start, h0, bend, len, max(u - SPRITE_TAIL * uSpriteSpeed, 0.0));
      vec2 pa = p - tail;
      vec2 ba = head - tail;
      float along = clamp(dot(pa, ba) / max(dot(ba, ba), 1.0e-9), 0.0, 1.0);
      float d = length(pa - ba * along);
      float env = sin(3.14159 * u);
      glow += exp(-d * d / (r * r)) * mix(0.25, 1.0, along * along) * env * env;
    }
  }
  return glow;
}

// The beat light waves' glow at p (see the SWEEP_WIDTH comment): the sum of
// every live wave's thin ring rippling out from near the centre of view,
// each tinted from the sky's own pale palette, pulled toward a spectrum by
// the Rainbow setting. main() applies it only in and around the floaters'
// tubes.
vec3 lightWaveAt(vec2 p, float devAspect) {
  vec3 glow = vec3(0.0);
  for (int i = 0; i < MAX_SWEEPS_C; i++) {
    float age = uTime - uSweepT0[i];
    if (age < 0.0 || age > SWEEP_SEC_C) continue;
    float seed = uSweepSeed[i];
    float t = age / SWEEP_SEC_C;
    vec2 origin = (hash22(vec2(seed, 63.0)) - 0.5) * 2.0 * SWEEP_ORIGIN_SPREAD;
    vec2 rel = p - origin;
    float ang = atan(rel.y, rel.x);
    // Far enough to clear the frame's farthest corner from any origin.
    float reach = 0.5 * length(vec2(devAspect, 1.0)) + SWEEP_ORIGIN_SPREAD * 1.5 + SWEEP_WIDTH * 3.0;
    float front = reach * (1.0 - pow(1.0 - t, SWEEP_EASE));
    float radius = length(rel) + SWEEP_WOBBLE * sin(ang * SWEEP_WOBBLE_LOBES + seed * 6.0 + uTime * 1.7);
    float x = (radius - front) / SWEEP_WIDTH;
    // A crisp leading edge and a short soft trail inside the ring.
    float band = x > 0.0 ? exp(-x * x * 3.0) : exp(-x * x * 0.6);
    float drift = 0.5 + 0.5 * sin(ang * 2.0 + seed * 4.1);
    vec3 tint = mix(mix(SWEEP_TINT_A, SWEEP_TINT_B, drift), SWEEP_TINT_C, 0.5 + 0.5 * cos(x * 1.3 + seed));
    // Red on the leading edge (x near 0) to violet in the trail (x negative).
    vec3 spectral = spectrumAt(clamp(-x / SWEEP_SPECTRUM_SPAN, 0.0, 1.0) * 0.8, RAINBOW_SAT);
    tint = mix(tint, spectral, uRainbow);
    float fade = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.6, 1.0, t));
    glow += tint * band * fade;
  }
  return glow;
}

// One cell's floater over color (main's step 4 picks which): from the
// streak density at the cell, an aligned strand in the body, a short flat
// strand on the fringe or a dot in a hotspot, as a refractive tube
// (floaterProfile) modulating what's behind it rather than a painted colour;
// then any beat light wave glinting through it. The cell's own hash fixes
// the floater's shape.
void drawFloater(inout vec3 color, vec2 p, float px, float devAspect, float cloudAlpha, float dens, float hot, float slant, vec2 cellId, vec2 cellC, vec2 stampC, float stampSeed) {
  // Keep off the clouds: the cell's centre, looked up in the same field the
  // cloud pass thresholds, with a margin below CLOUD_LOW so a streak gives
  // way before a cloud's visible edge reaches it.
  float clear = 1.0 - smoothstep(CLOUD_LOW * 0.3, CLOUD_LOW * 0.85, cloudBumpedAt(roomUv(cellC / vec2(devAspect, 1.0) + 0.5)));
  float vis = clear * (1.0 - cloudAlpha);
  if (vis <= 0.0) return;
  float cellSeed = hash21(cellId * 0.731 + 17.3) * 97.0 + cellId.x * 0.013;
  float s;
  if (dens > CELL_T_BODY && hot > CELL_T_HOT) {
    float r = mix(FLOATER_DOT_R_MIN, FLOATER_DOT_R_MAX, hash21(vec2(cellSeed, 15.0)));
    s = length(p - cellC) - max(r, FLOATER_MIN_PX * px);
  } else if (dens > CELL_T_BODY) {
    float len = mix(BODY_LEN_MIN, BODY_LEN_MAX, hash21(vec2(cellSeed, 25.0)));
    float heading = slant + (hash21(vec2(cellSeed, 44.0)) - 0.5) * BODY_HEADING_JITTER;
    s = floaterStrand(p, cellC, cellSeed, heading, len);
  } else {
    float len = mix(FRINGE_LEN_MIN, FRINGE_LEN_MAX, hash21(vec2(cellSeed, 25.0)));
    s = floaterStrand(p, cellC + vec2(0.0, FRINGE_DROP), cellSeed, 0.0, len);
  }
  // Rainbow's prism fringe (FLOATER_DISPERSION): red reads the tube's
  // profile a little further out, blue a little further in.
  float disp = uRainbow * FLOATER_DISPERSION * max(FLOATER_RIM_W, FLOATER_MIN_PX * px);
  vec3 delta = clamp(vec3(floaterProfile(s - disp), floaterProfile(s), floaterProfile(s + disp)) * uFloaterGain, -0.55, 0.55) * vis;
  // The rim's brightening drifts through the spectrum along the streak
  // (FLOATER_IRIDESCENCE at Rainbow = 1), its brightness kept.
  vec2 along = vec2(cos(slant), sin(slant));
  vec3 iri = spectrumAt(dot(cellC - stampC, along) * 2.2 + stampSeed * 0.37 + uTime * 0.04, 0.7);
  iri /= max(dot(iri, LUMA), 0.3);
  vec3 rimTint = mix(FLOATER_COOL_TINT, iri, uRainbow * FLOATER_IRIDESCENCE);
  color *= 1.0 + min(delta, vec3(0.0)) + max(delta, vec3(0.0)) * rimTint;

  // Beat light waves pass through the floaters only: each live wave is a
  // thin ring rippling out from near the centre of view (see the
  // SWEEP_WIDTH comment), and it lights this floater's own tube (inside it
  // and its rim) plus a soft halo SWEEP_HALO_PX around it, gone well inside
  // the cell so no cell edge shows, screen-blended so a floater glints as
  // the ring crosses it while the sky and clouds away from it stay untouched.
  float tube = 1.0 - smoothstep(0.0, max(FLOATER_FRINGE_W, FLOATER_MIN_PX * px), s);
  float haloPx = SWEEP_HALO_PX * px;
  float halo = SWEEP_HALO * exp(-max(s, 0.0) / haloPx) * (1.0 - smoothstep(2.0 * haloPx, 3.0 * haloPx, s));
  float lightMask = max(tube, halo);
  if (lightMask > 0.0) {
    vec3 sweepGlow = lightWaveAt(p, devAspect);
    vec3 lit = clamp(sweepGlow * SWEEP_ALPHA * uLightWaves * lightMask * vis, 0.0, 1.0);
    color = 1.0 - (1.0 - color) * (1.0 - lit);
  }
}

void main() {
  vec2 uv = roomUv(vUv);
  // The two illusions live in this device's own screen space, not the
  // shared room canvas — see the file header on why.
  float devAspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 p = (vUv - 0.5) * vec2(devAspect, 1.0);

  // 1. Sky, lit by the day cycle (see the DAY_KEY_E comment): a vertical
  // gradient between the keyed zenith and horizon colours for this sun
  // elevation, mornings warmed toward peach around the horizon glow, a
  // soft sun halo wherever the sun sits in the frame, horizon warmth pooled
  // on the sun's side around sunrise and sunset; no night (see the DAY_KEY_E
  // comment). The early-evening key is the earlier fixed look,
  // itself measured against a real hazy sky and then taken a step darker
  // with a faint pink-purple cast at the user's request.
  float px = 1.0 / max(uResolution.y, 1.0);
  float dayAngle = 6.28318 * (uDayPhase - 0.25);
  float sunE = sin(dayAngle);
  float lightE = max(sunE, DAY_E_FLOOR); // no night: the sky holds its sunset glow while the sun is down
  float dw[4];
  dayWeights(lightE, dw);
  vec3 zenith = dayMix(dw, SKY_ZENITH);
  vec3 horizon = dayMix(dw, SKY_HORIZON);
  vec3 sunCol = dayMix(dw, SUN_KEY);
  float glowHour = 1.0 - smoothstep(0.05, 0.3, abs(lightE)); // 1 around sunrise/sunset (and all through the skipped night), 0 by mid-morning
  // 1 at sunrise, 0 at sunset, easing between through noon and midnight: a
  // hard morning/evening switch would show, since the sky never goes dark.
  float morning = 0.5 + 0.5 * cos(dayAngle);
  horizon = mix(horizon, horizon * MORNING_WARMTH, morning * glowHour);
  sunCol = mix(sunCol, sunCol * MORNING_WARMTH, morning * glowHour);
  vec3 color = mix(horizon, zenith, smoothstep(SKY_GRADIENT_LO, SKY_GRADIENT_HI, uv.y));

  vec2 sunP = vec2(-cos(dayAngle) * SUN_X_SPAN * devAspect, -0.55 + 1.05 * sunE) * SUN_DISTANCE;
  float sunD = length(p - sunP);
  float sunUp = smoothstep(-0.25, 0.02, sunE);
  vec3 glow = sunCol * (SUN_HALO * exp(-sunD * 2.4) + SUN_CORE * exp(-sunD * 9.0)) * sunUp;
  float onSunSide = exp(-abs(p.x - sunP.x) / (0.8 * devAspect));
  float lowInSky = pow(1.0 - clamp(uv.y, 0.0, 1.0), 2.5);
  glow += sunCol * HORIZON_WARM * glowHour * onSunSide * lowInSky;
  color += glow;
  // Narrow the sky's colour range, then darken it (SKY_SPREAD, SKY_LEVEL).
  // Chroma here is colour over its own luma, so the pull moves hue and
  // saturation and leaves brightness where the keys put it.
  vec3 skyMid = 0.5 * (zenith + horizon);
  vec3 midChroma = skyMid / max(dot(skyMid, LUMA), 1e-3);
  float skyLuma = max(dot(color, LUMA), 1e-3);
  color = skyLuma * mix(midChroma, color / skyLuma, SKY_SPREAD) * SKY_LEVEL;


  // 2. Cloud cover: the sim's own dye density thresholded (CLOUD_LOW/HIGH)
  // rather than blended with a plain extinction curve — a gain/gamma remap
  // on a smooth density field stays smooth no matter how it's curved, so it
  // never grows a real edge; only an actual threshold does. A slowly
  // time-drifting fbm (CLOUD_BUMP_*) eats into the density's own edge for
  // the cauliflower bump texture and keeps the shape visibly morphing
  // beyond plain advection, the same "erode a silhouette with noise" idea
  // as Storm's Gas mode (storm.ts), independently written per the file
  // header.
  //
  // Shading is Storm's own two-tap sun-shadow technique (lightDir below,
  // CLOUD_SHADOW_TAP1-2/CLOUD_SHADOW_K1-2 above), ported from its 3D
  // raymarch to a plain 2D density lookup: sample density toward a fixed
  // light direction at two distances, run it through Beer's law, and use
  // the result to pick a point on a colour ramp (mix), not as a brightness
  // multiplier. The first pass's shading only compared immediate neighbour
  // texels, which sees an edge but nothing in a wide cloud's flat interior —
  // this reaches far enough across the body to shade actual folds.
  float bumped = cloudBumpedAt(uv);
  float cloudAlpha = smoothstep(CLOUD_LOW, CLOUD_HIGH, bumped);
  // Light from the sun's side of the frame, always from somewhat above; as
  // the sun passes under the horizon between sunset and sunrise it swings
  // back through overhead, so cloud shading never jumps.
  vec2 lightDir = normalize(vec2(-cos(dayAngle) * 0.8, 0.85));
  float sunNear = max(decodeDye(texture(uDye, uv + lightDir * CLOUD_SHADOW_TAP1)).x, 0.0);
  float sunFar = max(decodeDye(texture(uDye, uv + lightDir * CLOUD_SHADOW_TAP2)).x, 0.0);
  float shadow = exp(-CLOUD_SHADOW_K1 * sunNear - CLOUD_SHADOW_K2 * sunFar);
  // Keyed with the sky (CLOUD_LIT_KEY/CLOUD_SHADE_KEY), so clouds sit in the
  // same light: white at midday, gold toward sunset, lavender-white over
  // periwinkle once the sun is down. The midday pair was measured off a real hazy-cumulus
  // photo (shadow-fold RGB≈(156,151,172)/255, highlight RGB≈(255,255,254)/255).
  vec3 cloudShadow = dayMix(dw, CLOUD_SHADE_KEY);
  vec3 cloudLit = mix(dayMix(dw, CLOUD_LIT_KEY), dayMix(dw, CLOUD_LIT_KEY) * MORNING_WARMTH, morning * glowHour);
  // Thin, barely-there cloud is sunlit through, never shadowed — without
  // this, half-faded puffs blend a shadow tone into the sky and read as
  // grey smudges instead of airy haze.
  shadow = mix(1.0, shadow, smoothstep(0.0, 0.8, cloudAlpha));
  // cloudBrightnessDrive(uMid) is the reading Cloud brightness's own default
  // (anim.mid) equals; skyLift lifts uCloudBrightness toward 1 by it,
  // identity at drive 0 so an unplugged jack leaves the slider's own
  // brightness alone (drives.ts's header's "Nothing plugged in" paragraph).
  vec3 cloudColor = mix(cloudShadow, cloudLit, shadow) * (0.85 + 0.3 * skyLift(uCloudBrightness, cloudBrightnessDrive(uMid)));
  color = mix(color, cloudColor, cloudAlpha);

  // 3. Haidinger's brush: a faint bowtie centred on the fixation point,
  // rotating on uBrushPhase — under/with the sky+cloud, per the file
  // header's compositing order, so it never sits on top of the floaters.
  float r = length(p);
  float ang = atan(p.y, p.x) - uBrushPhase;
  float lobe = cos(2.0 * ang);
  float radial = smoothstep(0.0, BRUSH_R_CORE, r) * smoothstep(BRUSH_R_OUT, BRUSH_R_IN, r);
  vec3 brushLift = mix(BRUSH_BLUE, BRUSH_YELLOW, lobe * 0.5 + 0.5);
  // The brush is polarised skylight, so it dims toward the low twilight glow.
  float daylight = smoothstep(-0.1, 0.25, lightE);
  // The dim factor itself is (1.0 - k*drive) (identity at drive 0), not the
  // old brushOpacityDrive(1.0-0.4*uEnergy) — that put the WHOLE factor
  // inside the drive macro, so an unplugged jack (Custom=1, drive=0) zeroed
  // it outright and made the brush vanish rather than sit at full opacity.
  // Each beat's light-wave sweep also swells the bowtie (uBrushSwell), so
  // the brush breathes with the beat instead of sitting below notice.
  float brushAmt = clamp(uBrushOpacity * (BRUSH_BASE + BRUSH_SWELL * uBrushSwell) * radial * abs(lobe) * (1.0 - 0.4 * brushOpacityDrive(uEnergy)) * daylight, 0.0, 1.0);
  color = max(color + brushLift * brushAmt, 0.0);

  // 3b. Blue-field sprites (see the SPRITE_CELL comment): bright specks
  // darting over the sky, thinning out at the centre of view and mostly
  // hidden by solid cloud, drawn under the floaters (both are the eye's own,
  // but the floaters sit in front).
  if (uSprites > 0.0) {
    float sprite = spritesAt(p, uSprites) * smoothstep(SPRITE_GAP_R * 0.5, SPRITE_GAP_R * 1.5, r);
    float spriteA = clamp(sprite * SPRITE_GAIN * mix(1.0, SPRITE_OVER_CLOUD, cloudAlpha), 0.0, 1.0);
    color = mix(color, SPRITE_TINT, spriteA);
  }

  // 4. Floater waves (see the file header): snap this pixel to a grid cell,
  // take the densest live streak at the cell's centre, and draw the floater
  // that density puts in the cell (drawFloater). Each stamp reads the grid
  // shifted by Floater glide times its own drift so far: at 0 every stamp
  // shares one fixed screen grid and a drifting streak moves by floaters
  // switching on and off across it; at 1 the grid rides along with the
  // stamp, so its floaters glide with the wind and keep their shapes. Once
  // grids differ, two overlapping streaks would cut each other's floaters
  // off at cell edges, so the runner-up streak is drawn too wherever its
  // cell isn't the winner's own (with one shared grid, at glide 0, it always
  // is, and only the winner draws).
  // The slider alone — Flow speed's own drive already moves the fluid
  // (render()'s flowSpeedAmount, integrated through the sim's own dt/force);
  // multiplying it in again here made every streak visibly jump the instant
  // any live source was patched in.
  vec2 wind = STREAK_DRIFT * (0.5 + uFlowSpeed);
  // Winner (x) and runner-up (y): density, hotspot, slant, stamp seed.
  vec2 dens = vec2(-1.0);
  vec2 hot = vec2(0.0);
  vec2 slant = vec2(0.0);
  vec2 seedW = vec2(0.0);
  vec2 idA = vec2(0.0);
  vec2 idB = vec2(0.0);
  vec2 cA = vec2(0.0);
  vec2 cB = vec2(0.0);
  vec2 stampA = vec2(0.0);
  vec2 stampB = vec2(0.0);
  // Draw-side off-gate, the twin of render()'s spawnFloaters: with the
  // Floaters density product at 0 nothing new stamps, and any stamp still
  // live stops drawing this instant — dens stays below every threshold
  // below, so neither the streaks nor their sweep glints are drawn until the
  // amount comes back.
  float densityAmt = uFloaterDensity * floaterDensityDrive(1.0);
  bool floatersOn = densityAmt > 0.0;
  // The stamp-independent half of streakDensity's size, hoisted out of the loop.
  float sizeBase = clamp(uFloaterDensity * 1.3 * floaterDensityDrive(1.0), 0.1, 1.0);
  for (int b = 0; b < MAX_WAVE_BURSTS_C; b++) {
    if (!floatersOn) break;
    float age = uTime - uBurstT0[b];
    float life = uBurstLife[b];
    if (age < 0.0 || age > life) continue;
    vec2 centre = (vec2(uBurstX[b], uBurstY[b]) - 0.5) * vec2(devAspect, 1.0) + wind * age;
    vec2 gridShift = wind * age * uFloaterGlide;
    vec2 id = floor((p - gridShift) / FLOATER_CELL);
    vec2 c = (id + 0.5) * FLOATER_CELL + gridShift;
    // Cull against this stamp's own long half-axis, not the largest any stamp
    // could have: most of the frame is out of reach of a given streak.
    float stampLx = mix(STREAK_L_MIN.x, STREAK_L_MAX.x, sizeBase * clamp(uBurstAmp[b], 0.0, 1.0));
    vec2 dc = c - centre;
    if (dot(dc, dc) > stampLx * stampLx * STREAK_CULL2) continue;
    float h;
    float sl;
    float d = streakDensity(c, id.y, centre, uBurstSeed[b], uBurstAmp[b], age, life, sl, h);
    if (d > dens.x) {
      dens.y = dens.x; hot.y = hot.x; slant.y = slant.x; seedW.y = seedW.x;
      idB = idA; cB = cA; stampB = stampA;
      dens.x = d; hot.x = h; slant.x = sl; seedW.x = uBurstSeed[b];
      idA = id; cA = c; stampA = centre;
    } else if (d > dens.y) {
      dens.y = d; hot.y = h; slant.y = sl; seedW.y = uBurstSeed[b];
      idB = id; cB = c; stampB = centre;
    }
  }
  vec2 cGap = cA - cB;
  if (dens.y > CELL_T_FRINGE && dot(cGap, cGap) > 1.0e-10) {
    drawFloater(color, p, px, devAspect, cloudAlpha, dens.y, hot.y, slant.y, idB, cB, stampB, seedW.y);
  }
  if (dens.x > CELL_T_FRINGE) {
    drawFloater(color, p, px, devAspect, cloudAlpha, dens.x, hot.x, slant.x, idA, cA, stampA, seedW.x);
  }

  // 5. Gradient dither (DITHER_LSB): triangular noise per channel, the sum
  // of two independent hashes of the pixel, so the sky's smooth gradient
  // doesn't break into 8-bit stripes.
  vec2 fc = gl_FragCoord.xy;
  vec3 n1 = vec3(hash21(fc * 0.731 + 0.17), hash21(fc * 0.731 + 5.33), hash21(fc * 0.731 + 9.71));
  vec3 n2 = vec3(hash21(fc.yx * 0.613 + 2.41), hash21(fc.yx * 0.613 + 7.03), hash21(fc.yx * 0.613 + 13.9));
  color += (n1 + n2 - 1.0) * uDither * DITHER_LSB / 255.0;

  outColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;
}

function createSkyScene(): Scene {
  let displayProg: GLProgram | null = null;
  let quadVao: WebGLVertexArrayObject | null = null;
  let sim: FluidSim | null = null;
  let dyeLoc: WebGLUniformLocation | null = null;
  let wavePool: WavePool | null = null;
  const bandsBuf = new Float32Array(NUM_BANDS);
  const drifterSplats: Splat[] = DRIFTER_SEEDS.map((seed) => ({
    x: 0.5,
    y: 0.5,
    sigma: DRIFTER_SIGMA_MIN + (DRIFTER_SIGMA_MAX - DRIFTER_SIGMA_MIN) * ((seed * 0.618034) % 1),
    fx: 0,
    fy: 0,
    dye: 0,
    tag: 0,
    ring: 0,
  }));
  // The same drifters' current centres, reused as pickSwarmCenter's obstacles.
  const drifterCentres: [number, number][] = DRIFTER_SEEDS.map(() => [0.5, 0.5]);

  let ambientT = 0;
  let brushPhase = 0;
  let dayOffset = 0;
  // The one scene listener: a beat edge held to one event per beat. Its
  // decision feeds BOTH the beat light sweep and the floater brush stamp
  // (render() advances it once), so under Scene a ring glint and a new
  // stamp land on the same beat; a re-patch on either row gates
  // independently, since drives.fired() ignores this edge once a source is
  // wired in.
  const beatListener = createBeatListener({ source: "beat", hold: ONE_BEAT_HOLD });
  const sweepT0 = new Float32Array(MAX_SWEEPS).fill(WAVE_DEAD_T0);
  const sweepSeed = new Float32Array(MAX_SWEEPS);
  const cloudFlow = new Float32Array(CLOUD_FLOW_LEN);
  let sweepsFired = 0;
  let lastSweepSec: number | null = null;
  let spritePhase = 0;
  // The floater brush's own state — the invisible spawn point that steps
  // across the sky once per stamp (stepBrush). Unrelated to Haidinger's
  // brushPhase far below.
  let brushX = 0.5;
  let brushY = 0.5;
  let brushHeading = BRUSH_HEADING_INIT;
  let waveSeedCounter = 0;
  let lastFrameTime: number | null = null;

  return {
    id: ID,
    name: "Sky",
    settings: SETTINGS,

    init(ctx: SceneContext) {
      const { gl } = ctx;
      quadVao = createFullscreenQuad(gl);
      const format = detectSimFormat(gl);
      const initSize = simResolutionFor(
        ctx.quality.detail,
        Math.max(1, gl.drawingBufferWidth),
        Math.max(1, gl.drawingBufferHeight),
        MIRROR_OFF,
      );
      sim = createFluidSim(gl, quadVao, initSize, format, { splatSlots: SKY_SPLAT_SLOTS, edge: false });
      displayProg = createProgram(gl, buildDisplayFrag(format));
      dyeLoc = gl.getUniformLocation(displayProg.program, "uDye");
      wavePool = createWavePool();

      ambientT = 0;
      brushPhase = 0;
      dayOffset = 0;
      beatListener.reset();
      brushX = 0.5;
      brushY = 0.5;
      brushHeading = BRUSH_HEADING_INIT;
      sweepT0.fill(WAVE_DEAD_T0);
      sweepsFired = 0;
      lastSweepSec = null;
      spritePhase = 0;
      waveSeedCounter = 0;
      lastFrameTime = null;
    },

    render(ctx, frame, viewport, palette, anim, drives = PASSTHROUGH_DRIVES) {
      if (!displayProg || !quadVao || !sim || !wavePool) return;
      const { gl } = ctx;

      const dt = lastFrameTime === null ? 1 / 60 : Math.max(0, Math.min(0.1, frame.time - lastFrameTime));
      lastFrameTime = frame.time;

      // Rebuild the sim whenever the drawing buffer (or the quality
      // governor's detail) changes — same pattern as powder.ts's glow
      // targets.
      const wantSize = simResolutionFor(
        ctx.quality.detail,
        Math.max(1, gl.drawingBufferWidth),
        Math.max(1, gl.drawingBufferHeight),
        MIRROR_OFF,
      );
      if (!sameSimSize(wantSize, sim.size)) sim.resize(wantSize);

      // Each amount below is its own slider lifted toward 1 by its own
      // drive's reading (liftByDrive) — identity at drive 0, so an unplugged
      // jack (or every source muted) shows exactly the slider's own amount,
      // never a collapsed or reversed one. The sceneDefault argument passed
      // to drives.value() is the live reading each setting's own default
      // equals, so a stale stored "scene" preference behaves like that
      // default too (drives.ts's header's "Nothing plugged in" paragraph).
      const cloudCoverAmount = liftByDrive(resolveSceneSetting(ID, settingFor("cloudCover")), drives.value("cloudCover", anim.sectionIntensity));
      const flowSpeedAmount = liftByDrive(resolveSceneSetting(ID, settingFor("flowSpeed")), drives.value("flowSpeed", frame.energy));
      const turbulenceAmount = liftByDrive(resolveSceneSetting(ID, settingFor("turbulence")), drives.value("turbulence", anim.low));

      // Ambient cloud drift — a real-time clock, deliberately not
      // audio-reactive (see file header).
      ambientT += dt;
      for (let i = 0; i < DRIFTER_SEEDS.length; i++) {
        const seed = DRIFTER_SEEDS[i];
        const [x0, y0] = driftCenter(seed, ambientT);
        const [x1, y1] = driftCenter(seed, ambientT + DRIFT_TANGENT_EPS);
        const dx = x1 - x0;
        const dy = y1 - y0;
        const len = Math.hypot(dx, dy) || 1;
        const s = drifterSplats[i];
        s.x = x0;
        s.y = y0;
        s.fx = (dx / len) * DRIFTER_FORCE * (0.5 + flowSpeedAmount);
        s.fy = (dy / len) * DRIFTER_FORCE * (0.5 + flowSpeedAmount);
        s.dye = DRIFTER_DYE_RATE * drifterPuff(seed, ambientT) * (0.25 + 0.75 * cloudCoverAmount);
        drifterCentres[i][0] = x0;
        drifterCentres[i][1] = y0;
      }

      const simDt = Math.min(SIM_DT_MAX, dt * (0.5 + 1.5 * flowSpeedAmount));
      sim.step({
        dt: simDt,
        curl: turbulenceAmount,
        dissipation: DYE_DISSIPATION,
        energy: 0, // cloud drift is not audio-reactive in v1 — see file header
        viscosity: SIM_VISCOSITY,
        splats: drifterSplats,
      });

      // Floaters: one stamp per spawn event, laid where the brush stands —
      // the brush steps first, the stamp follows (see file header). The
      // listener advances every tick regardless of drive choice so its
      // one-per-beat hold clock keeps running for the Scene default
      // (physarum.ts's beatSeeder note says the same); drives.fired() gates
      // the event, drives.value() grades how many floaters the stamp lays
      // down (floaterCountFromEnergy at Scene), and spawnFloaters refuses
      // both while the Floaters product is 0 — the same product the
      // shader's off-gate checks, so a live stamp dies the instant the
      // slider hits 0 and no invisible pool slot is ever taken.
      wavePool.tick(anim.timeSec);
      const beatFired = beatListener.advance(anim).fired;
      if (drives.fired("lightWaves", beatFired)) {
        const slot = sweepSlot(sweepsFired);
        sweepT0[slot] = anim.timeSec;
        sweepSeed[slot] = wrapShaderSeed(sweepsFired) * 1.618 + 3.0;
        sweepsFired++;
        lastSweepSec = anim.timeSec;
      }
      const floaterAmount = resolveSceneSetting(ID, settingFor("floaterDensity")) * drives.value("floaterDensity", 1);
      if (drives.fired("floaterDensity", beatFired)) {
        const count = spawnFloaters(floaterAmount, drives.value("floaterDensity", floaterCountFromEnergy(frame.energy)));
        if (count > 0) {
          const seed = waveSeedCounter++;
          const stride = BRUSH_STRIDE_MAX * resolveSceneSetting(ID, settingFor("brushMove"));
          const next = stepBrush([brushX, brushY], brushHeading, stride, seed);
          brushX = next.x;
          brushY = next.y;
          brushHeading = next.heading;
          // The brush picks the region; pickSwarmCenter nudges to the
          // clearest spot within it (cloud drifters only — a trail is meant
          // to accumulate). The shader's per-floater cloud fade is the
          // second net.
          const [cx, cy] = pickSwarmCenter(seed, [brushX, brushY], drifterCentres);
          wavePool.trigger(
            anim.timeSec,
            count,
            seed,
            cx,
            cy,
            waveLifeSec(resolveSceneSetting(ID, settingFor("floaterSustain"))),
          );
        }
      }

      // Haidinger's brush — a continuously increasing accumulator, never
      // anim.barPhase (see file header).
      brushPhase = advanceBrushPhase(brushPhase, dt);

      // Blue-field sprites' own clock: a steady pace that surges on the
      // jack's reading (plain Beat by default, so each beat pulse throws
      // them forward), wrapped seamlessly (SPRITE_PERIOD_SEC).
      const spriteSpeedNow = spriteSpeed(drives.value("sprites", anim.beatPulse));
      spritePhase = advanceSpritePhase(spritePhase, dt, spriteSpeedNow);

      // Day cycle: Time of day is where the sky starts, Day drift how fast it
      // moves on from there, hurrying through the hours the sun is down
      // (see file header).
      const timeOfDay = resolveSceneSetting(ID, settingFor("timeOfDay"));
      const wrap = (v: number) => v - Math.floor(v);
      dayOffset = advanceDayOffset(dayOffset, dt, resolveSceneSetting(ID, settingFor("dayDrift")), wrap(timeOfDay + dayOffset));
      const dayPhase = wrap(timeOfDay + dayOffset);

      gl.disable(gl.BLEND);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      displayProg.use();
      uploadCommonUniforms(displayProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf, drives);
      displayProg.setF("uBrushPhase", brushPhase);
      displayProg.setF("uDayPhase", dayPhase);
      displayProg.setF("uBrushSwell", lastSweepSec === null ? 0 : brushSwell(anim.timeSec - lastSweepSec));
      displayProg.setF("uSpritePhase", spritePhase);
      displayProg.setF("uSpriteSpeed", spriteSpeedNow);
      displayProg.setF(
        "uFloaterGain",
        floaterGain(liftByDrive(resolveSceneSetting(ID, settingFor("floaterVisibility")), drives.value("floaterVisibility", anim.high))),
      );
      wavePool.upload(displayProg);
      displayProg.setFv("uSweepT0", sweepT0);
      displayProg.setFv("uSweepSeed", sweepSeed);
      displayProg.setV4v("uCloudFlow", cloudNoiseFlows(anim.timeSec, cloudFlow));
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sim.dyeTexture());
      gl.uniform1i(dyeLoc, 0);
      drawFullscreenQuad(gl, quadVao);

      // The gallery renders every scene into one shared context each tick —
      // must not leak a bound texture onto the next tile.
      gl.bindTexture(gl.TEXTURE_2D, null);
    },

    dispose(ctx: SceneContext) {
      const { gl } = ctx;
      sim?.dispose();
      displayProg?.dispose();
      if (quadVao) gl.deleteVertexArray(quadVao);
      sim = null;
      displayProg = null;
      quadVao = null;
      dyeLoc = null;
      wavePool = null;
      lastFrameTime = null;
    },
  };
}

export const skyScene = createSkyScene();
