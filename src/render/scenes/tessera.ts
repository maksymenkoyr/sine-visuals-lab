import { NUM_BANDS } from "../../audio/types.ts";
import { createProgram, createFullscreenQuad, drawFullscreenQuad, type GLProgram } from "../gl.ts";
import { PALETTE_GLSL, paletteVecs } from "../palette.ts";
import type { SceneSetting } from "../sceneSettings.ts";
import { resolveSceneSetting } from "../autoTune.ts";
import type { Scene, SceneContext } from "../scene.ts";
import { COMMON_UNIFORMS_GLSL, settingUniformName, uploadCommonUniforms } from "../sceneCommon.ts";

// Tessera — a video-feedback zoom, built from the measured picture in
// tools/.cache/refs/lZaThcqs-dk (report.md's "Picture, measured" section;
// look.png and frames/look_4.jpg, frames/b006_r16_+000.jpg show it).
//
// The content is a pool of advected sprites, not a feedback stamp. Earlier
// drafts drew tiles straight into the history buffer and let the feedback
// warp carry them — but a feedback stamp draws a tile's *path* (every past
// position blurred together by repeated resampling), not the *object*, so
// a tile smeared into a long curved arc over its lifetime and a burst had
// to flash the whole screen's lattice at once to look "fresh". The
// reference does neither: its tiles stay crisp rectangles across four
// generations of inward travel (echo rings at r 0.17/0.27/0.47/0.75) with
// only a short (~2x) radial streak, and nothing flashes screen-wide on a
// beat. So here the tile's true position lives in a JS-simulated sprite
// pool (r, angle, shape, hue, ...) — see the Sprite pool section below —
// and only the SHORT trailing streak behind each sprite is left to the
// feedback warp.
//
// Passes, every frame (see createTesseraScene's render()):
//   1. Feedback (FEEDBACK_FRAG) -> history[write]. Samples history[read] at
//      a warped position (rotate by Spin, push outward by Inflow's radial
//      law — see radialSpeed/radialTravelTime below) with a short 3-tap
//      radial blur (Streak) and a SHORT Persist decay — short enough that
//      what survives is only the last sprite-length or so of travel, which
//      is the entire streak; there is no lattice stamp here any more.
//   1b. Sprites (SPRITE_VERT/SPRITE_FRAG) drawn on top of the same
//      history[write], as GPU point sprites addressed by gl_VertexID into
//      two data textures uploaded fresh from the JS pool each frame (same
//      "attribute-less" idiom as chladni.ts's grain pass — see the Sprite
//      pool section). Premultiplied-over blend, like chladni's own point
//      pass, so overlapping sprites occlude instead of blooming additively
//      — crisp, opaque cores, exactly the reference's "tiles stay crisp
//      rectangles" look.
//   2. Glow (DOWNSAMPLE_FRAG then BLUR_FRAG x N, separable) — history[write]
//      downsampled to quarter resolution, blurred with a wide kernel
//      (measured glow e-fold 20-100px at 640px tall), iterated
//      quality.bloomPasses times for a progressively wider bloom.
//   3. Composite (COMPOSITE_FRAG) -> the screen. Samples history[write]
//      through the Lens warp, adds the blurred glow x Glow, and paints the
//      constant white core (Core) on top. Lens lives *here*, at display
//      time, rather than in the feedback loop: inside LENS_RADIUS the
//      picture is untouched, a bold near-black ring sits right at it, and
//      outside it a Fold-way mirrored, same-scale radial reflection about
//      the ring is drawn instead (a triangle wave in r, not a r'=R^2/r
//      inversion — an inversion magnifies the near-centre region into flat
//      fills the further out you sample, where a real kaleidoscope reflects
//      1:1; see LENS_RADIUS's own comment) — the mirrored petal shells in
//      the reference's 0-12s lens regime — sheets/rank4.png #6/#14/#18).
//      The fold and the unfolded view are each sampled and their *colours*
//      crossfaded by Lens, not their sample *positions* lerped — lerping
//      positions can walk a sample straight through unrelated parts of the
//      picture between the two points, which tore visibly during Drift's
//      sweep through a partial Lens value.
//
// Sprite pool: a plain JS array of live sprites (r, angle, size, aspect,
// shape, hue, highlight, age), capped at SPRITE_CAP (scaled down by
// ctx.quality.maxParticles if that's ever smaller). Each frame in JS
// (advectPool): r -= radialSpeed(r, inflow)*dt, angle += spin*dt, and a
// sprite is culled once r < SPRITE_KILL_R or its age exceeds
// SPRITE_MAX_AGE_SEC (r-based culling is the common case — see
// radialTravelTime's own comment for how quickly a sprite actually reaches
// the core). Continuous emission is the baseline, not an occasional
// top-up: report.md counts the echo rings as density *modulations* within
// an otherwise steady field of objects (rings at r 0.17/0.27/0.47/0.75 hold
// a third to two-thirds of the frame's whole object count, not isolated
// bands with black gaps between them), so every spoke spawns tiles at a
// steady rate every frame (advanceContinuousEmission), not just on a beat.
// spokeColumnRate derives that rate from the radial law itself: tiles enter
// at SPRITE_SPAWN_R_MID moving at radialSpeed(SPRITE_SPAWN_R_MID, inflow),
// and consecutive tiles in a column should sit SPRITE_COLUMN_SPACING_TILES
// tile-lengths apart, so rate = speed / (spacing * meanTileLength) —
// physically derived, not a tuned constant. Trickle (Motion) multiplies
// this baseline; Burst (Motion) rides a short rate bump on top of it for
// SPRITE_BURST_BUMP_SEC right after a tempo-held burst signal
// (burstHoldSec/advanceBurstHold, below — the scene's one honest beat tie);
// Density (Form) is a master scale on both. New sprites always spawn at the
// edge — r uniform in [SPRITE_SPAWN_R_MIN, SPRITE_SPAWN_R_MAX], just outside
// the visible frame — at an angle drawn from SPRITE_SPOKES fixed, shared
// directions (plus a small jitter): reusing the same discrete angle grid
// every time is what makes tiles converge into the reference's radial
// columns rather than reading as scattered noise. Every spawn is a
// point-symmetric pair (angle and angle+PI share every random draw — size,
// shape, aspect, hue, highlight), which is what gives the picture its
// 2-fold rotational symmetry directly, no per-pixel hash-fold needed — and
// since spawnPair already seeds a spoke's antipodal partner, only the first
// half of SPRITE_SPOKES gets its own accumulator (accumulating on both
// halves would double-count every column). init() pre-seeds
// SPRITE_PRESEED_SEC of simulated steady emission so the first second on
// screen isn't empty. Tile size does not scale with r (measured size ~
// r^0.2, a flat pattern) — each spawn draws a major-axis length from
// SPRITE_SIZE_SMALL_*/SPRITE_SIZE_LARGE_* (mostly small, a minority large —
// see spawnPair), scaled by Tiling around its own calibration default, not
// a single fixed size; width is that length divided by the spawn's own
// aspect (SPRITE_ASPECT_MIN..MAX).
//
// Two history textures (RGBA8, LINEAR/CLAMP, ping-ponged) plus a
// quarter-res LINEAR/CLAMP glow pair are all sized off
// gl.drawingBufferWidth/Height and rebuilt whenever that changes (checked
// every frame — the quality governor moves renderScale at runtime, so this
// can't be decided once at init; see ensureHistoryTargets/ensureGlowTargets,
// the same policy as powder.ts's ensureGlowTargets). RGBA8 because the
// content this scene ever needs to hold — a short trailing streak under a
// short Persist — never needs more than 8 bits/channel of headroom. A
// rebuild empties history to black; it refills within a beat, same as a
// hard cut in the reference. The sprite pool textures (poolTexA/poolTexB)
// are RGBA32F, sized once at init from SPRITE_CAP — WebGL2 samples float
// textures natively via texelFetch (no filtering, so no extension needed),
// the same "pack JS-simulated state into a texture, address by
// gl_VertexID" idiom chladni.ts's grain pass uses for its RGBA8 position
// texture, just wider channels since sprite state (radius, angle, hue, ...)
// needs more range/precision than a packed 0..1 value.
//
// This scene intentionally does not chase Panorama cross-device continuity
// (uViewport/roomUv()): the feedback loop is a self-contained per-device
// effect, like Chladni's plate, not a room-spanning pattern, so every pass
// works directly in vUv/NDC (which is exactly room-space at the
// default/only-tested full viewport).
//
// Sync (see the plan's "Sync hypotheses" for the measurements behind each):
// inflow/spin run continuously, never locked to the beat — the reference
// shows no beat-rank preference on activity/zoom. The one honest beat tie
// is Burst's rate bump, triggered on anim.onset (the Beat-grid one-shot)
// with a free-running fallback (advanceFreeBurst) so the pool keeps
// refreshing when tempoLock is low — both gated through the same
// tempo-derived hold (burstHoldSec/advanceBurstHold) so neither source can
// trigger a bump faster than roughly once a beat: the analyser's default
// Hits grid fires several onsets a beat on a busy track, and a bump on
// every one of those would read as constant, not a beat-synced accent.
// hueOffset steps on a JS bar counter (advanceBarCounter)
// every HUE_STEP_BARS bars, slewed rather than snapped, and bounded to a
// narrow +/-HUE_SPAN triangle wave rather than cycling the whole hue wheel
// — hypothesis 3's "regime warms at bar/phrase beats", the reference stays
// yellow-dominant throughout. Drift's lens sweep (lensDriftEnvelope) is a
// plain wall-clock timer, not audio-driven — hypothesis 4 found the
// lens<->starburst regime switches uncorrelated with any audio boundary.
export const ID = "tessera";

