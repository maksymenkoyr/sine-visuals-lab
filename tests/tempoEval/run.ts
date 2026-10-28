import { FeatureExtractor } from "../../src/audio/features.ts";
import { AudioEngine } from "../../src/audio/engine/engine.ts";
import { createAnimClock, type AnimFrame } from "../../src/render/animClock.ts";
import type { EngineReading, FeatureFrame } from "../../src/audio/types.ts";
import { LOCK_MEANINGS, type LockMeaning } from "../../src/render/lockMeaning.ts";
import { releaseTapTempo, tapTempoAt } from "../../src/render/tapTempo.ts";
import { getHitShape } from "../../src/audio/hitStrength.ts";
import {
  feedSilenceGateMeasurement,
  hitPasses,
  musicHoldsGate,
  resetSilenceGateTracker,
  resolveSilenceGate,
  silenceGateDimmer,
  SILENCE_GATE_SEED,
  type SilenceGateMarks,
} from "../../src/audio/silenceGate.ts";
import { feedAutoGainMeasurement, resetAutoGain, resolveAutoGain } from "../../src/audio/autoGain.ts";
import { decodeFeatureFrame, encodeFeatureFrame, type WireEngine } from "../../src/net/protocol.ts";
import { JitterBuffer } from "../../src/net/jitterBuffer.ts";
import { RENDER_DELAY_MS } from "../../server/roomDevices.ts";
import { readBandsDb } from "./bands.ts";
import { micChain } from "./micChain.ts";
import { SR, type Track, type TempoSegment } from "./synth.ts";

/**
 * Renders a synthesized Track (synth.ts) the way the app hears and draws it,
 * and scores the result against the track's own ground truth. The permanent,
 * dependency-free scoreboard tests/tempoEval.test.ts asserts targets against.
 *
 * The device that hears the sound runs as src/app.ts's readLocalCapture()
 * does: FeatureExtractor for the bands and level, the audio engine
 * (src/audio/engine/engine.ts) fed the track's samples in AudioWorklet-sized
 * blocks up to each frame's own time (never further, so a frame can't hear
 * its own future), its reading and tempo set on the frame, and the frame's
 * hit flags from the engine's hits and the silence gate.
 *
 * Two paths draw it (EvalOptions.path):
 * - solo: that frame straight into this device's anim clock.
 * - host: what a TV draws. Every frame goes through encodeFeatureFrame and
 *   decodeFeatureFrame (no WireDecimator: its parameter properties would stop
 *   `node tools/mic-gap-analyze.ts`, which imports this file, from loading)
 *   into a JitterBuffer, and the follower samples it RENDER_DELAY_MS behind,
 *   building its frame the way room.ts's sample() and src/tv.ts do. Each of
 *   its frames is scored at the instant it shows.
 */

