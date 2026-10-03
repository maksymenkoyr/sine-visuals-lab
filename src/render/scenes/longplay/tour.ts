// Which view Long Play shows, and when it mixes to the next one — a pure
// state machine (tests/longplay.test.ts) so none of it needs a GL context.
//
// What it imitates, measured on the reference set (docs/scenes/longplay.md):
// the VJ holds a view for minutes and then *mixes* into the next one over a
// few seconds — a crossfade, never a cut. The changes don't follow the
// music's track changes (no closer to them than chance), so the hold is a
// plain timer ("Hold", minutes). The mix itself starts on a phrase start,
// which is what the reference's within-view changes favour; our runtime has
// no downbeat, so "phrase start" here is the next multiple of PHRASE_BEATS
// on the beat clock's own count — right length, arbitrary phase. A real
// phrase phase is a to-do for src/render/beatClock.ts, not this file.
//
// Picking a view by hand mixes to it at once. A view that becomes locked
// (Pro, src/render/pro.ts) is never toured to, and the tour walks the views
// in order, skipping locked ones.

export const PHRASE_BEATS = 16;
/** The mix's length in beats — two bars. */
export const MIX_BEATS = 8;
/** Without a beat clock (silence, no tempo yet), how long to wait for a
 *  phrase start before mixing anyway, and how long a mix takes at the
 *  least: two bars at 120 bpm. */
export const PHRASE_WAIT_SEC = 8;
export const MIX_MIN_SEC = 4;

export interface TourState {
  /** The view on screen (the one being mixed *from* during a mix). */
  cur: number;
  /** The view being mixed to; equals `cur` when not mixing. */
  next: number;
  mixing: boolean;
  /** 0..1 progress of the current mix (raw, not eased). */
  mix: number;
  mixStartBeat: number;
  mixStartSec: number;
  /** Seconds `cur` has been fully on screen. */
  heldSec: number;
  /** When the hold ran out and the tour started waiting for a phrase start. */
  waitStartSec: number | null;
  /** The View setting's value last frame — a change means a hand pick. */
  lastPick: number;
  lastBeats: number;
}

export interface TourInput {
  timeSec: number;
  dtSec: number;
  /** Unwrapped beat count (AnimFrame.beats). */
  beats: number;
  /** The View setting (already clamped, so never a locked option). */
  pick: number;
  /** Auto change on. */
  auto: boolean;
  holdSec: number;
  count: number;
  locked: (index: number) => boolean;
}

export function createTour(pick: number, beats = 0): TourState {
  return {
    cur: pick,
    next: pick,
    mixing: false,
    mix: 0,
    mixStartBeat: beats,
    mixStartSec: 0,
    heldSec: 0,
    waitStartSec: null,
    lastPick: pick,
    lastBeats: beats,
  };
}

/** The next view after `from` that isn't locked, walking forward; `from`
 *  itself when every other view is locked. */
export function nextOpenView(from: number, count: number, locked: (i: number) => boolean): number {
  for (let k = 1; k < count; k++) {
    const i = (from + k) % count;
    if (!locked(i)) return i;
  }
  return from;
}

function startMix(s: TourState, to: number, input: TourInput): void {
  s.next = to;
  s.mixing = to !== s.cur;
  s.mix = 0;
  s.mixStartBeat = input.beats;
  s.mixStartSec = input.timeSec;
  s.waitStartSec = null;
}

export function stepTour(s: TourState, input: TourInput): TourState {
  const { timeSec, beats, pick, count, locked } = input;

  // A view that is now locked (or out of range) leaves the screen at once.
  if (s.cur >= count || locked(s.cur)) {
    s.cur = pick;
    s.next = pick;
    s.mixing = false;
    s.heldSec = 0;
  }

  if (pick !== s.lastPick) {
    // A hand pick mixes from whatever is mostly on screen right now.
    if (s.mixing && s.mix > 0.5) s.cur = s.next;
    s.lastPick = pick;
    startMix(s, pick, input);
  } else if (s.mixing) {
    const byBeats = (beats - s.mixStartBeat) / MIX_BEATS;
    const bySec = (timeSec - s.mixStartSec) / MIX_MIN_SEC;
    s.mix = Math.min(1, Math.max(byBeats, bySec, 0));
    if (s.mix >= 1) {
      s.cur = s.next;
      s.mixing = false;
      s.mix = 0;
      s.heldSec = 0;
    }
  } else {
    s.heldSec += input.dtSec;
    if (input.auto && s.heldSec >= input.holdSec) {
      if (s.waitStartSec === null) s.waitStartSec = timeSec;
      const phraseStart = Math.floor(beats / PHRASE_BEATS) > Math.floor(s.lastBeats / PHRASE_BEATS);
      if (phraseStart || timeSec - s.waitStartSec >= PHRASE_WAIT_SEC) {
        startMix(s, nextOpenView(s.cur, count, locked), input);
      }
    }
  }
  s.lastBeats = beats;
  return s;
}

/** The eased mix weight of `next` over `cur` — what the blend draws. */
export function mixWeight(s: TourState): number {
  if (!s.mixing) return 0;
  const t = s.mix;
  return t * t * (3 - 2 * t);
}