// ---- pure helpers (exported for tests/tessera.test.ts) --------------------

const RADIAL_R0 = 0.5; // hh — the law's calibration radius
// Measured in the starburst regimes (report.md's "Picture, measured" flow
// lines): radial speed grows a little faster than sqrt(r).
const RADIAL_EXPONENT = 0.6;

/** Speed (half-heights/sec, magnitude) at which content crosses radius r
 *  under the feedback push — the measured law (0.55-0.65 hh/s at r=0.5,
 *  proportional to r^RADIAL_EXPONENT). `inflow` is the Inflow setting's
 *  resolved value. Used both by the feedback warp and (advectPool) by the
 *  sprite pool's own radial motion, so the two stay the same law. */
export function radialSpeed(r: number, inflow: number): number {
  return inflow * Math.pow(Math.max(r, 0) / RADIAL_R0, RADIAL_EXPONENT);
}

/** Closed-form time for a point to travel from r0 down to r1 (r0 > r1)
 *  under dr/dt = -radialSpeed(r, inflow). Substituting u = r^(1-RADIAL_EXPONENT)
 *  makes du/dt constant (a generalization of the sqrt-linear-in-time trick:
 *  RADIAL_EXPONENT=0.5 is the special case where u=sqrt(r)), so this is
 *  exact rather than numerically integrated (tests/tessera.test.ts checks
 *  it against a step-integrated reference). Used to size the echo-ring
 *  generation spacing against the beat (hypothesis 7 in the plan) and,
 *  informally, how long a sprite survives before advectPool culls it at
 *  SPRITE_KILL_R. */
export function radialTravelTime(r0: number, r1: number, inflow: number): number {
  if (inflow <= 0) return Infinity;
  const q = 1 - RADIAL_EXPONENT;
  return ((Math.pow(r0, q) - Math.pow(r1, q)) * Math.pow(RADIAL_R0, RADIAL_EXPONENT)) / (q * inflow);
}

/** Bar counter driven by anim.barPhase samples, incrementing exactly once
 *  per wrap (a big backward jump, not a naive `<` check that would also
 *  fire on the very first sample). Pure state/step split so
 *  tests/tessera.test.ts can drive it with a scripted phase sequence. */
export interface BarCounterState {
  prevBarPhase: number;
  bars: number;
}

export function createBarCounterState(): BarCounterState {
  return { prevBarPhase: 0, bars: 0 };
}

/** Advances the counter in place; returns whether this call was a wrap. */
export function advanceBarCounter(state: BarCounterState, barPhase: number): boolean {
  const wrapped = barPhase < state.prevBarPhase - 0.5;
  if (wrapped) state.bars++;
  state.prevBarPhase = barPhase;
  return wrapped;
}

// Regime warms every couple of bars, not every bar — hypothesis 3 found the
// saturation jumps at rank-8/rank-16 beats (2/4 bars), not every bar.
const HUE_STEP_BARS = 2;

// The reference stays yellow-dominant for the whole clip, drifting only
// toward orange/red — never cycling the full wheel. HUE_SPAN bounds the
// hue-stepper's excursion from HUE_BASE (see spawnPair's own use of it)
// to match: a triangle wave bouncing between -HUE_SPAN and +HUE_SPAN rather
// than an unbounded walk.
const HUE_SPAN = 0.12;

/** Standard triangle wave: 0 at x=0, rising to `amplitude` at x=amplitude,
 *  back down through 0 to -amplitude at x=3*amplitude, and back to 0 at
 *  x=4*amplitude (period 4*amplitude) — continuous, so hueStepTarget's
 *  steps bounce cleanly rather than tearing at the fold. */
function triangleWave(x: number, amplitude: number): number {
  const period = 4 * amplitude;
  let m = x % period;
  if (m < 0) m += period;
  if (m <= amplitude) return m;
  if (m <= 3 * amplitude) return 2 * amplitude - m;
  return m - period; // m in (3a,4a] -> (-a,0]
}

/** The hue offset this many completed bars should be resting at — a
 *  triangle wave (bounded to +/-HUE_SPAN, bouncing back rather than
 *  cycling the whole wheel) in steps of hueDrift every HUE_STEP_BARS bars,
 *  meant to be approached with slewToward rather than assigned directly. */
export function hueStepTarget(bars: number, hueDrift: number): number {
  const steps = Math.floor(bars / HUE_STEP_BARS);
  return triangleWave(steps * hueDrift, HUE_SPAN);
}

/** One-pole approach toward `target`, same shape as autoTune.ts's own
 *  AUTO_SLEW_RATE glide — used here for the hue stepper (so a bar-boundary
 *  hue step reads as a slow warm, not a jump) and reusable anywhere else in
 *  this scene that wants the same. */
export function slewToward(current: number, target: number, ratePerSec: number, dtSec: number): number {
  return current + (target - current) * Math.min(1, Math.max(0, ratePerSec * dtSec));
}

