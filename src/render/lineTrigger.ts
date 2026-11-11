/**
 * A cut on a visible line and a clock: the rule behind Alien's Dance cut and
 * Camera cut (other trigger drivers may read it later).
 *
 * The wired signal has to climb up through a **line** to cut. A climb in the
 * first `shortestSec` after the last cut is skipped, not remembered. At
 * `longestSec` it cuts anyway (the "timer"), on the first beat edge after
 * it when `onBeat` is on. `sink` slides the line down from `line` toward
 * `line × (1 − sink)` between Shortest and Longest, so the line comes down
 * to meet a signal that never quite reaches it as the cut falls due. Unlike
 * standout.ts's detector, a slow rise counts: it only has to cross the line.
 *
 * A setting becomes a trigger driver by declaring `SceneSetting.drive.trigger`
 * (sceneSettings.ts): its line is the setting's threshold row, and the wait's
 * values live in its drive entry (driveStore.ts's getDriveTrigger) and show
 * under that line in the wire panel. The scene reads them with
 * `drives.lineTrigger(key)` and steps this rule itself.
 *
 * Pure and DOM/GL-free; tests/lineTrigger.test.ts drives it directly.
 */

/** With on-beat on and no beat edge (tempo not locked), the Longest cut still comes this long after Longest. */
export const BEAT_WAIT_MAX_SEC = 2;

export interface LineTriggerSettings {
  /** The line's height in the signal's units, or null for no line: only Longest cuts. */
  line: number | null;
  /** 0..1: how far the line sinks by Longest, as a share of its height. */
  sink: number;
  shortestSec: number;
  /** Infinity: never. */
  longestSec: number;
  onBeat: boolean;
}

/** The wait's four values in the form a setting declares and the drive entry stores. */
export interface LineTriggerWait {
  shortestSec: number;
  /** LONGEST_NEVER_SEC: never. */
  longestSec: number;
  sink: number;
  onBeat: boolean;
}

/** The wire panel's Longest slider tops out here, which means never. */
export const LONGEST_NEVER_SEC = 120;
/** The wire panel's Shortest slider range. */
export const SHORTEST_MAX_SEC = 10;
/** The wire panel's Longest slider starts here. */
export const LONGEST_MIN_SEC = 5;

/** The rule's settings from a line (null: no line) and a stored or declared wait. */
export function lineTriggerSettings(line: number | null, wait: LineTriggerWait): LineTriggerSettings {
  return {
    line,
    sink: Math.max(0, Math.min(1, wait.sink)),
    shortestSec: wait.shortestSec,
    longestSec: wait.longestSec >= LONGEST_NEVER_SEC ? Infinity : wait.longestSec,
    onBeat: wait.onBeat,
  };
}

export interface LineTrigger {
  /** Seconds since the last cut (or since the trigger last was armed). */
  sinceSec: number;
  /** Signal minus line on the last step; null before the first, or with no line. */
  prevDiff: number | null;
}

export function createLineTrigger(): LineTrigger {
  return { sinceSec: 0, prevDiff: null };
}

/** The line's height `sinceSec` after the last cut; null with no line. */
export function lineAt(s: LineTriggerSettings, sinceSec: number): number | null {
  if (s.line === null) return null;
  const sink = Math.max(0, Math.min(1, s.sink));
  if (sink === 0 || !Number.isFinite(s.longestSec) || sinceSec <= s.shortestSec) return s.line;
  const span = Math.max(1e-6, s.longestSec - s.shortestSec);
  const along = Math.min(1, (sinceSec - s.shortestSec) / span);
  return s.line * (1 - sink * along);
}

export interface LineTriggerTick {
  signal: number;
  /** A beat edge on this tick (the metronome's one-shot). */
  beat: boolean;
  /** Whether it may cut; disarmed, the wait starts over every tick. */
  armed: boolean;
  /** Whether there is music; the Longest cut waits through silence. */
  music: boolean;
}

/** Advances the trigger one tick. Returns what cut on this tick, if anything. */
export function stepLineTrigger(t: LineTrigger, dtSec: number, tick: LineTriggerTick, s: LineTriggerSettings): "signal" | "timer" | null {
  t.sinceSec += Math.max(0, dtSec);
  const e = lineAt(s, t.sinceSec);
  const d = e === null ? null : tick.signal - e;
  const crossed = d !== null && t.prevDiff !== null && t.prevDiff < 0 && d >= 0;
  const due = tick.music && t.sinceSec >= s.longestSec && (!s.onBeat || tick.beat || t.sinceSec >= s.longestSec + BEAT_WAIT_MAX_SEC);
  if (!tick.armed) {
    t.sinceSec = 0;
    t.prevDiff = d;
    return null;
  }
  // On-beat, a crossing while a cut is due still cuts as "signal" at once
  // (the beat wait is for the timer's cut); off-beat the timer takes it.
  if (crossed && t.sinceSec >= s.shortestSec && (s.onBeat || !due)) {
    t.sinceSec = 0;
    t.prevDiff = d;
    return "signal";
  }
  if (due) {
    t.sinceSec = 0;
    // A level still above the line has to drop below and climb again.
    t.prevDiff = d !== null && d >= 0 ? 0 : null;
    return "timer";
  }
  t.prevDiff = d;
  return null;
}
