import type { AnimFrame } from "./animClock.ts";
import type { SignalId } from "./signals.ts";

/**
 * The one place trigger + hold + refractory lives — every scene that reacts
 * to "a beat, but not too often" (shards' cut, kaleido's advanceBeatSurge,
 * caustics' advanceLurch, powder's createBigHitDetector, storm/ambience's
 * own pools) used to hand-roll this itself. Shards is the first migration
 * (src/render/scenes/shards/layout.ts's CUT_LISTENER); the rest are
 * follow-ups, not this change.
 *
 * A listener is fed the render-latched AnimFrame from a scene's own
 * render() — never a raw FeatureFrame — so it only ever sees an edge a
 * scene could actually have drawn a reaction to (see renderLatch.ts). There
 * is deliberately no free-run option: a listener that never sees a trigger
 * simply never fires again. A scene wanting "move on its own in silence"
 * has to say so itself; this file won't do it quietly on a scene's behalf
 * (the shards migration this file was built for removed exactly that
 * behavior — see the plan/PR history around "Remove free-run").
 *
 * advance()'s per-tick decision, in order: age the time since the last
 * fire, read this tick's edge for `source` (sourceEdge below), compute the
 * hold that edge would have to clear (resolveHold below, floored at
 * `refractorySec`), then classify — no edge is "quiet"; an edge younger
 * than refractorySec is "refractory"; younger than the hold is "held";
 * anything else fires. sinceFireSec starts at Infinity so the very first
 * edge always fires, whatever hold/refractory is configured.
 */

export type BeatSource = "beat" | "bass" | "mid" | "high" | "bar" | "drop";

/** Default `pulse` decay — animClock.ts's BEAT_PULSE_DECAY_PER_SEC, kept in
 *  step by hand (that constant is module-private there). */
export const PULSE_DECAY_DEFAULT = 6;

/** A hold sized in beats once the tempo tracker is confident (tempoLock >=
 *  lockMin, default 0.35 — beatClock.ts's own rough "trust this" line),
 *  falling back to a fixed `fallbackSec` otherwise — the shape shards'
 *  pre-listener minHoldSec used to reproduce the beat spacing of a locked
 *  track without needing a lock. See resolveHold. */
export interface HoldBeats {
  beats: number;
  fallbackSec: number;
  lockMin?: number;
}

export interface BeatListenerSpec {
  source: BeatSource;
  /** Hard minimum spacing between fires, independent of `hold` — a physical
   *  "can't repeat this fast" floor. Defaults to 0 (no floor beyond `hold`
   *  itself). */
  refractorySec?: number;
  /** A fixed number of seconds, or a HoldBeats spec resolved against the
   *  live tempo each tick — see resolveHold. Defaults to 0 (no hold beyond
   *  `refractorySec`). */
  hold?: number | HoldBeats;
  /** Exponential decay rate for `result.pulse`, per second. Defaults to
   *  PULSE_DECAY_DEFAULT — the same rate animClock.ts's beatPulse decays at,
   *  so a scene swapping beatPulse for a listener's pulse sees the same
   *  flash. */
  pulseDecayPerSec?: number;
}

/** Why this tick's edge (if any) didn't fire, or "quiet" for no edge at
 *  all. Mutually exclusive with `fired` — see ListenResult. */
export type ListenReason = "fired" | "held" | "refractory" | "quiet";

export interface ListenResult {
  /** True only on the tick a trigger actually cleared hold + refractory —
   *  the one-shot edge a caller should act on. */
  fired: boolean;
  /** This tick's raw source edge, before hold/refractory — see sourceEdge.
   *  A caller driving its own diagnostics (not just `fired`) reads this. */
  edge: boolean;
  reason: ListenReason;
  /** Decaying [0,1] envelope, 1 on the tick `fired` is true — see
   *  BeatListenerSpec.pulseDecayPerSec. */
  pulse: number;
  /** Seconds since the last fire; starts at Infinity. */
  sinceFireSec: number;
  /** This tick's resolved hold (max(refractorySec, resolveHold(...))) —
   *  exposed for a caller/test that wants to see what the edge was measured
   *  against. */
  holdSec: number;
}

export interface BeatListener {
  readonly result: Readonly<ListenResult>;
  /** Call once per scene render() tick with that tick's render-latched
   *  AnimFrame. `source` overrides the spec's own for this call only — a
   *  scene whose "listen to what" is itself a user setting (shards' Cut on)
   *  can pass the resolved choice here instead of rebuilding the listener
   *  every time it changes. */
  advance(anim: AnimFrame, source?: BeatSource): Readonly<ListenResult>;
  /** Back to the just-constructed state — sinceFireSec to Infinity, pulse
   *  to 0, the internal bar-phase tracker cleared. */
  reset(): void;
}

