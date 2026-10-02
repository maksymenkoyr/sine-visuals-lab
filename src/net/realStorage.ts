/**
 * The page's real `window.localStorage`, captured before anything can replace it.
 *
 * A paired phone or TV installs an in-memory overlay over `localStorage` so
 * that applying the room's look never writes into (or deletes from) the
 * device's own saved settings (src/net/tvStorageBoot.ts,
 * src/net/controllerStorageBoot.ts). Anything that must reach the device's
 * actual storage — the device id, the saved pairing session — imports this
 * instead of reading the global, which by then may be the overlay.
 *
 * It imports nothing so it can be evaluated first, and has no side effects.
 * Null when storage is unavailable (private window, blocked site data); callers
 * must cope, as they already do for a throwing `localStorage`.
 */
export const realStorage: Storage | null = (() => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
})();
