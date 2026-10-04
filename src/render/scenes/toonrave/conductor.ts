/**
 * Conductor: turns the app's beat clock into the Toon Rave cycle position.
 *
 * `c` is the position in beats inside one cycle, with the drop at c = 0. It
 * runs 0..cycleBeats and wraps; the wrap is the scheduled drop.
 *
 * Locked (tempoLock > 0.5 and bpm > 0): c = (beats - anchor) mod cycleBeats.
 * The anchor moves only at a drop, so cycles stay on the app's bar lines.
 *
 * Unlocked: free-run at the last good bpm (120 before any) from timeSec.
 * c never jumps backwards by itself. When the lock returns the cycle waits
 * for the next bar line, anchors there on a beat that is a multiple of 4, and
 * eases the leftover phase difference out (the "slew") by speeding up or
 * slowing down by at most half a frame's worth of beats per frame, so c stays
 * continuous. The first lock after reset(), and any lock within the first
 * SNAP_WINDOW_SEC of rendering, instead anchors at once and snaps c to the grid.
 *
 * paused (Clock on signal, with its signal below the mark) holds c where it is:
 * it drops the anchor as a lost lock would and stops the free run, so when it
 * clears, c carries on from where it stopped and a returning lock re-anchors on
 * the next bar line exactly as above. A drop is ignored while paused.
 *
 * dropFired starts a new cycle on the nearest whole beat (c becomes 0 there),
 * but only if at least MIN_DROP_GAP_BEATS have passed since the last drop
 * (scheduled or fired). Pure: no wall clock, no DOM.
 */

export interface ConductorInput {
  timeSec: number;
  dtSec: number;
  /** Unwrapped beat count from the app's beat clock. */
  beats: number;
  beatPhase: number;
  barPhase: number;
  tempoLock: number;
  bpm: number;
  dropFired: boolean;
  /** Hold the clock where it is (see the header). Default false. */
  paused?: boolean;
}

export interface ConductorOut {
  /** Cycle position in beats, 0..cycleBeats, drop at 0. */
  c: number;
  bpm: number;
  locked: boolean;
}

export interface Conductor {
  step(input: ConductorInput, cycleBeats: number): ConductorOut;
  reset(): void;
}

export const DEFAULT_BPM = 120;
export const BEATS_PER_BAR = 4;
/** A dropFired closer than this to the last drop is ignored (8 bars). */
export const MIN_DROP_GAP_BEATS = 8 * BEATS_PER_BAR;
/** Longest frame step trusted when free-running (a hidden tab, a stall). */
const MAX_DT_SEC = 0.5;
/** Share of a frame's beats the slew may add or remove per frame. */
const SLEW_RATE = 0.5;
/** Lock acquisitions in this many seconds after the first frame snap, not slew. */
const SNAP_WINDOW_SEC = 8;

const mod = (x: number, n: number): number => ((x % n) + n) % n;

export function createConductor(): Conductor {
  let started = false;
  let anchored = false; // locked and anchored: c follows the beat clock
  let anchor = 0;
  let slew = 0;
  let free = 0; // free-run position in beats
  let lastBpm = DEFAULT_BPM;
  let prevBeats = 0;
  let prevTime = 0;
  let prevC = 0;
  let sinceDrop = Infinity;
  let everLocked = false;
  let startTime = 0;

  const reset = (): void => {
    started = false;
    anchored = false;
    anchor = 0;
    slew = 0;
    free = 0;
    lastBpm = DEFAULT_BPM;
    prevBeats = 0;
    prevTime = 0;
    prevC = 0;
    sinceDrop = Infinity;
    everLocked = false;
    startTime = 0;
  };

  const step = (inp: ConductorInput, cycleBeats: number): ConductorOut => {
    const n = cycleBeats;
    const paused = inp.paused === true;
    const tempoLocked = inp.tempoLock > 0.5 && inp.bpm > 0;
    if (tempoLocked) lastBpm = inp.bpm;
    // paused reads as an unlocked clock that doesn't advance
    const locked = tempoLocked && !paused;

    let dt = started ? inp.timeSec - prevTime : inp.dtSec;
    if (!(dt >= 0)) dt = Math.max(0, inp.dtSec);
    if (dt > MAX_DT_SEC) dt = MAX_DT_SEC;
    const frameBeats = paused ? 0 : (dt * lastBpm) / 60;

    const drop = !paused && inp.dropFired && sinceDrop >= MIN_DROP_GAP_BEATS;

    if (!started) {
      started = true;
      startTime = inp.timeSec;
      if (locked) {
        anchored = true;
        anchor = Math.floor(inp.beats / BEATS_PER_BAR) * BEATS_PER_BAR;
        slew = 0;
      } else {
        anchored = false;
        free = 0;
      }
    } else if (anchored && !locked) {
      // Lock lost: carry on from where c is.
      anchored = false;
      slew = 0;
      free = prevC;
    }

    let c: number;
    if (anchored) {
      if (drop) {
        anchor = Math.round(inp.beats);
        slew = 0;
      } else {
        const eat = Math.min(Math.abs(slew), frameBeats * SLEW_RATE);
        slew -= Math.sign(slew) * eat;
      }
      let rel = inp.beats - anchor;
      if (rel < 0 && rel > -1) rel = 0; // drop rounded up: hold at 0
      c = mod(mod(rel, n) + slew, n);
    } else {
      if (drop) {
        free = 0;
      } else {
        free = mod(free + frameBeats, n);
      }
      c = free;
      if (locked && drop) {
        anchored = true;
        anchor = Math.round(inp.beats);
        slew = 0;
      } else if (locked) {
        // Lock is back: anchor at the next bar line.
        const crossed =
          Math.floor(inp.beats / BEATS_PER_BAR) >
          Math.floor(prevBeats / BEATS_PER_BAR);
        // The first lock after reset, or any lock in the first SNAP_WINDOW_SEC:
        // re-anchor at once and snap (no slew), so the first cycle's cuts sit
        // on the app's bar lines.
        const snap = !everLocked || inp.timeSec - startTime < SNAP_WINDOW_SEC;
        if (crossed || snap) {
          const aligned0 = BEATS_PER_BAR * Math.round(free / BEATS_PER_BAR);
          anchor =
            Math.floor(inp.beats / BEATS_PER_BAR) * BEATS_PER_BAR - aligned0;
          const aligned = mod(inp.beats - anchor, n);
          slew = snap ? 0 : mod(free - aligned + n / 2, n) - n / 2;
          anchored = true;
          if (snap) c = aligned;
        }
      }
    }

    // Drop bookkeeping: beats since the last drop, reset on wrap or drop.
    if (drop) {
      sinceDrop = 0;
    } else {
      const adv = mod(c - prevC + n / 2, n) - n / 2;
      if (adv > 0) sinceDrop += adv;
      if (c < prevC && adv > 0) sinceDrop = c;
    }

    if (anchored) everLocked = true;
    prevBeats = inp.beats;
    prevTime = inp.timeSec;
    prevC = c;
    return { c, bpm: lastBpm, locked: tempoLocked };
  };

  return { step, reset };
}
