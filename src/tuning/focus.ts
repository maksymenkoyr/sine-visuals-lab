/**
 * Dev-only spotlight state: which settings I've asked you to look at, and the
 * plain-language phrase that prompted it. Written by the param bus (bus.ts)
 * from a `focus` list in tuning/params.json, read by src/ui/deviceMenu.ts to
 * highlight the matching rows and by probe.ts to tag them in a readout.
 *
 * Deliberately separate from overrides.ts: an override *changes* a value,
 * focus only points at one. Pointing has to work without pinning, since the
 * whole idea is that you move the dial, not me.
 */

export interface FocusEntry {
  /** Matches SceneSetting.key. Unknown keys are kept, not dropped — a scene
   *  switch shouldn't silently discard a focus meant for another scene. */
  key: string;
  /** The phrase this came from ("thinner ridges"), shown next to the row.
   *  This is the half that eventually becomes a tuning/VOCAB.md entry. */
  note?: string;
  /** Suggested sweep range. Purely advisory — the slider still spans the
   *  spec's own min/max; this just says where I think the answer lives. */
  from?: number;
  to?: number;
}

let entries: FocusEntry[] = [];
const listeners = new Set<() => void>();

export function getFocus(): readonly FocusEntry[] {
  return entries;
}

export function focusFor(key: string): FocusEntry | undefined {
  return entries.find((e) => e.key === key);
}

export function isFocused(key: string): boolean {
  return entries.some((e) => e.key === key);
}

/** Replaces the whole list, mirroring how applyTuningParams replaces the whole
 *  override set — a key dropped from the file lets go rather than lingering. */
export function setFocus(next: FocusEntry[]): void {
  entries = next;
  for (const listener of listeners) listener();
}

export function clearFocus(): void {
  setFocus([]);
}

/** Returns an unsubscribe. deviceMenu.ts uses this to repaint highlights
 *  without rebuilding rows. */
export function onFocusChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
