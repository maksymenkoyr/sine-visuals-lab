// Reference lines a scene draws onto one of its own settings' "What it
// receives" graph in the panel (src/ui/deviceMenu.ts's buildOutputGraph), plus
// the reactions that setting actually produced — so the user can see *why* a
// hit did or didn't react, not just the signal going in. Caustics' Beat ripple
// is the first user: its salience bar and full-ring height (rippleEmitter.ts)
// and each ring it emitted.
//
// A scene publishes from its own render callback; the panel reads at its own
// refresh rate. Reactions accumulate (max) between reads so a reaction
// between two panel reads isn't lost, and a read clears them. A scene
// rendering on another device (the paired TV) never publishes here, so the
// graph simply shows no marks there — nothing depends on them.

export interface SettingMarkLine {
  /** In the same units the graph plots (the setting's combined drive value). */
  value: number;
  label: string;
}

interface Entry {
  lines: SettingMarkLine[];
  reaction: number;
}

const entries = new Map<string, Entry>();
const keyOf = (sceneId: string, key: string) => `${sceneId}:${key}`;

function entryFor(sceneId: string, key: string): Entry {
  const k = keyOf(sceneId, key);
  let e = entries.get(k);
  if (!e) {
    e = { lines: [], reaction: 0 };
    entries.set(k, e);
  }
  return e;
}

/** Replaces the setting's reference lines, and records this frame's reaction
 *  strength (0 = none; kept as the max until the panel next reads). */
export function publishSettingMarks(sceneId: string, key: string, lines: SettingMarkLine[], reaction: number): void {
  const e = entryFor(sceneId, key);
  e.lines = lines;
  if (reaction > e.reaction) e.reaction = reaction;
}

/** The panel's read: current lines and the strongest reaction since the last
 *  read (which this clears). Null if the scene never published for this key. */
export function takeSettingMarks(sceneId: string, key: string): { lines: SettingMarkLine[]; reaction: number } | null {
  const e = entries.get(keyOf(sceneId, key));
  if (!e) return null;
  const out = { lines: e.lines, reaction: e.reaction };
  e.reaction = 0;
  return out;
}
