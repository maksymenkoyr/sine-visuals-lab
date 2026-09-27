// Reference lines a scene draws onto one of its own settings' "What it
// receives" graph in the panel (src/ui/deviceMenu.ts's buildOutputGraph), plus
// the reactions that setting actually produced — so the user can see *why* a
// hit did or didn't react, not just the signal going in. Caustics' Beat ripple
// is the first user: its salience bar and full-ring height (rippleEmitter.ts)
// and each ring it emitted.
//
// A scene publishes from its own render callback; the panel reads at its own
// refresh rate. Reactions accumulate (max) between reads so a reaction
// between two panel reads isn't lost, and a read clears them — per reader,
// since more than one panel view reads the same setting (the pinned graph
// and the row's own sparkline) and one must not steal the other's reactions. A scene
// rendering on another device (the paired TV) never publishes here, so the
// graph simply shows no marks there — nothing depends on them.

export interface SettingMarkLine {
  /** In the same units the graph plots (the setting's combined drive value). */
  value: number;
  label: string;
}

interface Entry {
  lines: SettingMarkLine[];
  /** Strongest reaction since each reader's last read, keyed by reader. */
  reactions: Map<string, number>;
}

const entries = new Map<string, Entry>();
const keyOf = (sceneId: string, key: string) => `${sceneId}:${key}`;

function entryFor(sceneId: string, key: string): Entry {
  const k = keyOf(sceneId, key);
  let e = entries.get(k);
  if (!e) {
    e = { lines: [], reactions: new Map() };
    entries.set(k, e);
  }
  return e;
}

/** Replaces the setting's reference lines, and records this frame's reaction
 *  strength (0 = none; kept as the max until the panel next reads). */
export function publishSettingMarks(sceneId: string, key: string, lines: SettingMarkLine[], reaction: number): void {
  const e = entryFor(sceneId, key);
  e.lines = lines;
  for (const [reader, r] of e.reactions) if (reaction > r) e.reactions.set(reader, reaction);
}

/** A panel view's read (`reader` names the view, e.g. "graph" or "row"):
 *  current lines and the strongest reaction since that view's last read,
 *  which this clears. Null if the scene never published for this key. */
export function takeSettingMarks(sceneId: string, key: string, reader: string): { lines: SettingMarkLine[]; reaction: number } | null {
  const e = entries.get(keyOf(sceneId, key));
  if (!e) return null;
  const reaction = e.reactions.get(reader) ?? 0;
  e.reactions.set(reader, 0);
  return { lines: e.lines, reaction };
}
