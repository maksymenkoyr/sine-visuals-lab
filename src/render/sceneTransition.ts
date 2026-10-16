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

/** A stored value, field by field: the default for a field missing or out of
 *  range, the defaults when absent or empty, and null when the text cannot be
 *  read (not JSON, or not an object), so a synced re-seed can keep what it has
 *  (net/syncedStores.ts's header). */
function readTransition(raw: string | null): SceneTransition | null {
  if (!raw) return TRANSITION_DEFAULT;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const t = v as Partial<SceneTransition>;
  return {
    style: t.style === "cut" ? "cut" : "fade",
    bars: typeof t.bars === "number" && TRANSITION_BARS.includes(t.bars) ? t.bars : TRANSITION_DEFAULT.bars,
  };
}

/** A stored value, or the defaults for anything missing, out of range or unreadable. */
export function parseTransition(raw: string | null): SceneTransition {
  return readTransition(raw) ?? TRANSITION_DEFAULT;
}

function readStored(): SceneTransition | null {
  try {
    return readTransition(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

let current = readStored() ?? TRANSITION_DEFAULT;

// Re-seeds from localStorage for the pop-out window and a TV
// (net/syncedStores.ts); text it cannot read keeps the current transition.
registerSyncedStore(KEY, () => {
  const next = readStored();
  if (next === null) return;
  current = next;
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
