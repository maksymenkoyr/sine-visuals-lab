// Copied from audio-subsystem/v6/src/song/v4 (2026-10-30, #798/#800), which is v4's code with the browser-storage reads and writes cut; the bench check (bench-signals' probe app-song) holds it equal to v6. Edits: import paths, unused code removed.
import { RESYNC_RATIO } from "../../src/metronome.ts";

/**
 * Tap tempo: tap Ctrl (src/app.ts) or the Tempo card's Tap button
 * (src/ui/audioMeters.ts) on every beat, and the tracker takes the tapped
 * tempo and beat — as a correction it then keeps refining, not a clock that
 * replaces it. The sibling of beatTrim.ts's beat keys (B, [ ], , .): the
 * same kind of session-only store, the same "counter, not edge flag" so
 * every clock that reads it notices on its own next tick, and the same
 * reach — only this window's own clocks. The pop-out output window and a
 * paired TV run their own anim clock off the feature frames and never see
 * a beat key or a tap.
 *
 * THE ESTIMATE (fitTaps). A run of taps ends after a gap longer than
 * TAP_GAP_SEC; only the latest TAP_MAX_TAPS count. The run is fitted by
 * least squares of tap time against beat number: the slope is the beat
 * length and the line itself says where the beats fall, so every tap in the
 * run pulls on both and timing jitter averages out over the whole run
 * rather than gap by gap (a median of the gaps alone gives no phase, and a
 * mean of the gaps only ever hears the first and last tap). What makes the
 * fit robust is the numbering. Each tap is numbered by walking from a
 * starting tap at the median gap, measured from the last tap kept (so a
 * small error in the median never adds up along the run); a tap more than
 * TAP_TOLERANCE of a beat off that grid is a stray and is left out — the
 * Ctrl of a Ctrl+<key> chord, a double press — and a skipped beat just takes
 * the next number. Every tap is tried as the start and the numbering that
 * keeps the most taps wins, so a stray first tap can't throw off the rest;
 * then every tap is numbered again against that first line (the closest
 * tap wins a number) and the line fitted once more. Taps are beats, not bar
 * starts: B still says where the 1 is. The result has to sit in the
 * tracker's own range (BPM_MIN..BPM_MAX), which it can't hold a tempo
 * outside of. A tap just past an end — within metronome.ts's RESYNC_RATIO,
 * its line for "the same tempo" — is clamped to it; one further out is
 * halved or doubled into it instead, which keeps every tapped beat on a beat
 * line where a clamp would tick off the taps (eighth notes tapped on a fast
 * song, a very slow song tapped at its own pace).
 *
 * THE STORE. Once TAP_MIN_TAPS taps fit, and again on every tap after that,
 * the fitted tempo and the time of the latest tapped beat take effect:
 * `seq` goes up, and beatTrim.ts's ×2/÷2 and nudge go back to none
 * (resetBeatTrim — the tap is exactly what was tapped; B's bar anchor
 * stays). releaseTapTempo() (Shift+B, with the beat trim) hands the tempo
 * back to the tracker.
 *
 * WHERE IT MEETS THE TRACKER (createTapGuide, run by animClock.ts). The
 * tracker is three layers: the raw estimate (tempoComb.ts, in the audio
 * worklet or features.ts), which picks the octave; beatClock.ts, a smoothed
 * tempo and a phase comb over the hits; and metronome.ts over
 * tempoSettle.ts, the Tempo card's number and the steady tick. The
 * narrowest place to steer all three is where the raw reading enters the
 * render side, in animClock.ts, as a seed and a hint:
 *  - the seed: beatClock.seed() and metronome.seed() take the tapped tempo
 *    and beat on the next tick (the Tempo card shows the metronome's
 *    tempo, so it reads the tap at once), and tempoSettle.hold() holds it
 *    as a tempo the tracker is sure of;
 *  - the hint, fold(): while guided, a raw reading that sits at one of the
 *    ratios in TAP_FAMILY of the guided tempo — within metronome.ts's
 *    RESYNC_RATIO, its own line for "the same tempo" — is divided back onto
 *    it. The tracker's octave or ratio choice lands on the tap's, while
 *    everything finer still comes from the music: the clock eases to the
 *    reading's exact tempo, the comb corrects the phase, the metronome
 *    follows both, and the guided tempo follows the metronome as it drifts.
 *    When the reading sits at twice the tap, the comb is also told to judge
 *    the hits against every half beat (beatClock.setDivision — see that
 *    file's header for the measured reason), so the music's faster pulse
 *    still corrects the timing but the tap alone says which pulse is the
 *    beat.
 * Not inside the estimator itself: it runs on the audio thread, and its
 * reading rides the wire to every paired device, which the beat keys never
 * touch. Guidance ends (follow()) when the metronome stops — the tracker
 * hears no tempo at all — or retunes to a tempo outside the family, so the
 * existing retune rule (tempoSettle.ts's RETUNE_SURE_SEC/RETUNE_UNSURE_SEC)
 * decides when the music has really moved on; there is no timer of its own.
 */

