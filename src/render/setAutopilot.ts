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
 * Ahead. peekAutopilot chooses the next pad before it fires and says how many
 * bars are left, so the desk can show it and count down to it; stepAutopilot
 * then fires that same pad. skipAutopilotPick swaps the pick for another one
 * without moving the walk or the count.
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
  /** The pad it will fire next, chosen ahead by peekAutopilot; null until asked. */
  pick: string | null;
}

export function createAutopilot(): AutopilotState {
  return { cursor: null, counting: null, startBeats: 0, startSec: 0, lastBeats: 0, bag: [], pick: null };
}

/** A pad was shown by hand (or Autopilot just turned on): that pad is the
 *  cursor and the bar count starts over, from the next step. */
export function restartAutopilot(s: AutopilotState, padId: string | null): void {
  s.cursor = padId;
  s.counting = null;
  s.bag = [];
  s.pick = null;
}

function nextInOrder(ids: readonly string[], cursor: string | null): string {
  const at = cursor === null ? -1 : ids.indexOf(cursor);
  return ids[(at + 1) % ids.length]!;
}

/** Callers guarantee at least one pad outside `avoid`. */
function nextShuffled(
  s: AutopilotState,
  ids: readonly string[],
  avoid: ReadonlyArray<string | null>,
  random: () => number,
): string {
  s.bag = s.bag.filter((id) => ids.includes(id) && !avoid.includes(id));
  if (s.bag.length === 0) s.bag = ids.filter((id) => !avoid.includes(id));
  const i = Math.min(s.bag.length - 1, Math.floor(random() * s.bag.length));
  return s.bag.splice(i, 1)[0]!;
}

/** The pad after the one showing now, in the configured order. */
function choose(s: AutopilotState, ids: readonly string[], config: AutopilotConfig, random: () => number): string {
  return config.order === "shuffle" ? nextShuffled(s, ids, [s.cursor], random) : nextInOrder(ids, s.cursor);
}

/** Bars until the next change, from the count the machine is running. */
function barsLeft(s: AutopilotState, clock: AutopilotClock, config: AutopilotConfig): number {
  if (s.counting === "beats") {
    return Math.max(
      0,
      Math.ceil((config.everyBars * METRONOME_BEATS_PER_BAR - (clock.beats - s.startBeats)) / METRONOME_BEATS_PER_BAR),
    );
  }
  if (s.counting === "timer") {
    return Math.max(
      0,
      Math.ceil(
        (config.everyBars * AUTOPILOT_FALLBACK_SEC_PER_BAR - (clock.timeSec - s.startSec)) /
          AUTOPILOT_FALLBACK_SEC_PER_BAR,
      ),
    );
  }
  return config.everyBars;
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
  const id = s.pick !== null && padIds.includes(s.pick) ? s.pick : choose(s, padIds, config, random);
  s.pick = null;
  s.cursor = id;
  s.startBeats = Math.floor(clock.beats / METRONOME_BEATS_PER_BAR) * METRONOME_BEATS_PER_BAR;
  s.startSec = clock.timeSec;
  return id;
}

/** The pad the next change will show, and the bars until it. Chooses the pad
 *  now if none is picked yet, exactly as stepAutopilot would, and keeps it for
 *  that step. Moves neither the cursor nor the count. Null when Autopilot is
 *  off or there are too few pads. */
export function peekAutopilot(
  s: AutopilotState,
  clock: AutopilotClock,
  config: AutopilotConfig,
  padIds: readonly string[],
  random: () => number = Math.random,
): { padId: string; inBars: number } | null {
  if (!config.on || padIds.length < AUTOPILOT_MIN_PADS) return null;
  let pick = s.pick;
  if (pick === null || !padIds.includes(pick)) {
    pick = choose(s, padIds, config, random);
    s.pick = pick;
  }
  return { padId: pick, inBars: barsLeft(s, clock, config) };
}

/** Swaps the pick for another pad. In order, the pad after the skipped one
 *  (as if the skipped one had played). In shuffle, a pad drawn from the bag
 *  that is neither the skipped one nor the pad showing now; the skipped pad
 *  leaves this deal. With no other pad to draw, the pick stays. The cursor and
 *  the count are untouched. */
export function skipAutopilotPick(
  s: AutopilotState,
  config: AutopilotConfig,
  padIds: readonly string[],
  random: () => number = Math.random,
): void {
  if (!config.on || padIds.length < AUTOPILOT_MIN_PADS) return;
  const current = s.pick !== null && padIds.includes(s.pick) ? s.pick : choose(s, padIds, config, random);
  if (config.order !== "shuffle") {
    s.pick = nextInOrder(padIds, current);
    return;
  }
  if (padIds.every((id) => id === s.cursor || id === current)) {
    s.pick = current;
    return;
  }
  s.pick = nextShuffled(s, padIds, [s.cursor, current], random);
}
