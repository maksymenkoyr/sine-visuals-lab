// Lock (AnimFrame.tempoLock) is how sure the beat clock is of its beat, 0..1.
// The beat grid's switch-on line (gridPulse.ts's GRID_LOCK_ON), the
// metronome's follow line (metronome.ts's FOLLOW_LOCK), the tempo settle's
// retune rule (tempoSettle.ts's RETUNE_LOCK), the music profile's pulse dial
// (musicProfile.ts), the Lock row and many scenes read it. It can mean one of
// three things:
// - stability: how small the clock's recent phase corrections are
//   (src/audio/engine/clock.ts's follow()), the meaning the old phase comb had.
// - presence: the clock is locked to a steady pulse at all.
// - clarity: the engine's own confidence, how periodic the recent onsets are.
// This is a comparison: LockMeter computes all three every tick, the anim
// clock hands one on, and the default is picked from the Lock meanings table
// tests/tempoEval.test.ts prints.

import type { ClockFrame } from "../audio/engine/clock.ts";
import type { EngineReading } from "../audio/types.ts";

export type LockMeaning = "stability" | "presence" | "clarity";
export const LOCK_MEANINGS: readonly LockMeaning[] = ["stability", "presence", "clarity"];

/** `?lock=<meaning>` from a page's query string, else stability. */
export function lockMeaningFromQuery(search: string): LockMeaning {
  const v = new URLSearchParams(search).get("lock");
  return LOCK_MEANINGS.find((m) => m === v) ?? "stability";
}

// Carried over from the old beat clock's lock (render/beatClock.ts), which
// tuned them against tests/tempoEval.test.ts on its own phase comb.
const STABILITY_START = 0.2;
const STABILITY_ALPHA = 0.4;
const STABILITY_SURE = 0.05;
const STABILITY_UNSURE = 0.12;
// The old clock's rise was 0.5. Measured 2026-10-24 on the eval's house:
// the clock's corrections grow when the drums come back after the breakdown,
// and at 0.5 Lock took about 2 s to climb back past the metronome's
// FOLLOW_LOCK, while the metronome, free-run through the breakdown at the
// engine's 123.6 for a 124 track, ticked about 60 ms late (metroCoverage
// 0.851). 1 gave 0.894; this gives 0.915. The spread still has to settle
// under STABILITY_UNSURE first, so one good update doesn't flash Lock to full.
const LOCK_RISE_RATE = 1.5;
const LOCK_DIP_RATE = 1;
const LOCK_FALL_RATE = 3;

const PRESENCE_RISE_RATE = 1.5;
const PRESENCE_FALL_RATE = 3;

function smoothstep(lo: number, hi: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

function ease(value: number, target: number, rise: number, fall: number, dtSec: number): number {
  const rate = target > value ? rise : fall;
  return value + (target - value) * Math.min(1, rate * dtSec);
}

export class LockMeter {
  readonly values: Record<LockMeaning, number> = { stability: 0, presence: 0, clarity: 0 };
  private spread = STABILITY_START;

  /** One tick: the clock's frame, the phase error its follow() measured this tick (null if none) and the engine's reading. */
  // @per-frame
  update(dtSec: number, clock: ClockFrame, phaseError: number | null, engine: EngineReading | null): void {
    const v = this.values;
    if (clock.locked) {
      if (phaseError !== null) this.spread += (Math.abs(phaseError) - this.spread) * STABILITY_ALPHA;
      const sure = 1 - smoothstep(STABILITY_SURE, STABILITY_UNSURE, this.spread);
      v.stability = ease(v.stability, sure, LOCK_RISE_RATE, LOCK_DIP_RATE, dtSec);
    } else {
      this.spread = STABILITY_START;
      v.stability = ease(v.stability, 0, LOCK_FALL_RATE, LOCK_FALL_RATE, dtSec);
    }
    v.presence = ease(v.presence, clock.locked ? 1 : 0, PRESENCE_RISE_RATE, PRESENCE_FALL_RATE, dtSec);
    v.clarity = ease(v.clarity, engine ? engine.confidence : 0, PRESENCE_RISE_RATE, PRESENCE_FALL_RATE, dtSec);
  }
}
