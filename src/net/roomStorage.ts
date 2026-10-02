/**
 * The localStorage overlay a paired phone or TV installs, so that the room's
 * look and the device's own settings never trample each other.
 *
 * The room look (server/lookDoc.ts) is applied by writing the room's keys into
 * `localStorage` and re-seeding every store from it (net/syncedStores.ts
 * `applyRoomStorage`) — the same mechanism the pop-out uses. On the pop-out's
 * private window that is free; on a phone or TV it would overwrite the device's
 * real saved settings, and the "remove keys the snapshot lacks" half of an
 * apply would delete them (the phone's saved Looks library most of all). So
 * the keys `isRoomKey` names live in an in-memory map instead, and every other
 * key (device id, saved Looks, panel prefs, quality, pairing sessions) passes
 * straight through to the real storage. Applying a look can then never delete
 * what is not part of it.
 *
 * `length`, `key(i)` and `clear()` see only the room keys. That is on purpose:
 * `applySyncedStorage` enumerates the storage to decide which keys the
 * snapshot lacks, and it must never be shown a key it is not allowed to touch.
 *
 * A controller page seeds the map from its real room keys, so the first phone
 * into an empty room publishes its own tuning as the room's starting look. A
 * TV starts empty: it has no look until the room sends one.
 *
 * Install happens in a first-import side-effect module before any store
 * evaluates (tvStorageBoot.ts, controllerStorageBoot.ts): ES modules run in
 * import order and every store seeds its cache from `localStorage` at module
 * load. Imports only realStorage.ts and syncedStores.ts, both import-free.
 */

import { realStorage } from "./realStorage.ts";
import { isRoomKey } from "./syncedStores.ts";

/** A Storage whose room keys are held in memory and whose other keys go to
 *  `real` (try/catch: a blocked or full storage reads as empty and drops
 *  writes, as the stores already expect). `real` null means no storage at all.
 *  `seed` copies the room keys `real` holds into the map first. */
export function createRoomOverlay(real: Storage | null, seed: boolean): Storage {
  const room = new Map<string, string>();
  if (seed && real) {
    try {
      for (let i = 0; i < real.length; i++) {
        const k = real.key(i);
        if (k === null || !isRoomKey(k)) continue;
        const v = real.getItem(k);
        if (v !== null) room.set(k, v);
      }
    } catch {
      // Unreadable storage seeds nothing — the defaults.
    }
  }

  return {
    get length(): number {
      return room.size;
    },
    key: (i) => Array.from(room.keys())[i] ?? null,
    getItem(k) {
      if (isRoomKey(k)) return room.has(k) ? (room.get(k) as string) : null;
      try {
        return real ? real.getItem(k) : null;
      } catch {
        return null;
      }
    },
    setItem(k, v) {
      if (isRoomKey(k)) {
        room.set(k, String(v));
        return;
      }
      try {
        if (real) real.setItem(k, v);
      } catch {
        // Not fatal — the setting just won't persist across reloads.
      }
    },
    removeItem(k) {
      if (isRoomKey(k)) {
        room.delete(k);
        return;
      }
      try {
        if (real) real.removeItem(k);
      } catch {
        // Nothing to remove from storage we cannot reach.
      }
    },
    clear: () => room.clear(),
  };
}

/** Puts the overlay over `window.localStorage`. False when the property could
 *  not be replaced; the page still works then, because every look apply goes
 *  through `applyRoomStorage(values, localStorage)`, which only ever touches
 *  room keys — but the look is then written into the device's own saved room
 *  settings, the very thing the overlay exists to prevent. */
export function installRoomStorage(opts: { seed: boolean }): boolean {
  try {
    Object.defineProperty(window, "localStorage", {
      value: createRoomOverlay(realStorage, opts.seed),
      configurable: true,
    });
    return true;
  } catch {
    return false;
  }
}

/** Whether this page was opened to be (or become) a phone controller — decided
 *  from the URL alone, before any module has run. Looser than bootPlan.ts's
 *  planBoot on purpose: a malformed link merely gets an in-memory look for
 *  that visit, while a missed one would let the room overwrite the phone's own
 *  settings. */
export function wantsControllerStorage(search: string): boolean {
  try {
    const params = new URLSearchParams(search);
    return params.get("role") === "controller" || params.has("adopt");
  } catch {
    return false;
  }
}
