import { describe, expect, it } from "vitest";
import { planBoot } from "../src/net/bootPlan.ts";
import { newKey } from "../src/net/pairing.ts";
import type { ControllerSession } from "../src/net/sessions.ts";

const K = newKey();
const N = newKey();
const SAVED: ControllerSession = { room: "ABCD", key: newKey(), ts: 1 };

describe("planBoot: adopt", () => {
  it("a TV's QR is an adopt", () => {
    expect(planBoot(`?adopt=WXYZ&n=${N}`, null)).toEqual({ kind: "adopt", slot: "WXYZ", nonce: N });
  });

  it("wins over everything else in the link", () => {
    expect(planBoot(`?room=ABCD&role=controller&k=${K}&adopt=WXYZ&n=${N}`, SAVED).kind).toBe("adopt");
    expect(planBoot(`?room=ABCD&role=host&adopt=WXYZ&n=${N}`, null).kind).toBe("adopt");
  });

  it("upper-cases the slot but never touches the nonce", () => {
    const plan = planBoot(`?adopt=wxyz&n=${N}`, null);
    expect(plan).toEqual({ kind: "adopt", slot: "WXYZ", nonce: N });
  });

  it("needs a valid slot and a valid nonce", () => {
    const solo = { kind: "bad-adopt-link", then: { kind: "solo" } };
    expect(planBoot("?adopt=WXYZ", null)).toEqual(solo);
    expect(planBoot("?adopt=WXYZ&n=short", null)).toEqual(solo);
    expect(planBoot(`?adopt=WXY&n=${N}`, null)).toEqual(solo);
    expect(planBoot(`?adopt=WXY1&n=${N}`, null)).toEqual(solo);
    expect(planBoot("?adopt=!!!!&n=garbage", null)).toEqual(solo);
    expect(planBoot(`?n=${N}`, null)).toEqual(solo);
    expect(planBoot("?adopt=", null)).toEqual(solo);
  });

  it("a broken TV link never becomes a new host room", () => {
    for (const search of ["?adopt=!!!!&n=garbage", "?adopt=WXYZ&n=short", "?adopt=WXYZ", `?n=${N}`]) {
      for (const session of [null, SAVED]) {
        const plan = planBoot(search, session);
        expect(plan.kind).toBe("bad-adopt-link");
        if (plan.kind === "bad-adopt-link") expect(plan.then.kind).not.toBe("host-new");
      }
    }
  });

  it("a broken TV link resumes the saved controller session", () => {
    expect(planBoot("?adopt=!!!!&n=garbage", SAVED)).toEqual({
      kind: "bad-adopt-link",
      then: { kind: "controller", room: SAVED.room, key: SAVED.key, keyFromUrl: false },
    });
    expect(planBoot("?audio=synthetic&adopt=WXYZ&n=short", SAVED)).toEqual({
      kind: "bad-adopt-link",
      then: { kind: "controller", room: SAVED.room, key: SAVED.key, keyFromUrl: false },
    });
  });

  it("falls through to the rest of the link when the adopt part is broken", () => {
    expect(planBoot("?adopt=WXYZ&n=short&room=ABCD", null)).toEqual({
      kind: "bad-adopt-link",
      then: { kind: "renderer", room: "ABCD" },
    });
    expect(planBoot(`?adopt=!!!!&n=garbage&room=ABCD&role=controller&k=${K}`, null)).toEqual({
      kind: "bad-adopt-link",
      then: { kind: "controller", room: "ABCD", key: K, keyFromUrl: true },
    });
    expect(planBoot("?adopt=!!!!&n=garbage&room=ABCD&role=host", null)).toEqual({
      kind: "bad-adopt-link",
      then: { kind: "host-join", room: "ABCD" },
    });
  });

  it("a broken TV link on a controller link with no key still needs pairing", () => {
    expect(planBoot("?adopt=!!!!&n=garbage&room=WXYZ&role=controller", SAVED)).toEqual({
      kind: "bad-adopt-link",
      then: { kind: "need-pairing" },
    });
  });
});

