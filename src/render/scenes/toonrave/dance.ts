/**
 * Dance: turns any signal into a move for the cast, and Energy into how fast
 * they go through it. Pure (no wall clock, no DOM); index.ts steps it per frame
 * and motion.ts draws the result through the groove's own poses.
 *
 * Three parts, each a plain object:
 *
 *   - createDance(): finds a beat in the signal's fires and learns the move.
 *     The tempo comes from tempoComb.ts's estimateTempo over the recent fires
 *     and the phase from beatClock.ts's phase comb at that tempo (the same two
 *     pieces the app's own tempo tracker uses on the music, reused unchanged).
 *     The move is the signal itself folded over one bar of that beat: every
 *     frame the signal's value is averaged into the MOVE_BINS slot at the
 *     clock's bar position, so after a few bars the loop is the signal's
 *     average shape through a bar (a kick learns four sharp peaks, a hi-hat its
 *     off-beat ticks, a breakbeat its own pattern). at() reads that loop
 *     smoothed and stretched to 0..1; a loop flatter than FLAT_RANGE reads 0.
 *     While the beat is "holding" (no fire for HOLD_BEATS) nothing is learned:
 *     silence keeps the last move. Learning the quiet used to reshape the
 *     stretched loop under a stopped cast (a held pose drifting) and then flatten
 *     it (the pose snapping to 0), all with no music.
 *   - createEnergy(): base, boost, pump and drop, as Caustics' Drift speed
 *     family does speed: the floor is base + boost × the boost signal's level,
 *     each pump hit kicks energy up, and above the floor it drains back at a
 *     rate proportional to how far above it is (so slower the lower it gets).
 *   - createPlayhead(): Energy → speed through the move. Speed snaps to the
 *     on-beat steps in SPEED_STEPS (stop, ¼, ½, 1, 2 times the found beat),
 *     picked from energy smoothed over STEP_ENERGY_SMOOTH_SEC (a pump swings it
 *     every beat), so the move always lands on the music; the position at a step is
 *     frac(bars × multiple), a pure function of the beat clock. A change of step
 *     crossfades over half a beat; "stop" holds where the last step left off.
 */
import { createBeatClock } from "../../beatClock.ts";
import { estimateTempo, BPM_MIN, BPM_MAX, type TempoOnsetVote } from "../../../audio/tempoComb.ts";

/** Slots in the learned one-bar move. */
export const MOVE_BINS = 64;
/** Beats in the bar the move is learned over (and in beatClock's barPhase). */
const BAR_BEATS = 4;
/** How long the fires a tempo is estimated from are kept. */
const FIRE_WINDOW_SEC = 8;
// estimateTempo's options for fires timed to the render tick (features.ts's own
// tolerances for the same kind of onset times), with the fixed-hop analyser's
// recency fade so the estimate follows a new signal's tempo quickly.
const TEMPO_OPTS = {
  tolSec: 0.05,
  refineTolSec: 0.025,
  recencySec: 3,
  switchMargin: 1.25,
  periodStepSec: 0.0025,
  bpmMin: BPM_MIN,
  bpmMax: BPM_MAX,
};
/** How fast a slot learns while the playhead passes it, per second. */
const LEARN_RATE_PER_SEC = 7;
/** A learned loop whose range is below this has no move in it (reads 0). */
const FLAT_RANGE = 0.04;
/** No fire for this many beats: the beat is "holding" (kept, not confirmed). */
const HOLD_BEATS = 3;

export type DanceStatus = "none" | "finding" | "locked" | "holding";

export interface Dance {
  /** Advance by dtSec with this frame's fire and the signal's value (0..1). */
  step(dtSec: number, fired: boolean, value: number): void;
  /** The found tempo, 0 before any. */
  readonly bpm: number;
  /** Beats elapsed on the found beat (free-running, nudged toward the fires). */
  readonly beats: number;
  status(): DanceStatus;
  /** The learned move at bar position p (any real; wraps), 0..1. */
  at(p: number): number;
  /** The learned loop, smoothed and stretched to 0..1 (MOVE_BINS long). */
  readonly shape: Float32Array;
  reset(): void;
}

const frac = (x: number): number => x - Math.floor(x);

