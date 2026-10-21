/**
 * The desk strips' M button (issue #622). One setting of one scene can be
 * muted: drives.ts's forScene treats it the way "Only this" (driveSolo.ts)
 * treats every setting it silences, so its reaction is switched off for the
 * drive engine's reads and a built-in reaction holds at its rest value.
 *
 * It is in memory, never stored and never synced. This module is deliberately
 * not registered in src/net/syncedStores.ts, so the pop-out output and a
 * room's TV keep the real look and keep moving while NEXT is muted. Stored
 * wires are never touched, so unmuting restores them exactly. Nothing here
 * touches the DOM or localStorage.
 */

const muted = new Set<string>();
const listeners = new Set<() => void>();

function keyOf(sceneId: string, key: string): string {
  return JSON.stringify([sceneId, key]);
}

function emit(): void {
  for (const cb of Array.from(listeners)) cb();
}

export function isDriveMuted(sceneId: string, key: string): boolean {
  return muted.has(keyOf(sceneId, key));
}

/** Mute the setting if it is live, unmute it if it is muted. Listeners run on every toggle. */
export function toggleDriveMute(sceneId: string, key: string): void {
  const k = keyOf(sceneId, key);
  if (muted.has(k)) muted.delete(k);
  else muted.add(k);
  emit();
}

/** Unmute every setting. Listeners run only when something was muted. */
export function clearDriveMutes(): void {
  if (muted.size === 0) return;
  muted.clear();
  emit();
}

/** Subscribe to every change of the mute set. Returns the unsubscribe function. */
export function onDriveMuteChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
