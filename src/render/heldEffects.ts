/**
 * The held effects — Blackout, Strobe, Freeze, Invert, Mirror — as plain data
 * and pure functions. Each is on only while its key or on-screen button is
 * held. They are not part of the look: never saved, never held by Cue, never
 * in a Look's share code. The main window keeps its own set
 * (ui/effectControls.ts) and sends it to the pop-out output as its own message
 * (net/outputSync.ts's `effects`, like `power`); src/render/compositor.ts is
 * what draws them, over whichever scene or crossfade is on screen.
 *
 * EFFECTS is the one list the keys, the on-screen buttons and the keys card
 * (ui/keyHints.ts) are all built from. Keys are matched on the physical key
 * (`code`), so a Cyrillic or German layout reaches them too.
 */

export type EffectId = "blackout" | "strobe" | "freeze" | "invert" | "mirror";

export interface EffectDef {
  id: EffectId;
  /** Button text and the keys-card label. */
  label: string;
  /** KeyboardEvent.code. */
  code: string;
  /** The key as shown. */
  key: string;
  /** What the keys card says it does. */
  hint: string;
}

export const EFFECTS: readonly EffectDef[] = [
  { id: "blackout", label: "Blackout", code: "KeyQ", key: "Q", hint: "Hold to fade the picture to black" },
  { id: "strobe", label: "Strobe", code: "KeyW", key: "W", hint: "Hold for white flashes on every eighth note" },
  { id: "freeze", label: "Freeze", code: "KeyE", key: "E", hint: "Hold to freeze the picture" },
  { id: "invert", label: "Invert", code: "KeyI", key: "I", hint: "Hold for negative colours" },
  { id: "mirror", label: "Mirror", code: "KeyU", key: "U", hint: "Hold to mirror the left half onto the right" },
];

export type HeldEffects = Record<EffectId, boolean>;

export const NO_EFFECTS: HeldEffects = { blackout: false, strobe: false, freeze: false, invert: false, mirror: false };

export function anyEffect(e: HeldEffects): boolean {
  return EFFECTS.some((d) => e[d.id]);
}

export function sameEffects(a: HeldEffects, b: HeldEffects): boolean {
  return EFFECTS.every((d) => a[d.id] === b[d.id]);
}

/** The effect a physical key stands for, if any. */
export function effectForCode(code: string): EffectDef | undefined {
  return EFFECTS.find((d) => d.code === code);
}

/** Reads an effects set off a message from another window: anything that is
 *  not exactly `true` is off, so a malformed one can only switch things off. */
export function parseEffects(v: unknown): HeldEffects {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const out = { ...NO_EFFECTS };
  for (const d of EFFECTS) out[d.id] = o[d.id] === true;
  return out;
}

/** How long Blackout takes to fade fully in, and fully out. */
export const BLACKOUT_FADE_MS = 160;

/** One step of a fade toward `on`: `level` moves by `dtMs` of the fade time. */
export function stepFade(level: number, on: boolean, dtMs: number): number {
  const step = Math.max(0, dtMs) / BLACKOUT_FADE_MS;
  return on ? Math.min(1, level + step) : Math.max(0, level - step);
}

/** Flashes per (quarter-note) beat: an eighth note is half a beat. */
export const STROBE_FLASHES_PER_BEAT = 2;
/** How much of each eighth note the flash stays lit. */
export const STROBE_ON_FRACTION = 0.3;
/** How white a flash gets (1 = pure white). */
export const STROBE_PEAK = 0.9;
/** The tempo a flash follows while there is no settled one to lock to. */
export const STROBE_FALLBACK_BPM = 120;

/** The Strobe flash level (0..STROBE_PEAK) for a position within the current
 *  beat, `beatPhase01` in [0,1): lit at the start of each eighth note, dark for
 *  the rest. */
export function strobeLevel(beatPhase01: number): number {
  const p = beatPhase01 * STROBE_FLASHES_PER_BEAT;
  const within = p - Math.floor(p);
  return within < STROBE_ON_FRACTION ? STROBE_PEAK : 0;
}

/** The beat position Strobe locks to: the metronome's own while it has a
 *  settled tempo (the flashes then land on the beat clock the scenes use),
 *  else a free-running clock at STROBE_FALLBACK_BPM so the effect still works
 *  with no music. */
export function strobeBeatPhase(clock: { tempoOn: boolean; metronomePhase: number; timeSec: number }): number {
  if (clock.tempoOn) return clock.metronomePhase;
  const beats = (clock.timeSec * STROBE_FALLBACK_BPM) / 60;
  return beats - Math.floor(beats);
}

/** The values the compositor's effect pass takes, from the engaged set and the
 *  smoothed blackout level. */
export interface EffectLook {
  invert: boolean;
  mirror: boolean;
  /** 0..1 mix toward white. */
  flash: number;
  /** 0..1 dim toward black. */
  black: number;
}

export function effectLook(e: HeldEffects, blackLevel: number, beatPhase01: number): EffectLook {
  return {
    invert: e.invert,
    mirror: e.mirror,
    flash: e.strobe ? strobeLevel(beatPhase01) : 0,
    black: blackLevel,
  };
}