function smoothstep01(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// Drift's scripted lens sweep: a slow wall-clock timer, not audio-driven
// (hypothesis 4 — the lens<->starburst regime switches in the reference
// don't line up with any audio boundary). Period and on-time approximate
// the clip's own lens (~12s) / starburst (~18s) cadence.
const LENS_DRIFT_PERIOD_SEC = 30;
const LENS_DRIFT_ON_SEC = 12;
const LENS_DRIFT_EDGE_SEC = 3;

/** 0->1->0 envelope for the Drift toggle's scripted lens sweep: a smooth
 *  trapezoid over the first LENS_DRIFT_ON_SEC seconds of each
 *  LENS_DRIFT_PERIOD_SEC-second period, zero for the rest. `tSec` is a
 *  free-running seconds counter the caller advances by dtSec each frame —
 *  this function does the wrapping, so the caller never needs to. Pure and
 *  exported for tests/tessera.test.ts. */
export function lensDriftEnvelope(tSec: number): number {
  const t = ((tSec % LENS_DRIFT_PERIOD_SEC) + LENS_DRIFT_PERIOD_SEC) % LENS_DRIFT_PERIOD_SEC;
  if (t >= LENS_DRIFT_ON_SEC) return 0;
  const rise = smoothstep01(0, LENS_DRIFT_EDGE_SEC, t);
  const fall = 1 - smoothstep01(LENS_DRIFT_ON_SEC - LENS_DRIFT_EDGE_SEC, LENS_DRIFT_ON_SEC, t);
  return Math.min(rise, fall);
}

// A plausible free-running "beat" when nothing is locked — see
// advanceFreeBurst below and the file header's Sync section.
const FREE_BURST_PERIOD_SEC = 0.5;
// Below this tempoLock, the beat grid is unreliable enough that the pool
// should keep refreshing on its own rather than going stale.
const FREE_BURST_TEMPO_LOCK_MAX = 0.3;

export interface FreeBurstState {
  phase: number;
}

export function createFreeBurstState(): FreeBurstState {
  return { phase: 0 };
}

/** Advances the free-running fallback phase in place; returns whether this
 *  call wrapped (i.e. the fallback wants to fire). Independent of tempoLock
 *  — the caller (see render() below) decides whether to actually use a
 *  wrap based on tempoLock, so this stays a pure phase accumulator. */
export function advanceFreeBurst(state: FreeBurstState, dtSec: number): boolean {
  const next = state.phase + dtSec / FREE_BURST_PERIOD_SEC;
  const wrapped = next >= 1;
  state.phase = wrapped ? next % 1 : next;
  return wrapped;
}

export { FREE_BURST_TEMPO_LOCK_MAX };

// Minimum spacing between bursts, regardless of tempo — the floor a fast or
// unlocked track falls back to.
const BURST_HOLD_FLOOR_SEC = 0.45;
// The fraction of a beat a burst holds for once tempo is trusted — the
// echo-ring spacing is roughly one beat of travel (see radialTravelTime's
// own comment), so bursts should be spaced close to a beat apart, not on
// every onset. On this track's default Hits grid the analyser fires far
// more often than once a beat (hears.json: ~5 onsets/s at 118 bpm ~= 2 Hz),
// which without a hold re-seeded the edge several times a beat and filled
// the frame solid — the same lesson the Shards scene's per-onset-cut
// rework learned.
const BURST_HOLD_BEAT_FRACTION = 0.85;

/** How long to ignore further burst requests after one fires. Below
 *  tempoLock 0.5 the beat clock isn't trusted enough to derive a hold from,
 *  so this is just the floor; at or above it, the hold is
 *  BURST_HOLD_BEAT_FRACTION of a beat, but never under the floor (a very
 *  fast bpm shouldn't be allowed to burst faster than BURST_HOLD_FLOOR_SEC
 *  apart either). Pure and exported for tests/tessera.test.ts. */
export function burstHoldSec(bpm: number, tempoLock: number): number {
  if (tempoLock < 0.5) return BURST_HOLD_FLOOR_SEC;
  const beatSec = 60 / Math.max(bpm, 1e-3);
  return Math.max(BURST_HOLD_FLOOR_SEC, BURST_HOLD_BEAT_FRACTION * beatSec);
}

export interface BurstHoldState {
  /** Seconds since the last actual (post-hold) fire — starts at Infinity
   *  so the very first request always fires immediately. */
  sinceLastSec: number;
}

export function createBurstHoldState(): BurstHoldState {
  return { sinceLastSec: Infinity };
}

/** Gates a burst request by burstHoldSec's tempo-derived hold: advances the
 *  time-since-last-fire clock by dtSec regardless, then fires (and resets
 *  that clock) only if `requested` is true AND the hold has elapsed. The
 *  free-running fallback in render() routes through this the same way a
 *  real onset does, so a fallback wrap can't sneak a burst in before the
 *  hold from a real onset (or a previous fallback) has cleared. Pure and
 *  exported for tests/tessera.test.ts. */
export function advanceBurstHold(
  state: BurstHoldState,
  dtSec: number,
  requested: boolean,
  bpm: number,
  tempoLock: number,
): boolean {
  state.sinceLastSec += dtSec;
  if (!requested) return false;
  if (state.sinceLastSec < burstHoldSec(bpm, tempoLock)) return false;
  state.sinceLastSec = 0;
  return true;
}

// ---- sprite pool ----------------------------------------------------------

interface Sprite {
  r: number;
  angle: number;
  /** Full major-axis length, half-heights (already scaled by Tiling — see
   *  spawnPair's own comment on TILING_CALIBRATION). */
  sizeHH: number;
  aspect: number;
  /** 0 = filled bar, 1 = hollow "gate", 2 = disc. */
  shape: number;
  huePos: number;
  /** 0/1 — a near-white highlight tile (see SPRITE_FRAG). */
  highlight: number;
  ageSec: number;
}

const SPRITE_CAP = 6000;
// Discrete angles new tiles spawn on, shared across every emission — this
// fixed grid (not a fresh random angle each time) is what makes tiles
// converge into the reference's radial columns as they travel inward,
// rather than reading as scattered noise. 72 gives roughly the column
// count the reference shows at r~0.5 for the measured tile size and
// spacing below.
const SPRITE_SPOKES = 72;
const SPRITE_SPOKE_JITTER = 0.35; // fraction of one spoke's angular width
// Spawn just outside the visible frame so new tiles read as entering from
// the edge, not popping into existence mid-frame.
const SPRITE_SPAWN_R_MIN = 1.25;
const SPRITE_SPAWN_R_MAX = 1.45;
const SPRITE_SPAWN_R_MID = (SPRITE_SPAWN_R_MIN + SPRITE_SPAWN_R_MAX) / 2;
const SPRITE_ASPECT_MIN = 1.6;
const SPRITE_ASPECT_MAX = 2.4;
// Size distribution measured off the reference (report.md's "Picture,
// measured"): the bulk of objects are small, with a minority of larger
// ones — not a single fixed size, and not derived from aspect alone.
const SPRITE_SIZE_SMALL_MIN = 0.025; // hh, full major-axis length
const SPRITE_SIZE_SMALL_MAX = 0.06;
const SPRITE_SIZE_LARGE_MIN = 0.06;
const SPRITE_SIZE_LARGE_MAX = 0.11;
const SPRITE_SIZE_LARGE_CHANCE = 0.05;
// Weighted mean major-axis length across the whole distribution — used
// only to derive the continuous emission rate below (spokeColumnRate), so
// it's computed from the ranges above rather than restated as its own
// number.
const SPRITE_MEAN_SIZE_HH =
  (1 - SPRITE_SIZE_LARGE_CHANCE) * ((SPRITE_SIZE_SMALL_MIN + SPRITE_SIZE_SMALL_MAX) / 2) +
  SPRITE_SIZE_LARGE_CHANCE * ((SPRITE_SIZE_LARGE_MIN + SPRITE_SIZE_LARGE_MAX) / 2);
// Tiling's own default is exactly the size the SPRITE_SIZE_* range above
// was measured at, so Tiling reads as a scale multiplier around 1.0 at its
// default rather than a literal length — moving it scales the whole
// distribution up or down together.
const TILING_CALIBRATION = 0.06;
const SPRITE_DISC_CHANCE = 0.1;
const SPRITE_HIGHLIGHT_CHANCE = 0.15;
const SPRITE_ACCENT_CHANCE = 0.08;
const SPRITE_HUE_SPREAD = 0.07;
const SPRITE_HUE_BASE = 0.85; // ~yellow at the default (Neon) palette's own phase
const SPRITE_HUE_ACCENT = 0.33; // ~blue/cyan — see palette.ts's PALETTES
const SPRITE_KILL_R = 0.085; // roughly the core's own visual extent
const SPRITE_MAX_AGE_SEC = 6; // a backstop — most sprites die from SPRITE_KILL_R first
const SPRITE_FADE_IN_SEC = 0.12;
// Continuous emission is the baseline (report.md counts rings as density
// *modulations* within an otherwise steady field of objects, not isolated
// bands with gaps between them): consecutive tiles along one column should
// sit this many tile-lengths apart at the spawn edge, so the column reads
// as near-touching rather than a string of separated dots — see
// spokeColumnRate below for how that turns into a spawn rate.
const SPRITE_COLUMN_SPACING_TILES = 1.2;
// How long a beat's rate bump lasts — see the Burst setting and render()'s
// burstBoostTimer.
const SPRITE_BURST_BUMP_SEC = 0.12;
const SPRITE_PRESEED_SEC = 3;

/** The angle for spoke index i this call — a fixed slot (see SPRITE_SPOKES)
 *  plus a small jitter, freshly rolled each call so consecutive spawns on
 *  the same spoke don't land exactly on top of each other. */
function spokeAngle(i: number): number {
  const slot = (Math.PI * 2) / SPRITE_SPOKES;
  const jitter = (Math.random() - 0.5) * SPRITE_SPOKE_JITTER * slot;
  return i * slot + jitter;
}

/** Baseline spawn rate (pairs/sec) for one spoke-pair's column: the speed
 *  content crosses the spawn edge (radialSpeed at SPRITE_SPAWN_R_MID)
 *  divided by the target spacing between consecutive tiles
 *  (SPRITE_COLUMN_SPACING_TILES tile-lengths). At Trickle=Density=1 (their
 *  own neutral defaults) this is used as-is; both scale it further in
 *  render(). Pure and exported for tests/tessera.test.ts. */
export function spokeColumnRate(inflow: number): number {
  const edgeSpeed = radialSpeed(SPRITE_SPAWN_R_MID, inflow);
  const spacing = SPRITE_COLUMN_SPACING_TILES * SPRITE_MEAN_SIZE_HH;
  return edgeSpeed / Math.max(spacing, 1e-6);
}

/** Spawns one point-symmetric pair (angle and angle+PI) sharing every
 *  random draw — size, shape, aspect, hue, highlight — so the picture's
 *  2-fold rotational symmetry holds without any per-pixel hash-fold.
 *  No-ops once the pool is at cap. `tilingScale` is Tiling's resolved
 *  value divided by TILING_CALIBRATION (1.0 at Tiling's own default). */
function spawnPair(
  pool: Sprite[],
  cap: number,
  angle: number,
  gatesShare: number,
  hueOffset: number,
  tilingScale: number,
): void {
  if (pool.length + 2 > cap) return;
  const isLarge = Math.random() < SPRITE_SIZE_LARGE_CHANCE;
  const sizeHH =
    (isLarge
      ? SPRITE_SIZE_LARGE_MIN + Math.random() * (SPRITE_SIZE_LARGE_MAX - SPRITE_SIZE_LARGE_MIN)
      : SPRITE_SIZE_SMALL_MIN + Math.random() * (SPRITE_SIZE_SMALL_MAX - SPRITE_SIZE_SMALL_MIN)) * tilingScale;
  const aspect = SPRITE_ASPECT_MIN + Math.random() * (SPRITE_ASPECT_MAX - SPRITE_ASPECT_MIN);
  const roll = Math.random();
  const shape = roll < gatesShare ? 1 : roll < gatesShare + SPRITE_DISC_CHANCE ? 2 : 0;
  const highlight = Math.random() < SPRITE_HIGHLIGHT_CHANCE ? 1 : 0;
  const huePos =
    Math.random() < SPRITE_ACCENT_CHANCE
      ? SPRITE_HUE_ACCENT + (Math.random() - 0.5) * SPRITE_HUE_SPREAD
      : SPRITE_HUE_BASE + (Math.random() - 0.5) * SPRITE_HUE_SPREAD + hueOffset;
  const r = SPRITE_SPAWN_R_MIN + Math.random() * (SPRITE_SPAWN_R_MAX - SPRITE_SPAWN_R_MIN);
  pool.push({ r, angle, sizeHH, aspect, shape, huePos, highlight, ageSec: 0 });
  pool.push({ r, angle: angle + Math.PI, sizeHH, aspect, shape, huePos, highlight, ageSec: 0 });
}

/** Advances every spoke-pair's emission accumulator by dtSec at
 *  `ratePerSpoke` (pairs/sec), firing spawnPair (a fresh jitter angle each
 *  time) whenever an accumulator crosses 1 — a `while`, not an `if`, so a
 *  rate faster than the frame rate still spawns the right count instead of
 *  stalling at one per frame. Only the first half of SPRITE_SPOKES gets its
 *  own accumulator: spawnPair already seeds a spoke's antipodal partner
 *  (angle+PI, which lands exactly on another spoke since SPRITE_SPOKES is
 *  even), so accumulating on both halves would double-count every column. */
function advanceContinuousEmission(
  pool: Sprite[],
  cap: number,
  spokeAccum: Float64Array,
  dtSec: number,
  ratePerSpoke: number,
  gatesShare: number,
  hueOffset: number,
  tilingScale: number,
): void {
  const halfSpokes = SPRITE_SPOKES / 2;
  for (let i = 0; i < halfSpokes; i++) {
    spokeAccum[i] = (spokeAccum[i] ?? 0) + ratePerSpoke * dtSec;
    while (spokeAccum[i]! >= 1) {
      spokeAccum[i] = spokeAccum[i]! - 1;
      spawnPair(pool, cap, spokeAngle(i), gatesShare, hueOffset, tilingScale);
    }
  }
}

/** Advances every sprite's radial/angular position in place (the same
 *  radial law as the feedback warp — see radialSpeed) and culls dead ones
 *  by swap-remove (O(1), order doesn't matter for a point cloud). */
function advectPool(pool: Sprite[], dtSec: number, inflow: number, spinDegPerSec: number): void {
  const spinRad = (spinDegPerSec * Math.PI) / 180;
  let i = 0;
  while (i < pool.length) {
    const sp = pool[i]!;
    sp.r -= radialSpeed(sp.r, inflow) * dtSec;
    sp.angle += spinRad * dtSec;
    sp.ageSec += dtSec;
    if (sp.r < SPRITE_KILL_R || sp.ageSec > SPRITE_MAX_AGE_SEC) {
      pool[i] = pool[pool.length - 1]!;
      pool.pop();
    } else {
      i++;
    }
  }
}

/** Seeds the pool on init by simulating SPRITE_PRESEED_SEC of steady
 *  continuous emission (no beat bump — there's no real beat yet) in coarse
 *  steps, so the first second on screen already shows full columns instead
 *  of filling in from empty. `spokeAccum` is the same array render() goes
 *  on advancing afterward, so whatever fractional accumulation is left
 *  over carries through with no seam. */
function preseedPool(
  pool: Sprite[],
  cap: number,
  spokeAccum: Float64Array,
  density: number,
  trickle: number,
  gatesShare: number,
  inflow: number,
  spinDegPerSec: number,
  tilingScale: number,
): void {
  const ratePerSpoke = spokeColumnRate(inflow) * trickle * density;
  const dt = 1 / 30;
  const steps = Math.round(SPRITE_PRESEED_SEC / dt);
  for (let s = 0; s < steps; s++) {
    advanceContinuousEmission(pool, cap, spokeAccum, dt, ratePerSpoke, gatesShare, 0, tilingScale);
    advectPool(pool, dt, inflow, spinDegPerSec);
  }
}

// ---- settings ---------------------------------------------------------

const SETTINGS: SceneSetting[] = [
  {
    key: "tiling",
    label: "Tile size",
    description: "Sprite width, in half-heights (half the frame height = 1); radial length is this times the sprite's own aspect",
    group: "Form",
    min: 0.02,
    max: 0.16,
    step: 0.005,
    default: 0.06,
  },
  {
    key: "gates",
    label: "Gate share",
    description: "Fraction of tiles drawn as hollow outlined \"gates\" instead of filled",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.3,
  },
  {
    key: "density",
    label: "Density",
    description: "Master scale on how many tiles spawn, both the continuous stream and the beat bump",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.15,
  },
  {
    key: "lens",
    label: "Lens",
    description: "Folds the outer picture into mirrored petal shells around a dark ring",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0,
  },
  {
    key: "fold",
    label: "Lens folds",
    description: "How many mirrored wedges the lens splits the outer picture into",
    group: "Form",
    min: 2,
    max: 16,
    step: 1,
    default: 8,
    advanced: true,
  },
  {
    key: "inflow",
    label: "Inflow",
    description: "Inward flow speed at r=0.5 (half the frame height), half-heights per second",
    group: "Motion",
    min: 0,
    max: 1.2,
    step: 0.05,
    default: 0.6,
    // Faster-moving music streams tiles inward harder.
    auto: { tempo: 0.3 },
  },
  {
    key: "spin",
    label: "Spin",
    description: "Rotation speed, degrees/second (negative = clockwise)",
    group: "Motion",
    min: -60,
    max: 60,
    step: 1,
    default: -20,
    // A steadier pulse spins a little faster (more clockwise).
    auto: { pulse: -0.15 },
  },
  {
    key: "burst",
    label: "Burst",
    description: "A brief bump in spawn rate right on the beat, riding on top of the continuous stream — 0 is no bump, 1 triples the rate for the moment",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.7,
    auto: { pulse: 0.3 },
  },
  {
    key: "trickle",
    label: "Trickle",
    description: "Multiplies the continuous baseline spawn rate — the columns of tiles streaming in, independent of the beat",
    group: "Motion",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
    auto: { density: 0.2 },
  },
  {
    key: "drift",
    label: "Drift",
    description: "Slowly sweeps Lens between the lensed and starburst regimes on its own timer",
    group: "Motion",
    type: "boolean",
    min: 0,
    max: 1,
    step: 1,
    default: 1,
  },
  {
    key: "persist",
    label: "Persist",
    description: "Trail decay time, seconds — this is the streak length now: short enough that a tile's trail fades within about one tile-length of travel, not a spiral",
    group: "Look",
    min: 0.05,
    max: 1,
    step: 0.05,
    default: 0.35,
    // A busy mix wants trails to clear faster so it doesn't wash out.
    auto: { density: -0.2 },
  },
  {
    key: "streak",
    label: "Streak",
    description: "Radial blur applied each frame, screen pixels",
    group: "Look",
    min: 0,
    max: 3,
    step: 0.1,
    default: 0.1,
  },
  {
    key: "pastel",
    label: "Pastel",
    description: "Pulls tile colour toward a muted pearl tone",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
  },
  {
    key: "hueDrift",
    label: "Hue drift",
    description: "Hue step applied every couple of bars, bouncing within a narrow band rather than cycling the whole wheel",
    group: "Look",
    min: 0,
    max: 0.3,
    step: 0.01,
    default: 0.02,
  },
  {
    key: "glow",
    label: "Glow",
    description: "Bloom strength",
    group: "Post",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
  },
  {
    key: "core",
    label: "Core",
    description: "Size and brightness of the constant white core",
    group: "Post",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
  },
];

function settingFor(key: string): SceneSetting {
  const s = SETTINGS.find((x) => x.key === key);
  if (!s) throw new Error(`tessera: unknown setting ${key}`);
  return s;
}

const SETTINGS_UNIFORMS_GLSL = SETTINGS.map((s) => `uniform float ${settingUniformName(s.key)};`).join("\n");

// ---- shaders ------------------------------------------------------------

const FEEDBACK_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
${COMMON_UNIFORMS_GLSL}
${SETTINGS_UNIFORMS_GLSL}
uniform sampler2D uPrevTex;
uniform float uDt;

// CLAMP_TO_EDGE repeats the edge texel for any out-of-range uv — sampling
// past the frame edge would otherwise keep re-reading (and, under Persist,
// re-accumulating) that one clamped edge pixel forever, smearing it inward
// as a bright band. Treat anything outside the frame as black instead.
bool inFrame(vec2 uv) {
  return uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0;
}

vec3 sampleInFrame(sampler2D tex, vec2 uv) {
  return inFrame(uv) ? texture(tex, uv).rgb : vec3(0.0);
}

void main() {
  float aspect = uResolution.x / uResolution.y;
  vec2 p = (vUv - 0.5) * vec2(aspect, 1.0) * 2.0;
  float r = length(p);
  float ang = atan(p.y, p.x);

  // --- warp: sample the previous frame rotated and pushed further out, so
  // content reads as flowing inward while spinning (see the file header).
  // This is now only a short trailing streak behind each sprite — the
  // sprite itself, drawn fresh every frame by the pass right after this
  // one, carries the actual position.
  float spinRad = radians(uSpin) * uDt;
  float sampleAng = ang - spinRad;
  float pushedR = r + uInflow * uDt * pow(max(r, 0.0) / 0.5, 0.6);
  vec2 sampleDir = vec2(cos(sampleAng), sin(sampleAng));

  // Streak: a 3-tap blur along the *sample* radial direction, in pixels of
  // the current drawing buffer (resScale keeps it a consistent physical
  // width across resolutions, same idea as powder.ts's grainPx).
  float resScale = max(1.0, uResolution.y / 640.0);
  float streakHH = uStreak * resScale * (2.0 / uResolution.y);

  vec2 toUv = 1.0 / (vec2(aspect, 1.0) * 2.0);
  vec2 uv0 = (sampleDir * pushedR) * toUv + 0.5;
  vec2 uv1 = (sampleDir * (pushedR + streakHH)) * toUv + 0.5;
  vec2 uv2 = (sampleDir * (pushedR - streakHH)) * toUv + 0.5;

  vec3 hist = sampleInFrame(uPrevTex, uv0) * 0.5
            + sampleInFrame(uPrevTex, uv1) * 0.25
            + sampleInFrame(uPrevTex, uv2) * 0.25;
  hist *= exp(-uDt / max(uPersist, 0.05));
  // A hard floor under the exponential decay: without it, a trail never
  // truly reaches black (only asymptotically), so quiet regions of the
  // frame sit at a low haze forever instead of the measured ground lum
  // 0.000.
  hist = max(hist - vec3(0.015), vec3(0.0));

  outColor = vec4(hist, 1.0);
}
`;

// Sprites are drawn as GPU point sprites addressed by gl_VertexID into two
// RGBA32F data textures uploaded fresh from the JS pool each frame (see the
// file header's Sprite pool section) — the same attribute-less idiom
// chladni.ts's grain pass uses, just with wider channels than that pass's
// packed RGBA8 (sprite state needs more range/precision than a 0..1 value).
// uPoolA is (r, angle, sizeHH, shape); uPoolB is (fadeInAlpha, huePos,
// highlight, aspect). sizeHH is already the sprite's full major-axis
// length in half-heights (Tiling-scaled — see spawnPair in tessera.ts), so
// the pixel conversion here is exactly that measured length times
// half-heights-to-pixels, plus a small fixed AA margin — not re-derived
// from Tiling and aspect separately, which is what let a stale scale slip
// in unnoticed before.
const SPRITE_VERT = `#version 300 es
precision highp float;
uniform sampler2D uPoolA;
uniform sampler2D uPoolB;
uniform float uSide;
uniform vec2 uResolution;
out float vShape;
out float vFadeAlpha;
out float vHuePos;
out float vHighlight;
out float vAngle;
out float vNormLong;
out float vNormShort;

void main() {
  int side = int(uSide);
  ivec2 texel = ivec2(gl_VertexID % side, gl_VertexID / side);
  vec4 a = texelFetch(uPoolA, texel, 0);
  vec4 b = texelFetch(uPoolB, texel, 0);
  float r = a.x;
  float angle = a.y;
  float sizeHH = a.z;
  float shapeType = a.w;
  float aspect = b.w;

  float aspectXY = uResolution.x / uResolution.y;
  vec2 p = vec2(cos(angle), sin(angle)) * r;
  gl_Position = vec4(p / vec2(aspectXY, 1.0), 0.0, 1.0);

  // The point's square footprint must cover the sprite's full rotated
  // extent at any angle, so it's sized to the shape's own diagonal — a
  // disc stays round (no elongation, diameter = sizeHH); a bar/gate is
  // sizeHH long along its own radial direction, sizeHH/aspect wide.
  float longHalfHH = sizeHH * 0.5;
  float shortHalfHH = shapeType > 1.5 ? longHalfHH : longHalfHH / max(aspect, 1.0);
  float boundRadiusHH = length(vec2(longHalfHH, shortHalfHH));
  float pxPerHH = uResolution.y / 2.0;
  // +2px is a fixed halo/AA margin, not part of the measured geometry.
  gl_PointSize = clamp(2.0 * boundRadiusHH * pxPerHH + 2.0, 1.0, 256.0);

  vNormLong = longHalfHH / max(2.0 * boundRadiusHH, 1e-5);
  vNormShort = shortHalfHH / max(2.0 * boundRadiusHH, 1e-5);
  vShape = shapeType;
  vFadeAlpha = b.x;
  vHuePos = b.y;
  vHighlight = b.z;
  vAngle = angle;
}
`;

const SPRITE_FRAG = `#version 300 es
precision highp float;
in float vShape;
in float vFadeAlpha;
in float vHuePos;
in float vHighlight;
in float vAngle;
in float vNormLong;
in float vNormShort;
out vec4 outColor;
uniform vec3 uPalA;
uniform vec3 uPalB;
uniform vec3 uPalC;
uniform vec3 uPalD;
uniform float uPastel;
${PALETTE_GLSL}

void main() {
  // Rotate the point's local coordinate into the sprite's own (radial,
  // tangential) frame, then test against a rectangle (bar/gate) or a
  // circle (disc) sized in vNormLong/vNormShort — see SPRITE_VERT.
  vec2 d = gl_PointCoord - 0.5;
  float ca = cos(-vAngle);
  float sa = sin(-vAngle);
  vec2 local = vec2(ca * d.x - sa * d.y, sa * d.x + ca * d.y);

  float coverage;
  if (vShape > 1.5) {
    float dist = length(local) / max(vNormShort, 1e-5);
    float aa = fwidth(dist) * 1.5 + 1e-4;
    coverage = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, dist);
  } else {
    float box = max(abs(local.x) / max(vNormLong, 1e-5), abs(local.y) / max(vNormShort, 1e-5));
    float aa = fwidth(box) * 1.5 + 1e-4;
    if (vShape > 0.5) {
      float outer = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, box);
      float inner = 1.0 - smoothstep(0.72 - aa, 0.72 + aa, box);
      float ring = outer - inner;
      vec2 normLocal = vec2(local.x / max(vNormLong, 1e-5), local.y / max(vNormShort, 1e-5));
      float dotMask = 1.0 - smoothstep(0.0, 0.14, length(normLocal));
      coverage = clamp(ring + dotMask * 0.8, 0.0, 1.0);
    } else {
      coverage = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, box);
    }
  }
  if (coverage <= 0.0) discard;

  // pearl is a light pastel tone (luminance ~0.8), not a mid grey — the
  // reference's saturation 0.40 is a frame mean over mostly-black ground
  // (report.md's "Look, as statistics"), so the lit tiles themselves sit
  // well above that. ~15% of tiles (vHighlight, baked in at spawn) carry a
  // near-white highlight on top — the brightest specks the reference shows
  // scattered among its pastel tiles.
  vec3 col = palette(vHuePos, uPalA, uPalB, uPalC, uPalD);
  vec3 pearl = vec3(0.90, 0.84, 0.66);
  col = mix(col, pearl, mix(0.15, 0.6, uPastel));
  if (vHighlight > 0.5) col = mix(col, vec3(1.0), 0.85);

  float alpha = coverage * vFadeAlpha;
  // Premultiplied — see attachColour/the sprite draw call's blend func.
  outColor = vec4(col * alpha, alpha);
}
`;

const DOWNSAMPLE_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uTexel;

void main() {
  vec3 c = texture(uTex, vUv + uTexel * vec2(-0.5, -0.5)).rgb
         + texture(uTex, vUv + uTexel * vec2( 0.5, -0.5)).rgb
         + texture(uTex, vUv + uTexel * vec2(-0.5,  0.5)).rgb
         + texture(uTex, vUv + uTexel * vec2( 0.5,  0.5)).rgb;
  outColor = vec4(c * 0.25, 1.0);
}
`;

