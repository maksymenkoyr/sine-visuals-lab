/**
 * The generic gate window, and the Fixed/Loud height envelope for a catalogue
 * hit. Two users share this one copy: a setting's own generic gate (drives.ts
 * accumulate() and forScene()) and a wire's modifier (wireMod.ts). It holds
 * the gate tracker (a peak that jumps up and eases back down toward a floor
 * that follows the input's resting level), the window's math
 * (windowReading: Min and Max each run from 0 to that peak, so a window open
 * all the way passes the input on unchanged), Smoothness's formulas
 * (GATE_FORMULAS: a dev build can pick one per setting while PR #544 picks
 * the one to keep, gateFormulas.ts), the generic defaults for Min, Max and
 * Smoothness, and stepHeightEnv, the
 * Fixed/Loud envelope a hit-kind catalogue entry gets, with the lane and decay
 * rate each entry borrows from its own pulse.
 *
 * It is its own module because driveStore.ts and wireMod.ts read it at load,
 * and drives.ts imports both: importing a value from drives.ts here would
 * form a runtime cycle. This file imports nothing from drives.ts.
 */
import { type AnimFrame, BEAT_PULSE_DECAY_PER_SEC } from "./animClock.ts";
import { GROUP_TUNING } from "./bandEnergy.ts";
import type { HitLane } from "../audio/hitStrength.ts";
import { SIGNALS, type SignalId } from "./signals.ts";

/** The generic engine gate's own threshold default (drives.ts's header's
 *  threshold paragraph) — the slider's resting position the one time it's
 *  ever read before a user moves it. Unlike a scene-handled threshold
 *  (SceneSetting.drive.threshold's own `default`), there's one value for
 *  every generic setting, since none of them shaped this gate on purpose the
 *  way a scene-handled setting shapes its own. */
export const GENERIC_THRESHOLD_DEFAULT = 0.25;

/** The generic gate window's Max default (driveStore.ts's getDriveWindowMax) — 1 puts the Max line on the tracked peak, so only a new high reads full. */
export const GENERIC_WINDOW_MAX_DEFAULT = 1;

/** The generic engine gate's Smoothness default (driveStore.ts's
 *  getDriveSmoothness; the window itself is windowReading's) — the resting
 *  position of the Smoothness slider, and the small softening every generic
 *  setting starts with. A scene-handled threshold never reads it. */
export const GENERIC_SMOOTHNESS_DEFAULT = 0.02;

// The generic gate tracker's own time constants (drives.ts's accumulate()) — a
// floor that chases a *lower* resting level quickly (so a quiet moment reads
// as quiet almost at once) but a *higher* one slowly (so one loud passage
// doesn't instantly convince it the room got louder), and a peak that jumps
// to a new high immediately but eases back down toward the floor at the same
// slow rate. Picked to feel like a noise floor, not measured against any
// reference — nothing here plays back a released ring the way
// standout.ts's FLOOR_RELAX_SEC/PEAK_RELAX_SEC do for its own,
// unrelated trackers.
const GATE_FLOOR_DOWN_TAU_SEC = 0.3;
const GATE_FLOOR_UP_TAU_SEC = 4;
const GATE_PEAK_DECAY_TAU_SEC = 4;

/** Smoothness's formulas: how it softens the window (windowReading). Every
 *  one gives the exact window at Smoothness 0. "inside" is the default, and
 *  the only one a production build runs (GATE_FORMULA_DEFAULT); the rest are
 *  candidates a dev build can pick per setting (gateFormulas.ts) while PR
 *  #544 picks which to keep. The same formulas run in the "Gate Smoothness
 *  Lab" artifact. */
export const GATE_FORMULAS = [
  { id: "inside", label: "Widen inside 0 and the peak" },
  { id: "past", label: "Widen past the ends (old)" },
  { id: "corners", label: "Rounded corners" },
  { id: "sticky", label: "Sticky gate" },
  { id: "glide", label: "Glide" },
  { id: "riseFall", label: "Fast rise, slow fall" },
  { id: "smoothFirst", label: "Smooth the signal first" },
] as const;
export type GateFormula = (typeof GATE_FORMULAS)[number]["id"];
export const GATE_FORMULA_DEFAULT: GateFormula = "inside";

