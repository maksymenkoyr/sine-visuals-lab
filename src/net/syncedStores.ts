/**
 * What a second renderer window (the pop-out output, see outputSync.ts)
 * copies from the main window: every localStorage key the app writes, except
 * the ones in PRIVATE_KEYS. Wholesale on purpose — a store added next year is
 * mirrored without anyone remembering to list it.
 *
 * The room look (server/lookDoc.ts) is the same snapshot with a narrower
 * scope: `isRoomKey` is the question "does this key change how a scene
 * looks, for everyone watching?". It is a denylist over `vibe.*` for the same
 * reason — PRIVATE_KEYS, VOLATILE_PREFIXES and ROOM_EXCLUDED_PREFIXES name
 * what stays on one device, and a store added next year rides along. Passing
 * `isRoomKey` as the `scope` of capture/apply (captureRoomStorage /
 * applyRoomStorage) keeps a phone's or TV's own keys — device id, saved
 * Looks, panel prefs, pairing sessions — out of both directions. No scope
 * means today's pop-out behaviour, unchanged.
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
 *  the room identity, panel/tip/toast state, which audio source this
 *  machine picked (the output gets frames, not audio), and each window's
 *  own quality, power and resolution settings (render/outputPower.ts: the
 *  output's travel as a `power` message, outside Cue). */
export const PRIVATE_KEYS: ReadonlySet<string> = new Set([
  "vibe.deviceId",
  "vibe.keyTips",
  "vibe.panelFolds",
  "vibe.hitTailLinked",
  "vibe.hiddenInputs",
  "vibe.bakeToast",
  "vibe.audioSource",
  "vibe.audioInputDevice",
  // Which controller knob or pad does what: a controller is plugged into one
  // machine (ui/midiInput.ts).
  "vibe.midiMap",
  "vibe.quality",
  "vibe.powerMode",
  "vibe.output.quality",
  "vibe.output.powerMode",
  "vibe.preview.quality",
  "vibe.preview.size",
  "vibe.output.resolution",
  "vibe.preview.resolution",
  // The pairing sessions (src/net/sessions.ts) hold room secrets: never
  // mirrored to the pop-out, and not `vibe.*`, so never in a room look either.
  "svl.hostRoom",
  "svl.controllerSession",
  "svl.tvSession",
  "svl.pendingAdopt",
]);

/** Key prefixes the main window rewrites continuously on its own (auto-
 *  tracked marks): mirrored, but ignored by outputSync.ts's stateKey so they
 *  never read as a difference between preview and output. */
export const VOLATILE_PREFIXES: readonly string[] = ["vibe.silenceGate", "vibe.autoGain"];

/** Keys under `vibe.*` that are one device's own and so never join the room
 *  look, though the pop-out still mirrors them: the Looks library (a shelf of
 *  looks, not the look on screen), dev pins, each window's output/preview
 *  settings and the panel's own chrome (the glass blur, ui/glassPref.ts). Every `vibe.` key literal
 *  in src is classified in tests/syncedScope.test.ts, so a new key cannot
 *  slip into the room unseen — add it here if it is device-local. */
export const ROOM_EXCLUDED_PREFIXES: readonly string[] = [
  "vibe.looks",
  "vibe.devPins",
  "vibe.output.",
  "vibe.preview.",
  "vibe.panelBlur",
];

/** Whether `key` belongs to the room look. Only `vibe.` keys ever do, which
 *  also keeps names like `__proto__` out of a look by construction. */
export function isRoomKey(key: string): boolean {
  if (!key.startsWith("vibe.") || PRIVATE_KEYS.has(key)) return false;
  for (const p of VOLATILE_PREFIXES) if (key.startsWith(p)) return false;
  for (const p of ROOM_EXCLUDED_PREFIXES) if (key.startsWith(p)) return false;
  return true;
}

const hooks: Array<() => void> = [];

/** Runs after a snapshot is applied, once per distinct function. `key` only
 *  documents which store the hook belongs to. */
export function registerSyncedStore(_key: string, reload: () => void): void {
  if (!hooks.includes(reload)) hooks.push(reload);
}

type Keyed = Pick<Storage, "getItem" | "key" | "length">;

/** Every mirrored key's current text. With `scope`, only the keys it accepts. */
export function captureSyncedStorage(storage: Keyed, scope?: (key: string) => boolean): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key === null || PRIVATE_KEYS.has(key) || (scope && !scope(key))) continue;
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
 *  real one the main window owns.
 *
 *  With `scope`, only keys it accepts are removed or written — on the way in
 *  too, so a snapshot from another machine cannot plant a key outside it.
 *  Each hook runs on its own: one store that throws leaves the others
 *  re-seeded rather than a display half-applied. */
export function applySyncedStorage(
  values: Record<string, string>,
  storage: Pick<Storage, "setItem" | "removeItem" | "key" | "length">,
  scope?: (key: string) => boolean,
): void {
  const existing: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k !== null) existing.push(k);
  }
  for (const k of existing) {
    if (!(k in values) && !PRIVATE_KEYS.has(k) && (!scope || scope(k))) storage.removeItem(k);
  }
  for (const k of Object.keys(values)) {
    if (!scope || scope(k)) storage.setItem(k, values[k]);
  }
  for (const reload of hooks) {
    try {
      reload();
    } catch {
      // A store that cannot re-read keeps what it had.
    }
  }
}

/** The room look's storage: every `isRoomKey` key's current text. */
export function captureRoomStorage(storage: Keyed): Record<string, string> {
  return captureSyncedStorage(storage, isRoomKey);
}

/** Makes `storage`'s room keys match this snapshot and re-seeds the stores. */
export function applyRoomStorage(
  values: Record<string, string>,
  storage: Pick<Storage, "setItem" | "removeItem" | "key" | "length">,
): void {
  applySyncedStorage(values, storage, isRoomKey);
}