export function createDance(): Dance {
  let clock = createBeatClock();
  let t = 0;
  let bpm = 0;
  let lastFire = -Infinity;
  let fires: TempoOnsetVote[] = [];
  const raw = new Float32Array(MOVE_BINS);
  const shape = new Float32Array(MOVE_BINS);
  let lastBin = -1;

  function rebuild(): void {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < MOVE_BINS; i++) {
      // a small circular blur, so the loop reads as a move rather than a staircase
      let s = 0;
      let w = 0;
      for (let k = -2; k <= 2; k++) {
        const kw = 3 - Math.abs(k);
        s += kw * raw[(i + k + MOVE_BINS) % MOVE_BINS];
        w += kw;
      }
      shape[i] = s / w;
      if (shape[i] < lo) lo = shape[i];
      if (shape[i] > hi) hi = shape[i];
    }
    const range = hi - lo;
    for (let i = 0; i < MOVE_BINS; i++) shape[i] = range < FLAT_RANGE ? 0 : (shape[i] - lo) / range;
  }

  const d: Dance = {
    step(dtSec, fired, value) {
      const dt = Math.max(0, dtSec);
      t += dt;
      if (fired) {
        lastFire = t;
        fires.push({ time: t, weight: 1 });
        while (fires.length && fires[0].time < t - FIRE_WINDOW_SEC) fires.shift();
        const est = estimateTempo(fires, t, bpm, TEMPO_OPTS);
        if (est !== null) bpm = est;
      }
      clock.advance(dt, bpm, fired);
      if (clock.bpm <= 0) return;
      // learn: every slot the playhead crossed this frame moves toward the value
      const bin = Math.floor(frac(clock.beats / BAR_BEATS) * MOVE_BINS) % MOVE_BINS;
      if (d.status() === "holding") {
        lastBin = bin; // silence teaches nothing (see the header)
        return;
      }
      const a = 1 - Math.exp(-LEARN_RATE_PER_SEC * dt);
      const v = Math.min(1, Math.max(0, value));
      if (lastBin < 0) lastBin = bin;
      const span = (bin - lastBin + MOVE_BINS) % MOVE_BINS;
      for (let k = span === 0 ? 0 : 1; k <= span; k++) {
        const i = (lastBin + k) % MOVE_BINS;
        raw[i] += (v - raw[i]) * a;
      }
      lastBin = bin;
      rebuild();
    },
    get bpm() {
      return clock.bpm;
    },
    get beats() {
      return clock.beats;
    },
    status() {
      if (clock.bpm <= 0) return "none";
      if ((t - lastFire) * (clock.bpm / 60) > HOLD_BEATS) return "holding";
      return clock.tempoLock > 0.5 ? "locked" : "finding";
    },
    at(p) {
      const x = frac(p) * MOVE_BINS;
      const i = Math.floor(x) % MOVE_BINS;
      const f = x - Math.floor(x);
      return shape[i] * (1 - f) + shape[(i + 1) % MOVE_BINS] * f;
    },
    shape,
    reset() {
      clock = createBeatClock();
      t = 0;
      bpm = 0;
      lastFire = -Infinity;
      fires = [];
      raw.fill(0);
      shape.fill(0);
      lastBin = -1;
    },
  };
  return d;
}

/** The most energy there is (the speed steps sit below it). */
export const MAX_ENERGY = 1.5;
/** One pump hit at full Energy pump adds this much energy. */
const PUMP_KICK = 0.2;
/** How fast energy rises to a floor above it, per second. */
const RISE_PER_SEC = 8;

export interface EnergyInputs {
  /** The Energy slider: where energy settles with no signal. */
  base: number;
  /** The Energy boost slider, and its signal's level (0..1). */
  boost: number;
  level: number;
  /** The Energy pump slider, and whether its signal fired this frame. */
  pump: number;
  pumpFired: boolean;
  /** The Energy drop slider (0..1): how fast energy drains to the floor. */
  drop: number;
}

export interface Energy {
  step(dtSec: number, inp: EnergyInputs): void;
  readonly value: number;
  /** base + boost × level this frame: what energy drains toward. */
  readonly floor: number;
  reset(): void;
}

