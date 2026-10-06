/**
 * Main and Play, from one device's side: the room's look document
 * (server/lookDoc.ts) is **Main**, the program every screen of the room shows,
 * and each device's own look (what its panel set) is its **preview**. Pure —
 * the socket, the device's storage and the clock are injected — so the whole
 * story is tested without a browser (tests/mainPlay.test.ts). It replaces the
 * phone's old live publisher: nothing a device edits reaches the room until
 * it presses Play. Whether the room accepts a device's Play is the room's rule
 * (server/roomDevices.ts `mayPlay`); net/roomBridge.ts keeps a device without
 * the right from sending one, and a refusal that still comes back is `onReject`.
 *
 * What a device does with Main:
 * - **Play** sends the diff between Main and this device's look as one patch
 *   (`play`). The room applies it, relays it to everyone else and acks it to
 *   us; the ack folds the patch into our copy of Main (`onAck`), so "on air"
 *   turns true without waiting for a snapshot. A hold asks the screens to glide
 *   there (`glideMs`, ignored by the room's storage, relayed beside the
 *   patch) — but only within one scene: a scene change always switches at
 *   once, so a glide is never asked for when the patch names a scene.
 * - **Someone else plays.** A device that was *on air* (its look equals the
 *   Main that just got replaced) follows: `apply` shows the new Main, glide
 *   hint included, so a remote's panel always starts from what the screens
 *   show. A device with unplayed edits keeps its preview and reports
 *   `changedBy` (the bar says MAIN CHANGED BY <name>); `take` drops its edits
 *   and shows Main. A device whose roster screen is `own` never applies Main
 *   and never reports a change — it keeps its look but can still Play. `main`
 *   and `off` follow alike.
 * - **Joining.** The first snapshot of a connection decides: a non-owner
 *   applies an existing Main at once (as a phone always did); the room's owner
 *   (the laptop) keeps its own look and just reads "not on air"; in a room with
 *   no Main yet the owner plays its look as the first one. A room's Main that
 *   has no scene (the owner opened in the gallery, so it had none to play)
 *   gets the owner's scene, and only that, once the owner has one (`tick`). A
 *   later snapshot (a gap resync or a reconnect) follows only a device that
 *   was on air, so a wifi blink never costs anyone their unplayed edits.
 *   The room sends a connection's snapshot before its roster, so a non-owner's
 *   screen choice may still be unknown (`screen()` returns null) at the first
 *   snapshot: the join waits for `onScreenKnown` and then applies Main only
 *   when the screen isn't `own`, so a device set to `own` keeps its look
 *   across a reload. While the screen is unknown nothing follows.
 *
 * "On air" compares this device's look to Main through outputSync.ts's
 * `stateKey` (sorted, stable, ignores the keys the main window rewrites on its
 * own). A device cannot always show Main exactly — the phone keeps ids it
 * cannot render, a store normalises a value after a write — so right after
 * applying a Main the key of what the device then showed is remembered
 * (`anchor`): a device still showing exactly that against that Main counts as
 * on air. A patch of ours that is in flight counts as part of Main for the
 * "on air" reading and for the next Play's diff (several quick Plays each send
 * only what is new, and a key reverted in between is still sent back). A relay
 * from someone else that lands while ours is in flight is folded into Main but
 * never shown: ours is applied by the room after it, so the device keeps what
 * it played. If it changed something none of ours set, the device does not
 * show it either, so once ours settle (ack or reject) the device reports
 * `changedBy` for it and offers Take Main (otherwise the next Play would
 * silently send the old value back over it).
 *
 * Revisions give gap detection exactly as in lookSync.ts's `createLookReplica`,
 * which holds Main here: a relay that skips a revision asks the caller (through
 * `onNeedSnapshot`, once per resync) to send a `lookGet`. Applying is
 * idempotent on the room side, so nothing is retried: a patch lost on a dropped
 * socket is simply gone and the next Play sends the whole diff again; a
 * rejected one is the same.
 *
 * The device's own window cannot glide: the laptop's and the iPad's main
 * window switch at once when following a Main that someone played with a hold
 * (what an `apply` does with `glideMs` is the caller's — the TV and the
 * pop-out walk it, see outputGlide.ts).
 */