/** The ratios a tracker's reading may sit at against the tapped tempo and
 *  still be the tapped tempo, heard in another octave or ratio. */
const TAP_FAMILY: readonly number[] = [1, 2, 0.5, 1.5, 2 / 3];











// ---- The store (see the file header) ----

let seq = 0;
let tappedBpm = 0;
let anchorMs = 0;
let releaseSeq = 0;

interface TapTempoState {
  /** Goes up every time a tap tempo takes effect. */
  seq: number;
  /** The tapped tempo, 0 before the first. */
  bpm: number;
  /** A tapped beat's time, on performance.now()'s clock. */
  anchorMs: number;
  /** Goes up on every releaseTapTempo(). */
  releaseSeq: number;
}

/** This tick's store — a fresh snapshot, like beatTrim.ts's getBeatTrim(). */
function getTapTempo(): TapTempoState {
  return { seq, bpm: tappedBpm, anchorMs, releaseSeq };
}





// ---- The guide (see the file header's "where it meets the tracker") ----

interface TapSeed {
  bpm: number;
  /** [0,1) beat phase at the instant poll() was given. */
  beatPhase: number;
}

export interface TapGuide {
  /** True from a tap taking effect until the tracker moves on (or Shift+B). */
  readonly guided: boolean;
  /** 2 while the last fold() found the reading at twice the guided tempo,
   *  else 1 — beatClock.setDivision's argument (see the file header). */
  readonly division: 1 | 2;
  /** Reads the store once per tick. A tap tempo that took effect since the
   *  last call comes back as the tempo and the beat phase at `atMs` (on
   *  performance.now()'s clock) for the caller to seed; otherwise null. The
   *  very first call only adopts the store's counters, like a beat trimmer:
   *  a tap from before this guide existed is not applied. */
  poll(atMs: number): TapSeed | null;
  /** `rawBpm` (the tracker's reading; 0 = none), divided back onto the
   *  guided tempo when it sits at a ratio in TAP_FAMILY of it. Unchanged
   *  whenever not guided. */
  fold(rawBpm: number): number;
  /** Call after the metronome advanced: guidance ends once it isn't running
   *  or ticks outside RESYNC_RATIO of the guided tempo; otherwise the guided
   *  tempo follows it. */
  follow(running: boolean, metronomeBpm: number): void;
}

function wrap01(x: number): number {
  const w = x % 1;
  return w < 0 ? w + 1 : w;
}

export function createTapGuide(): TapGuide {
  let lastSeq: number | null = null;
  let lastRelease = 0;
  let ref = 0;

  function setGuided(on: boolean): void {
    (guide as { guided: boolean }).guided = on;
    if (!on) setDivision(1);
  }

  function setDivision(division: 1 | 2): void {
    (guide as { division: 1 | 2 }).division = division;
  }

  const guide: TapGuide = {
    guided: false,
    division: 1,
    poll(atMs: number): TapSeed | null {
      const s = getTapTempo();
      if (lastSeq === null) {
        lastSeq = s.seq;
        lastRelease = s.releaseSeq;
        return null;
      }
      if (s.releaseSeq !== lastRelease) {
        lastRelease = s.releaseSeq;
        setGuided(false);
      }
      if (s.seq === lastSeq) return null;
      lastSeq = s.seq;
      if (!(s.bpm > 0)) return null;
      ref = s.bpm;
      setGuided(true);
      return { bpm: s.bpm, beatPhase: wrap01(((atMs - s.anchorMs) * s.bpm) / 60000) };
    },
    fold(rawBpm: number): number {
      if (!guide.guided) return rawBpm;
      if (rawBpm > 0) {
        for (const ratio of TAP_FAMILY) {
          if (Math.abs(rawBpm / (ref * ratio) - 1) <= RESYNC_RATIO) {
            setDivision(ratio === 2 ? 2 : 1);
            return rawBpm / ratio;
          }
        }
      }
      setDivision(1);
      return rawBpm;
    },
    follow(running: boolean, metronomeBpm: number): void {
      if (!guide.guided) return;
      if (!running || !(Math.abs(metronomeBpm / ref - 1) <= RESYNC_RATIO)) {
        setGuided(false);
        return;
      }
      ref = metronomeBpm;
    },
  };
  return guide;
}
