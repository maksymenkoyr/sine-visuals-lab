import { registerSyncedStore } from "../net/syncedStores.ts";
import type { CrossfadeOptions } from "./crossfade.ts";

/**
 * How one scene gives way to the next: Cut or Fade, and for a Fade how many
 * bars it takes. Set at the foot of the scene list (ui/scenePicker.ts) and
 * read wherever a crossfade begins — the main window (app.ts), the pop-out
 * output (output.ts) and a room's TV (tv.ts) — through crossfadeOptions, so
 * the list, a Set pad, Autopilot, Play and a phone's pick all switch the same
 * way. Both start on the next beat (render/crossfade.ts has the timing).
 *
 * Storage: one key, KEY, as JSON; absent means TRANSITION_DEFAULT, which is
 * what every scene change did before this setting existed. It changes how
 * the room's screens switch, so it is part of the room look (syncedStores.ts's
 * isRoomKey lets it through), but it never changes the picture on screen, so
 * it sits with the shelves (SHELF_KEYS): picking Cut never reads as the
 * output differing from the preview.
 */

const KEY = "vibe.transition";

export type TransitionStyle = "fade" | "cut";

/** What Length offers, in bars. */
export const TRANSITION_BARS: readonly number[] = [0.5, 1, 2, 4];

export interface SceneTransition {
  style: TransitionStyle;
  /** One of TRANSITION_BARS; kept while Cut is picked, for the next Fade. */
  bars: number;
}

export const TRANSITION_DEFAULT: SceneTransition = { style: "fade", bars: 1 };

/** A stored value, or the defaults for anything missing or out of range. */
export function parseTransition(raw: string | null): SceneTransition {
  if (raw === null) return TRANSITION_DEFAULT;
  try {
    const v = JSON.parse(raw) as Partial<SceneTransition> | null;
    return {
      style: v?.style === "cut" ? "cut" : "fade",
      bars: typeof v?.bars === "number" && TRANSITION_BARS.includes(v.bars) ? v.bars : TRANSITION_DEFAULT.bars,
    };
  } catch {
    return TRANSITION_DEFAULT;
  }
}

function load(): SceneTransition {
  try {
    return parseTransition(localStorage.getItem(KEY));
  } catch {
    return TRANSITION_DEFAULT;
  }
}

let current = load();

// Re-seeds from localStorage for the pop-out window and a TV (net/syncedStores.ts).
registerSyncedStore(KEY, () => {
  current = load();
});

export function getSceneTransition(): SceneTransition {
  return current;
}

/** Changes and stores the transition; a write storage refuses keeps it for
 *  this session only. */
export function setSceneTransition(patch: Partial<SceneTransition>): SceneTransition {
  current = parseTransition(JSON.stringify({ ...current, ...patch }));
  const isDefault = current.style === TRANSITION_DEFAULT.style && current.bars === TRANSITION_DEFAULT.bars;
  try {
    if (isDefault) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Storage full or blocked.
  }
  return current;
}

/** What a crossfade is begun with. The floor quality preset always cuts (two
 *  scenes at once cost too much there); a held Play's earned glide
 *  (`glideMs`) is a deliberate gesture, so it blends over its own length even
 *  when Cut is picked; otherwise the stored transition decides. */
export function crossfadeOptions(t: SceneTransition, floor: boolean, glideMs?: number): CrossfadeOptions {
  if (floor) return { cut: true };
  if (glideMs !== undefined && glideMs > 0) return { lengthMs: glideMs };
  if (t.style === "cut") return { cut: true };
  return { bars: t.bars };
}
