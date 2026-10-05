import { METRONOME_BEATS_PER_BAR } from "./metronome.ts";

/**
 * The timing of one scene-to-scene crossfade, as a pure state machine: no GL,
 * no clock of its own. src/render/compositor.ts owns the drawing; this file
 * only answers "at this moment, how far across are we?".
 *
 * A change to a different scene waits for the next beat of the metronome
 * (metronome.ts — the same settled tempo the BPM card shows), then blends over
 * one bar of it. While waiting, the outgoing scene alone is on screen. With no
 * settled tempo (silence, nothing locked yet) there is no beat to wait for, so
 * the blend starts at once and runs for CROSSFADE_FALLBACK_MS. A tempo that
 * disappears or never produces a beat while waiting is given up on after
 * CROSSFADE_MAX_WAIT_MS, the same way.
 *
 * An explicit `lengthMs` (a held Play on the output window — ui/outputKeys.ts's
 * glideMsForHold) replaces the bar length but still starts on the beat. `cut`
 * (the floor quality preset, where two scenes at once cost too much) makes the
 * length zero: the new scene takes over on the beat, with no blend.
 */

/** Blend length when there is no tempo to take a bar from. */
export const CROSSFADE_FALLBACK_MS = 1500;
/** A bar at a very fast or very slow tempo is kept inside these. */
export const CROSSFADE_MIN_MS = 600;
export const CROSSFADE_MAX_MS = 8000;
/** The longest a waiting crossfade holds the old scene for a beat that never comes. */
export const CROSSFADE_MAX_WAIT_MS = 2500;

/** What the render loop knows about the beat clock on this frame: the settled
 *  metronome tempo (animClock's metronomeOn / metronomeBpm) and whether a beat
 *  edge landed since the last rendered frame (the latched metronomeBeat). */
export interface CrossfadeClock {
  tempoOn: boolean;
  bpm: number;
  beat: boolean;
}

/** One bar at `bpm`, in ms, kept within CROSSFADE_MIN_MS..CROSSFADE_MAX_MS. */
export function barLengthMs(bpm: number): number {
  if (!(bpm > 0)) return CROSSFADE_FALLBACK_MS;
  const ms = (METRONOME_BEATS_PER_BAR * 60_000) / bpm;
  return Math.min(CROSSFADE_MAX_MS, Math.max(CROSSFADE_MIN_MS, ms));
}

export type CrossfadeStage = "wait" | "blend" | "done";

export interface CrossfadeView {
  stage: CrossfadeStage;
  /** 0 = only the outgoing scene, 1 = only the incoming one (eased). */
  mix: number;
}

export interface CrossfadeOptions {
  /** Blend length in place of one bar; ignored with `cut`. */
  lengthMs?: number;
  /** No blend: the incoming scene takes over on the beat. */
  cut?: boolean;
}

export interface Crossfade {
  /** The state at `nowMs`. Call once per rendered frame, in time order. Once it
   *  has said "done" it keeps saying it. */
  step(nowMs: number, clock: CrossfadeClock): CrossfadeView;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

export function createCrossfade(opts: CrossfadeOptions = {}): Crossfade {
  let firstMs: number | null = null;
  let startMs: number | null = null;
  let lengthMs = 0;
  return {
    step(nowMs, clock) {
      if (firstMs === null) firstMs = nowMs;
      if (startMs === null) {
        const tempo = clock.tempoOn && clock.bpm > 0;
        if (tempo && !clock.beat && nowMs - firstMs < CROSSFADE_MAX_WAIT_MS) return { stage: "wait", mix: 0 };
        startMs = nowMs;
        if (opts.cut) lengthMs = 0;
        else if (opts.lengthMs !== undefined && opts.lengthMs > 0) lengthMs = opts.lengthMs;
        else lengthMs = tempo ? barLengthMs(clock.bpm) : CROSSFADE_FALLBACK_MS;
      }
      if (lengthMs <= 0) return { stage: "done", mix: 1 };
      const t = (nowMs - startMs) / lengthMs;
      if (t >= 1) return { stage: "done", mix: 1 };
      return { stage: "blend", mix: smoothstep(Math.max(0, t)) };
    },
  };
}