// "past": how far each end moves, as a share of the 0→peak range at full
// Smoothness, with a floor on that range so a silent signal still softens
// (the formula before PR #544).
const PAST_REACH = 2;
const PAST_RANGE_MIN = 0.1;
// "corners": each corner's half-width at full Smoothness, as a share of the peak.
const CORNER_REACH = 0.5;
// Time formulas: their easing time at full Smoothness.
const GLIDE_TAU_MAX_SEC = 0.6;
const FALL_TAU_MAX_SEC = 1.2;
const RISE_TAU_SEC = 0.01;
const SMOOTH_FIRST_TAU_MAX_SEC = 0.4;

// matches src/render/sectionIntensity.ts's own DROP_PULSE_DECAY (kept in
// step by hand — that module doesn't export it, same convention as
// LINE_DRIVE_RELEASE_PER_SEC in drives.ts until animClock's own constant was
// exported for GRID_PULSE_DECAY_PER_SEC).
const DROP_PULSE_DECAY_PER_SEC = 2.5;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** One gate tracker (drives.ts's header's threshold paragraph) — drives.ts's
 *  `accumulate()` advances it once per tick, from the setting's own
 *  combined-and-gained value; `forScene()` only ever reads `line`/`floor`/
 *  `peak` back, never advances them itself. A wire's modifier owns one too,
 *  advanced by wireMod.ts's stepWireMod. */
export interface GateTrackerState {
  init: boolean;
  /** Where the peak eases back to: it follows the input's resting level. */
  floor: number;
  peak: number;
  /** t·peak, t the setting's own threshold value — what the panel's graph
   *  draws dotted (SceneDrives.gateLine) and what value()/fired() gate
   *  against. Recomputed every advance, so it's always current the instant
   *  the peak moves even if the threshold slider itself didn't. */
  line: number;
  /** max(t, tMax)·peak — the window's Max line (SceneDrives.gateTop). Never below `line`. */
  top: number;
  /** A time formula's memory (GATE_FORMULAS), stepped by advanceGateTracker:
   *  "sticky"'s open gate, "glide"/"riseFall"'s eased output and
   *  "smoothFirst"'s eased input, the last two NaN until the first step. */
  open: boolean;
  y: number;
  x: number;
}

export function createGateTracker(): GateTrackerState {
  return { init: false, floor: 0, peak: 0, line: 0, top: 0, open: false, y: Number.NaN, x: Number.NaN };
}

/** Advances one gate tracker by `dtSec`, given `v` (the input's reading this
 *  tick — the same number value() would give with the gate itself switched
 *  off), `t` (the window's Min slider, 0..1) and `tMax` (the window's Max
 *  slider, 0..1), then steps the time formula `formula` at Smoothness `s`.
 *  The first call seeds floor/peak from `v` rather than from 0, so startup
 *  never reads as a signal that's fallen far below a floor of 0. */
export function advanceGateTracker(tr: GateTrackerState, dtSec: number, v: number, t: number, tMax: number, formula: GateFormula = GATE_FORMULA_DEFAULT, s = 0): void {
  if (!tr.init) {
    tr.floor = v;
    tr.peak = v;
    tr.init = true;
  } else {
    const floorTau = v < tr.floor ? GATE_FLOOR_DOWN_TAU_SEC : GATE_FLOOR_UP_TAU_SEC;
    tr.floor += (v - tr.floor) * (1 - Math.exp(-dtSec / floorTau));
    tr.peak = v > tr.peak ? v : tr.floor + (tr.peak - tr.floor) * Math.exp(-dtSec / GATE_PEAK_DECAY_TAU_SEC);
  }
  tr.line = clamp01(t) * tr.peak;
  tr.top = Math.max(clamp01(t), clamp01(tMax)) * tr.peak;
  switch (formula) {
    case "sticky":
      if (tr.open) {
        if (v < tr.line * (1 - s)) tr.open = false;
      } else if (v >= tr.line) tr.open = true;
      return;
    case "glide": {
      const target = exactReading(tr, v);
      tr.y = Number.isFinite(tr.y) ? ease(tr.y, target, s * GLIDE_TAU_MAX_SEC, dtSec) : target;
      return;
    }
    case "riseFall": {
      const target = exactReading(tr, v);
      tr.y = Number.isFinite(tr.y) ? ease(tr.y, target, target > tr.y ? RISE_TAU_SEC : s * FALL_TAU_MAX_SEC, dtSec) : target;
      return;
    }
    case "smoothFirst":
      tr.x = Number.isFinite(tr.x) ? ease(tr.x, v, s * SMOOTH_FIRST_TAU_MAX_SEC, dtSec) : v;
      return;
    default:
      return;
  }
}