const BLUR_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uBlurStep;

void main() {
  vec3 c = texture(uTex, vUv).rgb * 0.40;
  c += (texture(uTex, vUv + uBlurStep).rgb + texture(uTex, vUv - uBlurStep).rgb) * 0.24;
  c += (texture(uTex, vUv + uBlurStep * 2.0).rgb + texture(uTex, vUv - uBlurStep * 2.0).rgb) * 0.06;
  outColor = vec4(c, 1.0);
}
`;

const COMPOSITE_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
${COMMON_UNIFORMS_GLSL}
${SETTINGS_UNIFORMS_GLSL}
uniform sampler2D uHistTex;
uniform sampler2D uGlowTex;

const float PI = 3.14159265359;
// Measured lens geometry (report.md's lens-regime frames): inside this
// radius the picture is untouched; a dark ring sits right at it; outside,
// a Fold-way mirrored, same-scale reflection of the annulus just inside the
// ring is drawn — a real kaleidoscope reflects 1:1, so this is a radial
// mirror (triangle wave in r, period 2*LENS_RADIUS — see the lens block
// below), not a r'=R^2/r inversion. Inversion magnifies the near-centre
// region into huge flat fills the further out you sample (everything past
// r=2R maps into the tiny disc right around the centre), which is why the
// old version's outer shells read as flat colour blocks instead of the
// reference's fine, same-scale tile texture.
const float LENS_RADIUS = 0.45;
const float LENS_RING_WIDTH = 0.055;
// CORE_RADIUS is a *half*-width: at the default Core=0.5 (coreScale=1.25
// below), the core's full on-screen width is 2*CORE_RADIUS*1.25 = 0.08 hh,
// matching the measured 0.07-0.09 hh.
const float CORE_RADIUS = 0.032;

void main() {
  float aspect = uResolution.x / uResolution.y;
  vec2 p = (vUv - 0.5) * vec2(aspect, 1.0) * 2.0;
  float r = length(p);
  float ang = atan(p.y, p.x);
  vec2 toUv = 1.0 / (vec2(aspect, 1.0) * 2.0);

  vec2 uvUnfolded = p * toUv + 0.5;
  vec3 colUnfolded = texture(uHistTex, uvUnfolded).rgb;
  vec3 col = colUnfolded;

  // Crossfade the two *sampled colours* rather than lerping the sample
  // *positions*: p and its folded counterpart can be far apart in the
  // history texture, so blending positions walks the sample straight
  // through whatever lies between them — a visible tear during the Drift
  // sweep's partial-lens moments. Blending the colours instead always
  // reads as a clean dissolve between "unfolded" and "folded", at any
  // uLens.
  if (uLens > 0.001 && r > LENS_RADIUS) {
    float wedge = 2.0 * PI / max(uFold, 1.0);
    float m = mod(ang + wedge * 0.5, wedge) - wedge * 0.5;
    float mirrored = abs(m);
    // Radial mirror about the ring: a triangle wave in (r - LENS_RADIUS)
    // with period 2*LENS_RADIUS, so the shell just outside the ring shows
    // the annulus just inside it at the same scale, folding again (not
    // compressing toward the centre) for anything further out. Clamped to
    // a small floor so the fold never quite reaches r'=0, where the core's
    // own flat colour would otherwise repeat oddly under it.
    float d = r - LENS_RADIUS;
    float period = 2.0 * LENS_RADIUS;
    float dm = mod(d, period);
    float folded = dm <= LENS_RADIUS ? dm : period - dm;
    float rFolded = max(LENS_RADIUS - folded, LENS_RADIUS * 0.15);
    vec2 lensed = rFolded * vec2(cos(mirrored), sin(mirrored));
    vec3 colFolded = texture(uHistTex, lensed * toUv + 0.5).rgb;
    col = mix(colUnfolded, colFolded, uLens);
  }

  if (uLens > 0.001) {
    // A flat near-black band across the ring's full width, not just a
    // single dark point at r==LENS_RADIUS (a V-shaped falloff reads as a
    // thin line, not the reference's bold, near-black ring).
    float ringDist = abs(r - LENS_RADIUS);
    float ringHalf = LENS_RING_WIDTH * 0.5;
    float ringEdge = max(fwidth(ringDist), 0.004);
    float ring = smoothstep(ringHalf - ringEdge, ringHalf + ringEdge, ringDist);
    col *= mix(1.0, ring, uLens);
  }

  // Glow's minimum stays low so the black ground (between the sparse lit
  // tiles) stays black — the reference's wide glow sits around lit tiles
  // only, not as a frame-wide haze.
  vec3 glow = texture(uGlowTex, vUv).rgb;
  float glowGain = 0.05 + 0.55 * uGlow;
  col += glow * glowGain;

  // Tonemap: 1-exp(-x) is exactly 0 at x=0, so true black in col stays
  // black here — this only compresses the bright end, it never lifts the
  // floor.
  col = 1.0 - exp(-col * 1.1);

  // Constant white core, painted here at display time only — not fed back
  // into the history buffer (see the file header) — and after the tonemap
  // above, so it reads as a crisp blown-out white rather than getting
  // pulled down to grey by the same curve that keeps the rest of the
  // picture from clipping. A soft radial falloff around it (not carried
  // through the glow chain, which only sees the history buffer) gives it a
  // halo instead of a flat cutout square.
  float coreScale = 0.5 + 1.5 * uCore;
  float coreDist = length(p) / max(CORE_RADIUS * coreScale, 1e-4);
  float coreHalo = exp(-coreDist * coreDist * 2.2) * 0.35 * (0.4 + uCore);
  col += coreHalo;
  vec2 coreLocal = p / (CORE_RADIUS * coreScale);
  float coreBox = max(abs(coreLocal.x), abs(coreLocal.y));
  float coreAa = fwidth(coreBox) * 1.5 + 1e-4;
  float coreMask = 1.0 - smoothstep(1.0 - coreAa, 1.0 + coreAa, coreBox);
  col = mix(col, vec3(1.0), coreMask);

  outColor = vec4(col, 1.0);
}
`;

