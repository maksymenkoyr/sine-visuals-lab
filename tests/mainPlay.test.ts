import { describe, expect, it } from "vitest";
import { MAIN_POLL_MS, createMainPlay, type MainPlay, type MainPlayStatus } from "../src/net/mainPlay.ts";
import type { LookClientMsg, LookDoc, LookPatch } from "../server/lookDoc.ts";
import type { ScreenUse } from "../server/roomDevices.ts";

interface Rig {
  mp: MainPlay;
  /** The device's own look: what its panel set. */
  look: LookDoc;
  sent: LookClientMsg[];
  applied: { doc: LookDoc; glideMs?: number }[];
  snapshotAsks: number;
  statuses: MainPlayStatus[];
  setScreen(s: ScreenUse): void;
  online: { value: boolean };
}

function doc(scene: string, storage: Record<string, string> = {}, palette = "p1"): LookDoc {
  return { scene, palette, storage };
}

function rig(opts: { isOwner?: boolean; screen?: ScreenUse; look?: LookDoc; names?: Record<string, string> } = {}): Rig {
  let screen: ScreenUse = opts.screen ?? "main";
  const r = {
    look: opts.look ?? doc("mesh"),
    sent: [] as LookClientMsg[],
    applied: [] as { doc: LookDoc; glideMs?: number }[],
    snapshotAsks: 0,
    statuses: [] as MainPlayStatus[],
    online: { value: true },
  } as Rig;
  r.setScreen = (s) => {
    screen = s;
  };
  r.mp = createMainPlay({
    send: (m) => {
      if (!r.online.value) return false;
      r.sent.push(m);
      return true;
    },
    capture: () => ({ scene: r.look.scene, palette: r.look.palette, storage: { ...r.look.storage } }),
    apply: (d, glideMs) => {
      r.applied.push({ doc: d, glideMs });
      r.look = { scene: d.scene, palette: d.palette, storage: { ...d.storage } };
    },
    screen: () => screen,
    isOwner: opts.isOwner ?? false,
    nameOf: (id) => (opts.names ? (opts.names[id] ?? null) : null),
  });
  r.mp.onNeedSnapshot(() => {
    r.snapshotAsks++;
  });
  r.mp.onStatus((s) => r.statuses.push(s));
  return r;
}

/** A device that has joined a room whose Main is `main` and shows it. */
function joined(main: LookDoc, o: Parameters<typeof rig>[0] = {}): Rig {
  const r = rig({ ...o, look: o.look ?? main });
  r.mp.onSnapshot(1, main);
  r.applied.length = 0; // the join's own apply is not what the tests look at
  return r;
}

function lookMsgs(r: Rig): ({ type: "lookPatch"; n: number } & LookPatch)[] {
  return r.sent.filter((m): m is { type: "lookPatch"; n: number } & LookPatch => m.type === "lookPatch");
}

describe("joining", () => {
  it("the owner of an empty room plays its look as the first Main at once", () => {
    const r = rig({ isOwner: true, look: doc("mesh", { "vibe.a": "1" }) });
    r.mp.onSnapshot(0, null);
    expect(lookMsgs(r)).toEqual([
      { type: "lookPatch", n: 1, scene: "mesh", palette: "p1", set: { "vibe.a": "1" } },
    ]);
    r.mp.onAck(1, 1);
    expect(r.mp.status()).toEqual({ known: true, onAir: true, changedBy: null });
  });

  it("a non-owner applies an existing Main at once", () => {
    const r = rig({ look: doc("old") });
    r.mp.onSnapshot(4, doc("fluid", { "vibe.a": "1" }));
    expect(r.applied).toHaveLength(1);
    expect(r.applied[0].doc.scene).toBe("fluid");
    expect(r.mp.status()).toEqual({ known: true, onAir: true, changedBy: null });
  });

  it("the owner keeps its own look when a Main exists, and reads not on air", () => {
    const r = rig({ isOwner: true, look: doc("mine") });
    r.mp.onSnapshot(4, doc("fluid"));
    expect(r.applied).toEqual([]);
    expect(r.look.scene).toBe("mine");
    expect(r.mp.status()).toEqual({ known: true, onAir: false, changedBy: null });
  });

  it("a non-owner on screen own keeps its look on joining", () => {
    const r = rig({ screen: "own", look: doc("mine") });
    r.mp.onSnapshot(4, doc("fluid"));
    expect(r.applied).toEqual([]);
  });

  it("a non-owner in an empty room has nothing to apply and sends nothing", () => {
    const r = rig();
    r.mp.onSnapshot(0, null);
    expect(r.applied).toEqual([]);
    expect(r.sent).toEqual([]);
    expect(r.mp.status().known).toBe(true);
  });
});