/** The window's reading of `v` (drives.ts's header's threshold paragraph): 0
 *  at or under the Min line, the tracked peak at or over the Max line, and a
 *  straight rise between. `smoothness` (0..1) softens it by `formula`
 *  (GATE_FORMULAS); 0 is an exact window. The default formula moves the Min
 *  line toward 0 and the Max line toward the peak, by that share of the room
 *  on each side and never past them, so silence still reads 0 and a new high
 *  still reads the peak. A time formula only reads the memory
 *  advanceGateTracker stepped, since value() may run more than once a frame. */
export function windowReading(tr: GateTrackerState, v: number, smoothness: number, formula: GateFormula = GATE_FORMULA_DEFAULT): number {
  const s = smoothness;
  switch (formula) {
    case "past": {
      const k = PAST_REACH * s * Math.max(tr.peak, PAST_RANGE_MIN);
      return rise(tr, v, tr.line - k, tr.top + k);
    }
    case "corners":
      return tr.peak * cornersFrac(tr, v, CORNER_REACH * s * tr.peak);
    case "sticky":
      return tr.open ? rise(tr, v, tr.line * (1 - s), tr.top) : 0;
    case "glide":
    case "riseFall":
      return Number.isFinite(tr.y) ? tr.y : exactReading(tr, v);
    case "smoothFirst":
      return exactReading(tr, Number.isFinite(tr.x) ? tr.x : v);
    default:
      return rise(tr, v, tr.line * (1 - s), tr.top + s * (tr.peak - tr.top));
  }
}

// 0 at or under `lo`, the peak at or over `hi`, a straight rise between; a
// step at the Min line when the two meet.
function rise(tr: GateTrackerState, v: number, lo: number, hi: number): number {
  if (hi - lo <= 1e-6) return v >= tr.line ? tr.peak : 0;
  return tr.peak * clamp01((v - lo) / (hi - lo));
}

function exactReading(tr: GateTrackerState, v: number): number {
  return rise(tr, v, tr.line, tr.top);
}

// A compressor-style soft corner `k` wide on each side of 0.
function softRamp(x: number, k: number): number {
  if (k <= 0) return Math.max(0, x);
  if (x < -k) return 0;
  if (x > k) return x;
  return ((x + k) * (x + k)) / (4 * k);
}

// The window with both corners rounded `k` wide.
function cornersFrac(tr: GateTrackerState, v: number, k: number): number {
  const w = tr.top - tr.line;
  if (w > 1e-6) return clamp01((softRamp(v - tr.line, k) - softRamp(v - tr.top, k)) / w);
  if (k <= 0) return v >= tr.line ? 1 : 0;
  return clamp01((v - tr.line + k) / (2 * k));
}

function ease(y: number, target: number, tau: number, dtSec: number): number {
  return tau <= 0 ? target : y + (target - y) * (1 - Math.exp(-dtSec / tau));
}

/** The Smoothness that counts as an edit when there is no window to soften:
 *  what the slider holds above its resting value, GENERIC_SMOOTHNESS_DEFAULT,
 *  so a wire nobody touched still reads its plain value. */
export function glideSmoothness(smoothness: number): number {
  return Math.max(0, smoothness - GENERIC_SMOOTHNESS_DEFAULT);
}

