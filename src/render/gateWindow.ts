/**
 * The generic gate window, and the Fixed/Loud height envelope for a catalogue
 * hit. Two users share this one copy: a setting's own generic gate (drives.ts
 * accumulate() and forScene()) and a shaping node (shapingNodes.ts). It holds
 * the gate tracker (a floor that follows the input's resting level, and a peak
 * that jumps up and eases back down), the window's knee math (windowReading),
 * the generic defaults for Min, Max and Smoothness, and stepHeightEnv, the
 * Fixed/Loud envelope a hit-kind catalogue entry gets, with the lane and decay
 * rate each entry borrows from its own pulse.
 *
 * It is its own module because shapingNodes.ts is read at load by its store,
 * and drives.ts imports shapingNodes.ts: if shapingNodes.ts imported a value
 * from drives.ts, the two would form a runtime cycle. Both import this file
 * instead. This file imports nothing from drives.ts or shapingNodes.ts.
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

/** The generic engine gate's knee-width default (driveStore.ts's
 *  getDriveSmoothness; the knee itself is windowReading's) — the resting
 *  position of the Smoothness slider, and the knee every generic setting has
 *  always had. A scene-handled threshold never reads it. */
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
// How far Smoothness widens the window at each end (windowReading below): a
// fraction of the tracker's own floor-to-peak spread, with a minimum so a
// dead-flat signal (peak == floor) still has *some* knee rather than a hard
// step. The fraction is the generic gate's Smoothness setting
// (driveStore.ts getDriveSmoothness, 0..1) scaled by GATE_KNEE_MAX_FRACTION,
// so the setting's default, GENERIC_SMOOTHNESS_DEFAULT, is the knee every
// generic gate had before the slider existed.
const GATE_KNEE_MAX_FRACTION = 2;
const GATE_KNEE_SPREAD_MIN = 0.1;

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
 *  `peak` back, never advances them itself. A shaping node owns one too,
 *  advanced by stepShapingNode. */
export interface GateTrackerState {
  init: boolean;
  floor: number;
  peak: number;
  /** floor + t·(peak−floor), t the setting's own threshold value — what the
   *  panel's graph draws dotted (SceneDrives.gateLine) and what value()/
   *  fired() gate against. Recomputed every advance, so it's always current
   *  the instant floor/peak move even if the threshold slider itself didn't. */
  line: number;
  /** floor + max(t, tMax)·(peak−floor) — the window's Max line (SceneDrives.gateTop). Never below `line`. */
  top: number;
}

export function createGateTracker(): GateTrackerState {
  return { init: false, floor: 0, peak: 0, line: 0, top: 0 };
}

/** Advances one gate tracker by `dtSec`, given `v` (the input's reading this
 *  tick — the same number value() would give with the gate itself switched
 *  off), `t` (the window's Min slider, 0..1) and `tMax` (the window's Max
 *  slider, 0..1). The first call seeds floor/peak from `v` rather than from 0,
 *  so startup never reads as a signal that's fallen far below a floor of 0. */
export function advanceGateTracker(tr: GateTrackerState, dtSec: number, v: number, t: number, tMax: number): void {
  if (!tr.init) {
    tr.floor = v;
    tr.peak = v;
    tr.init = true;
  } else {
    const floorTau = v < tr.floor ? GATE_FLOOR_DOWN_TAU_SEC : GATE_FLOOR_UP_TAU_SEC;
    tr.floor += (v - tr.floor) * (1 - Math.exp(-dtSec / floorTau));
    tr.peak = v > tr.peak ? v : tr.floor + (tr.peak - tr.floor) * Math.exp(-dtSec / GATE_PEAK_DECAY_TAU_SEC);
  }
  tr.line = tr.floor + clamp01(t) * (tr.peak - tr.floor);
  tr.top = tr.floor + Math.max(clamp01(t), clamp01(tMax)) * (tr.peak - tr.floor);
}

/** The window's reading of `v` (drives.ts's header's threshold paragraph): 0
 *  at or under the Min line, the tracked peak at or over the Max line, and a
 *  straight rise between. `smoothness` (0..1) widens both ends by the knee so
 *  a reading riding the Min line doesn't flicker; 0 is an exact window. */
export function windowReading(tr: GateTrackerState, v: number, smoothness: number): number {
  const k = GATE_KNEE_MAX_FRACTION * smoothness * Math.max(tr.peak - tr.floor, GATE_KNEE_SPREAD_MIN);
  const lo = tr.line - k;
  const hi = tr.top + k;
  if (hi - lo <= 1e-6) return v >= tr.line ? tr.peak : 0;
  return tr.peak * clamp01((v - lo) / (hi - lo));
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
 *  sensitivity-applied broadband level (`driveEnergy`, matching Loudness · All
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
