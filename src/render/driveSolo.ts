/**
 * The "Only this" preview. One setting in one scene can be "soloed": every
 * other setting of that scene has its reaction switched off for the drive
 * engine's reads (drives.ts's forScene treats them as silenced, and a
 * built-in reaction is held at its rest value), so only the soloed setting
 * still follows the sound. The state is one in-memory {sceneId, key}, or
 * none. Starting a new solo replaces the old one; it never stacks.
 *
 * It is a local preview and nothing more. It is not stored and not synced:
 * this module is deliberately not registered in src/net/syncedStores.ts, so
 * the pop-out output and a room's TV keep the real look. Stored wires are
 * never edited, so ending the solo restores every setting exactly as it was.
 * Nothing here touches the DOM or localStorage.
 */

let current: { sceneId: string; key: string } | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const cb of Array.from(listeners)) cb();
}

export function getDriveSolo(): { sceneId: string; key: string } | null {
  return current;
}

/** Solo `key` in `sceneId`, replacing any solo already in place. Listeners
 *  run only when this actually changes which setting is soloed. */
export function setDriveSolo(sceneId: string, key: string): void {
  if (current && current.sceneId === sceneId && current.key === key) return;
  current = { sceneId, key };
  emit();
}

/** End the solo, if there is one. Listeners run only on a real change. */
export function clearDriveSolo(): void {
  if (!current) return;
  current = null;
  emit();
}

/** Subscribe to every change of the solo. Returns the unsubscribe function. */
export function onDriveSoloChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
