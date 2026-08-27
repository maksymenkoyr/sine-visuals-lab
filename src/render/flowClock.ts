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
