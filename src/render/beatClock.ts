// A phase-locked beat/bar clock — the tempo analog of flowClock.ts's phase
// accumulator. The naive version of "where are we in the beat" is
// FeatureFrame.onsetPhase, which the extractor (and jitterBuffer, for remote
// frames) resets to exactly 0 on *every* detected onset. With only a 100ms
// refractory window and no beat-grid quantization, a hi-hat, fill or false
// positive resets it just as readily as an actual downbeat, so anything
// animating off it (a cosine "breath", an expanding ripple) jumps or restarts
// several times a beat. Fix: accumulate a free-running phase at the smoothed
// tempo — never assigned, only advanced.
//
// The phase still needs correcting toward where the hits actually land, and
// the first approach here was a per-onset nudge: on every fired onset within
// CAPTURE_WINDOW_BEATS of a predicted beat line, ease the phase a small,
// capped amount toward it. That failed on real patterns: a busy hi-hat isn't
// one onset near the beat line, it's a train of onsets spread roughly evenly
// across the whole beat, and nudging toward whichever one happened to fire
// pulled the clock equally hard from both sides — it settled wherever the
// pulls happened to cancel, which measured out to about a third of a beat
// off the kick on a four-on-the-floor pattern, and landed close to the
// off-beat entirely on drum & bass.
//
// What advance() does instead: a phase comb. Every fired beat lands a
// {time, weight} hit in a rolling window (PHASE_WINDOW_SEC); once enough
// have accumulated (PHASE_MIN_HITS), each candidate whole-beat offset `o` in
// [-0.5, 0.5) is scored by how well shifting the clock by `o` would land
// every recent hit's own predicted phase (extrapolated back to when it fired,
// off the *current* smoothed tempo/phase) on a whole beat, in a small
// window (PHASE_KERNEL) around it — so a hit train that's spread across
// the whole beat votes for the single offset that explains all of them at
// once, rather than each hit pulling independently. The winning offset
// becomes `pending`, applied smoothly over the following ticks at a capped
// rate (PHASE_RATE/PHASE_MAX_RATE) so the clock's own phase is still
// monotonic frame to frame — it can slow down, never run backward.
//
// tempoLock no longer means "a bpm exists" (that was `bpm > 0`, a boolean in
// disguise — see today's LOCK_FALL_RATE case). It's a confidence: how
// *stable* the comb's own chosen offset has been recently (`stability`, a
// leaky average of |pending| at the moment each comb run picks it —
// STABILITY_ALPHA). A steady train keeps re-picking an offset near 0
// (nothing left to correct) and stability collapses toward STABILITY_SURE;
// a train that keeps needing a fresh, sizeable correction (no real beat to
// lock onto) keeps stability up near STABILITY_UNSURE or above.
// `confidence` turns that into 0..1 (inverted smoothstep between the two),
// and `tempoLock` eases toward it — quickly while confidence is falling
// (LOCK_DIP_RATE, so a tracker that's lost the plot doesn't keep reading as
// locked), more gradually while it's climbing (LOCK_RISE_RATE, so one good
// hit doesn't flash it to full), and drops out at LOCK_FALL_RATE once bpm
// itself returns to 0 (features.ts's TEMPO_DECAY_SEC).
const BPM_TRACK_RATE = 2; // how fast the internal tempo estimate follows frame.bpm
const BEATS_PER_BAR = 4;