/** One step of a window-less wire's Smoothness: `y` eases toward `target`,
 *  rising and falling alike, over up to GLIDE_TAU_MAX_SEC at full `s`
 *  (glideSmoothness). */
export function glideStep(y: number, target: number, s: number, dtSec: number): number {
  return Number.isFinite(y) ? ease(y, target, s * GLIDE_TAU_MAX_SEC, dtSec) : target;
}

/** Which Length row (AnimFrame.hitTail) stretches a hit-kind source's
 *  Fixed/Loud release — the lane whose pulse edgeDecayPerSec below borrows
 *  its rate from. Null for Drop: its slow pulse (sectionIntensity.ts) is a
 *  section swell, not a hit's ring-out, so no Length row stretches it. */
function edgeTailLane(id: SignalId): HitLane | null {
  switch (id) {
    case "anim.lowOnset":
      return "low";
    case "anim.midOnset":
      return "mid";
    case "anim.highOnset":
      return "high";
    case "anim.dropOnset":
      return null;
    default:
      return "beat"; // Any hit and the metronome, timed like beatPulse
  }
}

/** Fixed/Loud's own release rate for a hit-kind catalogue entry — reused
 *  directly from the module that owns the Graded pulse it stands in for
 *  (drives.ts's header). Only ever called for an edge-kind catalogue entry. */
function edgeDecayPerSec(id: SignalId): number {
  switch (id) {
    case "feature.onset":
      return BEAT_PULSE_DECAY_PER_SEC;
    case "anim.lowOnset":
      return GROUP_TUNING.low.pulseDecayRate;
    case "anim.midOnset":
      return GROUP_TUNING.mid.pulseDecayRate;
    case "anim.highOnset":
      return GROUP_TUNING.high.pulseDecayRate;
    case "anim.dropOnset":
      return DROP_PULSE_DECAY_PER_SEC;
    case "anim.metronome":
    case "anim.metronomeBar":
      return BEAT_PULSE_DECAY_PER_SEC; // matches animClock.ts's own metronomePulse/metronomeBarPulse decay
    default:
      return BEAT_PULSE_DECAY_PER_SEC; // unreached — every edge-kind SignalId is listed above
  }
}

/** Loud height's own target on a hit-kind catalogue entry's edge — "that band
 *  group's level" (drives.ts's header): the group's own slewed level for a
 *  band onset, sectionIntensity's trend for Drop (its own composite
 *  "loudness" — Drop has no group level of its own to read), and the
 *  sensitivity-applied broadband level (`driveEnergy`, matching Level
 *  exactly) for Any hit and the metronome (Metronome/Metronome bar), since
 *  none of those is band-specific. */
function edgeLoudLevel(id: SignalId, anim: AnimFrame, driveEnergy: number): number {
  switch (id) {
    case "anim.lowOnset":
      return anim.low;
    case "anim.midOnset":
      return anim.mid;
    case "anim.highOnset":
      return anim.high;
    case "anim.dropOnset":
      return anim.sectionIntensity;
    case "anim.metronome":
    case "anim.metronomeBar":
      return driveEnergy; // same broadband level as "feature.onset" (Any hit)
    default:
      return driveEnergy; // "feature.onset" (Any hit) and unreached edge cases
  }
}

/** One step of a hit-kind catalogue entry's height envelope (drives.ts's
 *  header, "Heights"): decays `env` at the entry's own pulse rate, stretched by
 *  its Length row, and on an edge lifts it to 1 (Fixed) or to the entry's
 *  Loud level. Returns the new envelope. */
export function stepHeightEnv(env: number, id: SignalId, height: "fixed" | "loud", dtSec: number, anim: AnimFrame, driveEnergy: number): number {
  const lane = edgeTailLane(id);
  const rate = edgeDecayPerSec(id) * (lane === null ? 1 : anim.hitTail[lane]);
  let out = env * Math.exp(-dtSec * rate);
  if (SIGNALS[id].edge!(anim)) out = Math.max(out, height === "fixed" ? 1 : edgeLoudLevel(id, anim, driveEnergy));
  return out;
}