function makeTarget(gl: WebGL2RenderingContext, w: number, h: number): WebGLTexture | null {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

function attachColour(gl: WebGL2RenderingContext, tex: WebGLTexture | null): WebGLFramebuffer | null {
  const f = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, f);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error(`tessera: framebuffer incomplete (0x${status.toString(16)})`);
  }
  return f;
}

/** A NEAREST-filtered RGBA32F data texture, side x side, for the sprite
 *  pool (see SPRITE_VERT). Float texels sample fine via texelFetch in
 *  WebGL2 core with no extension — only LINEAR filtering on a float
 *  texture would need one, and this never filters. */
function makePoolTexture(gl: WebGL2RenderingContext, side: number): WebGLTexture | null {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, side, side, 0, gl.RGBA, gl.FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

function createTesseraScene(): Scene {
  let feedbackProg: GLProgram | null = null;
  let spriteProg: GLProgram | null = null;
  let downsampleProg: GLProgram | null = null;
  let blurProg: GLProgram | null = null;
  let compositeProg: GLProgram | null = null;
  let quadVao: WebGLVertexArrayObject | null = null;
  // The sprite pass has no vertex attributes at all — every sprite is
  // addressed by gl_VertexID into the pool textures — so it draws from an
  // empty VAO, the same idiom as chladni.ts's point pass.
  let spriteVao: WebGLVertexArrayObject | null = null;

  let feedbackPrevLoc: WebGLUniformLocation | null = null;
  let spritePoolALoc: WebGLUniformLocation | null = null;
  let spritePoolBLoc: WebGLUniformLocation | null = null;
  let downsampleTexLoc: WebGLUniformLocation | null = null;
  let blurTexLoc: WebGLUniformLocation | null = null;
  let compositeHistLoc: WebGLUniformLocation | null = null;
  let compositeGlowLoc: WebGLUniformLocation | null = null;

  // Full-drawing-buffer-size ping-pong history — see the file header's RGBA8
  // + rebuild-on-resize policy.
  const histTex: (WebGLTexture | null)[] = [null, null];
  const histFbo: (WebGLFramebuffer | null)[] = [null, null];
  let histW = 0;
  let histH = 0;
  let read = 0;

  // Quarter-res glow chain: downsampled once into glowTex, then blurred
  // through blurTexA/blurTexB, iterated quality.bloomPasses times.
  let glowTex: WebGLTexture | null = null;
  let blurTexA: WebGLTexture | null = null;
  let blurTexB: WebGLTexture | null = null;
  let glowFbo: WebGLFramebuffer | null = null;
  let blurFboA: WebGLFramebuffer | null = null;
  let blurFboB: WebGLFramebuffer | null = null;
  let glowW = 0;
  let glowH = 0;

  // Sprite pool state — see the file header's Sprite pool section.
  let pool: Sprite[] = [];
  let cap = SPRITE_CAP;
  let poolSide = 1;
  let poolDataA = new Float32Array(4);
  let poolDataB = new Float32Array(4);
  let poolTexA: WebGLTexture | null = null;
  let poolTexB: WebGLTexture | null = null;
  // One continuous-emission accumulator per spoke-pair (see
  // advanceContinuousEmission) and a countdown for Burst's rate bump (see
  // SPRITE_BURST_BUMP_SEC).
  let spokeAccum = new Float64Array(SPRITE_SPOKES / 2);
  let burstBoostTimer = 0;

  const bandsBuf = new Float32Array(NUM_BANDS);
  let barCounter = createBarCounterState();
  let hueOffset = 0;
  let lensDriftPhaseSec = 0;
  let freeBurst = createFreeBurstState();
  let burstHold = createBurstHoldState();

  function freeHistoryTargets(gl: WebGL2RenderingContext): void {
    for (let i = 0; i < 2; i++) {
      if (histFbo[i]) gl.deleteFramebuffer(histFbo[i]);
      if (histTex[i]) gl.deleteTexture(histTex[i]);
      histFbo[i] = null;
      histTex[i] = null;
    }
    histW = 0;
    histH = 0;
  }

  /** Rebuilds the ping-pong history when the drawing buffer changes size —
   *  checked every frame because the quality governor moves renderScale at
   *  runtime (same policy as ensureGlowTargets below, and powder.ts's own
   *  ensureGlowTargets it's copied from). */
  function ensureHistoryTargets(gl: WebGL2RenderingContext): void {
    const w = Math.max(1, gl.drawingBufferWidth);
    const h = Math.max(1, gl.drawingBufferHeight);
    if (w === histW && h === histH && histFbo[0] && histFbo[1]) return;
    freeHistoryTargets(gl);
    for (let i = 0; i < 2; i++) {
      histTex[i] = makeTarget(gl, w, h);
      histFbo[i] = attachColour(gl, histTex[i]);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    histW = w;
    histH = h;
    read = 0;
  }

  function freeGlowTargets(gl: WebGL2RenderingContext): void {
    if (glowFbo) gl.deleteFramebuffer(glowFbo);
    if (blurFboA) gl.deleteFramebuffer(blurFboA);
    if (blurFboB) gl.deleteFramebuffer(blurFboB);
    if (glowTex) gl.deleteTexture(glowTex);
    if (blurTexA) gl.deleteTexture(blurTexA);
    if (blurTexB) gl.deleteTexture(blurTexB);
    glowFbo = null;
    blurFboA = null;
    blurFboB = null;
    glowTex = null;
    blurTexA = null;
    blurTexB = null;
    glowW = 0;
    glowH = 0;
  }

  function ensureGlowTargets(gl: WebGL2RenderingContext): void {
    const w = Math.max(1, gl.drawingBufferWidth >> 2);
    const h = Math.max(1, gl.drawingBufferHeight >> 2);
    if (w === glowW && h === glowH && glowFbo) return;
    freeGlowTargets(gl);
    glowTex = makeTarget(gl, w, h);
    blurTexA = makeTarget(gl, w, h);
    blurTexB = makeTarget(gl, w, h);
    glowFbo = attachColour(gl, glowTex);
    blurFboA = attachColour(gl, blurTexA);
    blurFboB = attachColour(gl, blurTexB);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    glowW = w;
    glowH = h;
  }

  function freePoolTargets(gl: WebGL2RenderingContext): void {
    if (poolTexA) gl.deleteTexture(poolTexA);
    if (poolTexB) gl.deleteTexture(poolTexB);
    poolTexA = null;
    poolTexB = null;
  }

  return {
    id: ID,
    name: "Tessera",
    minQuality: "low",
    settings: SETTINGS,

    init(ctx: SceneContext) {
      const { gl } = ctx;
      feedbackProg = createProgram(gl, FEEDBACK_FRAG);
      spriteProg = createProgram(gl, SPRITE_FRAG, SPRITE_VERT);
      downsampleProg = createProgram(gl, DOWNSAMPLE_FRAG);
      blurProg = createProgram(gl, BLUR_FRAG);
      compositeProg = createProgram(gl, COMPOSITE_FRAG);
      feedbackPrevLoc = gl.getUniformLocation(feedbackProg.program, "uPrevTex");
      spritePoolALoc = gl.getUniformLocation(spriteProg.program, "uPoolA");
      spritePoolBLoc = gl.getUniformLocation(spriteProg.program, "uPoolB");
      downsampleTexLoc = gl.getUniformLocation(downsampleProg.program, "uTex");
      blurTexLoc = gl.getUniformLocation(blurProg.program, "uTex");
      compositeHistLoc = gl.getUniformLocation(compositeProg.program, "uHistTex");
      compositeGlowLoc = gl.getUniformLocation(compositeProg.program, "uGlowTex");
      quadVao = createFullscreenQuad(gl);
      spriteVao = gl.createVertexArray();

      cap = Math.max(1, Math.min(SPRITE_CAP, Math.floor(ctx.quality.maxParticles)));
      poolSide = Math.max(1, Math.ceil(Math.sqrt(cap)));
      poolDataA = new Float32Array(poolSide * poolSide * 4);
      poolDataB = new Float32Array(poolSide * poolSide * 4);
      freePoolTargets(gl);
      poolTexA = makePoolTexture(gl, poolSide);
      poolTexB = makePoolTexture(gl, poolSide);
      gl.bindTexture(gl.TEXTURE_2D, null);

      read = 0;
      barCounter = createBarCounterState();
      hueOffset = 0;
      lensDriftPhaseSec = 0;
      freeBurst = createFreeBurstState();
      burstHold = createBurstHoldState();
      burstBoostTimer = 0;
      spokeAccum = new Float64Array(SPRITE_SPOKES / 2);
      pool = [];
      preseedPool(
        pool,
        cap,
        spokeAccum,
        settingFor("density").default,
        settingFor("trickle").default,
        settingFor("gates").default,
        settingFor("inflow").default,
        settingFor("spin").default,
        settingFor("tiling").default / TILING_CALIBRATION,
      );
    },

    render(ctx, frame, viewport, palette, anim) {
      if (
        !feedbackProg ||
        !spriteProg ||
        !downsampleProg ||
        !blurProg ||
        !compositeProg ||
        !quadVao ||
        !spriteVao ||
        !poolTexA ||
        !poolTexB
      ) {
        return;
      }
      const { gl } = ctx;
      ensureHistoryTargets(gl);
      ensureGlowTargets(gl);

      const dt = anim.dtSec;
      const inflowS = resolveSceneSetting(ID, settingFor("inflow"));
      const spinS = resolveSceneSetting(ID, settingFor("spin"));
      const densityS = resolveSceneSetting(ID, settingFor("density"));
      const burstS = resolveSceneSetting(ID, settingFor("burst"));
      const trickleS = resolveSceneSetting(ID, settingFor("trickle"));
      const pastelS = resolveSceneSetting(ID, settingFor("pastel"));
      const tilingS = resolveSceneSetting(ID, settingFor("tiling"));
      const gatesS = resolveSceneSetting(ID, settingFor("gates"));

      // Beat-grid burst request, with a free-running fallback while
      // tempoLock is low, both gated through the same tempo-derived hold
      // (see the file header's Sync section).
      const freeWrapped = advanceFreeBurst(freeBurst, dt);
      const requested = anim.onset || (anim.tempoLock < FREE_BURST_TEMPO_LOCK_MAX && freeWrapped);
      const fired = advanceBurstHold(burstHold, dt, requested, frame.bpm, anim.tempoLock);

      // Bar counter -> hue stepper, slewed toward its target.
      advanceBarCounter(barCounter, anim.barPhase);
      const hueDriftS = resolveSceneSetting(ID, settingFor("hueDrift"));
      const hueTarget = hueStepTarget(barCounter.bars, hueDriftS);
      hueOffset = slewToward(hueOffset, hueTarget, 0.3, dt);

      // Lens: Drift's scripted sweep adds on top of the (usually-zero)
      // resolved Lens value, so an explicit Lens=1 override still reads as
      // fully lensed regardless of where the timer sits.
      lensDriftPhaseSec += dt;
      const driftOn = resolveSceneSetting(ID, settingFor("drift")) > 0.5;
      const lensBase = resolveSceneSetting(ID, settingFor("lens"));
      const lensValue = Math.min(1, lensBase + (driftOn ? lensDriftEnvelope(lensDriftPhaseSec) : 0));

      // --- sprite pool: advect, cull, emit ---
      // Continuous emission is the baseline (report.md counts the echo
      // rings as density *modulations* within an otherwise steady field,
      // not isolated bands): Trickle scales the physically-derived
      // per-column rate (spokeColumnRate), Burst rides a short rate bump on
      // top of it right on the beat, and Density is a master scale on both
      // — see the file header's Sprite pool section.
      const tilingScale = tilingS / TILING_CALIBRATION;
      advectPool(pool, dt, inflowS, spinS);
      burstBoostTimer = Math.max(0, burstBoostTimer - dt);
      if (fired) burstBoostTimer = SPRITE_BURST_BUMP_SEC;
      const burstBoost = burstBoostTimer > 0 ? 1 + 2 * burstS : 1;
      const ratePerSpoke = spokeColumnRate(inflowS) * trickleS * densityS * burstBoost;
      advanceContinuousEmission(pool, cap, spokeAccum, dt, ratePerSpoke, gatesS, hueOffset, tilingScale);

      const aliveCount = pool.length;
      for (let i = 0; i < aliveCount; i++) {
        const sp = pool[i]!;
        const o = i * 4;
        poolDataA[o] = sp.r;
        poolDataA[o + 1] = sp.angle;
        poolDataA[o + 2] = sp.sizeHH;
        poolDataA[o + 3] = sp.shape;
        poolDataB[o] = Math.min(1, sp.ageSec / SPRITE_FADE_IN_SEC);
        poolDataB[o + 1] = sp.huePos;
        poolDataB[o + 2] = sp.highlight;
        poolDataB[o + 3] = sp.aspect;
      }
      gl.bindTexture(gl.TEXTURE_2D, poolTexA);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, poolSide, poolSide, 0, gl.RGBA, gl.FLOAT, poolDataA);
      gl.bindTexture(gl.TEXTURE_2D, poolTexB);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, poolSide, poolSide, 0, gl.RGBA, gl.FLOAT, poolDataB);

      gl.disable(gl.BLEND);

      // --- pass 1: feedback (warp + short streak + decay only) ---
      const write = 1 - read;
      gl.bindFramebuffer(gl.FRAMEBUFFER, histFbo[write]);
      gl.viewport(0, 0, histW, histH);
      feedbackProg.use();
      uploadCommonUniforms(feedbackProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf);
      feedbackProg.setF("uDt", dt);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, histTex[read]);
      gl.uniform1i(feedbackPrevLoc, 0);
      drawFullscreenQuad(gl, quadVao);

      // --- pass 1b: sprites, drawn crisp on top, premultiplied-over ---
      spriteProg.use();
      spriteProg.setF("uSide", poolSide);
      spriteProg.setV2("uResolution", gl.drawingBufferWidth, gl.drawingBufferHeight);
      spriteProg.setF("uPastel", pastelS);
      const pv = paletteVecs(palette);
      spriteProg.setV3v("uPalA", pv.a);
      spriteProg.setV3v("uPalB", pv.b);
      spriteProg.setV3v("uPalC", pv.c);
      spriteProg.setV3v("uPalD", pv.d);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, poolTexA);
      gl.uniform1i(spritePoolALoc, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, poolTexB);
      gl.uniform1i(spritePoolBLoc, 1);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindVertexArray(spriteVao);
      gl.drawArrays(gl.POINTS, 0, aliveCount);
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);

      read = write;

      // --- pass 2: glow (downsample, then separable blur) ---
      gl.bindFramebuffer(gl.FRAMEBUFFER, glowFbo);
      gl.viewport(0, 0, glowW, glowH);
      downsampleProg.use();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, histTex[read]);
      gl.uniform1i(downsampleTexLoc, 0);
      downsampleProg.setV2("uTexel", 1 / histW, 1 / histH);
      drawFullscreenQuad(gl, quadVao);

      let glowSrc = glowTex;
      const passes = Math.max(1, Math.min(3, ctx.quality.bloomPasses));
      blurProg.use();
      for (let i = 0; i < passes; i++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, blurFboA);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, glowSrc);
        gl.uniform1i(blurTexLoc, 0);
        blurProg.setV2("uBlurStep", 1 / glowW, 0);
        drawFullscreenQuad(gl, quadVao);

        gl.bindFramebuffer(gl.FRAMEBUFFER, blurFboB);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, blurTexA);
        gl.uniform1i(blurTexLoc, 0);
        blurProg.setV2("uBlurStep", 0, 1 / glowH);
        drawFullscreenQuad(gl, quadVao);

        glowSrc = blurTexB;
      }

      // Both hosts (app.ts / tv.ts) size the viewport to the drawing buffer
      // and only re-set it on resize; the gallery preview sets it per
      // frame. Either way the drawing buffer is the right thing to restore
      // to before the on-screen composite (same reasoning as chladni.ts's
      // sim pass).
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);

      // --- pass 3: composite ---
      compositeProg.use();
      uploadCommonUniforms(compositeProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf);
      compositeProg.setF(settingUniformName("lens"), lensValue);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, histTex[read]);
      gl.uniform1i(compositeHistLoc, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, glowSrc);
      gl.uniform1i(compositeGlowLoc, 1);
      drawFullscreenQuad(gl, quadVao);

      // The gallery renders every scene into one shared context each tick —
      // must not leak a bound texture onto the next tile.
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, null);
    },

    dispose(ctx: SceneContext) {
      const { gl } = ctx;
      feedbackProg?.dispose();
      spriteProg?.dispose();
      downsampleProg?.dispose();
      blurProg?.dispose();
      compositeProg?.dispose();
      if (quadVao) gl.deleteVertexArray(quadVao);
      if (spriteVao) gl.deleteVertexArray(spriteVao);
      freeHistoryTargets(gl);
      freeGlowTargets(gl);
      freePoolTargets(gl);
      feedbackProg = null;
      spriteProg = null;
      downsampleProg = null;
      blurProg = null;
      compositeProg = null;
      quadVao = null;
      spriteVao = null;
      feedbackPrevLoc = null;
      spritePoolALoc = null;
      spritePoolBLoc = null;
      downsampleTexLoc = null;
      blurTexLoc = null;
      compositeHistLoc = null;
      compositeGlowLoc = null;
      read = 0;
      barCounter = createBarCounterState();
      hueOffset = 0;
      lensDriftPhaseSec = 0;
      freeBurst = createFreeBurstState();
      burstHold = createBurstHoldState();
      burstBoostTimer = 0;
      spokeAccum = new Float64Array(SPRITE_SPOKES / 2);
      pool = [];
    },
  };
}

export const tesseraScene = createTesseraScene();
