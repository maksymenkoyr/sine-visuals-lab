import { METRONOME_BEATS_PER_BAR } from "./metronome.ts";

/**
 * Beat trim: a pure correction layer between the tempo clocks
 * (beatClock.ts/metronome.ts) and AnimFrame — a bar resync ("this beat is
 * the 1"), a ×2/÷2 tracking-error fix, and a small earlier/later nudge, the
 * three controls every VJ tool gives the operator because a tempo tracker
 * can't infer them on its own.
 *
 * Why: both clocks put bar beat 1 at floor(beats / METRONOME_BEATS_PER_BAR)
 * — an arbitrary beat (see beatClock.ts's own header and beatGrid.ts's "no
 * downbeat detector" note). metronome.ts only ever corrects *sub-beat*
 * phase toward beatClock, so a whole-beat bar error is never fixed on its
 * own — every bar-timed thing (Bar wave, Metronome bar, bar/multi-bar beat
 * grids, uBarPhase, a scene's one-bar morphs) lands on beat 2/3/4 three
 * times in four. A tracker can also lock onto half or double the actual
 * tempo, and a hurried/rushed reading always benefits from a small
 * earlier/later nudge. This module owns none of the tracking itself — it
 * only reshapes whatever beatClock.ts/metronome.ts already produced, so
 * it's a pure function of (their output, this module's own settings), safe
 * to bypass entirely by construction (see IDENTITY below).
 *
 * Two independent instances: animClock.ts runs one BeatTrimmer on top of
 * beatClock.ts's own beats ("clockTrim") and a second on top of
 * metronome.ts's own beats ("metroTrim") — see that file for the wiring.
 * Only the metronome's trimmer's ticks (beatTick/barTick) are actually read
 * anywhere; the clock's own trimmer only ever contributes its continuous
 * beats/beatPhase/barPhase/bpm.
 *
 * THE STORE below is session-only module state (not persisted — a VJ
 * resyncs live, per session, and never wants an earlier gig's nudge
 * creeping back in) that src/app.ts's keys write to, and every BeatTrimmer
 * reads a fresh snapshot of once per tick. `offsetMs > 0` means visuals run
 * AHEAD (earlier) by that many ms. `resyncSeq` is a counter, not an edge
 * flag, so every independent BeatTrimmer (app.ts's live clock, its
 * idle-preview clock, tv.ts's own) notices and applies a resync on its own
 * next tick, however many already have.
 *
 * THE MATH (advance(), below) keeps an affine map from the input beats to
 * the output: `out = in*m + k`, `m` the applied multiplier and `k` a
 * carried anchor, plus a small time-based nudge on top. A multiplier change
 * recomputes `k` (rounded onto the new multiplier's own grid — 1 for
 * ×1/×2, 0.5 for ÷2 — via Math.ceil, which can only push `k` up, never
 * down) so the map stays continuous at the instant of the change and never
 * steps backward; a resync recomputes `k` so the output beat nearest the
 * keypress becomes an exact multiple of METRONOME_BEATS_PER_BAR (bar beat
 * 1), also only ever moving `k` up (0..METRONOME_BEATS_PER_BAR-1 beats).
 * IDENTITY: at the default `m===1, k===0, offsetMs===0`, advance() returns
 * the input beats/bpm bit-for-bit (an explicit branch guarantees this,
 * belt-and-suspenders over the IEEE754 arithmetic already being exact
 * there) — a session that never touches a beat-trim key is bit-identical to
 * one running before this file existed. `npm run eval:tempo`
 * (tests/tempoEval.test.ts) is the proof: its whole table must come out
 * unchanged, since every track it scores takes this default path
 * throughout.
 */

export type TempoMultiplier = 0.5 | 1 | 2;
const TEMPO_MULTIPLIERS: readonly TempoMultiplier[] = [0.5, 1, 2];

/** How far a nudge (Comma/Period in app.ts) can push offsetMs either way. */
export const BEAT_OFFSET_MAX_MS = 250;

export interface BeatTrimSettings {
  multiplier: TempoMultiplier;
  /** > 0 = visuals run this many ms AHEAD (earlier); < 0 = behind (later). */
  offsetMs: number;
  /** Bumped by requestBarResync() — a counter, not an edge flag; see the
   *  file header for why. */
  resyncSeq: number;
}

let multiplier: TempoMultiplier = 1;
let offsetMs = 0;
let resyncSeq = 0;