describe("someone else plays", () => {
  it("a device that is on air follows, with the glide hint", () => {
    const r = joined(doc("mesh"));
    r.mp.onPatch(2, { scene: "mesh", set: { "vibe.a": "1" }, glideMs: 800, by: "d2" });
    // scene unchanged in the patch is a no-op for scene; the key changed
    expect(r.applied).toHaveLength(1);
    expect(r.applied[0].glideMs).toBe(800);
    expect(r.look.storage).toEqual({ "vibe.a": "1" });
    expect(r.mp.status()).toEqual({ known: true, onAir: true, changedBy: null });
  });

  it("follows a scene change without a glide when none was asked", () => {
    const r = joined(doc("mesh"));
    r.mp.onPatch(2, { scene: "fluid", by: "d2" });
    expect(r.applied[0].doc.scene).toBe("fluid");
    expect(r.applied[0].glideMs).toBeUndefined();
  });

  it("a device with unplayed edits keeps them and names who changed Main", () => {
    const r = joined(doc("mesh"), { names: { d2: "iPad" } });
    r.look = doc("mesh", { "vibe.mine": "9" });
    r.mp.onPatch(2, { set: { "vibe.a": "1" }, by: "d2" });
    expect(r.applied).toEqual([]);
    expect(r.look.storage).toEqual({ "vibe.mine": "9" });
    expect(r.mp.status()).toEqual({ known: true, onAir: false, changedBy: "iPad" });
  });

  it("falls back to a plain name when the roster does not know the device", () => {
    const r = joined(doc("mesh"));
    r.look = doc("other");
    r.mp.onPatch(2, { set: { "vibe.a": "1" }, by: "ghost" });
    expect(r.mp.status().changedBy).toBe("another device");
  });

  it("a device on screen own never applies Main and reports nothing", () => {
    const r = joined(doc("mesh"), { screen: "own" });
    r.mp.onPatch(2, { scene: "fluid", by: "d2" });
    expect(r.applied).toEqual([]);
    expect(r.mp.status().changedBy).toBeNull();
    r.look = doc("mine");
    r.mp.onPatch(3, { scene: "storm", by: "d2" });
    expect(r.mp.status().changedBy).toBeNull();
  });

  it("a device on screen off follows like main", () => {
    const r = joined(doc("mesh"), { screen: "off" });
    r.mp.onPatch(2, { scene: "fluid", by: "d2" });
    expect(r.applied).toHaveLength(1);
  });

  it("changedBy clears when the edits are reverted to match Main", () => {
    const r = joined(doc("mesh"));
    r.look = doc("mine");
    r.mp.onPatch(2, { scene: "fluid", by: "d2" });
    expect(r.mp.status().changedBy).toBe("another device");
    r.look = doc("fluid");
    r.mp.tick(1000);
    expect(r.mp.status()).toEqual({ known: true, onAir: true, changedBy: null });
  });

  it("a Main it could not show exactly still counts as on air, and is followed", () => {
    // This device cannot show scene "fancy": its capture keeps its own id.
    const mp2 = createMainPlay({
      send: () => true,
      capture: () => ({ scene: "plain", palette: "p1", storage: {} }),
      apply: () => {},
      screen: () => "main",
      isOwner: false,
      nameOf: () => null,
    });
    mp2.onSnapshot(1, doc("fancy"));
    expect(mp2.status().onAir).toBe(true);
    const applied: string[] = [];
    const mp3 = createMainPlay({
      send: () => true,
      capture: () => ({ scene: "plain", palette: "p1", storage: {} }),
      apply: (d) => applied.push(d.scene),
      screen: () => "main",
      isOwner: false,
      nameOf: () => null,
    });
    mp3.onSnapshot(1, doc("fancy"));
    mp3.onPatch(2, { scene: "fancier", by: "d2" });
    expect(applied).toEqual(["fancy", "fancier"]);
  });
});

