// A monotonic, audio-warped clock for scenes that want a "current" flowing
// (caustics' domain warp, currently). The naive version of this — scaling
// elapsed time by a live audio value, e.g. `uTime * (0.15 + bass * 0.5)` —
// looks fine for a few seconds but is actually broken: at t=300s a bass
// change of 0.1 displaces the multiplied result by ~15 units in a single
// frame, so the pattern teleports, and it gets worse the longer the page has
// been open. Accumulating a phase instead (phase += dt * rate) means the
// audio only ever affects the *rate* of change going forward, never a jump
// in position — smooth no matter how long it's been running.
const FLOW_ENERGY_GAIN = 0.6; // how much louder audio speeds up the flow

export interface FlowClock {
  /** Advances the accumulated phase by dt seconds, sped up by energy in
   *  [0,1], and returns the new phase. Call once per render tick. */
  advance(dtSec: number, energy: number): number;
}

export function createFlowClock(): FlowClock {
  let phase = 0;
  return {
    advance(dtSec: number, energy: number): number {
      const rate = 1 + Math.max(0, energy) * FLOW_ENERGY_GAIN;
      phase += dtSec * rate;
      return phase;
    },
  };
}

/** A phase that moves at a live setting's rate, for a scene that has a clock
 *  phase (the one `createFlowClock` makes, via `anim.flowPhase`) and a
 *  user-facing speed setting on top of it. Multiplying the clock's absolute
 *  phase by the setting (`flowPhase * speed`) is the teleporting pattern
 *  described at the top of this file: one slider step, or a tiny Auto drift,
 *  shifts the result by `flowPhase * dSpeed`. This accumulates the clock's
 *  per-frame *step* times the current rate instead, so the setting only ever
 *  changes the speed going forward. */
export interface ScaledPhase {
  /** Feeds the clock's current phase and the setting's current rate; returns
   *  the accumulated phase. Call once per render tick. The first call, and any
   *  step that goes backwards or is longer than `MAX_SCALED_STEP` (the clock
   *  was swapped or recreated, or the tab was hidden for a while), advance by
   *  nothing, so the result never pops. */
  advance(phase: number, rate: number): number;
  reset(): void;
}

/** The longest clock step (in phase units, about a second of flow) that still
 *  counts as motion. A scene object can be driven by several clocks (a
 *  gallery tile and the main view each have their own), and switching between
 *  them makes the phase jump by an arbitrary amount in either direction. */
export const MAX_SCALED_STEP = 1;

export function createScaledPhase(): ScaledPhase {
  let acc = 0;
  let last: number | null = null;
  return {
    advance(phase: number, rate: number): number {
      if (last !== null && Number.isFinite(phase)) {
        const d = phase - last;
        if (d > 0 && d < MAX_SCALED_STEP) acc += d * Math.max(0, rate);
      }
      if (Number.isFinite(phase)) last = phase;
      return acc;
    },
    reset(): void {
      acc = 0;
      last = null;
    },
  };
}
