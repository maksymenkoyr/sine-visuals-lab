/**
 * Keeping a room's look document (server/lookDoc.ts) and a device's own
 * settings in step: the phone controller's publisher, and the TV's replica.
 * Both are pure — the socket, the storage and the clock are injected — so the
 * whole conflict story is tested without a browser (tests/lookSync.test.ts,
 * tests/roomLookE2E.test.ts).
 *
 * The room is the serialiser. It applies patches in arrival order, per key,
 * last writer wins, and bumps its revision once per patch that changed
 * anything. Everything here exists to make that safe over a flaky link:
 *
 * - **Stop-and-wait.** The publisher keeps one patch in flight. `base` — what
 *   it believes the room holds — advances only when the room acks, never on
 *   send, so a patch that was lost on a dropped socket is simply computed
 *   again by the next tick (applying is idempotent, so a resend that did get
 *   through is harmless).
 * - **Nothing to remember about edits.** There is no queue of unsent changes:
 *   the diff between `base` and what `io.read()` returns right now *is* the
 *   unsent change, so a slider dragged ten times while offline publishes once.
 * - **Own edits win until acked.** A patch from another controller never
 *   overwrites a key this device has changed and not yet had acked; that key
 *   is skipped locally and our value goes out on the next tick. Remote keys we
 *   have not touched are written into the local stores at once.
 * - **Reconnect is a three-way merge.** A fresh snapshot is the room's truth;
 *   the keys this device touched since `base` (or has in flight — the ack may
 *   have been the thing that was lost) are laid back over it with this
 *   device's current values, and the next tick republishes exactly those.
 *   Server truth plus our un-acked edits, and nothing else.
 * - **Echo suppression is structural.** Whatever arrives from the room is
 *   written to the local stores *and* folded into `base`, so the diff stays
 *   empty and nothing bounces back. A store that normalises a value after a
 *   write (autoTune.ts prunes entries equal to default) can cause one extra
 *   patch; it converges because applying is idempotent.
 * - **A refused diff is not retried.** If the room rejects a patch (too big, a
 *   shape it will not take, not allowed) that same diff would be rejected
 *   again, so it is remembered and not resent until something differs.
 *
 * Revisions give gap detection: a relayed patch must be exactly one past the
 * last seen, else `lookGet` asks for the whole document (which lands in the
 * three-way merge above). The room never echoes a patch to its sender, so our
 * own acks carry the revision our patch produced.
 *
 * The TV never edits, so its replica is only the room's document and a
 * revision: a snapshot replaces it, a patch applies when it is next in line,
 * and the caller resyncs on a gap. What the TV does with a document — apply the
 * whole `storage` through net/syncedStores.ts `applyRoomStorage` — is tv.ts's.
 */

import {
  applyLookPatch,
  diffLook,
  emptyLookDoc,
  isEmptyPatch,
  sanitizeLookDoc,
  type LookClientMsg,
  type LookDoc,
  type LookPatch,
  type LookRejectReason,
} from "../../server/lookDoc.ts";

/** How often the phone checks for an unsent edit. Same cadence as the
 *  pop-out's LOOK_POLL_MS (outputBridge.ts). */
export const LOOK_PUBLISH_MS = 120;

export interface LookIO {
  /** The device's current look: its scene and palette ids and its room-scope storage. */
  read(): LookDoc;
  /** Makes the device show this look (writes the stores, switches scene/palette). */
  write(doc: LookDoc): void;
  /** False when the socket is not open — the message is then NOT counted as sent. */
  send(msg: LookClientMsg): boolean;
  /** The room refused one of our patches. */
  onReject?(reason: LookRejectReason): void;
}

export interface LookSync {
  /** The room's snapshot: on every (re)connect, and the reply to `lookGet`. */
  onSnapshot(rev: number, doc: LookDoc | null): void;
  /** Another controller's edit, as the room relayed it. A gap asks for a snapshot. */
  onPatch(rev: number, patch: LookPatch): void;
  onAck(n: number, rev: number): void;
  onReject(n: number | null, reason: LookRejectReason): void;
  /** The socket dropped: whatever was in flight is assumed lost. */
  onDisconnect(): void;
  /** Publishes the pending edit, if any. Call every LOOK_PUBLISH_MS. */
  tick(): void;
  /** Whether a snapshot has been taken (nothing is published before). */
  readonly joined: boolean;
  /** The last room revision folded in. */
  readonly rev: number;
}

function hasOwn(o: object, k: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, k);
}

/** `applyLookPatch`, except it never refuses. The size caps are the room's to
 *  enforce on what it stores; a device that is itself past them must still be
 *  able to follow its room, so on a size refusal the patch is merged plainly. */
function applyLoose(doc: LookDoc, patch: LookPatch): LookDoc {
  const r = applyLookPatch(doc, patch);
  if (r.ok) return r.doc;
  const storage: Record<string, string> = { ...doc.storage };
  if (patch.del) for (const k of patch.del) delete storage[k];
  if (patch.set) for (const k of Object.keys(patch.set)) storage[k] = patch.set[k];
  return { scene: patch.scene ?? doc.scene, palette: patch.palette ?? doc.palette, storage };
}

/** Which parts of the look this device has changed and not had acked. */
interface Touched {
  keys: Set<string>;
  scene: boolean;
  palette: boolean;
}

