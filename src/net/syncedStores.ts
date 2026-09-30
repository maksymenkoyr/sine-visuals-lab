/**
 * What a second renderer window (the pop-out output, see outputSync.ts)
 * copies from the main window: every localStorage key the app writes, except
 * the ones in PRIVATE_KEYS. Wholesale on purpose — a store added next year is
 * mirrored without anyone remembering to list it.
 *
 * Copying the text is not enough, because stores are in-memory caches seeded
 * once from localStorage (render/sceneSettings.ts's header has the pattern).
 * A store whose cache the output renders from registers a hook,
 * `registerSyncedStore(KEY, reload)`, that re-seeds it after a snapshot is
 * applied. A store that forgets still gets its text mirrored, and re-reads it
 * at the next output reload; the hook is what makes it live.
 *
 * Kept import-free on purpose: stores in render/ and audio/ both import it.
 */

/** Keys that belong to one window or one person's chrome, never mirrored:
 *  the room identity, panel/tip/toast state, and which audio source this
 *  machine picked (the output gets frames, not audio). */
export const PRIVATE_KEYS: ReadonlySet<string> = new Set([
  "vibe.deviceId",
  "vibe.keyTips",
  "vibe.panelFolds",
  "vibe.hiddenInputs",
  "vibe.bakeToast",
  "vibe.audioSource",
  "vibe.audioInputDevice",
]);

/** Key prefixes the main window rewrites continuously on its own (auto-
 *  tracked marks): mirrored, but ignored by outputSync.ts's stateKey so they
 *  never read as a difference between preview and output. */
export const VOLATILE_PREFIXES: readonly string[] = ["vibe.silenceGate", "vibe.autoGain"];

const hooks: Array<() => void> = [];

/** Runs after a snapshot is applied, once per distinct function. `key` only
 *  documents which store the hook belongs to. */
export function registerSyncedStore(_key: string, reload: () => void): void {
  if (!hooks.includes(reload)) hooks.push(reload);
}

type Keyed = Pick<Storage, "getItem" | "key" | "length">;

/** Every mirrored key's current text. */
export function captureSyncedStorage(storage: Keyed): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key === null || PRIVATE_KEYS.has(key)) continue;
      const raw = storage.getItem(key);
      if (raw !== null) out[key] = raw;
    }
  } catch {
    // Unreadable storage reads as "nothing stored" — the defaults.
  }
  return out;
}

/** Makes `storage` hold exactly this snapshot (keys it lacks are removed, so
 *  a setting reset to default there resets here too), then runs every store
 *  hook. The output window passes its private in-memory storage, never the
 *  real one the main window owns. */
export function applySyncedStorage(
  values: Record<string, string>,
  storage: Pick<Storage, "setItem" | "removeItem" | "key" | "length">,
): void {
  const existing: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k !== null) existing.push(k);
  }
  for (const k of existing) if (!(k in values) && !PRIVATE_KEYS.has(k)) storage.removeItem(k);
  for (const k of Object.keys(values)) storage.setItem(k, values[k]);
  for (const reload of hooks) reload();
}
