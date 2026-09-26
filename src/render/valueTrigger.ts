/**
 * A Schmitt-trigger signal->trigger converter: turns a continuous, roughly
 * 0..1 value (a level-kind catalogue reading, or a drawn frequency line's
 * own drive) into one-shot fires a scene's trigger logic (a ripple pool, a
 * beat listener, …) can react to the same way it reacts to a hit-kind
 * source's real edge. Built for drives.ts's `fired()` — see that file's
 * header: a level-kind catalogue source or the line has no natural edge of
 * its own (every sample is a fresh, independent reading, not a rising-edge
 * event), so without this, `fired()` used to fall back to whatever
 * `sceneDefaultFired` the caller happened to pass in, silently ignoring the
 * source the user actually picked.
 *
 * A plain `value > threshold` comparison can't stand in for a real edge on
 * its own — two problems, which is why this is a Schmitt trigger (two marks,
 * plus a held re-fire) rather than a bare comparator:
 *
 *   - **Chatter.** A signal hovering right at one fixed mark (mic hiss
 *     riding a level, a drawn line's own frame-to-frame noise) crosses it
 *     back and forth many times a second, each crossing a separate fire.
 *     Hysteresis is the standard fix: once armed, it takes a rise past
 *     `upper` to fire; once fired, it takes a fall all the way past a
 *     *lower* mark (`upper * VALUE_TRIGGER_LOWER_RATIO`) to re-arm. A signal
 *     that never dips below the lower mark can't refire no matter how much
 *     it wobbles above the upper one.
 *   - **Going silent under a sustained signal.** A one-shot edge fires once
 *     and stops — correct for a hit, wrong for "the mix has been loud for
 *     the last four bars": reading only the rising edge would ring once and
 *     then sit dark for as long as the level stays up, exactly backwards
 *     from what a sustained-level source is for. So a signal held above
 *     `upper` keeps re-firing — once per beat while the tempo tracker is
 *     confident (the same `tempoLock >= 0.35` "trust this" line
 *     beatListener.ts's `resolveHold` defaults its own `lockMin` to; not
 *     exported there — it's an inline default on an optional field — so
 *     this is a hand-kept copy of the same line, not an import), or every
 *     `HELD_REFIRE_FALLBACK_SEC` by the clock when the tracker isn't
 *     confident, so a scene still gets a steady pulse train without a beat
 *     to hang it on.
 *
 * Pure, and per-source: drives.ts keeps one `ValueTrigger` in its own
 * per-(scene, setting, source) `SourceState`, so two settings — or two
 * sources inside one patch — never share hysteresis. `stepValueTrigger` is
 * called once per `fired()` read; `fired()` itself runs once per scene
 * render (drives.ts's header), which is exactly the rate hysteresis wants —
 * a tick a scene never rendered never gets a vote on whether the trigger
 * should have fired.
 */

export const VALUE_TRIGGER_UPPER_DEFAULT = 0.6;
export const VALUE_TRIGGER_LOWER_RATIO = 0.65; // lower mark = upper * this
export const HELD_REFIRE_FALLBACK_SEC = 0.5; // re-fire period while held and tempo isn't locked

const VALUE_TRIGGER_UPPER_MIN = 0.05;
const VALUE_TRIGGER_UPPER_MAX = 0.98;

// beatListener.ts's resolveHold defaults its own lockMin to this same
// 0.35 — see this file's header for why that's a copy, not an import.
const TEMPO_TRUST_LOCK = 0.35;

export interface ValueTrigger {
  /** True when the next rise past `upper` should fire. False from the tick
   *  it fires until the value falls back past the lower mark. */
  armed: boolean;
  /** floor(anim.beats) as of the last fire — lets the held re-fire branch
   *  tell "a new beat has started" from "still the same beat". */
  lastBeat: number;
  /** anim.timeSec as of the last fire — the held re-fire branch's own
   *  fallback clock while the tempo tracker isn't confident. */
  lastFireSec: number;
}

/** Starts armed (`-Infinity` beat/time so the first fire always sets both
 *  cleanly) — the very first rise past `upper` always fires, same as a
 *  beat listener's own sinceFireSec-starts-at-Infinity contract. */
export function createValueTrigger(): ValueTrigger {
  return { armed: true, lastBeat: -Infinity, lastFireSec: -Infinity };
}

function clampUpper(upper: number): number {
  if (!Number.isFinite(upper)) return VALUE_TRIGGER_UPPER_DEFAULT;
  return Math.min(VALUE_TRIGGER_UPPER_MAX, Math.max(VALUE_TRIGGER_UPPER_MIN, upper));
}

/** Advances `st` in place by one tick/read and returns true on the tick it
 *  fires — see this file's header for the full state machine. `anim` is
 *  only the three fields the held re-fire branch needs, not a whole
 *  AnimFrame, so a caller (or a test) that only has those doesn't have to
 *  build one. */
export function stepValueTrigger(
  st: ValueTrigger,
  value: number,
  upper: number,
  anim: { timeSec: number; beats: number; tempoLock: number },
): boolean {
  const hi = clampUpper(upper);
  const lo = hi * VALUE_TRIGGER_LOWER_RATIO;

  if (st.armed) {
    if (value <= hi) return false;
    st.armed = false;
    st.lastBeat = Math.floor(anim.beats);
    st.lastFireSec = anim.timeSec;
    return true;
  }

  if (value < lo) {
    st.armed = true; // re-armed, but a fire waits for the next actual rise
    return false;
  }

  if (value > hi) {
    const beat = Math.floor(anim.beats);
    const due =
      anim.tempoLock >= TEMPO_TRUST_LOCK
        ? beat > st.lastBeat
        : anim.timeSec - st.lastFireSec >= HELD_REFIRE_FALLBACK_SEC;
    if (due) {
      st.lastBeat = beat;
      st.lastFireSec = anim.timeSec;
      return true;
    }
  }

  return false; // between the marks, or held but not yet due to refire
}
