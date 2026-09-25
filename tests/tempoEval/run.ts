import { FeatureExtractor } from "../../src/audio/features.ts";
import { createAnimClock } from "../../src/render/animClock.ts";
import { getHitShape } from "../../src/audio/hitStrength.ts";
import { TempoAnalyzer } from "../../src/audio/tempoAnalyzer.ts";
import { PHASE_BASS, type TempoHit } from "../../src/render/beatClock.ts";
import { readBandsDb } from "./bands.ts";
import { SR, type Track, type TempoSegment } from "./synth.ts";

/**
 * Renders a synthesized Track (synth.ts) through the real FeatureExtractor +
 * AnimClock, exactly the way src/app.ts drives them in solo mode (see its
 * currentVisual()/loop() — extractor.update() then animClock.advance() with
 * this device's own HitShape and the same tick's fluxRatio as the broadband
 * hit weight), and scores the result against the track's own ground truth.
 * The permanent, dependency-free scoreboard tests/tempoEval.test.ts asserts
 * targets against (see that file, and the plan/PR that added this harness
 * for what each metric is meant to guard).
 *
 * `{ analyzer: true }` swaps the render-tick FeatureExtractor.bpm for the
 * fixed-hop TempoAnalyzer's own — see tempoAnalyzer.ts's header for why its
 * numbers are better. It's fed the track's samples in the same 128-sample
 * blocks (with their own exact start times) app.ts's real AudioWorklet
 * would, incrementally, up to each render tick's own `time` — never more,
 * so a track's own future samples can't leak into an earlier tick's
 * estimate the way it would if the whole buffer were pushed up front. Its
 * drained onsets become that tick's animClock.advance() tempoHits, exactly
 * the shape app.ts's currentVisual()/loop() build (agoSec against this same
 * tick's `time`, weight graded by PHASE_BASS-weighted bass). Every other
 * metric computed below is unchanged between the two modes — same
 * FeatureExtractor, same AnimFrame, same ground truth comparison — so the
 * two tables in tests/tempoEval.test.ts are directly comparable.
 */

export interface EvalMetrics {
  /** Share of frames inside a tempo segment where the tracker's own bpm is
   *  within 2 of that segment's true bpm. */
  tempoOk: number;
  /** Share of tracked beats (after t=8s, inside a tempo segment) whose
   *  nearest true beat lands within 30ms. */
  ticksOn30ms: number;
  /** Signed median offset (tracked − true), ms, over tracked beats within
   *  half a beat of their nearest true beat. NaN if none qualify. */
  medianOffsetMs: number;
  /** tempoOk, but only over frames at or after WARMUP_SEC — steady-state
   *  accuracy, with how long the first lock takes reported separately as
   *  timeToLockSec rather than folded in here. */
  tempoOkSteady: number;
  /** When the tracker first reads the true tempo (within 2 bpm) and then
   *  keeps it for LOCK_HOLD_SEC straight. NaN if it never does. */
  timeToLockSec: number;
  /** Mean tempoLock, after t=6s inside a tempo segment, over frames where
   *  the tracker's bpm is right (within 2 of the truth). */
  lockWhenRight: number;
  /** The same over frames where it is wrong — a confidence worth having
   *  reads lower here than lockWhenRight. */
  lockWhenWrong: number;
  /** Mean tempoLock over frames after t=6s that are neither inside a tempo
   *  segment nor in the track's own trailing silence (the time after its
   *  last tempo segment ends — a track with no tempo segments at all, like
   *  `random`, has no such tail, so nothing is excluded there). */
  lockNoTempo: number;
  /** frame.bpm at the very last rendered frame. */
  endBpm: number;
  /** anim.tempoLock at the very last rendered frame. */
  endLock: number;
}

function currentSegment(segments: TempoSegment[], segPtr: { i: number }, t: number): TempoSegment | null {
  while (segPtr.i < segments.length && t >= segments[segPtr.i]!.to) segPtr.i++;
  const seg = segments[segPtr.i];
  if (seg && t >= seg.from && t < seg.to) return seg;
  return null;
}

function nearestBeat(beats: number[], t: number): number | null {
  if (beats.length === 0) return null;
  let lo = 0;
  let hi = beats.length - 1;
  if (t <= beats[0]!) return beats[0]!;
  if (t >= beats[hi]!) return beats[hi]!;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (beats[mid]! <= t) lo = mid;
    else hi = mid;
  }
  return t - beats[lo]! <= beats[hi]! - t ? beats[lo]! : beats[hi]!;
}

function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

const TICKS_MIN_SEC = 8;
const LOCK_MIN_SEC = 6;
const TICKS_TOLERANCE_SEC = 0.03;
const WARMUP_SEC = 3;
const LOCK_HOLD_SEC = 2;
// Matches app.ts's tempoWorklet.ts real AudioWorklet render-quantum feed —
// see tempoAnalyzer.ts's own hop derivation for why the exact block size
// doesn't matter to its own hop timing (it's independent of the push()
// chunking), only to how often this harness calls push().
const ANALYZER_PUSH_BLOCK = 128;

export interface EvalOptions {
  /** Swap the render-tick FeatureExtractor.bpm for the fixed-hop
   *  TempoAnalyzer's — see this file's own header. */
  analyzer?: boolean;
}