/** Whether `source` has a fresh edge this tick. "bar" is its own thing: a
 *  bar wrap (this tick's AnimFrame.barPhase less than `prevBarPhase`, the
 *  value from the tick before) while the tempo tracker is confident
 *  (tempoLock > 0.5 — beatClock.ts's own "trust the grid" line); below that
 *  a bar boundary isn't known yet, so it falls back to the plain beat edge.
 *  Every other source reads its matching AnimFrame one-shot directly. */
export function sourceEdge(source: BeatSource, anim: AnimFrame, prevBarPhase: number | null): boolean {
  switch (source) {
    case "beat":
      return anim.onset;
    case "bass":
      return anim.lowOnset;
    case "mid":
      return anim.midOnset;
    case "high":
      return anim.highOnset;
    case "drop":
      return anim.dropOnset;
    case "bar":
      if (anim.tempoLock > 0.5) return prevBarPhase !== null && anim.barPhase < prevBarPhase - 0.5;
      return anim.onset;
  }
}

/** Resolves BeatListenerSpec.hold against the live tempo. A plain number is
 *  a fixed hold regardless of tempo; undefined holds for nothing (0); a
 *  HoldBeats spec sizes the hold in beats once tempoLock clears `lockMin`
 *  (default 0.35), otherwise falls back to `fallbackSec` — reproduces
 *  shards' pre-listener minHoldSec exactly for
 *  `{ beats: 0.7, fallbackSec: 0.25, lockMin: 0.35 }` (see layout.ts's
 *  CUT_LISTENER). */
export function resolveHold(hold: number | HoldBeats | undefined, tempoLock: number, bpm: number): number {
  if (hold === undefined) return 0;
  if (typeof hold === "number") return hold;
  const lockMin = hold.lockMin ?? 0.35;
  if (tempoLock >= lockMin && bpm > 0) return hold.beats * (60 / bpm);
  return hold.fallbackSec;
}

export function createBeatListener(spec: BeatListenerSpec): BeatListener {
  const refractorySec = spec.refractorySec ?? 0;
  const pulseDecayPerSec = spec.pulseDecayPerSec ?? PULSE_DECAY_DEFAULT;
  let sinceFireSec = Infinity;
  let pulse = 0;
  let prevBarPhase: number | null = null;
  let result: ListenResult = {
    fired: false,
    edge: false,
    reason: "quiet",
    pulse: 0,
    sinceFireSec: Infinity,
    holdSec: 0,
  };

  return {
    get result(): Readonly<ListenResult> {
      return result;
    },
    advance(anim: AnimFrame, source: BeatSource = spec.source): Readonly<ListenResult> {
      const dt = anim.dtSec;
      sinceFireSec += dt;
      pulse *= Math.exp(-dt * pulseDecayPerSec);

      // Read before overwriting — sourceEdge's "bar" case compares against
      // the phase from the tick before this one.
      const wasBarPhase = prevBarPhase;
      prevBarPhase = anim.barPhase;
      const edge = sourceEdge(source, anim, wasBarPhase);

      const holdSec = Math.max(refractorySec, resolveHold(spec.hold, anim.tempoLock, anim.bpm));

      let fired = false;
      let reason: ListenReason = "quiet";
      if (edge) {
        if (sinceFireSec < refractorySec) reason = "refractory";
        else if (sinceFireSec < holdSec) reason = "held";
        else {
          fired = true;
          reason = "fired";
        }
      }
      if (fired) {
        sinceFireSec = 0;
        pulse = 1;
      }

      result = { fired, edge, reason, pulse, sinceFireSec, holdSec };
      return result;
    },
    reset(): void {
      sinceFireSec = Infinity;
      pulse = 0;
      prevBarPhase = null;
      result = { fired: false, edge: false, reason: "quiet", pulse: 0, sinceFireSec: Infinity, holdSec: 0 };
    },
  };
}

/** Which SIGNALS entry (src/render/signals.ts) a source corresponds to, for
 *  a setting row's `reads` — only where one already exists (see signals.ts's
 *  own "populate on demand" rule): "mid"/"high" have no registered signal
 *  yet (nothing reads them today), and "bar" isn't a single live signal at
 *  all (it's a wrap derived from two ticks). */
export const SOURCE_SIGNAL: Partial<Record<BeatSource, SignalId>> = {
  beat: "feature.onset",
  bass: "anim.lowOnset",
  drop: "anim.dropOnset",
};
