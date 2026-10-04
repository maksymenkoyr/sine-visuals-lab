/**
 * The one switch for Pro content. Pro is the subscription that unlocks some
 * settings and scene variants on the hosted site (the paid-scene side is a
 * different mechanism — see scenes/privateScenes.ts). Pro code stays AGPL in
 * this repo; what the subscription sells is access on the hosted site, so the
 * gate is soft by design.
 *
 * Today there is no subscription, and Pro content is locked everywhere
 * except a dev build (`npm run dev`), where it stays playable so it can be
 * built and tuned. When billing lands, its entitlement check calls
 * setProUnlocked(true) — nothing else changes.
 *
 * What a lock means is owned by whatever is locked: an enum setting's
 * `proOptions` (sceneSettings.ts) is the first and so far only kind — a locked
 * option can't be stored or read back, so a Look, a share code or a paired
 * phone can't select it either.
 */

let unlocked: boolean = import.meta.env.DEV;

export function proUnlocked(): boolean {
  return unlocked;
}

/** For the entitlement check once billing exists, and for tests. */
export function setProUnlocked(value: boolean): void {
  unlocked = value;
}