/** This tick's settings — a fresh snapshot, cheap (three numbers), so every
 *  BeatTrimmer reading it independently can never see another's mutation
 *  mid-tick. */
export function getBeatTrim(): BeatTrimSettings {
  return { multiplier, offsetMs, resyncSeq };
}

/** "This beat is the 1" — the next tick any BeatTrimmer advances, it makes
 *  the output beat nearest *that* tick's own input beats the start of a
 *  bar. See advance()'s resync case for the math. */
export function requestBarResync(): void {
  resyncSeq += 1;
}

/** ½ ↔ 1 ↔ 2, clamped at either end (a press past ×2 or ÷2 is a no-op,
 *  same value returned). */
export function stepTempoMultiplier(dir: 1 | -1): TempoMultiplier {
  const i = TEMPO_MULTIPLIERS.indexOf(multiplier);
  const next = Math.min(TEMPO_MULTIPLIERS.length - 1, Math.max(0, i + dir));
  multiplier = TEMPO_MULTIPLIERS[next]!;
  return multiplier;
}

/** Nudges offsetMs by deltaMs, clamped to ±BEAT_OFFSET_MAX_MS. */
export function nudgeBeatOffset(deltaMs: number): number {
  offsetMs = Math.min(BEAT_OFFSET_MAX_MS, Math.max(-BEAT_OFFSET_MAX_MS, offsetMs + deltaMs));
  return offsetMs;
}

/** Back to ×1 with no nudge — the bar anchor a resync set is deliberately
 *  left alone (a VJ clearing a tracking-error fix shouldn't also lose where
 *  they told it the 1 was). */
export function resetBeatTrim(): void {
  multiplier = 1;
  offsetMs = 0;
}

/** Same shape as beatClock.ts's own (unexported) wrap01 — duplicated, not
 *  imported, the way metronome.ts already duplicates its own wrap01/
 *  wrapHalf: a tiny pure helper, and identity here depends on this
 *  producing bit-exactly what beatClock.ts's own wrap01 would for the same
 *  input. */
function wrap01(x: number): number {
  const w = x % 1;
  return w < 0 ? w + 1 : w;
}

export interface TrimmedBeats {
  beats: number;
  beatPhase: number;
  barPhase: number;
  bpm: number;
  /** One-shot: true only on the advance() call whose beats crossed a whole
   *  beat — same shape as metronome.ts's own beatTick, and only meaningful
   *  for a trimmer sitting on top of a clock that itself has ticks to
   *  correct (animClock.ts's metroTrim; clockTrim computes these too, but
   *  nothing reads them there). Never true on an arm tick (bootstrap, a
   *  multiplier change, a resync, or an explicit rearm()) — see advance(). */
  beatTick: boolean;
  /** Same rule as beatTick, on a METRONOME_BEATS_PER_BAR-beat boundary. */
  barTick: boolean;
}

export interface BeatTrimmer {
  /** Advances by one tick, given the underlying clock's own current beats
   *  and bpm and this tick's BeatTrimSettings snapshot. Pure: the same
   *  inputs plus this trimmer's own prior calls always produce the same
   *  output — no clock/timer reads inside. Call once per render tick, right
   *  after the clock it's trimming. */
  advance(inBeats: number, inBpm: number, s: BeatTrimSettings): TrimmedBeats;
  /** Arms this trimmer so its *next* advance() call establishes a fresh
   *  tick baseline instead of comparing against the last one — no
   *  beatTick/barTick fires for whatever jump that call's own inBeats
   *  happens to be. Use right after the underlying clock itself jumped
   *  (metronome.ts adopting a fresh tempo) so the jump isn't mistaken for
   *  real beats crossed. */
  rearm(): void;
  /** Copies another trimmer's current multiplier and anchor (not its
   *  resync/tick state) — metroTrim adopting clockTrim's own correction the
   *  moment metronome.ts itself adopts clockTrim's beats, so the two stay
   *  consistent rather than metroTrim re-deriving its own anchor against a
   *  stale, possibly idle-frozen `inBeats`. A caller wanting a clean tick
   *  baseline too should also call rearm(). */
  adoptFrom(other: BeatTrimmer): void;
}

interface TrimmerState {
  m: TempoMultiplier;
  k: number;
  lastSeq: number | null;
  lastFloor: number;
  lastBarFloor: number;
  lastTickVal: number;
  armed: boolean;
}

