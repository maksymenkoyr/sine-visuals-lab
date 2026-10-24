// The low end behind the old beat clock's vote (beatClock.ts, fed by
// animClock.ts's hitWeight): how fast the band split's low range of
// `frame.bands` is rising, over a threshold that adapts to its recent rises
// (1 = at the threshold). This was bandEnergy.ts's Bass onset detector before
// the lanes moved onto the audio engine; the beat clock's weights were tuned
// against it (tests/tempoEval.test.ts), so it keeps exactly this input until
// the engine's own clock replaces it (#678 deletes this file).

import { getBandSplit } from "../audio/bandSplit.ts";

// The old Bass detector's tuning, unchanged: the eval's targets were met with these.
const FLUX_ADAPT_RATE = 3;
const TRIGGER_MULT = 1.6;
const TRIGGER_MARGIN = 1.5;
// Keeps a zero or non-finite step from turning a rise into Infinity or NaN.
const MIN_DT_SEC = 1e-4;

export interface TempoVoteBass {
  /** This tick's rise over its threshold. Read after advance(). */
  readonly ratio: number;
  advance(dtSec: number, bands: Float32Array): void;
}

export function createTempoVoteBass(): TempoVoteBass {
  let prevRaw: number | null = null;
  let baseline = 0;
  const state = {
    ratio: 0,
    advance(dtSec: number, bands: Float32Array): void {
      const dt = Number.isFinite(dtSec) ? Math.max(MIN_DT_SEC, dtSec) : MIN_DT_SEC;
      const { lowMid } = getBandSplit();
      let sum = 0;
      for (let i = 0; i < lowMid; i++) sum += bands[i];
      const raw = lowMid > 0 ? sum / lowMid : 0;
      // Null until the first tick, so a fresh clock can't read its start as a rise.
      const rise = prevRaw === null ? 0 : Math.max(0, (raw - prevRaw) / dt);
      prevRaw = raw;
      baseline += (rise - baseline) * Math.min(1, FLUX_ADAPT_RATE * dt);
      state.ratio = rise / (baseline * TRIGGER_MULT + TRIGGER_MARGIN);
    },
  };
  return state;
}