export function createEnergy(): Energy {
  let e = 0;
  let floor = 0;
  return {
    step(dtSec, inp) {
      const dt = Math.max(0, dtSec);
      floor = Math.min(MAX_ENERGY, Math.max(0, inp.base + inp.boost * Math.min(1, Math.max(0, inp.level))));
      if (inp.pumpFired) e += inp.pump * PUMP_KICK;
      if (e < floor) e += (floor - e) * Math.min(1, dt * RISE_PER_SEC);
      else e -= (e - floor) * Math.min(1, dt * drainPerSec(inp.drop));
      e = Math.min(MAX_ENERGY, Math.max(0, e));
    },
    get value() {
      return e;
    },
    get floor() {
      return floor;
    },
    reset() {
      e = 0;
      floor = 0;
    },
  };
}

/** Energy drop's slider (0..1) → the drain rate per second of the height above the floor. */
export function drainPerSec(drop: number): number {
  return 0.12 + 2.2 * drop * drop;
}

/** The on-beat speeds through the move, and the energy each starts at. */
export const SPEED_STEPS: readonly { at: number; multiple: number; name: string }[] = [
  { at: 0, multiple: 0, name: "stop" },
  { at: 0.05, multiple: 0.25, name: "¼×" },
  { at: 0.2, multiple: 0.5, name: "½×" },
  { at: 0.45, multiple: 1, name: "1×" }, // a steady kick at the default pump sits around 0.6
  { at: 0.9, multiple: 2, name: "2×" },
];
/** How far energy must clear a step's line to change step (so it doesn't flicker). */
const STEP_HYSTERESIS = 0.04;
/** The step follows energy smoothed over about this long: a pump swings energy
 *  up and down every beat, and the speed must not change with every kick. */
const STEP_ENERGY_SMOOTH_SEC = 1.2;
/** A change of step crossfades over this many beats. */
const CROSSFADE_BEATS = 0.5;

/** The speed step for `energy`, starting from `current` (with hysteresis). */
export function pickSpeedStep(energy: number, current: number): number {
  let s = Math.max(0, Math.min(SPEED_STEPS.length - 1, current));
  while (s + 1 < SPEED_STEPS.length && energy > SPEED_STEPS[s + 1].at + STEP_HYSTERESIS) s++;
  while (s > 0 && energy < SPEED_STEPS[s].at - STEP_HYSTERESIS) s--;
  return s;
}

export interface Playhead {
  /** Pick the step for this frame's energy; `bars` is the found beat in bars. */
  update(dtSec: number, energy: number, bars: number, beatSec: number): void;
  /** The move's value at the playhead, `offsetBars` along the move (crossfaded). */
  value(dance: Dance, bars: number, offsetBars?: number): number;
  /** Where the playhead is in the move (0..1) at the current step. */
  position(bars: number): number;
  readonly step: number;
  reset(): void;
}

export function createPlayhead(): Playhead {
  let from = 0;
  let to = 0;
  let w = 1;
  let held = 0;
  let smooth = 0;
  const posAt = (s: number, bars: number): number => {
    const m = SPEED_STEPS[s].multiple;
    return m === 0 ? held : frac(bars * m);
  };
  return {
    update(dtSec, energy, bars, beatSec) {
      smooth += (energy - smooth) * (1 - Math.exp(-Math.max(0, dtSec) / STEP_ENERGY_SMOOTH_SEC));
      const next = pickSpeedStep(smooth, to);
      if (next !== to) {
        held = posAt(to, bars); // where the outgoing step is now: "stop" holds it
        from = to;
        to = next;
        w = 0;
      }
      w = Math.min(1, w + Math.max(0, dtSec) / Math.max(1e-3, CROSSFADE_BEATS * beatSec));
    },
    value(dance, bars, offsetBars = 0) {
      // "stop" holds one pose for everyone; a moving step reads each row at its own offset
      const at = (s: number): number => dance.at(posAt(s, bars) + (SPEED_STEPS[s].multiple ? offsetBars : 0));
      const a = at(from);
      const b = at(to);
      return a + (b - a) * w;
    },
    position(bars) {
      return posAt(to, bars);
    },
    get step() {
      return to;
    },
    reset() {
      from = 0;
      to = 0;
      w = 1;
      held = 0;
      smooth = 0;
    },
  };
}