// Keyed off each trimmer's own public handle so adoptFrom can reach another
// trimmer's private state without putting m/k on the BeatTrimmer interface
// itself (which would let a scene poke at them directly) — nothing outside
// this module ever needs to read a TrimmerState.
const stateOf = new WeakMap<BeatTrimmer, TrimmerState>();

export function createBeatTrimmer(): BeatTrimmer {
  const state: TrimmerState = {
    m: 1,
    k: 0,
    lastSeq: null,
    lastFloor: 0,
    lastBarFloor: 0,
    lastTickVal: -Infinity,
    armed: false,
  };

  const trimmer: BeatTrimmer = {
    advance(inBeats: number, inBpm: number, s: BeatTrimSettings): TrimmedBeats {
      // First call ever: a resync requested before this trimmer existed is
      // not retroactively applied (see requestBarResync's own doc) — just
      // adopt whatever resyncSeq is already at, and arm (no tick from the
      // very first reading having "crossed" from nothing).
      if (state.lastSeq === null) {
        state.lastSeq = s.resyncSeq;
        state.armed = true;
      }

      // Multiplier change: keep the map continuous at this instant by
      // solving k so in*m2+k lands where in*m+k (the old map) already was,
      // then round that k up onto the new multiplier's own grid (g) — see
      // the file header for why Math.ceil (never backward) and why g is
      // 0.5 only for ÷2.
      if (s.multiplier !== state.m) {
        const out0 = inBeats * state.m + state.k;
        const m2 = s.multiplier;
        const g = m2 === 0.5 ? 0.5 : 1;
        state.k = g * Math.ceil((out0 - inBeats * m2) / g);
        state.m = m2;
        state.armed = true;
      }

      // Resync: push k forward just far enough (0..METRONOME_BEATS_PER_BAR-1
      // output beats) that the output beat nearest this instant becomes an
      // exact multiple of METRONOME_BEATS_PER_BAR — bar beat 1.
      if (s.resyncSeq !== state.lastSeq) {
        const out0 = inBeats * state.m + state.k;
        const n = Math.round(out0);
        const j = ((-n % METRONOME_BEATS_PER_BAR) + METRONOME_BEATS_PER_BAR) % METRONOME_BEATS_PER_BAR;
        state.k += j;
        state.lastSeq = s.resyncSeq;
        state.armed = true;
      }

      const out = inBeats * state.m + state.k;
      let outF = out + (s.offsetMs / 1000) * ((inBpm * state.m) / 60);
      // Identity guarantee — see the file header. Already exact under
      // IEEE754 (in*1+0 and +0 change nothing), made explicit so nothing
      // above can ever cost this a bit.
      if (state.m === 1 && state.k === 0 && s.offsetMs === 0) outF = inBeats;

      // Ticks: a running max so a "later" nudge easing outF back a hair
      // right after a tick can never make that same tick fire again (it can
      // still nudge the *returned* beats/beatPhase back a hair — only the
      // tick edge is protected). An armed tick establishes lastFloor/
      // lastBarFloor from this instant without comparing (nothing to
      // compare a bootstrap/jump against).
      const tickVal = Math.max(outF, state.lastTickVal);
      let beatTick = false;
      let barTick = false;
      if (state.armed) {
        state.lastFloor = Math.floor(tickVal);
        state.lastBarFloor = Math.floor(tickVal / METRONOME_BEATS_PER_BAR);
        state.armed = false;
      } else {
        const floorNow = Math.floor(tickVal);
        beatTick = floorNow > state.lastFloor;
        state.lastFloor = floorNow;
        const barFloorNow = Math.floor(tickVal / METRONOME_BEATS_PER_BAR);
        barTick = barFloorNow > state.lastBarFloor;
        state.lastBarFloor = barFloorNow;
      }
      state.lastTickVal = tickVal;

      return {
        beats: outF,
        beatPhase: wrap01(outF),
        barPhase: wrap01(outF / METRONOME_BEATS_PER_BAR),
        bpm: inBpm * state.m,
        beatTick,
        barTick,
      };
    },
    rearm(): void {
      state.armed = true;
    },
    adoptFrom(other: BeatTrimmer): void {
      const o = stateOf.get(other);
      if (!o) return;
      state.m = o.m;
      state.k = o.k;
    },
  };

  stateOf.set(trimmer, state);
  return trimmer;
}