export function createLookSync(io: LookIO): LookSync {
  let base: LookDoc = emptyLookDoc();
  let inflight: { n: number; patch: LookPatch } | null = null;
  /** Patches that were in flight when the socket dropped: the room may have
   *  applied them and lost the ack. Only the next snapshot can say, so their
   *  keys stay "ours" until it arrives (an edit reverted meanwhile must win). */
  let limbo: LookPatch[] = [];
  let joined = false;
  let lastRev = 0;
  let seq = 0;
  /** Signature of the last diff the room refused. */
  let refused: string | null = null;

  function touched(local: LookDoc): Touched {
    const t: Touched = { keys: new Set<string>(), scene: false, palette: false };
    const add = (p: LookPatch | null): void => {
      if (!p) return;
      if (p.scene !== undefined) t.scene = true;
      if (p.palette !== undefined) t.palette = true;
      if (p.set) for (const k of Object.keys(p.set)) t.keys.add(k);
      if (p.del) for (const k of p.del) t.keys.add(k);
    };
    add(diffLook(base, local));
    if (inflight) add(inflight.patch);
    for (const p of limbo) add(p);
    return t;
  }

  /** What this device still means to say about everything it touched: those
   *  keys at the values it holds now, or deleted where it no longer has them. */
  function intent(local: LookDoc, t: Touched): LookPatch | null {
    const p: LookPatch = {};
    if (t.scene && local.scene !== "") p.scene = local.scene;
    if (t.palette && local.palette !== "") p.palette = local.palette;
    t.keys.forEach((k) => {
      if (hasOwn(local.storage, k)) (p.set ??= {})[k] = local.storage[k];
      else (p.del ??= []).push(k);
    });
    return isEmptyPatch(p) ? null : p;
  }

  function joinAt(rev: number): void {
    lastRev = rev;
    joined = true;
    inflight = null;
    limbo = [];
    refused = null;
  }

  return {
    onSnapshot(rev, doc) {
      if (doc === null) {
        // An empty room (rev 0): this device's look is the room's to start
        // from. `base` is empty, so the next tick publishes all of it.
        base = emptyLookDoc();
        joinAt(rev);
        return;
      }
      if (!joined) {
        io.write(doc);
        base = io.read();
        joinAt(rev);
        return;
      }
      // Reconnect or gap recovery: the room's truth, plus what we have not got acked.
      const local = io.read();
      const mine = intent(local, touched(local));
      io.write(mine ? applyLoose(doc, mine) : doc);
      base = doc;
      joinAt(rev);
    },

    onPatch(rev, patch) {
      if (!joined || rev <= lastRev) return;
      if (rev !== lastRev + 1) {
        io.send({ type: "lookGet" });
        return;
      }
      const local = io.read();
      const mine = touched(local);
      const take: LookPatch = {};
      if (patch.scene !== undefined && !mine.scene) take.scene = patch.scene;
      if (patch.palette !== undefined && !mine.palette) take.palette = patch.palette;
      if (patch.set) {
        for (const k of Object.keys(patch.set)) if (!mine.keys.has(k)) (take.set ??= {})[k] = patch.set[k];
      }
      if (patch.del) {
        const del = patch.del.filter((k) => !mine.keys.has(k));
        if (del.length > 0) take.del = del;
      }
      if (!isEmptyPatch(take)) io.write(applyLoose(local, take));
      // `base` follows the room whole, skipped keys included: a key we are
      // holding back then differs from `base`, which is what republishes it.
      base = applyLoose(base, patch);
      lastRev = rev;
    },

    onAck(n, rev) {
      if (!inflight || inflight.n !== n) return;
      base = applyLoose(base, inflight.patch);
      inflight = null;
      if (rev > lastRev + 1) io.send({ type: "lookGet" }); // missed a patch before ours
      if (rev > lastRev) lastRev = rev;
    },

    onReject(n, reason) {
      if (n !== null && (!inflight || inflight.n !== n)) return; // not ours any more
      const patch = inflight ? inflight.patch : null;
      inflight = null;
      // The same diff would be refused again, whatever the reason: don't resend it.
      if (patch) refused = JSON.stringify(patch);
      if (io.onReject) io.onReject(reason);
    },

    onDisconnect() {
      // Assume it was lost and let the next tick resend it (applying is idempotent).
      if (inflight) limbo.push(inflight.patch);
      inflight = null;
    },

    tick() {
      if (!joined || inflight) return;
      const patch = diffLook(base, io.read());
      if (!patch) return;
      if (refused !== null && JSON.stringify(patch) === refused) return;
      const n = seq + 1;
      if (io.send({ type: "lookPatch", n, ...patch })) {
        seq = n;
        inflight = { n, patch };
      }
    },

    get joined() {
      return joined;
    },
    get rev() {
      return lastRev;
    },
  };
}

export interface LookReplica {
  /** Replaces the document and revision (sanitised); null is an empty room. */
  onSnapshot(rev: number, doc: LookDoc | null): void;
  /** The next patch applies and returns the new document and what changed; one
   *  already seen is stale; anything else means a patch was missed — the
   *  caller should ask the room for a snapshot. */
  onPatch(
    rev: number,
    patch: LookPatch,
  ): { status: "applied"; doc: LookDoc; changed: LookPatch } | { status: "stale" } | { status: "gap" };
  /** Null until the room has said anything but "empty". */
  doc(): LookDoc | null;
  rev(): number;
}

export function createLookReplica(): LookReplica {
  let doc: LookDoc | null = null;
  let rev = 0;
  return {
    onSnapshot(r, d) {
      rev = r;
      doc = d === null ? null : sanitizeLookDoc(d);
    },
    onPatch(r, patch) {
      if (r <= rev) return { status: "stale" };
      if (r !== rev + 1) return { status: "gap" };
      const res = applyLookPatch(doc ?? emptyLookDoc(), patch);
      // A document that will not hold the room's own patch is out of step: resync.
      if (!res.ok) return { status: "gap" };
      doc = res.doc;
      rev = r;
      return { status: "applied", doc: res.doc, changed: res.effective ?? {} };
    },
    doc: () => doc,
    rev: () => rev,
  };
}