import {
  LOOK_LIMITS,
  applyLookPatch,
  diffLook,
  emptyLookDoc,
  isEmptyPatch,
  type LookClientMsg,
  type LookDoc,
  type LookPatch,
  type LookRejectReason,
} from "../../server/lookDoc.ts";
import type { ScreenUse } from "../../server/roomDevices.ts";
import { createLookReplica } from "./lookSync.ts";
import { DEFAULT_OUTPUT_PARAMS, stateKey } from "./outputSync.ts";

/** How often `tick` re-reads the device's look to recompute "on air". Same
 *  cadence as the pop-out's LOOK_POLL_MS (outputBridge.ts). */
export const MAIN_POLL_MS = 120;

/** What the bar says when it cannot name who changed Main. */
const SOMEONE = "another device";

export interface MainPlayOptions {
  /** Sends a look message to the room; false when the socket isn't open. */
  send: (msg: LookClientMsg) => boolean;
  /** This device's look now: scene, palette and room-scope storage. */
  capture: () => LookDoc;
  /** Make this device show `doc`. `glideMs` is a hint the device may ignore. */
  apply: (doc: LookDoc, glideMs?: number) => void;
  /** This device's screen choice right now (its roster entry); null until the
   *  room has sent a roster that has this device (see the header). */
  screen: () => ScreenUse | null;
  /** The room's owner device keeps its own look when it joins (see the header). */
  isOwner: boolean;
  /** The name to show for a device id (`by`), from the roster. */
  nameOf: (deviceId: string) => string | null;
}

export interface MainPlayStatus {
  /** The room has told this device its Main (a snapshot arrived since connecting). */
  known: boolean;
  /** This device's look equals Main. */
  onAir: boolean;
  /** Who changed Main while this device had unplayed edits; null otherwise. */
  changedBy: string | null;
}

export interface MainPlay {
  onSnapshot(rev: number, doc: LookDoc | null): void;
  /** The roster now tells this device's screen: settles a join that waited for it. */
  onScreenKnown(): void;
  /** Someone else's patch, as the room relayed it. */
  onPatch(rev: number, patch: LookPatch & { by?: string; glideMs?: number }): void;
  onAck(n: number, rev: number): void;
  onReject(n: number | null, reason: LookRejectReason): void;
  onDisconnect(): void;
  /** Re-reads this device's look every `MAIN_POLL_MS` and recomputes onAir.
   *  Call as often as you like; it throttles itself. */
  tick(nowMs: number): void;
  /** Sends this device's look to Main. "sent" or "glide" (a glide was asked
   *  for); null when there is nothing to send, Main isn't known yet or the
   *  socket is down. A glide is only asked for within one scene. */
  play(glideMs?: number): "sent" | "glide" | null;
  /** Drops this device's edits: applies Main, clears changedBy. */
  take(): void;
  status(): MainPlayStatus;
  onStatus(cb: (s: MainPlayStatus) => void): () => void;
  /** Needs a lookGet (a gap in revisions). The caller sends it. */
  onNeedSnapshot(cb: () => void): void;
}

function lookKey(doc: LookDoc): string {
  return stateKey({ scene: doc.scene, palette: doc.palette, storage: doc.storage, params: DEFAULT_OUTPUT_PARAMS });
}

/** Does `changed` (what a relay changed) touch a scene, palette or key that none of `patches` sets? */
function touchesOutside(changed: LookPatch, patches: LookPatch[]): boolean {
  if (changed.scene !== undefined && !patches.some((p) => p.scene !== undefined)) return true;
  if (changed.palette !== undefined && !patches.some((p) => p.palette !== undefined)) return true;
  const mine = new Set<string>();
  for (const p of patches) {
    for (const k of Object.keys(p.set ?? {})) mine.add(k);
    for (const k of p.del ?? []) mine.add(k);
  }
  const keys = [...Object.keys(changed.set ?? {}), ...(changed.del ?? [])];
  return keys.some((k) => !mine.has(k));
}