// Comb window/threshold: how much recent hit history a correction is judged
// against, and how many hits have to be in it before the comb runs at all —
// below PHASE_MIN_HITS a single stray onset (or the very first hit of a
// fresh train) has nothing to corroborate it, so no correction is computed
// this tick (see advance()'s own comment).
const PHASE_WINDOW_SEC = 4;
const PHASE_MIN_HITS = 4;
// The candidate-offset grid the comb searches, and how wide a triangular
// kernel each hit's own vote spreads around its nearest candidate.
const PHASE_STEP = 0.025;
const PHASE_KERNEL = 0.06;
// How fast a newly-picked `pending` correction is actually applied to
// `phase`, and the hard per-second cap on how much that can slow the clock
// down — PHASE_MAX_RATE is in beats per second, so the clock's own phase
// rate can never be pulled below (smoothedBpm/60 - PHASE_MAX_RATE); it can
// never run backward, only slower, so beatPhase/beats both stay monotonic
// frame to frame regardless of how large a correction the comb just picked.
const PHASE_RATE = 3;
const PHASE_MAX_RATE = 0.35;
// stability's own easing: how much a freshly-computed |pending| moves the
// leaky average that becomes `confidence` below. Tuned against
// tests/tempoEval.test.ts: STABILITY_ALPHA raised from an initial 0.2 to 0.4
// (faster to both build and shed confidence — see PHASE_BASS's own doc
// below for the other half of that same tuning pass); STABILITY_START
// tried lower (0.1) with no measurable effect (it only matters for the
// first comb run after a fresh bpm>0, not the sustained-but-wrong-tempo
// stretches an eval track like `ramp` actually exercises) and was left at
// its original value.
const STABILITY_START = 0.2;
const STABILITY_ALPHA = 0.4;
// confidence = 1 at/under STABILITY_SURE, 0 at/over STABILITY_UNSURE,
// smoothstepped between.
const STABILITY_SURE = 0.05;
const STABILITY_UNSURE = 0.12;
// tempoLock's own three easing rates — see the file header for when each
// applies. LOCK_DIP_RATE is deliberately faster than LOCK_RISE_RATE: losing
// confidence should read as losing confidence quickly, not fade out at the
// same leisurely pace a fresh lock builds up at.
const LOCK_RISE_RATE = 0.5;
const LOCK_DIP_RATE = 1;
const LOCK_FALL_RATE = 3;

// How much more a bass-weighted hit counts toward the phase comb's vote —
// see src/render/animClock.ts's own hitWeight computation, which reads this.
// Exported from here (not animClock.ts) since it's a property of what the
// comb does with a hit's weight, not of how animClock derives one. Raised
// from an initial 2 to 4 against tests/tempoEval.test.ts (a kick's own vote
// needs to clearly outweigh a busy hat pattern's); animClock.ts's own
// BASS_WEIGHT_FLOOR/BASS_WEIGHT_SPAN mapping was tried both looser and
// tighter and made every track's own lockInTempo worse either way, so it
// stayed at its original values.
export const PHASE_BASS = 4;
// A hit is only noticed on the first render tick after its sound starts
// (features.ts's flux compares whole frames), so every fired beat is late by
// part of a frame — a lag that grows as the frame rate drops, and that the
// comb would otherwise faithfully lock the beat lines onto, landing the
// metronome a little after the kick. Each hit is back-dated by this many of
// its own tick's dtSec before it votes. Swept against tests/tempoEval.test.ts
// at both 60 and 30 fps: this value landed tick offsets closest to zero at
// both rates.
const HIT_LATENCY_FRAMES = 0.75;

function wrap01(x: number): number {
  const w = x % 1;
  return w < 0 ? w + 1 : w;
}

/** Wraps into [-0.5, 0.5) — the signed distance to the nearest whole beat. */
function wrapHalf(x: number): number {
  const w = (((x + 0.5) % 1) + 1) % 1;
  return w - 0.5;
}

