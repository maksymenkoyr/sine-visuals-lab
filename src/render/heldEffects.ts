/**
 * The held effects (the list is EFFECTS below) as plain data and pure
 * functions. Each is on only while its key or on-screen button is held,
 * except one marked `flash` (Strobe), which a press turns on for
 * STROBE_FLASH_MS and which then goes off by itself, however long the press:
 * one flash per tap, so the strobing is the user's own tapping. They are not
 * part of the look: never saved, never held by Cue, never
 * in a Look's share code. The main window keeps its own set
 * (ui/effectControls.ts) and sends it to the pop-out output as its own message
 * (net/outputSync.ts's `effects`, like `power`); src/render/compositor.ts is
 * what draws them, over whichever scene or crossfade is on screen.
 *
 * EFFECTS is the one list the keys, the on-screen buttons and the keys card
 * (ui/keyHints.ts) are all built from. Keys are matched on the physical key
 * (`code`), so a Cyrillic or German layout reaches them too.
 */

export type EffectId = "blackout" | "strobe" | "freeze" | "invert";

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
  /** A press turns it on for STROBE_FLASH_MS, then it goes off by itself,
   *  instead of staying on while held. */
  flash?: boolean;
}

export const EFFECTS: readonly EffectDef[] = [
  { id: "blackout", label: "Blackout", code: "KeyQ", key: "Q", hint: "Hold to fade the picture to black" },
  { id: "strobe", label: "Strobe", code: "KeyW", key: "W", hint: "Tap for one white flash, keep tapping to strobe", flash: true },
  { id: "freeze", label: "Freeze", code: "KeyE", key: "E", hint: "Hold to freeze the picture" },
  { id: "invert", label: "Invert", code: "KeyD", key: "D", hint: "Hold for negative colours" },
];

export type HeldEffects = Record<EffectId, boolean>;

export const NO_EFFECTS: HeldEffects = { blackout: false, strobe: false, freeze: false, invert: false };

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

/** How long one Strobe flash stays lit. */
export const STROBE_FLASH_MS = 75;
/** How white a flash gets (1 = pure white). */
export const STROBE_PEAK = 0.9;

/** The values the compositor's effect pass takes, from the engaged set and the
 *  smoothed blackout level. */
export interface EffectLook {
  invert: boolean;
  /** 0..1 mix toward white. */
  flash: number;
  /** 0..1 dim toward black. */
  black: number;
}

export function effectLook(e: HeldEffects, blackLevel: number): EffectLook {
  return {
    invert: e.invert,
    flash: e.strobe ? STROBE_PEAK : 0,
    black: blackLevel,
  };
}
