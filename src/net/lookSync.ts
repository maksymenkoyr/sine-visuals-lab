/**
 * A copy of the room's look document (server/lookDoc.ts) and its revision,
 * kept from the room's own messages: a snapshot replaces it, a patch applies
 * when it is next in line, and a patch that skips a revision (or will not fit)
 * is a `gap`, which the caller answers by asking the room for a snapshot
 * (`lookGet`). Pure — no socket, no storage, no clock — so the rules are
 * tested without a browser (tests/lookSync.test.ts).
 *
 * Two users: the TV (src/tv.ts), which only ever shows the document and
 * applies it whole through net/syncedStores.ts `applyRoomStorage`, and
 * `createMainPlay` (net/mainPlay.ts), which keeps the room's Main in one and
 * does everything else a device does with it (follow, Play, Take Main).
 *
 * The room is the serialiser: it applies patches in arrival order, per key,
 * last writer wins, and bumps its revision once per patch that changed
 * anything, so "the next revision" is exactly "the one after the last seen".
 * The room never echoes a patch to its sender; a sender's own ack carries the
 * revision its patch produced, which the sender folds in itself.
 */

import { applyLookPatch, emptyLookDoc, sanitizeLookDoc, type LookDoc, type LookPatch } from "../../server/lookDoc.ts";

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