/** Mean Lock in one meaning over the frames each lock metric of EvalMetrics masks. */
export interface LockStats {
  whenRight: number;
  whenWrong: number;
  noTempo: number;
  end: number;
}

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
  /** Share of metronome ticks (metronome.ts, after TICKS_MIN_SEC, inside a
   *  tempo segment) whose nearest true beat (track.beats) lands within
   *  TICKS_TOLERANCE_SEC — the metronome's own counterpart to ticksOn30ms. */
  metroOn30ms: number;
  /** Share of true beats (after TICKS_MIN_SEC, inside a tempo segment) with
   *  a metronome tick within TICKS_TOLERANCE_SEC of them — catches a
   *  metronome that's dropped out rather than one that's merely offset. */
  metroCoverage: number;
  /** Coefficient of variation of consecutive metronome tick intervals
   *  (after TICKS_MIN_SEC) — how evenly spaced the metronome's own ticks
   *  are. NaN for a track whose tempo segments aren't all the same bpm
   *  (ramp) or has none at all (random) — there's no single "even" interval
   *  to measure against. */
  metroIntervalCv: number;
  /** Share of those same intervals within METRO_EVEN_TOL of their median —
   *  the asserted evenness reading. Unlike the CV, one deliberate phase
   *  correction (metronome.ts's PHASE_SNAP_BEATS: one longer interval, once
   *  per start/retune) costs it one interval instead of failing the track,
   *  while a metronome that keeps wobbling still scores low. Same NaN rule. */
  metroEvenShare: number;
  /** house only (any track with a gap between two tempo segments, i.e. a
   *  breakdown with no drums under it): share of frames inside that gap
   *  where the metronome is running. NaN for a track with no such gap. */
  metroBreakdownRun: number;
  /** Same scope as metroBreakdownRun: share of that gap's own gridBeats
   *  (Track.gridBeats — every beat of the grid, drums or not) with a
   *  metronome tick within TICKS_TOLERANCE_SEC. NaN for a track with no
   *  such gap. */
  metroBreakdownOn30ms: number;
  /** Whether the metronome is still running at the very last frame — it
   *  should have let go by then on any track whose music actually ends. */
  metroEndRunning: boolean;
  /** Share of all frames after LOCK_MIN_SEC the metronome is running —
   *  reported for every track. metronome.ts now runs exactly when
   *  tempoSettle.ts's own settled bpm is non-zero (no confidence gate — see
   *  that file's header), so on `random` this tracks bpmPresentShare below,
   *  not "almost never": whether the tracker was ever fooled into a
   *  *confident* lock on unstructured hits is lockNoTempo's job, not this
   *  one's. */
  metroRunShare: number;
  /** Share of all frames after LOCK_MIN_SEC where the tracker's own raw
   *  bpm (FeatureFrame.bpm) is non-zero at all — metroRunShare's own
   *  target now that starting/stopping is ungated on tempoLock; the two
   *  should track each other closely (tempoSettle.ts's window is the only
   *  thing between them). */
  bpmPresentShare: number;
  /** lockWhenRight/lockWhenWrong/lockNoTempo/endLock for every Lock meaning
   *  (lockMeaning.ts), whichever one this run's anim clock hands on. */
  lockBy: Record<LockMeaning, LockStats>;
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
const METRO_EVEN_TOL = 0.03;
const LOCK_MIN_SEC = 6;
const TICKS_TOLERANCE_SEC = 0.03;
const WARMUP_SEC = 3;
const LOCK_HOLD_SEC = 2;
// The AudioWorklet's render quantum, the block size engineWorklet.ts posts.
const ENGINE_PUSH_BLOCK = 128;

export type EvalPath = "solo" | "host";

export interface EvalOptions {
  /** Which device draws the track: solo (default), or a TV following the
   *  device that hears it — see this file's header. */
  path?: EvalPath;
  /** Lock's meaning for this run's anim clock (lockMeaning.ts); stability by
   *  default. EvalMetrics.lockBy scores every meaning either way. */
  lockMeaning?: LockMeaning;
  /** Run the track's audio through micChain.ts before anything reads it —
   *  the conditions the app actually hears through a mic, rather than the
   *  track's own clean synthesized master. */
  mic?: boolean;
  /** Pass SILENCE_GATE_SEED as the silence gate on the frame's hit flags and on the anim clock,
   *  exactly like app.ts does (see silenceGate.ts's header for what the gate
   *  does and why it must not starve tempo tracking; that's exactly what this
   *  option, combined with `mic`, is here to measure). */
  gate?: boolean;
  /** With `gate`: run the room trackers the way app.ts does by default — the
   *  auto-gain amount from the measured band span (autoGain.ts) and the gate
   *  marks from the tracked room floor (silenceGate.ts), both re-seeded at
   *  the start of the run, instead of a fixed 1 and the shipped marks. */
  auto?: boolean;
  /** Tap tempo (src/render/tapTempo.ts), solo only: tap times in seconds on
   *  the track's own clock. Each is tapped just before the first frame at or
   *  after it, the way a keydown lands between two render ticks, and the
   *  anim clock is handed each frame's time as its `tapNowMs`. The store is
   *  released first, so nothing from an earlier evaluate() carries over.
   *  Omitted, the tap path is never reached and every metric is exactly
   *  what it was before taps existed. */
  taps?: readonly number[];
  /** Called after every frame with the instant it shows, the frame drawn
   *  (raw bpm) and the AnimFrame — for a test scoring something EvalMetrics
   *  doesn't (tests/tapTempoEval.test.ts). */
  onFrame?: (time: number, frame: FeatureFrame, anim: AnimFrame, resolved: { autoGain: number; gate: SilenceGateMarks | undefined }) => void;
}