describe("resync", () => {
  it("a later snapshot follows a device that was on air", () => {
    const r = joined(doc("mesh"));
    r.mp.onDisconnect();
    r.mp.onSnapshot(5, doc("fluid"));
    expect(r.applied.map((a) => a.doc.scene)).toEqual(["fluid"]);
  });

  it("a later snapshot keeps unplayed edits and flags the change", () => {
    const r = joined(doc("mesh"));
    r.look = doc("mine");
    r.mp.onDisconnect();
    r.mp.onSnapshot(5, doc("fluid"));
    expect(r.applied).toEqual([]);
    expect(r.look.scene).toBe("mine");
    expect(r.mp.status().changedBy).toBe("another device");
  });

  it("a later snapshot that changes nothing leaves everything alone", () => {
    const r = joined(doc("mesh"));
    r.look = doc("mine");
    r.mp.onSnapshot(1, doc("mesh"));
    expect(r.applied).toEqual([]);
    expect(r.mp.status().changedBy).toBeNull();
  });

  it("the disconnect clears known and drops what was in flight", () => {
    const r = joined(doc("mesh"));
    r.look = doc("mine");
    expect(r.mp.play()).toBe("sent");
    r.mp.onDisconnect();
    expect(r.mp.status().known).toBe(false);
    expect(r.mp.play()).toBeNull();
    r.mp.onAck(1, 2); // a late ack for a dropped patch is ignored
    expect(r.mp.status().known).toBe(false);
  });
});

describe("take", () => {
  it("drops the edits, shows Main and clears the notice", () => {
    const r = joined(doc("mesh"), { names: { d2: "iPad" } });
    r.look = doc("mine");
    r.mp.onPatch(2, { scene: "fluid", by: "d2" });
    expect(r.mp.status().changedBy).toBe("iPad");
    r.mp.take();
    expect(r.look.scene).toBe("fluid");
    expect(r.mp.status()).toEqual({ known: true, onAir: true, changedBy: null });
  });

  it("does nothing before Main is known", () => {
    const r = rig();
    r.mp.take();
    expect(r.applied).toEqual([]);
  });
});

describe("play", () => {
  it("sends only the difference from Main", () => {
    const r = joined(doc("mesh", { "vibe.a": "1", "vibe.b": "2" }));
    r.look = doc("mesh", { "vibe.a": "1", "vibe.c": "3" });
    expect(r.mp.play()).toBe("sent");
    expect(lookMsgs(r)).toEqual([{ type: "lookPatch", n: 1, set: { "vibe.c": "3" }, del: ["vibe.b"] }]);
    expect(r.mp.status().onAir).toBe(true); // in flight counts as Main
  });

  it("has nothing to send when the look equals Main, or Main is unknown, or the socket is down", () => {
    const r = joined(doc("mesh"));
    expect(r.mp.play()).toBeNull();
    expect(r.sent).toEqual([]);
    const fresh = rig({ look: doc("x") });
    expect(fresh.mp.play()).toBeNull();
    r.look = doc("mine");
    r.online.value = false;
    expect(r.mp.play()).toBeNull();
    r.online.value = true;
    expect(r.mp.play()).toBe("sent"); // nothing was remembered from the failed attempt
  });

  it("asks for a glide only within one scene", () => {
    const r = joined(doc("mesh", { "vibe.a": "1" }));
    r.look = doc("mesh", { "vibe.a": "2" });
    expect(r.mp.play(900)).toBe("glide");
    expect(lookMsgs(r)[0].glideMs).toBe(900);
    r.mp.onAck(1, 2);
    r.look = doc("fluid", { "vibe.a": "2" });
    expect(r.mp.play(900)).toBe("sent");
    expect(lookMsgs(r)[1].glideMs).toBeUndefined();
    expect(lookMsgs(r)[1].scene).toBe("fluid");
  });

  it("a hold of zero is a plain send", () => {
    const r = joined(doc("mesh"));
    r.look = doc("mesh", { "vibe.a": "1" });
    expect(r.mp.play(0)).toBe("sent");
    expect(lookMsgs(r)[0].glideMs).toBeUndefined();
  });

  it("quick second Play sends only what is new, and a reverted key goes back", () => {
    const r = joined(doc("mesh", { "vibe.a": "1" }));
    r.look = doc("mesh", { "vibe.a": "2" });
    r.mp.play();
    r.look = doc("mesh", { "vibe.a": "2", "vibe.b": "5" });
    r.mp.play();
    expect(lookMsgs(r)[1]).toEqual({ type: "lookPatch", n: 2, set: { "vibe.b": "5" } });
    r.look = doc("mesh", { "vibe.a": "1", "vibe.b": "5" });
    expect(r.mp.play()).toBe("sent");
    expect(lookMsgs(r)[2].set).toEqual({ "vibe.a": "1" });
  });

  it("the ack folds the patch on top of a relay that came first", () => {
    const r = joined(doc("mesh", { "vibe.a": "1" }), { names: { d2: "iPad" } });
    r.look = doc("mesh", { "vibe.a": "1", "vibe.mine": "7" });
    r.mp.play(); // n=1
    // someone else's patch is applied by the room first (rev 2), then ours (rev 3)
    r.mp.onPatch(2, { set: { "vibe.theirs": "8" }, by: "d2" });
    expect(r.applied).toEqual([]); // ours is on its way: keep what was played
    expect(r.mp.status().changedBy).toBeNull();
    r.mp.onAck(1, 3);
    expect(r.snapshotAsks).toBe(0);
    // Main is now both; this device lacks "theirs"
    expect(r.mp.status().onAir).toBe(false);
    r.look = doc("mesh", { "vibe.a": "1", "vibe.mine": "7", "vibe.theirs": "8" });
    r.mp.tick(1000);
    expect(r.mp.status()).toEqual({ known: true, onAir: true, changedBy: null });
    // and a fresh Play has nothing left to say
    expect(r.mp.play()).toBeNull();
  });

  it("an ack clears a notice that arrived while the patch was in the air", () => {
    const r = joined(doc("mesh"), { names: { d2: "iPad" } });
    r.look = doc("mine");
    r.mp.onPatch(2, { scene: "fluid", by: "d2" });
    expect(r.mp.status().changedBy).toBe("iPad");
    r.mp.play();
    r.mp.onAck(1, 3);
    expect(r.mp.status().changedBy).toBeNull();
  });

  it("an ack whose revision skips one asks for a snapshot", () => {
    const r = joined(doc("mesh"));
    r.look = doc("mine");
    r.mp.play();
    r.mp.onAck(1, 4); // revisions 2 and 3 never reached us
    expect(r.snapshotAsks).toBe(1);
  });

  it("an ack for a patch that changed nothing in the room is harmless", () => {
    const r = joined(doc("mesh"));
    r.look = doc("mine");
    r.mp.play();
    r.mp.onAck(1, 1); // the room already held it: revision unchanged
    expect(r.snapshotAsks).toBe(0);
  });
});

