/**
 * Dev-only override layer for live parameter tuning (see tuning/params.json
 * and vite-tuning-plugin.ts). Sits in front of the existing localStorage-
 * backed stores (sceneSettings.ts, sensitivity.ts) so a tuning session can
 * never clobber saved settings: overrides are pure in-memory state, gone on
 * reload or an explicit clearAllOverrides() call.
 *
 * autoTune.ts's resolve() consults this first, gated behind
 * import.meta.env.DEV — with no overrides active (or in a prod build, where
 * that check compiles away) resolution is bit-for-bit identical to today.
 *
 * pins.ts is this layer's persisted sibling — same idea, but for a value
 * typed into a param row that survives a reload. resolve() checks an
 * override before a pin, so a stale pin can never shadow a key a scripted
 * params.json push explicitly sets.
 */

const overrides = new Map<string, number>();
let autoPinned = false;

function overrideKey(sceneId: string, key: string): string {
  return `${sceneId}:${key}`;
}

export function getOverride(sceneId: string, key: string): number | undefined {
  return overrides.get(overrideKey(sceneId, key));
}

export function setOverride(sceneId: string, key: string, value: number): void {
  overrides.set(overrideKey(sceneId, key), value);
}

export function clearOverride(sceneId: string, key: string): void {
  overrides.delete(overrideKey(sceneId, key));
}

/** Called before applying a fresh params.json snapshot, so a key dropped
 *  from the file (rather than set back to a number) actually lets go —
 *  otherwise a removed override would linger forever. */
export function clearAllOverrides(): void {
  overrides.clear();
}

/** When true, resolve() skips auto-mode's music-driven target entirely and
 *  returns the manual/override value — see the plan's "auto-mode during
 *  tuning" note: without this, a value I write gets pushed around by the
 *  music before you can judge it. */
export function isAutoPinned(): boolean {
  return autoPinned;
}

export function setAutoPinned(on: boolean): void {
  autoPinned = on;
}

/** For the numeric probe — what's actually pinned right now, keyed the same
 *  way as the internal map. */
export function overrideSnapshot(): Record<string, number> {
  return Object.fromEntries(overrides);
}