describe("planBoot: controller", () => {
  it("a laptop's QR carries the key", () => {
    expect(planBoot(`?room=ABCD&role=controller&k=${K}`, null)).toEqual({
      kind: "controller",
      room: "ABCD",
      key: K,
      keyFromUrl: true,
    });
  });

  it("the key in the link beats a saved session", () => {
    const plan = planBoot(`?room=ABCD&role=controller&k=${K}`, SAVED);
    expect(plan).toEqual({ kind: "controller", room: "ABCD", key: K, keyFromUrl: true });
  });

  it("resumes from the saved session after the key was stripped from the address bar", () => {
    expect(planBoot("?room=ABCD&role=controller", SAVED)).toEqual({
      kind: "controller",
      room: "ABCD",
      key: SAVED.key,
      keyFromUrl: false,
    });
  });

  it("does not resume a session for a different room", () => {
    expect(planBoot("?room=WXYZ&role=controller", SAVED)).toEqual({ kind: "need-pairing" });
  });

  it("needs pairing with no key and no session", () => {
    expect(planBoot("?room=ABCD&role=controller", null)).toEqual({ kind: "need-pairing" });
  });

  it("treats a malformed key as no key", () => {
    expect(planBoot("?room=ABCD&role=controller&k=short", null)).toEqual({ kind: "need-pairing" });
    expect(planBoot("?room=ABCD&role=controller&k=short", SAVED).kind).toBe("controller");
  });

  it("upper-cases the room, and matches the saved one after doing so", () => {
    const plan = planBoot("?room=abcd&role=controller", SAVED);
    expect(plan).toEqual({ kind: "controller", room: "ABCD", key: SAVED.key, keyFromUrl: false });
  });

  it("never falls through to hosting, whatever else is wrong with the link", () => {
    expect(planBoot(`?role=controller&k=${K}`, null)).toEqual({ kind: "need-pairing" });
    expect(planBoot(`?room=ABC&role=controller&k=${K}`, null)).toEqual({ kind: "need-pairing" });
    expect(planBoot(`?room=ABCD1&role=controller&k=${K}`, SAVED)).toEqual({ kind: "need-pairing" });
  });
});

describe("planBoot: the rest", () => {
  it("a legacy host link", () => {
    expect(planBoot("?room=ABCD&role=host", null)).toEqual({ kind: "host-join", room: "ABCD" });
    expect(planBoot("?room=abcd&role=host", null)).toEqual({ kind: "host-join", room: "ABCD" });
  });

  it("a host link ignores a key", () => {
    expect(planBoot(`?room=ABCD&role=host&k=${K}`, null)).toEqual({ kind: "host-join", room: "ABCD" });
  });

  it("a plain room is a renderer", () => {
    expect(planBoot("?room=ABCD", null)).toEqual({ kind: "renderer", room: "ABCD" });
    expect(planBoot("?room=abcd", null)).toEqual({ kind: "renderer", room: "ABCD" });
  });

  it("a keyed renderer carries its key", () => {
    expect(planBoot(`?room=ABCD&k=${K}`, null)).toEqual({ kind: "renderer", room: "ABCD", key: K });
  });

  it("a malformed key on a renderer link is dropped, not passed on", () => {
    expect(planBoot("?room=ABCD&k=nope", null)).toEqual({ kind: "renderer", room: "ABCD" });
  });

  it("an unknown role is an ordinary renderer", () => {
    expect(planBoot("?room=ABCD&role=banana", null)).toEqual({ kind: "renderer", room: "ABCD" });
  });

  it("no room is the classic open-the-site flow", () => {
    expect(planBoot("", null)).toEqual({ kind: "host-new" });
    expect(planBoot("?audio=synthetic&bpm=120", null)).toEqual({ kind: "host-new" });
    expect(planBoot("?role=host", null)).toEqual({ kind: "host-new" });
  });

  it("a room code that isn't one is no room", () => {
    for (const room of ["", "AB", "ABCDE", "AB1D", "A-CD", "ABC "]) {
      expect(planBoot(`?room=${encodeURIComponent(room)}`, null).kind).toBe("host-new");
    }
  });

  it("other parameters change nothing", () => {
    expect(planBoot(`?audio=synthetic&room=ABCD&k=${K}&quality=low`, null)).toEqual({
      kind: "renderer",
      room: "ABCD",
      key: K,
    });
  });
});