describe("rejects", () => {
  it("a rejected patch is dropped and the next Play resends the whole diff", () => {
    const r = joined(doc("mesh"));
    r.look = doc("mesh", { "vibe.a": "1" });
    r.mp.play();
    r.mp.onReject(1, "size");
    expect(r.mp.status().onAir).toBe(false);
    r.mp.play();
    expect(lookMsgs(r)[1]).toEqual({ type: "lookPatch", n: 2, set: { "vibe.a": "1" } });
  });

  it("a reject with no number clears everything in flight", () => {
    const r = joined(doc("mesh"));
    r.look = doc("mine");
    r.mp.play();
    r.mp.onReject(null, "role");
    expect(r.mp.status().onAir).toBe(false);
    r.mp.play();
    expect(lookMsgs(r)).toHaveLength(2);
  });
});

describe("gaps", () => {
  it("a skipped revision asks for a snapshot once, until one arrives", () => {
    const r = joined(doc("mesh"));
    r.mp.onPatch(3, { scene: "fluid", by: "d2" });
    r.mp.onPatch(4, { scene: "storm", by: "d2" });
    expect(r.snapshotAsks).toBe(1);
    expect(r.applied).toEqual([]);
    r.mp.onSnapshot(4, doc("storm"));
    expect(r.applied.map((a) => a.doc.scene)).toEqual(["storm"]);
    r.mp.onPatch(6, { scene: "x", by: "d2" });
    expect(r.snapshotAsks).toBe(2);
  });

  it("an old relay is ignored", () => {
    const r = joined(doc("mesh"));
    r.mp.onPatch(1, { scene: "fluid", by: "d2" });
    expect(r.applied).toEqual([]);
  });
});

describe("status", () => {
  it("emits only when it changes, and tick throttles itself", () => {
    const r = joined(doc("mesh"));
    const base = r.statuses.length;
    r.mp.tick(1000);
    r.mp.tick(1000 + MAIN_POLL_MS);
    expect(r.statuses.length).toBe(base);
    r.look = doc("mine");
    r.mp.tick(1000 + MAIN_POLL_MS + 10); // too soon: not re-read yet
    expect(r.statuses.length).toBe(base);
    r.mp.tick(1000 + 2 * MAIN_POLL_MS);
    expect(r.statuses.length).toBe(base + 1);
    expect(r.statuses[r.statuses.length - 1].onAir).toBe(false);
  });

  it("onStatus returns an unsubscribe", () => {
    const r = joined(doc("mesh"));
    const seen: MainPlayStatus[] = [];
    const off = r.mp.onStatus((s) => seen.push(s));
    off();
    r.look = doc("mine");
    r.mp.tick(5000);
    expect(seen).toEqual([]);
  });
});