function smoothstep01(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

interface Hit {
  t: number; // clockSec at the tick this hit fired
  w: number; // hitWeight passed to advance()
}

export interface BeatClock {
  /** Continuous [0,1) position within the current beat. Free-running —
   *  never resets, only ever nudged toward a detected onset. */
  readonly beatPhase: number;
  /** beatPhase over a BEATS_PER_BAR-beat bar, for effects that should read
   *  once every few beats rather than every single one. */
  readonly barPhase: number;
  /** The same phase unwrapped: beats elapsed since the clock started, for
   *  anything that needs to count beats rather than watch one wrap — the
   *  beat grid (gridPulse.ts) reads this. Free-running like beatPhase. */
  readonly beats: number;
  /** The smoothed tempo this clock is actually running its phase at — see
   *  BPM_TRACK_RATE. Not the same object as the `bpm` advance() is given
   *  each tick (that's the raw, unsmoothed FeatureFrame/wire reading). */
  readonly bpm: number;
  /** 0..1, the phase comb's own raw confidence this tick — see the file
   *  header's account of `stability`. `tempoLock` (below) is what actually
   *  eases toward this; scenes/UI read tempoLock, not this. */
  readonly confidence: number;
  /** 0..1, eases toward `confidence` — see the file header for the three
   *  rates it moves at depending on whether it's rising, dipping while a
   *  tempo is still held, or falling out because bpm itself returned to 0. */
  readonly tempoLock: number;
  /** Advances the clock by dtSec, given this frame's estimated tempo,
   *  whether a beat fired this tick, and (if it did) how strongly —
   *  animClock.ts's own hitWeight, 1 by default so every other caller
   *  (tests, anything not passing one) keeps every fired beat's vote equal.
   *  Call once per render tick. */
  advance(dtSec: number, bpm: number, beatFired: boolean, hitWeight?: number): void;
}

export function createBeatClock(): BeatClock {
  let clockSec = 0;
  let phase = 0; // in beats, free-running, never reset
  let smoothedBpm = 0;
  let tempoLock = 0;
  let pending = 0; // beats of correction still to apply
  let stability = STABILITY_START;
  let confidence = 0;
  let hits: Hit[] = [];

  const clock: BeatClock = {
    beatPhase: 0,
    barPhase: 0,
    beats: 0,
    bpm: 0,
    confidence: 0,
    tempoLock: 0,
    advance(dtSec: number, bpm: number, beatFired: boolean, hitWeight = 1): void {
      clockSec += dtSec;
      const target = Math.max(0, bpm);
      smoothedBpm += (target - smoothedBpm) * Math.min(1, BPM_TRACK_RATE * dtSec);
      phase += dtSec * (smoothedBpm / 60);

      if (bpm <= 0) {
        hits = [];
        pending = 0;
        stability = STABILITY_START;
      }

      if (beatFired && smoothedBpm > 0) {
        hits.push({ t: clockSec - HIT_LATENCY_FRAMES * dtSec, w: hitWeight });
        hits = hits.filter((h) => clockSec - h.t <= PHASE_WINDOW_SEC);
        if (hits.length >= PHASE_MIN_HITS) {
          let bestOffset = 0;
          let bestScore = -Infinity;
          for (let o = -0.5; o < 0.5; o += PHASE_STEP) {
            let score = 0;
            for (const hit of hits) {
              const predicted = phase - (clockSec - hit.t) * (smoothedBpm / 60);
              const d = wrapHalf(predicted - o);
              score += hit.w * Math.max(0, 1 - Math.abs(d) / PHASE_KERNEL);
            }
            if (score > bestScore) {
              bestScore = score;
              bestOffset = o;
            }
          }
          pending = bestOffset;
          stability += (Math.abs(pending) - stability) * STABILITY_ALPHA;
        }
      }

      // Apply the pending correction smoothly, every tick — see PHASE_RATE/
      // PHASE_MAX_RATE's own doc above for the monotonic guarantee this gives.
      const rawStep = pending * Math.min(1, PHASE_RATE * dtSec);
      const cap = PHASE_MAX_RATE * dtSec;
      const step = Math.max(-cap, Math.min(cap, rawStep));
      phase -= step;
      pending -= step;

      confidence = bpm > 0 ? 1 - smoothstep01(STABILITY_SURE, STABILITY_UNSURE, stability) : 0;
      const lockRate = confidence > tempoLock ? LOCK_RISE_RATE : bpm > 0 ? LOCK_DIP_RATE : LOCK_FALL_RATE;
      tempoLock += (confidence - tempoLock) * Math.min(1, lockRate * dtSec);

      (clock as { beatPhase: number }).beatPhase = wrap01(phase);
      (clock as { barPhase: number }).barPhase = wrap01(phase / BEATS_PER_BAR);
      (clock as { beats: number }).beats = phase;
      (clock as { bpm: number }).bpm = smoothedBpm;
      (clock as { confidence: number }).confidence = confidence;
      (clock as { tempoLock: number }).tempoLock = tempoLock;
    },
  };

  return clock;
}
