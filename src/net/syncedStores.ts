/**
 * The registry of localStorage-backed stores that shape what a scene looks
 * like — the ones a second renderer window (the pop-out output, see
 * outputSync.ts) has to copy from the main window to draw the same picture.
 *
 * Every such store is an in-memory cache seeded once from localStorage (see
 * render/sceneSettings.ts's header for the pattern), so copying the stored
 * text is not enough: the cache has to be re-read too. A store opts in with
 * one line at module level, `registerSyncedStore(KEY, reload)`, where
 * `reload` empties its cache and re-seeds it from localStorage. Nothing else
 * in the repo lists these keys, so a new store that forgets to register
 * simply isn't mirrored to the output — it never silently half-works.
 *
 * Kept import-free on purpose: stores in render/ and audio/ both import it.
 */

interface SyncedStore {
  key: string;
  reload: () => void;
}

const stores: SyncedStore[] = [];

/** `reload` may be shared by several keys of one store (hit strength); the
 *  apply step below runs each distinct function once. */
export function registerSyncedStore(key: string, reload: () => void): void {
  stores.push({ key, reload });
}

/** The keys every registered store persists under, in registration order. */
export function syncedStorageKeys(): string[] {
  return stores.map((s) => s.key);
}

/** Every synced key's current stored text (absent keys omitted). */
export function captureSyncedStorage(storage: Pick<Storage, "getItem">): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { key } of stores) {
    let raw: string | null = null;
    try {
      raw = storage.getItem(key);
    } catch {
      // Unreadable storage reads as "nothing stored" — the defaults.
    }
    if (raw !== null) out[key] = raw;
  }
  return out;
}

/** Writes a captured snapshot into `storage` (removing synced keys it lacks,
 *  so a setting reset to default there resets here too), then makes every
 *  store re-read it. The output window passes its private in-memory
 *  storage, never the real one the main window owns. */
export function applySyncedStorage(
  values: Record<string, string>,
  storage: Pick<Storage, "setItem" | "removeItem">,
): void {
  for (const { key } of stores) {
    if (key in values) storage.setItem(key, values[key]);
    else storage.removeItem(key);
  }
  const done = new Set<() => void>();
  for (const { reload } of stores) {
    if (done.has(reload)) continue;
    done.add(reload);
    reload();
  }
}
