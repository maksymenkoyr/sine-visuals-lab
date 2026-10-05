import { crossedBeatMultiple, METRONOME_BEATS_PER_BAR } from "./metronome.ts";
import type { AutopilotConfig } from "./sceneSet.ts";

/**
 * The Set's Autopilot as a pure state machine: when to fire the next pad, and
 * which one. app.ts feeds it once per render tick (while the device that
 * hears the music is showing a scene) and acts on the pad id it returns; the
 * card and the key presses only touch it through `restart`.
 *
 * When. Every `everyBars` bars from the last restart, then on the next bar
 * boundary of the metronome's beat count (AnimFrame.metronomeBeats — the
 * steady clock under the Tempo card's BPM, see metronome.ts), the same
 * phrase-aligned change longplay's tour makes (crossedBeatMultiple). So the
 * first change after a manual press comes between N and N+1 bars later, and
 * every one after an Autopilot change lands exactly N bars on: it re-anchors
 * to the boundary it fired on, not to the tick that noticed it. With no
 * settled tempo (`tempo` false — the BPM reads "--") it counts seconds
 * instead, AUTOPILOT_FALLBACK_SEC_PER_BAR a bar. A change between the two
 * clocks restarts the count, since their units differ and the beat count
 * jumps when the metronome starts.
 *
 * Which. In order walks the Set's pads left to right and wraps. Shuffle deals
 * every pad once, in random order, before any repeats, and never opens a new
 * deal with the pad that just played. The cursor is a pad id, so deleting or
 * adding a pad mid-set keeps the walk sensible: an unknown cursor means
 * "before the first pad".
 *
 * With fewer than AUTOPILOT_MIN_PADS pads there is nothing to change to, and
 * it never fires.
 */

/** Seconds a bar takes when there is no tempo to count it in: 120 bpm. */
export const AUTOPILOT_FALLBACK_SEC_PER_BAR = 2;
/** The least pads Autopilot needs. */
export const AUTOPILOT_MIN_PADS = 2;

/** What the clock says this tick. `beats` is AnimFrame.metronomeBeats,
 *  `tempo` is AnimFrame.metronomeOn. */
export interface AutopilotClock {
  timeSec: number;
  beats: number;
  tempo: boolean;
}

export interface AutopilotState {
  /** The pad id last shown (by a press or by Autopilot); null before any. */
  cursor: string | null;
  /** The clock `startBeats`/`startSec` belong to; null before the first step. */
  counting: "beats" | "timer" | null;
  startBeats: number;
  startSec: number;
  lastBeats: number;
  /** Shuffle's undealt pads this round. */
  bag: string[];
}

export function createAutopilot(): AutopilotState {
  return { cursor: null, counting: null, startBeats: 0, startSec: 0, lastBeats: 0, bag: [] };
}

/** A pad was shown by hand (or Autopilot just turned on): that pad is the
 *  cursor and the bar count starts over, from the next step. */
export function restartAutopilot(s: AutopilotState, padId: string | null): void {
  s.cursor = padId;
  s.counting = null;
  s.bag = [];
}

function nextInOrder(ids: readonly string[], cursor: string | null): string {
  const at = cursor === null ? -1 : ids.indexOf(cursor);
  return ids[(at + 1) % ids.length]!;
}

function nextShuffled(s: AutopilotState, ids: readonly string[], random: () => number): string {
  s.bag = s.bag.filter((id) => ids.includes(id) && id !== s.cursor);
  if (s.bag.length === 0) s.bag = ids.filter((id) => id !== s.cursor);
  const i = Math.min(s.bag.length - 1, Math.floor(random() * s.bag.length));
  return s.bag.splice(i, 1)[0]!;
}

/** The pad id to show now, or null. `padIds` is the Set in pad order. */
export function stepAutopilot(
  s: AutopilotState,
  clock: AutopilotClock,
  config: AutopilotConfig,
  padIds: readonly string[],
  random: () => number = Math.random,
): string | null {
  const counting = clock.tempo ? "beats" : "timer";
  const prevBeats = s.lastBeats;
  s.lastBeats = clock.beats;
  if (!config.on || padIds.length < AUTOPILOT_MIN_PADS) {
    s.counting = null; // a count only runs while it can fire
    return null;
  }
  if (s.counting !== counting || clock.beats < s.startBeats) {
    s.counting = counting;
    s.startBeats = clock.beats;
    s.startSec = clock.timeSec;
    return null;
  }
  const due =
    counting === "beats"
      ? clock.beats - s.startBeats >= config.everyBars * METRONOME_BEATS_PER_BAR &&
        crossedBeatMultiple(prevBeats, clock.beats, METRONOME_BEATS_PER_BAR)
      : clock.timeSec - s.startSec >= config.everyBars * AUTOPILOT_FALLBACK_SEC_PER_BAR;
  if (!due) return null;
  const id = config.order === "shuffle" ? nextShuffled(s, padIds, random) : nextInOrder(padIds, s.cursor);
  s.cursor = id;
  s.startBeats = Math.floor(clock.beats / METRONOME_BEATS_PER_BAR) * METRONOME_BEATS_PER_BAR;
  s.startSec = clock.timeSec;
  return id;
}