export function createMainPlay(opts: MainPlayOptions): MainPlay {
  const replica = createLookReplica();
  /** Main is known: a snapshot has arrived on this connection. */
  let known = false;
  /** A snapshot has ever arrived on this page: later ones are resyncs. */
  let seen = false;
  let seq = 0;
  /** Patches sent and not yet acked, oldest first. */
  let inflight: { n: number; patch: LookPatch }[] = [];
  let changedBy: string | null = null;
  /** After an apply: the Main it showed and the key of what the device then
   *  held (see the header). */
  let anchor: { mainKey: string; shownKey: string } | null = null;
  let needSnapshot: (() => void) | null = null;
  /** A lookGet has been asked for and no snapshot has answered yet. */
  let asked = false;
  let lastTick = -Infinity;
  /** A non-owner's first snapshot arrived while its screen was unknown: the
   *  join is decided in `onScreenKnown`. */
  let joinHeld = false;
  /** The owner has sent the scene for a Main that had none, on this connection. */
  let seeded = false;
  /** Someone else's relay landed while ours was in flight and changed what none
   *  of ours set: who (see the header). Reported once ours settle. */
  let foreignWhileInflight: string | null = null;
  let last: MainPlayStatus = { known: false, onAir: false, changedBy: null };
  const listeners: ((s: MainPlayStatus) => void)[] = [];

  /** This device takes part in following Main: its screen is known and isn't `own`. */
  function follows(): boolean {
    const s = opts.screen();
    return s !== null && s !== "own";
  }

  /** Once the in-flight patches are all settled, reports a relay that landed
   *  among them and changed something they did not set. */
  function settle(): void {
    if (inflight.length > 0 || foreignWhileInflight === null) return;
    const by = foreignWhileInflight;
    foreignWhileInflight = null;
    if (known && !matches(projected())) changedBy = changedBy ?? by;
  }

  /** Main with our in-flight patches laid on top. */
  function projected(): LookDoc {
    let doc = replica.doc() ?? emptyLookDoc();
    for (const p of inflight.map((f) => f.patch)) {
      const r = applyLookPatch(doc, p);
      if (r.ok) doc = r.doc;
    }
    return doc;
  }

  /** Does the device show `doc`: exactly, or as exactly as it could the last
   *  time it applied that same Main. */
  function matches(doc: LookDoc): boolean {
    const shown = lookKey(opts.capture());
    const key = lookKey(doc);
    return shown === key || (anchor !== null && anchor.mainKey === key && anchor.shownKey === shown);
  }

  function show(doc: LookDoc, glideMs?: number): void {
    opts.apply(doc, glideMs);
    anchor = { mainKey: lookKey(doc), shownKey: lookKey(opts.capture()) };
    changedBy = null;
  }

  function askForSnapshot(): void {
    if (asked) return;
    asked = true;
    if (needSnapshot) needSnapshot();
  }

  /** Recomputes the status and tells the listeners if it changed. */
  function refresh(): void {
    const onAir = known && matches(projected());
    if (onAir && changedBy !== null) changedBy = null; // edits reverted to Main: nothing to report
    const next: MainPlayStatus = { known, onAir, changedBy };
    if (next.known === last.known && next.onAir === last.onAir && next.changedBy === last.changedBy) return;
    last = next;
    for (const cb of listeners.slice()) cb(next);
  }

  function play(glideMs?: number): "sent" | "glide" | null {
    if (!known) return null;
    const diff = diffLook(projected(), opts.capture());
    if (!diff) return null;
    return sendPatch(diff, glideMs);
  }

  function sendPatch(diff: LookPatch, glideMs?: number): "sent" | "glide" | null {
    const glide = glideMs !== undefined && glideMs > 0 && diff.scene === undefined;
    const n = seq + 1;
    const msg: LookClientMsg = { type: "lookPatch", n, ...diff };
    if (glide) msg.glideMs = Math.min(glideMs as number, LOOK_LIMITS.maxGlideMs);
    if (!opts.send(msg)) return null;
    seq = n;
    inflight.push({ n, patch: diff });
    refresh();
    return glide ? "glide" : "sent";
  }

  /** The owner opened in the gallery, so the room's Main may have no scene: send
   *  the owner's scene (alone) as soon as it has one. Once per connection. */
  function seedScene(): void {
    if (!opts.isOwner || !known || seeded) return;
    const scene = opts.capture().scene;
    if (scene === "" || projected().scene !== "") return;
    seeded = true;
    sendPatch({ scene });
  }

  return {
    onSnapshot(rev, doc) {
      asked = false;
      const prev = replica.doc();
      // Read the verdict on the old Main before it is replaced. A patch of ours
      // in flight muddies it, so then the device is simply not "on air".
      const wasOn = seen && inflight.length === 0 && matches(prev ?? emptyLookDoc());
      const prevKey = lookKey(prev ?? emptyLookDoc());
      const first = !seen;
      replica.onSnapshot(rev, doc);
      known = true;
      seen = true;
      const main = replica.doc();

      if (main === null) {
        if (opts.isOwner) play();
      } else if (first) {
        if (!opts.isOwner) {
          if (opts.screen() === null) joinHeld = true;
          else if (follows()) show(main);
        }
      } else if (follows() && lookKey(main) !== prevKey) {
        if (wasOn) show(main);
        else if (!matches(main)) changedBy = changedBy ?? SOMEONE;
      }
      seedScene();
      refresh();
    },

    onScreenKnown() {
      if (!joinHeld || opts.screen() === null) return;
      joinHeld = false;
      const main = replica.doc();
      if (known && main && follows()) show(main);
      refresh();
    },

    onPatch(rev, patch) {
      if (!known) return;
      const prev = replica.doc();
      const hadInflight = inflight.length > 0;
      const wasOn = !hadInflight && matches(prev ?? emptyLookDoc());
      const r = replica.onPatch(rev, patch);
      if (r.status === "gap") {
        askForSnapshot();
        return;
      }
      if (r.status === "stale") return;
      if (hadInflight && !isEmptyPatch(r.changed) && follows() && touchesOutside(r.changed, inflight.map((f) => f.patch))) {
        foreignWhileInflight = (patch.by !== undefined ? opts.nameOf(patch.by) : null) ?? SOMEONE;
      }
      if (!hadInflight && !isEmptyPatch(r.changed) && follows()) {
        if (wasOn) {
          const g = patch.glideMs;
          show(r.doc, typeof g === "number" && Number.isFinite(g) && g > 0 ? g : undefined);
        } else if (!matches(r.doc)) {
          changedBy = (patch.by !== undefined ? opts.nameOf(patch.by) : null) ?? SOMEONE;
        }
      }
      refresh();
    },

    onAck(n, rev) {
      const at = inflight.findIndex((f) => f.n === n);
      if (at < 0) return;
      const sent = inflight[at].patch;
      inflight.splice(at, 1);
      // The room applied our patch on top of whatever it held, so fold it on
      // top of ours; a revision we can't place means we missed a relay.
      const r = replica.onPatch(rev, sent);
      if (r.status === "gap") askForSnapshot();
      changedBy = null;
      settle();
      refresh();
    },

    onReject(n, _reason) {
      if (n === null) inflight = [];
      else inflight = inflight.filter((f) => f.n !== n);
      settle();
      refresh();
    },

    onDisconnect() {
      known = false;
      asked = false;
      inflight = [];
      seeded = false;
      foreignWhileInflight = null;
      refresh();
    },

    tick(nowMs) {
      if (nowMs - lastTick < MAIN_POLL_MS) return;
      lastTick = nowMs;
      seedScene();
      refresh();
    },

    play,

    take() {
      const main = replica.doc();
      if (known && main) show(main);
      changedBy = null;
      refresh();
    },

    status: () => last,

    onStatus(cb) {
      listeners.push(cb);
      return () => {
        const i = listeners.indexOf(cb);
        if (i >= 0) listeners.splice(i, 1);
      };
    },

    onNeedSnapshot(cb) {
      needSnapshot = cb;
    },
  };
}
