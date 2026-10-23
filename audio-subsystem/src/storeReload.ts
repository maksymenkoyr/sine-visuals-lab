/**
 * How the audio stores hear that their saved text changed under them. Each
 * store keeps an in-memory cache seeded once from localStorage and registers
 * a reload here with onAudioStoreReload. A host that rewrites those keys from
 * outside calls reloadAudioStores() so each store re-seeds in place; in this
 * repo src/net/syncedStores.ts does, when the pop-out output or a room's TV
 * applies a snapshot.
 *
 * Text a reload cannot read must not reset its store. A reload reads and
 * validates first, with parseStoredObject / parseStoredNumber (they throw on
 * unreadable text; a missing key still means the defaults), and swaps its
 * cache only on success.
 *
 * Import-free on purpose: every audio store imports it, and so does the host.
 */

const reloads: Array<() => void> = [];

/** Runs `reload` on every reloadAudioStores(), once per distinct function.
 *  `key` only documents which store the reload belongs to. */
export function onAudioStoreReload(_key: string, reload: () => void): void {
  if (!reloads.includes(reload)) reloads.push(reload);
}

/** Re-seeds every audio store from storage, each on its own (a store that
 *  throws keeps what it had). */
export function reloadAudioStores(): void {
  for (const reload of reloads) {
    try {
      reload();
    } catch {
      // A store that cannot re-read keeps what it had.
    }
  }
}

/** A stored key's JSON object. Null when the key is absent (or empty): the
 *  store resets to its defaults. Throws on text that is not a plain object. */
export function parseStoredObject(raw: string | null): Record<string, unknown> | null {
  if (raw === null || raw === "") return null;
  const parsed: unknown = JSON.parse(raw); // throws on bad JSON
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
  return parsed as Record<string, unknown>;
}

/** The same for a stored number: null when absent, throws when not finite. */
export function parseStoredNumber(raw: string | null): number | null {
  if (raw === null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error("not a number");
  return n;
}
