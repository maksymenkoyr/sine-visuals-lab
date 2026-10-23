import { METRONOME_BEATS_PER_BAR } from "../../audio-subsystem/src/metronome.ts";

/**
 * The one queue of pad launches shared by the desk's Pads row, the full Pads
 * view and the Timeline (#623, #624). Pressing a pad does not show it at once
 * when a launch line is set: it is queued for the next line on the beat clock,
 * and app.ts feeds `takeDue` a beat count every tick (the metronome's beats,
 * or seconds at Autopilot's fallback rate when there is no tempo) and fires
 * whatever comes due, the same way Autopilot fires a change.
 *
 * Beat counts are the metronome's unwrapped beats (metronome.ts). A launch
 * time is an absolute beat count, so a queued launch keeps its line even if
 * the tempo changes after it was queued; the queue is sorted by that count,
 * which `takeDue` relies on.
 *
 * The launch line is one device's own choice (PRIVATE_KEYS in
 * net/syncedStores.ts), kept in an in-memory cache seeded once from
 * localStorage, the same shape as render/sceneTransition.ts without the
 * synced-store hook.
 */

export type LaunchOn = "now" | "beat" | "bar" | "4bars" | "phrase";
export const LAUNCH_ON: readonly LaunchOn[] = ["now", "beat", "bar", "4bars", "phrase"];
export const LAUNCH_ON_LABELS: Record<LaunchOn, string> = {
  now: "Now",
  beat: "Beat",
  bar: "Bar",
  "4bars": "4 bars",
  phrase: "Phrase line",
};
export const LAUNCH_ON_DEFAULT: LaunchOn = "bar";
/** Bars in a phrase: the Timeline's phrase lines and "Phrase line" launches. */
export const PHRASE_BARS = 8;

export interface QueuedLaunch {
  padId: string;
  atBeats: number;
}

const KEY = "vibe.launchOn";

function lineSize(on: Exclude<LaunchOn, "now">, beatsPerBar: number): number {
  if (on === "beat") return 1;
  if (on === "bar") return beatsPerBar;
  if (on === "4bars") return 4 * beatsPerBar;
  return PHRASE_BARS * beatsPerBar;
}

/** The beat count a launch pressed at `nowBeats` lands on: the next line
 *  strictly after now ("now" lands at nowBeats). A press a hair before a line
 *  counts as on it, so float noise in the beat clock cannot skip a bar. */
export function launchBeat(nowBeats: number, on: LaunchOn, beatsPerBar = METRONOME_BEATS_PER_BAR): number {
  if (on === "now") return nowBeats;
  const size = lineSize(on, beatsPerBar);
  return (Math.floor(nowBeats / size + 1e-9) + 1) * size;
}

/** The queue with `padId` at `atBeats`, replacing any launch already at that
 *  beat; sorted by atBeats. Never mutates. */
export function queueLaunch(queue: readonly QueuedLaunch[], padId: string, atBeats: number): QueuedLaunch[] {
  return [...queue.filter((q) => q.atBeats !== atBeats), { padId, atBeats }].sort((a, b) => a.atBeats - b.atBeats);
}

/** The queue without the launch at `atBeats`. Never mutates. */
export function cancelLaunch(queue: readonly QueuedLaunch[], atBeats: number): QueuedLaunch[] {
  return queue.filter((q) => q.atBeats !== atBeats);
}

/** Splits off what is due at `beats` (atBeats <= beats). When several are due
 *  at once only the last counts, so a pad queued for a later line is not fired
 *  by an earlier one; the others are dropped. Expects a queue from queueLaunch
 *  (sorted by atBeats). */
export function takeDue(
  queue: readonly QueuedLaunch[],
  beats: number,
): { due: QueuedLaunch | null; rest: QueuedLaunch[] } {
  const due = queue.filter((q) => q.atBeats <= beats);
  return {
    due: due.length > 0 ? due[due.length - 1]! : null,
    rest: queue.filter((q) => q.atBeats > beats),
  };
}

function parseLaunchOn(raw: string | null): LaunchOn {
  return (LAUNCH_ON as readonly string[]).includes(raw ?? "") ? (raw as LaunchOn) : LAUNCH_ON_DEFAULT;
}

function load(): LaunchOn {
  try {
    return parseLaunchOn(localStorage.getItem(KEY));
  } catch {
    return LAUNCH_ON_DEFAULT;
  }
}

let current = load();

export function getLaunchOn(): LaunchOn {
  return current;
}

export function setLaunchOn(on: LaunchOn): void {
  current = on;
  try {
    localStorage.setItem(KEY, on);
  } catch {
    // Storage full or blocked: the choice holds for this session only.
  }
}