export function evaluate(track: Track, fps = 60, opts: EvalOptions = {}): EvalMetrics {
  const dt = 1 / fps;
  const totalDurationSec = track.mono.length / SR;
  const nFrames = Math.floor(totalDurationSec * fps);
  const finalSilenceStart = track.tempo.length > 0 ? Math.max(...track.tempo.map((s) => s.to)) : Infinity;

  const extractor = new FeatureExtractor();
  const animClock = createAnimClock();
  const shape = getHitShape();
  const analyzer = opts.analyzer ? new TempoAnalyzer(SR) : null;
  let analyzerSamplesPushed = 0;

  const segPtr = { i: 0 };
  let framesInSeg = 0;
  let framesOk = 0;
  let steadyFrames = 0;
  let steadyOk = 0;
  let runStart: number | null = null;
  let lockTime: number | null = null;
  let rightSum = 0;
  let rightCount = 0;
  let wrongSum = 0;
  let wrongCount = 0;
  let lockNoSum = 0;
  let lockNoCount = 0;
  const trackedBeats: number[] = [];

  let prevBeatsVal = 0;
  let prevTime = 0;
  let lastBpm = 0;
  let lastLock = 0;

  for (let i = 0; i < nFrames; i++) {
    const time = i * dt;
    const bands = readBandsDb(track.mono, time, SR);
    const frame = extractor.update(bands, time);

    let tempoHits: TempoHit[] | undefined;
    if (analyzer) {
      const upToSample = Math.min(track.mono.length, Math.round(time * SR));
      while (analyzerSamplesPushed < upToSample) {
        const end = Math.min(upToSample, analyzerSamplesPushed + ANALYZER_PUSH_BLOCK);
        analyzer.push(track.mono.subarray(analyzerSamplesPushed, end), analyzerSamplesPushed / SR);
        analyzerSamplesPushed = end;
      }
      frame.bpm = analyzer.bpm;
      tempoHits = analyzer.drainOnsets().map((o) => ({ agoSec: time - o.time, weight: o.strength * (1 + PHASE_BASS * o.bass) }));
    }

    const anim = animClock.advance(dt, frame, undefined, undefined, { shape, beatRatio: extractor.fluxRatio, tempoHits });

    const seg = currentSegment(track.tempo, segPtr, time);
    if (seg) {
      framesInSeg++;
      const ok = Math.abs(frame.bpm - seg.bpm) < 2;
      if (ok) framesOk++;
      if (time >= WARMUP_SEC) {
        steadyFrames++;
        if (ok) steadyOk++;
      }
      if (ok) {
        if (runStart === null) runStart = time;
        if (lockTime === null && time - runStart >= LOCK_HOLD_SEC) lockTime = runStart;
      } else runStart = null;
    }
    if (time > LOCK_MIN_SEC) {
      if (seg) {
        if (Math.abs(frame.bpm - seg.bpm) < 2) {
          rightSum += anim.tempoLock;
          rightCount++;
        } else {
          wrongSum += anim.tempoLock;
          wrongCount++;
        }
      } else if (time < finalSilenceStart) {
        lockNoSum += anim.tempoLock;
        lockNoCount++;
      }
    }

    if (i > 0) {
      let targetFloor = Math.floor(prevBeatsVal) + 1;
      const curFloor = Math.floor(anim.beats);
      const confident = frame.bpm > 0 || anim.tempoLock > 0.02;
      while (targetFloor <= curFloor) {
        if (confident && anim.beats !== prevBeatsVal) {
          const frac = (targetFloor - prevBeatsVal) / (anim.beats - prevBeatsVal);
          trackedBeats.push(prevTime + frac * (time - prevTime));
        }
        targetFloor++;
      }
    }
    prevBeatsVal = anim.beats;
    prevTime = time;
    lastBpm = frame.bpm;
    lastLock = anim.tempoLock;
  }

  // ticksOn30ms / medianOffsetMs — a second pass over the tracked beats
  // collected above, scoped to t > TICKS_MIN_SEC and inside a tempo segment.
  const tickSegPtr = { i: 0 };
  let qualifying = 0;
  let within30ms = 0;
  const offsetsMs: number[] = [];
  for (const tb of trackedBeats) {
    if (tb <= TICKS_MIN_SEC) continue;
    const seg = currentSegment(track.tempo, tickSegPtr, tb);
    if (!seg) continue;
    qualifying++;
    const nearest = nearestBeat(track.beats, tb);
    if (nearest === null) continue;
    const diffSec = tb - nearest;
    if (Math.abs(diffSec) <= TICKS_TOLERANCE_SEC) within30ms++;
    const periodSec = 60 / seg.bpm;
    if (Math.abs(diffSec) < periodSec * 0.5) offsetsMs.push(diffSec * 1000);
  }

  return {
    tempoOk: framesInSeg > 0 ? framesOk / framesInSeg : NaN,
    ticksOn30ms: qualifying > 0 ? within30ms / qualifying : NaN,
    medianOffsetMs: median(offsetsMs),
    tempoOkSteady: steadyFrames > 0 ? steadyOk / steadyFrames : NaN,
    timeToLockSec: lockTime ?? NaN,
    lockWhenRight: rightCount > 0 ? rightSum / rightCount : NaN,
    lockWhenWrong: wrongCount > 0 ? wrongSum / wrongCount : NaN,
    lockNoTempo: lockNoCount > 0 ? lockNoSum / lockNoCount : NaN,
    endBpm: lastBpm,
    endLock: lastLock,
  };
}