/** A follower's frame from a jitter-buffer sample, as room.ts's sample() and src/tv.ts build it. */
function followerFrame(buffer: JitterBuffer, targetMs: number, scratch: EngineReading): FeatureFrame | null {
  const s = buffer.sampleAt(targetMs);
  if (!s) return null;
  const timeSec = targetMs / 1000;
  let engine: EngineReading | null = null;
  const w: WireEngine | null = s.engine;
  if (w) {
    engine = Object.assign(scratch, w, {
      beatTime: timeSec - w.beatAgoMs / 1000,
      downbeatTime: timeSec - w.downbeatAgoMs / 1000,
    });
  }
  return {
    time: timeSec,
    bands: s.bands,
    energy: s.energy,
    onset: buffer.consumeOnsetIfDue(targetMs),
    pulseOnset: buffer.consumePulseIfDue(targetMs),
    bpm: s.bpm,
    onsetPhase: buffer.beatPhaseAt(targetMs),
    level: s.level,
    hats: s.hats,
    lead: s.lead,
    engine,
  };
}

function emptyLock(): LockStats {
  return { whenRight: NaN, whenWrong: NaN, noTempo: NaN, end: NaN };
}

export function evaluate(track: Track, fps = 60, opts: EvalOptions = {}): EvalMetrics {
  const mono = opts.mic ? micChain(track.mono, SR) : track.mono;
  const auto = opts.auto === true && opts.gate === true;
  if (auto) {
    resetAutoGain();
    resetSilenceGateTracker();
  }
  let gate: SilenceGateMarks | undefined = opts.gate ? SILENCE_GATE_SEED : undefined;
  let musicHeld = false;
  const dt = 1 / fps;
  const totalDurationSec = mono.length / SR;
  const nFrames = Math.floor(totalDurationSec * fps);
  const finalSilenceStart = track.tempo.length > 0 ? Math.max(...track.tempo.map((s) => s.to)) : Infinity;
  const host = opts.path === "host";

  const extractor = new FeatureExtractor();
  const engine = new AudioEngine(SR);
  let samplesPushed = 0;
  const animClock = createAnimClock({ lockMeaning: opts.lockMeaning });
  const shape = getHitShape();
  const buffer = new JitterBuffer();
  const followerEngine: EngineReading = { ...engine.read(0) };
  const taps = host ? undefined : opts.taps;
  let tapNext = 0;
  if (taps) releaseTapTempo();

  const segPtr = { i: 0 };
  let framesInSeg = 0;
  let framesOk = 0;
  let steadyFrames = 0;
  let steadyOk = 0;
  let runStart: number | null = null;
  let lockTime: number | null = null;
  // Per Lock meaning, then the anim clock's own tempoLock under "used".
  type LockSums = { right: number; rightN: number; wrong: number; wrongN: number; none: number; noneN: number; last: number };
  const sums = (): LockSums => ({ right: 0, rightN: 0, wrong: 0, wrongN: 0, none: 0, noneN: 0, last: 0 });
  const used = sums();
  const byMeaning = Object.fromEntries(LOCK_MEANINGS.map((m) => [m, sums()])) as Record<LockMeaning, LockSums>;
  const trackedBeats: number[] = [];
  const metroTicks: number[] = [];

  // A gap between two consecutive tempo segments is a stretch with no
  // audible beat under it at all (house's own breakdown, bars 8-11) — the
  // one thing metroBreakdownRun/metroBreakdownOn30ms score, on whichever
  // track (today, only house) actually has one.
  let breakdownFrom: number | null = null;
  let breakdownTo: number | null = null;
  for (let s = 0; s < track.tempo.length - 1; s++) {
    if (track.tempo[s]!.to < track.tempo[s + 1]!.from) {
      breakdownFrom = track.tempo[s]!.to;
      breakdownTo = track.tempo[s + 1]!.from;
      break;
    }
  }
  let breakdownFrames = 0;
  let breakdownRunning = 0;
  let framesAfterLockMin = 0;
  let framesRunningAfterLockMin = 0;
  let framesBpmPresentAfterLockMin = 0;

  let scored = 0;
  let prevBeatsVal = 0;
  let prevMetroBeatsVal = 0;
  let prevMetronomeOn = false;
  let prevTime = 0;
  let lastBpm = 0;
  let lastMetronomeOn = false;

  for (let i = 0; i < nFrames; i++) {
    const heardAt = i * dt;
    const bands = readBandsDb(mono, heardAt, SR);
    const autoGain = auto ? resolveAutoGain() : 1;
    if (auto) gate = resolveSilenceGate();
    const heard = extractor.update(bands, heardAt, autoGain, 1);
    if (auto) {
      // Same order as app.ts: the readings feed the next tick.
      feedAutoGainMeasurement(extractor.bandSpanDb, extractor.dtSec);
      feedSilenceGateMeasurement(heard.level, extractor.dtSec);
    }
    const upToSample = Math.min(mono.length, Math.round(heardAt * SR));
    while (samplesPushed < upToSample) {
      const end = Math.min(upToSample, samplesPushed + ENGINE_PUSH_BLOCK);
      engine.push(mono.subarray(samplesPushed, end), samplesPushed / SR);
      samplesPushed = end;
    }
    const reading = engine.read(dt);
    heard.engine = reading;
    heard.bpm = engine.bpm;
    const strongest = Math.max(reading.kick, reading.snare, reading.hat);
    musicHeld = musicHoldsGate(reading, musicHeld);
    heard.onset = hitPasses(strongest, gate ? silenceGateDimmer(heard.level, gate, musicHeld) : 1);
    heard.pulseOnset = strongest > 0;

    let frame: FeatureFrame = heard;
    let time = heardAt;
    if (host) {
      const roomMs = heardAt * 1000;
      const decoded = decodeFeatureFrame(encodeFeatureFrame(heard, roomMs));
      if (decoded) buffer.push(decoded);
      const targetMs = roomMs - RENDER_DELAY_MS;
      const shown = followerFrame(buffer, targetMs, followerEngine);
      if (!shown) continue;
      frame = shown;
      time = targetMs / 1000;
    }

    if (taps) while (tapNext < taps.length && taps[tapNext]! <= time) tapTempoAt(taps[tapNext++]! * 1000);
    const anim = animClock.advance(dt, frame, undefined, gate, { shape }, taps ? time * 1000 : undefined);
    opts.onFrame?.(time, frame, anim, { autoGain, gate });
    const readings = animClock.lockReadings();

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
    for (const [s, lock] of [[used, anim.tempoLock], ...LOCK_MEANINGS.map((m) => [byMeaning[m], readings[m]] as const)] as const) {
      if (time > LOCK_MIN_SEC) {
        if (seg) {
          if (Math.abs(frame.bpm - seg.bpm) < 2) {
            s.right += lock;
            s.rightN++;
          } else {
            s.wrong += lock;
            s.wrongN++;
          }
        } else if (time < finalSilenceStart) {
          s.none += lock;
          s.noneN++;
        }
      }
      s.last = lock;
    }

    if (breakdownFrom !== null && breakdownTo !== null && time >= breakdownFrom && time < breakdownTo) {
      breakdownFrames++;
      if (anim.metronomeOn) breakdownRunning++;
    }
    if (time > LOCK_MIN_SEC) {
      framesAfterLockMin++;
      if (anim.metronomeOn) framesRunningAfterLockMin++;
      if (frame.bpm > 0) framesBpmPresentAfterLockMin++;
    }

    if (scored > 0) {
      // A bar move (engine/clock.ts's alignBars) adds whole beats to the
      // count at once, and the clock flags no beat for them; take them off
      // before interpolating, so only the beats it actually flags count.
      const moved = Math.max(0, Math.round(anim.beats - prevBeatsVal - (anim.tempoBpm * (time - prevTime)) / 60));
      const fromBeats = prevBeatsVal + moved;
      let targetFloor = Math.floor(fromBeats) + 1;
      const curFloor = Math.floor(anim.beats);
      const confident = frame.bpm > 0 || anim.tempoLock > 0.02;
      while (targetFloor <= curFloor) {
        if (confident && anim.beats !== fromBeats) {
          const frac = (targetFloor - fromBeats) / (anim.beats - fromBeats);
          trackedBeats.push(prevTime + frac * (time - prevTime));
        }
        targetFloor++;
      }

      // Metronome ticks — same interpolation, off metronome.ts's own
      // metronomeBeats instead of the beat clock's. Only while it was *already*
      // running last tick and still is this tick: `metronomeBeats` jumps
      // discontinuously the instant it adopts a fresh tempo (by design — it
      // sits straight on the clock's own beat count, not wherever its own
      // frozen count last stood), and that jump itself is never a real tick
      // (metronome.ts's own advance() arms it silently) — counting a floor
      // crossing across that jump would fabricate a burst of fake ticks. The
      // same goes for a jump onto the clock's bar (AnimFrame.metronomeBeat
      // stays false for it).
      if (prevMetronomeOn && anim.metronomeOn) {
        let mTargetFloor = Math.floor(prevMetroBeatsVal) + 1;
        const mCurFloor = Math.floor(anim.metronomeBeats);
        const jumped = !anim.metronomeBeat && mCurFloor > Math.floor(prevMetroBeatsVal);
        while (!jumped && mTargetFloor <= mCurFloor) {
          if (anim.metronomeBeats !== prevMetroBeatsVal) {
            const frac = (mTargetFloor - prevMetroBeatsVal) / (anim.metronomeBeats - prevMetroBeatsVal);
            metroTicks.push(prevTime + frac * (time - prevTime));
          }
          mTargetFloor++;
        }
      }
    }
    scored++;
    prevBeatsVal = anim.beats;
    prevMetroBeatsVal = anim.metronomeBeats;
    prevMetronomeOn = anim.metronomeOn;
    prevTime = time;
    lastBpm = frame.bpm;
    lastMetronomeOn = anim.metronomeOn;
  }

  const lockStats = (s: LockSums): LockStats => ({
    whenRight: s.rightN > 0 ? s.right / s.rightN : NaN,
    whenWrong: s.wrongN > 0 ? s.wrong / s.wrongN : NaN,
    noTempo: s.noneN > 0 ? s.none / s.noneN : NaN,
    end: scored > 0 ? s.last : NaN,
  });
  const usedLock = lockStats(used);
  const lockBy = Object.fromEntries(LOCK_MEANINGS.map((m) => [m, scored > 0 ? lockStats(byMeaning[m]) : emptyLock()])) as Record<LockMeaning, LockStats>;

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

  // metroOn30ms — same shape as ticksOn30ms above, over metroTicks against
  // the same true beats.
  const metroSegPtr = { i: 0 };
  let metroQualifying = 0;
  let metroWithin = 0;
  for (const mt of metroTicks) {
    if (mt <= TICKS_MIN_SEC) continue;
    const seg = currentSegment(track.tempo, metroSegPtr, mt);
    if (!seg) continue;
    metroQualifying++;
    const nearest = nearestBeat(track.beats, mt);
    if (nearest !== null && Math.abs(mt - nearest) <= TICKS_TOLERANCE_SEC) metroWithin++;
  }

  // metroCoverage — the reverse direction: for each true beat, is there a
  // metronome tick near it at all? Catches a metronome that's dropped out
  // (no nearby tick anywhere), which metroOn30ms alone wouldn't show if the
  // few ticks it does have all happen to land well.
  const coverageSegPtr = { i: 0 };
  let coverageQualifying = 0;
  let coverageWithin = 0;
  for (const b of track.beats) {
    if (b <= TICKS_MIN_SEC) continue;
    const seg = currentSegment(track.tempo, coverageSegPtr, b);
    if (!seg) continue;
    coverageQualifying++;
    const nearest = nearestBeat(metroTicks, b);
    if (nearest !== null && Math.abs(nearest - b) <= TICKS_TOLERANCE_SEC) coverageWithin++;
  }

  // metroIntervalCv — only meaningful for a track whose tempo never changes
  // (see EvalMetrics.metroIntervalCv's own doc).
  const sameBpmThroughout = track.tempo.length > 0 && track.tempo.every((s) => s.bpm === track.tempo[0]!.bpm);
  let metroIntervalCv = NaN;
  let metroEvenShare = NaN;
  if (sameBpmThroughout) {
    const lateTicks = metroTicks.filter((t) => t > TICKS_MIN_SEC);
    const intervals: number[] = [];
    for (let k = 1; k < lateTicks.length; k++) intervals.push(lateTicks[k]! - lateTicks[k - 1]!);
    if (intervals.length > 1) {
      const meanInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const variance = intervals.reduce((a, b) => a + (b - meanInterval) ** 2, 0) / intervals.length;
      metroIntervalCv = meanInterval > 0 ? Math.sqrt(variance) / meanInterval : NaN;
      const median = [...intervals].sort((a, b) => a - b)[intervals.length >> 1]!;
      metroEvenShare = intervals.filter((x) => Math.abs(x / median - 1) <= METRO_EVEN_TOL).length / intervals.length;
    }
  }

  // metroBreakdownOn30ms — house's own gridBeats (every beat of the grid,
  // drums or not) inside the breakdown gap, scored against metroTicks.
  let metroBreakdownOn30ms = NaN;
  if (breakdownFrom !== null && breakdownTo !== null) {
    const gridInGap = track.gridBeats.filter((g) => g >= breakdownFrom! && g < breakdownTo!);
    let gridWithin = 0;
    for (const g of gridInGap) {
      const nearest = nearestBeat(metroTicks, g);
      if (nearest !== null && Math.abs(nearest - g) <= TICKS_TOLERANCE_SEC) gridWithin++;
    }
    metroBreakdownOn30ms = gridInGap.length > 0 ? gridWithin / gridInGap.length : NaN;
  }

  return {
    tempoOk: framesInSeg > 0 ? framesOk / framesInSeg : NaN,
    ticksOn30ms: qualifying > 0 ? within30ms / qualifying : NaN,
    medianOffsetMs: median(offsetsMs),
    tempoOkSteady: steadyFrames > 0 ? steadyOk / steadyFrames : NaN,
    timeToLockSec: lockTime ?? NaN,
    lockWhenRight: usedLock.whenRight,
    lockWhenWrong: usedLock.whenWrong,
    lockNoTempo: usedLock.noTempo,
    endBpm: lastBpm,
    endLock: usedLock.end,
    metroOn30ms: metroQualifying > 0 ? metroWithin / metroQualifying : NaN,
    metroCoverage: coverageQualifying > 0 ? coverageWithin / coverageQualifying : NaN,
    metroIntervalCv,
    metroEvenShare,
    metroBreakdownRun: breakdownFrames > 0 ? breakdownRunning / breakdownFrames : NaN,
    metroBreakdownOn30ms,
    metroEndRunning: lastMetronomeOn,
    metroRunShare: framesAfterLockMin > 0 ? framesRunningAfterLockMin / framesAfterLockMin : NaN,
    bpmPresentShare: framesAfterLockMin > 0 ? framesBpmPresentAfterLockMin / framesAfterLockMin : NaN,
    lockBy,
  };
}
