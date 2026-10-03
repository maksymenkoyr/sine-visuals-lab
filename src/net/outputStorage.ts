/**
 * The output window's private localStorage: an in-memory stand-in installed
 * over `window.localStorage` before any store module loads (output.ts
 * imports this first — ES modules evaluate in import order, and every store
 * seeds its cache from `localStorage` at module load).
 *
 * Why the output must not read the real one. It shares an origin with the
 * main window, so the real localStorage is the main window's *live* state —
 * exactly what Cue exists to hold back. The output's stores are instead fed
 * only by `state` messages (net/outputSync.ts) through
 * net/syncedStores.ts's applySyncedStorage, and nothing it writes can leak
 * back into the main window's saved settings.
 */

const mem = new Map<string, string>();

export const outputStorage: Storage = {
  get length(): number {
    return mem.size;
  },
  key: (i) => [...mem.keys()][i] ?? null,
  getItem: (k) => mem.get(k) ?? null,
  setItem: (k, v) => {
    mem.set(k, String(v));
  },
  removeItem: (k) => {
    mem.delete(k);
  },
  clear: () => mem.clear(),
};

try {
  Object.defineProperty(window, "localStorage", { value: outputStorage, configurable: true });
} catch {
  // Couldn't override: the output falls back to reading the real storage at
  // load, so Cue still holds scene and palette but not settings across a reload.
}
