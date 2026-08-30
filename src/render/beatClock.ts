// A phase-locked beat/bar clock — the tempo analog of flowClock.ts's phase
// accumulator. The naive version of "where are we in the beat" is
// FeatureFrame.onsetPhase, which the extractor (and jitterBuffer, for remote
// frames) resets to exactly 0 on *every* detected onset. With only a 100ms
// refractory window and no beat-grid quantization, a hi-hat, fill or false
// positive resets it just as readily as an actual downbeat, so anything
// animating off it (a cosine "breath", an expanding ripple) jumps or restarts
// several times a beat. Fix: accumulate a free-running phase at the smoothed
// tempo — never assigned, only advanced — and on a detected onset only nudge
// it a small, capped amount toward the nearest beat line. An onset far from
// where the clock already expects one (a fill, a snare on the offbeat) is
// ignored outright rather than yanking the phase.
const BPM_TRACK_RATE = 2; // how fast the internal tempo estimate follows frame.bpm
const CAPTURE_WINDOW_BEATS = 0.25; // ignore onsets farther than this from the predicted beat line
const CORRECTION_GAIN = 0.15;
const MAX_CORRECTION_BEATS = 0.05; // per onset — keeps phase monotonic frame to frame, never a jump
const BEATS_PER_BAR = 4;
const LOCK_RISE_RATE = 0.5; // tempoLock ramps up over a couple seconds of a held tempo
const LOCK_FALL_RATE = 3; // and drops out quickly once bpm goes back to 0

function wrap01(x: number): number {
  const w = x % 1;
  return w < 0 ? w + 1 : w;
}

export interface BeatClock {
  /** Continuous [0,1) position within the current beat. Free-running —
   *  never resets, only ever nudged toward a detected onset. */
  readonly beatPhase: number;
  /** beatPhase over a BEATS_PER_BAR-beat bar, for effects that should read
   *  once every few beats rather than every single one. */
  readonly barPhase: number;
  /** 0..1, ramps toward 1 while a tempo is held and toward 0 once bpm drops
   *  to 0 — lets tempo-driven effects fade in/out instead of popping. */
  readonly tempoLock: number;
  /** Advances the clock by dtSec, given this frame's estimated tempo and
   *  whether an onset fired. Call once per render tick. */
  advance(dtSec: number, bpm: number, beatFired: boolean): void;
}

export function createBeatClock(): BeatClock {
  let phase = 0; // in beats, free-running, never reset
  let smoothedBpm = 0;
  let tempoLock = 0;

  const clock: BeatClock = {
    beatPhase: 0,
    barPhase: 0,
    tempoLock: 0,
    advance(dtSec: number, bpm: number, beatFired: boolean): void {
      const target = Math.max(0, bpm);
      smoothedBpm += (target - smoothedBpm) * Math.min(1, BPM_TRACK_RATE * dtSec);

      phase += dtSec * (smoothedBpm / 60);

      if (beatFired && smoothedBpm > 0) {
        const err = phase - Math.round(phase); // signed distance to the nearest beat line, in beats
        if (Math.abs(err) <= CAPTURE_WINDOW_BEATS) {
          const correction = Math.max(-MAX_CORRECTION_BEATS, Math.min(MAX_CORRECTION_BEATS, err * CORRECTION_GAIN));
          phase -= correction;
        }
      }

      const lockRate = bpm > 0 ? LOCK_RISE_RATE : LOCK_FALL_RATE;
      const lockTarget = bpm > 0 ? 1 : 0;
      tempoLock += (lockTarget - tempoLock) * Math.min(1, lockRate * dtSec);

      (clock as { beatPhase: number }).beatPhase = wrap01(phase);
      (clock as { barPhase: number }).barPhase = wrap01(phase / BEATS_PER_BAR);
      (clock as { tempoLock: number }).tempoLock = tempoLock;
    },
  };

  return clock;
}
