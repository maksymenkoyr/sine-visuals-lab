import { describe, expect, it } from "vitest";
import {
  LOOK_PUBLISH_MS,
  createLookReplica,
  createLookSync,
  type LookIO,
  type LookSync,
} from "../src/net/lookSync.ts";
import {
  applyLookPatch,
  emptyLookDoc,
  sanitizeLookPatch,
  type LookClientMsg,
  type LookDoc,
  type LookPatch,
  type LookRejectReason,
} from "../server/lookDoc.ts";

// ---- a device (one phone's scene, palette and room-scope storage) ----------

interface Device {
  scene: string;
  palette: string;
  storage: Record<string, string>;
  writes: number;
  /** Mimics a store that rewrites a value after it is applied (autoTune.ts prunes defaults). */
  normalise?: (storage: Record<string, string>) => void;
}

function device(storage: Record<string, string> = {}, scene = "", palette = ""): Device {
  return { scene, palette, storage: { ...storage }, writes: 0 };
}

function deviceIO(d: Device, send: (m: LookClientMsg) => boolean, rejects: LookRejectReason[] = []): LookIO {
  return {
    read: () => ({ scene: d.scene, palette: d.palette, storage: { ...d.storage } }),
    write(doc) {
      d.writes++;
      if (doc.scene) d.scene = doc.scene;
      if (doc.palette) d.palette = doc.palette;
      d.storage = { ...doc.storage };
      if (d.normalise) d.normalise(d.storage);
    },
    send,
    onReject: (r) => void rejects.push(r),
  };
}

// ---- a tiny room: the Durable Object's look rules, JSON both ways ----------

interface Client {
  dev: Device;
  sync: LookSync;
  inbox: string[];
  up: boolean;
  sent: LookClientMsg[];
  rejects: LookRejectReason[];
}

class Hub {
  doc: LookDoc | null = null;
  rev = 0;
  clients: Client[] = [];
  /** Server -> client message types to lose in transit (a dropped ack). */
  drop = new Set<string>();
  /** Patches the room refuses, by reason. */
  refuse: LookRejectReason | null = null;
  traffic = 0;

  add(dev: Device, up = true): Client {
    const c: Client = {
      dev,
      inbox: [],
      up: false,
      sent: [],
      rejects: [],
      sync: undefined as unknown as LookSync,
    };
    c.sync = createLookSync(
      deviceIO(
        dev,
        (m) => {
          if (!c.up) return false;
          c.sent.push(m);
          this.traffic++;
          this.fromClient(c, JSON.stringify(m));
          return true;
        },
        c.rejects,
      ),
    );
    this.clients.push(c);
    if (up) this.connect(c);
    return c;
  }

  private push(c: Client, m: object): void {
    const text = JSON.stringify(m);
    if (this.drop.has((m as { type: string }).type)) return;
    c.inbox.push(text);
  }

  connect(c: Client): void {
    c.up = true;
    this.push(c, { type: "look", rev: this.rev, doc: this.doc });
  }

  disconnect(c: Client): void {
    c.up = false;
    c.inbox.length = 0;
    c.sync.onDisconnect();
  }

  private fromClient(c: Client, text: string): void {
    const m = JSON.parse(text);
    if (m.type === "lookGet") {
      this.push(c, { type: "look", rev: this.rev, doc: this.doc });
      return;
    }
    const s = sanitizeLookPatch(m);
    if (this.refuse || !s.ok) {
      this.push(c, { type: "lookReject", n: m.n, reason: this.refuse ?? (s.ok ? "shape" : s.reason) });
      return;
    }
    const r = applyLookPatch(this.doc ?? emptyLookDoc(), s.patch);
    if (!r.ok) {
      this.push(c, { type: "lookReject", n: m.n, reason: "size" });
      return;
    }
    if (r.effective) {
      this.doc = r.doc;
      this.rev++;
      for (const o of this.clients) {
        if (o !== c && o.up) this.push(o, { type: "lookPatch", rev: this.rev, ...r.effective });
      }
    }
    this.push(c, { type: "lookAck", n: m.n, rev: this.rev });
  }

  /** Delivers everything waiting for `c`, in order. */
  pump(c: Client): void {
    while (c.inbox.length > 0) {
      this.traffic++;
      const m = JSON.parse(c.inbox.shift() as string);
      if (m.type === "look") c.sync.onSnapshot(m.rev, m.doc);
      else if (m.type === "lookPatch") c.sync.onPatch(m.rev, m);
      else if (m.type === "lookAck") c.sync.onAck(m.n, m.rev);
      else if (m.type === "lookReject") c.sync.onReject(m.n, m.reason);
    }
  }

  /** Delivers, ticks and delivers again until no message moves either way. */
  settle(): void {
    for (let round = 0; round < 25; round++) {
      const before = this.traffic;
      for (const c of this.clients) if (c.up) this.pump(c);
      for (const c of this.clients) if (c.up) c.sync.tick();
      for (const c of this.clients) if (c.up) this.pump(c);
      if (this.traffic === before) return;
    }
    throw new Error("did not settle");
  }
}

const lookOf = (d: Device): LookDoc => ({ scene: d.scene, palette: d.palette, storage: d.storage });

describe("LOOK_PUBLISH_MS", () => {
  it("is a positive cadence", () => {
    expect(LOOK_PUBLISH_MS).toBeGreaterThan(0);
  });
});

describe("createLookSync joining", () => {
  it("seeds an empty room with the phone's whole look", () => {
    const hub = new Hub();
    const a = hub.add(device({ "vibe.sceneSettings": "{a}", "vibe.drives": "{d}" }, "plume", "neon"));
    expect(a.sync.joined).toBe(false);
    a.sync.tick();
    expect(a.sent).toEqual([]); // nothing is published before the room has spoken
    hub.pump(a);
    expect(a.sync.joined).toBe(true);
    hub.settle();
    expect(hub.rev).toBe(1);
    expect(hub.doc).toEqual({
      scene: "plume",
      palette: "neon",
      storage: { "vibe.sceneSettings": "{a}", "vibe.drives": "{d}" },
    });
    expect(a.sync.rev).toBe(1);
    // Acked: base caught up, nothing more to say.
    const sent = a.sent.length;
    hub.settle();
    expect(a.sent.length).toBe(sent);
  });

  it("takes a populated room's look instead of publishing its own", () => {
    const hub = new Hub();
    const a = hub.add(device({ "vibe.sceneSettings": "{a}" }, "plume", "neon"));
    hub.settle();
    const b = hub.add(device({ "vibe.sceneSettings": "{mine}", "vibe.hitAmount": "9" }, "storm", "mono"));
    hub.settle();
    expect(lookOf(b.dev)).toEqual(hub.doc);
    expect(b.sent).toEqual([]); // adopted, not published
    expect(b.sync.rev).toBe(hub.rev);
    expect(hub.rev).toBe(1);
    expect(a.sent.length).toBe(1);
  });

  it("an empty scene id is no opinion: the room's scene survives a phone with none", () => {
    const hub = new Hub();
    hub.add(device({ "vibe.drives": "{}" }, "plume", "neon"));
    hub.settle();
    const b = hub.add(device({}, "", ""));
    hub.settle();
    expect(hub.doc?.scene).toBe("plume");
    expect(b.dev.scene).toBe("plume");
  });
});

describe("createLookSync publishing", () => {
  it("one patch in flight; an ack moves the base on", () => {
    const hub = new Hub();
    const a = hub.add(device({ "vibe.drives": "1" }, "plume", "neon"));
    hub.settle();
    a.dev.storage["vibe.drives"] = "2";
    a.sync.tick();
    expect(a.sent.length).toBe(2);
    expect(a.sent[1]).toEqual({ type: "lookPatch", n: 2, set: { "vibe.drives": "2" } });
    a.dev.storage["vibe.drives"] = "3";
    a.sync.tick(); // still waiting for the ack: nothing more goes out
    expect(a.sent.length).toBe(2);
    hub.pump(a); // ack
    a.sync.tick();
    expect(a.sent[2]).toEqual({ type: "lookPatch", n: 3, set: { "vibe.drives": "3" } });
    hub.settle();
    expect(hub.doc?.storage["vibe.drives"]).toBe("3");
    expect(hub.rev).toBe(3);
  });

  it("publishes deletions and scene/palette changes", () => {
    const hub = new Hub();
    const a = hub.add(device({ "vibe.drives": "1", "vibe.hitAmount": "2" }, "plume", "neon"));
    const b = hub.add(device());
    hub.settle();
    expect(lookOf(b.dev)).toEqual(lookOf(a.dev));
    delete a.dev.storage["vibe.drives"];
    a.dev.scene = "storm";
    a.dev.palette = "mono";
    hub.settle();
    expect(lookOf(b.dev)).toEqual({ scene: "storm", palette: "mono", storage: { "vibe.hitAmount": "2" } });
  });

  it("a send that did not go (socket not open) is not counted, and goes next time", () => {
    const hub = new Hub();
    const a = hub.add(device({ "vibe.drives": "1" }, "plume", "neon"));
    hub.settle();
    a.dev.storage["vibe.drives"] = "2";
    a.up = false; // socket closed under the sync
    a.sync.tick();
    a.sync.tick();
    expect(a.sent.length).toBe(1);
    a.up = true;
    a.sync.tick();
    expect(a.sent.length).toBe(2);
    hub.pump(a);
    expect(hub.doc?.storage["vibe.drives"]).toBe("2");
  });

  it("does not resend a diff the room refused, until something differs", () => {
    const hub = new Hub();
    const a = hub.add(device({ "vibe.drives": "1" }, "plume", "neon"));
    hub.settle();
    hub.refuse = "size";
    a.dev.storage["vibe.drives"] = "huge";
    hub.settle();
    expect(a.rejects).toEqual(["size"]);
    const sent = a.sent.length;
    for (let i = 0; i < 5; i++) hub.settle();
    expect(a.sent.length).toBe(sent); // not hammering the room
    expect(a.rejects).toEqual(["size"]);

    a.dev.storage["vibe.drives"] = "smaller";
    hub.refuse = null;
    hub.settle();
    expect(hub.doc?.storage["vibe.drives"]).toBe("smaller");
  });

  it("remembers a role refusal the same way, and surfaces it", () => {
    const hub = new Hub();
    const a = hub.add(device({ "vibe.drives": "1" }, "plume", "neon"));
    hub.settle();
    hub.refuse = "role";
    a.dev.storage["vibe.drives"] = "2";
    hub.settle();
    const sent = a.sent.length;
    hub.settle();
    expect(a.rejects).toEqual(["role"]);
    expect(a.sent.length).toBe(sent);
  });

  it("ignores an ack or a refusal that is not for the patch in flight", () => {
    const rejects: LookRejectReason[] = [];
    const sent: LookClientMsg[] = [];
    const d = device({ "vibe.drives": "1" });
    const s = createLookSync(deviceIO(d, (m) => (sent.push(m), true), rejects));
    s.onSnapshot(0, null);
    s.tick();
    expect(sent.length).toBe(1);
    s.onAck(99, 7);
    s.onReject(99, "size");
    expect(rejects).toEqual([]);
    expect(s.rev).toBe(0);
    s.tick();
    expect(sent.length).toBe(1); // still in flight
    s.onAck(1, 1);
    expect(s.rev).toBe(1);
  });

  it("a disconnect assumes the patch in flight was lost and sends it again", () => {
    const hub = new Hub();
    const a = hub.add(device({ "vibe.drives": "1" }, "plume", "neon"));
    hub.settle();
    a.dev.storage["vibe.drives"] = "2";
    hub.drop.add("lookAck");
    a.sync.tick();
    hub.drop.delete("lookAck");
    expect(hub.doc?.storage["vibe.drives"]).toBe("2"); // the room applied it, the ack was lost
    hub.disconnect(a);
    hub.connect(a);
    hub.settle();
    expect(hub.rev).toBe(2);
    expect(hub.doc?.storage["vibe.drives"]).toBe("2"); // converged, and no second bump
  });
});

describe("createLookSync disconnect", () => {
  it("resends the patch that was in flight on the next tick", () => {
    const sent: LookClientMsg[] = [];
    const d = device({ "vibe.drives": "1" });
    const s = createLookSync(deviceIO(d, (m) => (sent.push(m), true)));
    s.onSnapshot(0, null);
    s.tick();
    expect(sent.length).toBe(1);
    s.onDisconnect();
    s.tick();
    expect(sent.length).toBe(2);
    expect(sent[1]).toMatchObject({ type: "lookPatch", n: 2, set: { "vibe.drives": "1" } });
    s.onAck(1, 1); // the old socket's ack, if it ever arrives, is not for the new patch
    s.tick();
    expect(sent.length).toBe(2);
    s.onAck(2, 1);
    expect(s.rev).toBe(1);
  });

  it("keeps joined, so the reconnect snapshot is merged, not replaced", () => {
    const d = device({ "vibe.drives": "mine" }, "plume", "neon");
    const s = createLookSync(deviceIO(d, () => true));
    s.onSnapshot(0, null);
    s.tick();
    s.onAck(1, 1);
    d.storage["vibe.drives"] = "edited offline";
    s.onDisconnect();
    expect(s.joined).toBe(true);
    s.onSnapshot(3, { scene: "plume", palette: "neon", storage: { "vibe.drives": "theirs", "vibe.hitAmount": "2" } });
    expect(d.storage).toEqual({ "vibe.drives": "edited offline", "vibe.hitAmount": "2" });
    expect(s.rev).toBe(3);
  });
});

describe("createLookSync remote patches", () => {
  it("writes what others changed", () => {
    const hub = new Hub();
    const a = hub.add(device({ "vibe.drives": "1" }, "plume", "neon"));
    const b = hub.add(device());
    hub.settle();
    a.dev.storage["vibe.hitAmount"] = "5";
    hub.settle();
    expect(b.dev.storage).toEqual({ "vibe.drives": "1", "vibe.hitAmount": "5" });
    expect(b.sent.length).toBe(0); // and does not echo it back
  });

  it("two phones converge on distinct edits", () => {
    const hub = new Hub();
    const a = hub.add(device({}, "plume", "neon"));
    const b = hub.add(device());
    hub.settle();
    a.dev.storage["vibe.sensitivity"] = "A";
    b.dev.storage["vibe.expansion"] = "B";
    hub.settle();
    expect(lookOf(a.dev)).toEqual(lookOf(b.dev));
    expect(a.dev.storage).toEqual({ "vibe.sensitivity": "A", "vibe.expansion": "B" });
    expect(lookOf(a.dev)).toEqual(hub.doc);
  });

  it("two phones editing the same key end up equal (arrival order wins)", () => {
    const hub = new Hub();
    const a = hub.add(device({ "vibe.drives": "0" }, "plume", "neon"));
    const b = hub.add(device());
    hub.settle();
    a.dev.storage["vibe.drives"] = "from A";
    b.dev.storage["vibe.drives"] = "from B";
    hub.settle();
    expect(a.dev.storage["vibe.drives"]).toBe(b.dev.storage["vibe.drives"]);
    expect(hub.doc?.storage["vibe.drives"]).toBe(a.dev.storage["vibe.drives"]);
  });

  it("keeps a key the phone has edited and not had acked, takes the rest", () => {
    const hub = new Hub();
    const a = hub.add(device({ "vibe.drives": "1" }, "plume", "neon"));
    const b = hub.add(device());
    hub.settle();

    // A has an edit it has not published; B's patch for the same key and another arrives.
    a.dev.storage["vibe.drives"] = "mine";
    b.dev.storage["vibe.drives"] = "theirs";
    b.dev.storage["vibe.hitAmount"] = "9";
    b.sync.tick();
    hub.pump(a);
    expect(a.dev.storage["vibe.drives"]).toBe("mine");
    expect(a.dev.storage["vibe.hitAmount"]).toBe("9");

    hub.settle();
    expect(hub.doc?.storage["vibe.drives"]).toBe("mine"); // A's edit then went out and won
    expect(b.dev.storage["vibe.drives"]).toBe("mine");
  });

  it("keeps a key whose patch is in flight too", () => {
    const hub = new Hub();
    const a = hub.add(device({ "vibe.drives": "1" }, "plume", "neon"));
    const b = hub.add(device());
    hub.settle();
    a.dev.storage["vibe.drives"] = "mine";
    a.sync.tick(); // in flight (applied by the room, ack waiting in A's inbox)
    b.dev.storage["vibe.hitAmount"] = "9";
    b.sync.tick();
    hub.pump(a);
    expect(a.dev.storage["vibe.drives"]).toBe("mine");
    expect(a.dev.storage["vibe.hitAmount"]).toBe("9");
    hub.settle();
    expect(lookOf(a.dev)).toEqual(lookOf(b.dev));
  });

  it("keeps a scene the phone just switched to over a remote scene change", () => {
    const hub = new Hub();
    const a = hub.add(device({}, "plume", "neon"));
    const b = hub.add(device());
    hub.settle();
    a.dev.scene = "storm";
    b.dev.scene = "silk";
    b.sync.tick();
    hub.pump(a);
    expect(a.dev.scene).toBe("storm");
    hub.settle();
    expect(a.dev.scene).toBe(b.dev.scene);
  });

  it("ignores a patch seen already, and a patch before joining", () => {
    const d = device({ "vibe.drives": "1" });
    const s = createLookSync(deviceIO(d, () => true));
    s.onPatch(1, { set: { "vibe.drives": "x" } });
    expect(d.writes).toBe(0);
    s.onSnapshot(4, { scene: "", palette: "", storage: { "vibe.drives": "1" } });
    const writes = d.writes;
    s.onPatch(4, { set: { "vibe.drives": "stale" } });
    s.onPatch(2, { set: { "vibe.drives": "stale" } });
    expect(d.writes).toBe(writes);
    expect(d.storage["vibe.drives"]).toBe("1");
    expect(s.rev).toBe(4);
  });

  it("asks for the whole look when a revision is missing", () => {
    const sent: LookClientMsg[] = [];
    const d = device({ "vibe.drives": "1" });
    const s = createLookSync(deviceIO(d, (m) => (sent.push(m), true)));
    s.onSnapshot(2, { scene: "", palette: "", storage: { "vibe.drives": "1" } });
    s.onPatch(4, { set: { "vibe.drives": "gap" } });
    expect(sent).toEqual([{ type: "lookGet" }]);
    expect(d.storage["vibe.drives"]).toBe("1"); // not applied out of order
    expect(s.rev).toBe(2);
    s.onPatch(3, { set: { "vibe.drives": "next" } });
    expect(d.storage["vibe.drives"]).toBe("next");
    expect(s.rev).toBe(3);
  });

  it("asks for the whole look when an ack shows a patch went by unseen", () => {
    const sent: LookClientMsg[] = [];
    const d = device();
    const s = createLookSync(deviceIO(d, (m) => (sent.push(m), true)));
    s.onSnapshot(2, { scene: "", palette: "", storage: {} });
    d.storage["vibe.drives"] = "1";
    s.tick();
    expect(sent.length).toBe(1);
    s.onAck(1, 5);
    expect(sent[sent.length - 1]).toEqual({ type: "lookGet" });
    expect(s.rev).toBe(5);
  });

  it("recovers from a gap through the snapshot", () => {
    const hub = new Hub();
    const a = hub.add(device({}, "plume", "neon"));
    const b = hub.add(device());
    hub.settle();
    // B's patches never reach A (lost in transit), then one arrives out of the blue.
    b.dev.storage["vibe.drives"] = "1";
    hub.drop.add("lookPatch");
    hub.settle();
    b.dev.storage["vibe.hitAmount"] = "2";
    hub.settle();
    hub.drop.delete("lookPatch");
    b.dev.storage["vibe.expansion"] = "3";
    hub.settle(); // A sees a patch two ahead, asks, and gets the lot
    expect(lookOf(a.dev)).toEqual(lookOf(b.dev));
    expect(lookOf(a.dev)).toEqual(hub.doc);
  });
});

describe("createLookSync reconnect", () => {
  it("lays unacked edits over the room's truth and republishes only those", () => {
    const hub = new Hub();
    const a = hub.add(device({ "vibe.drives": "1", "vibe.hitAmount": "1" }, "plume", "neon"));
    const b = hub.add(device());
    hub.settle();

    hub.disconnect(a);
    a.dev.storage["vibe.drives"] = "A's edit, offline";
    a.dev.scene = "storm";
    b.dev.storage["vibe.hitAmount"] = "B's edit";
    b.dev.storage["vibe.expansion"] = "B's other edit";
    hub.settle();

    hub.connect(a);
    hub.pump(a);
    expect(a.dev.storage).toEqual({
      "vibe.drives": "A's edit, offline", // ours, not yet sent
      "vibe.hitAmount": "B's edit", // theirs
      "vibe.expansion": "B's other edit",
    });
    expect(a.dev.scene).toBe("storm");
    a.sent.length = 0;
    hub.settle();
    expect(a.sent).toEqual([
      { type: "lookPatch", n: expect.any(Number), scene: "storm", set: { "vibe.drives": "A's edit, offline" } },
    ]);
    expect(lookOf(a.dev)).toEqual(hub.doc);
    expect(lookOf(b.dev)).toEqual(hub.doc);
  });

  it("a patch that was applied but never acked is not duplicated", () => {
    const hub = new Hub();
    const a = hub.add(device({ "vibe.drives": "1" }, "plume", "neon"));
    hub.settle();
    a.dev.storage["vibe.drives"] = "2";
    hub.drop.add("lookAck");
    a.sync.tick();
    hub.drop.delete("lookAck");
    hub.disconnect(a);
    hub.connect(a);
    a.sent.length = 0;
    hub.settle();
    expect(a.sent).toEqual([]); // the snapshot already holds it
    expect(hub.rev).toBe(2);
  });

  it("an edit reverted while its patch was in flight stays reverted", () => {
    const hub = new Hub();
    const a = hub.add(device({ "vibe.drives": "orig" }, "plume", "neon"));
    hub.settle();
    a.dev.storage["vibe.drives"] = "changed";
    hub.drop.add("lookAck");
    a.sync.tick(); // applied by the room, ack lost
    hub.drop.delete("lookAck");
    a.dev.storage["vibe.drives"] = "orig"; // the user puts it back
    hub.disconnect(a);
    hub.connect(a);
    hub.settle();
    expect(a.dev.storage["vibe.drives"]).toBe("orig");
    expect(hub.doc?.storage["vibe.drives"]).toBe("orig");
  });

  it("a key deleted offline is deleted in the room afterwards", () => {
    const hub = new Hub();
    const a = hub.add(device({ "vibe.drives": "1", "vibe.hitAmount": "2" }, "plume", "neon"));
    const b = hub.add(device());
    hub.settle();
    hub.disconnect(a);
    delete a.dev.storage["vibe.drives"];
    hub.settle();
    hub.connect(a);
    hub.settle();
    expect(hub.doc?.storage).toEqual({ "vibe.hitAmount": "2" });
    expect(b.dev.storage).toEqual({ "vibe.hitAmount": "2" });
  });

  it("reseeds from the phone when the room turns out to be empty again", () => {
    const hub = new Hub();
    const a = hub.add(device({ "vibe.drives": "1" }, "plume", "neon"));
    hub.settle();
    hub.disconnect(a);
    hub.doc = null; // the room was wiped meanwhile
    hub.rev = 0;
    hub.connect(a);
    hub.settle();
    expect(hub.doc).toEqual({ scene: "plume", palette: "neon", storage: { "vibe.drives": "1" } });
  });
});

describe("createLookSync echo and noise", () => {
  it("a store that normalises after a write converges instead of looping", () => {
    // Like autoTune.ts pruning an entry equal to its default after a reload.
    const prune = (s: Record<string, string>) => {
      if (s["vibe.sceneAuto"] === "{}") delete s["vibe.sceneAuto"];
    };
    const hub = new Hub();
    const a = hub.add(device({ "vibe.drives": "1" }, "plume", "neon"));
    const b = hub.add(device());
    a.dev.normalise = prune;
    b.dev.normalise = prune;
    hub.settle();

    a.dev.storage["vibe.sceneAuto"] = "{}";
    hub.settle();
    a.dev.storage["vibe.sceneAuto"] = '{"x":1}';
    hub.settle();
    a.dev.storage["vibe.sceneAuto"] = "{}";
    hub.settle();
    expect(lookOf(a.dev)).toEqual(lookOf(b.dev));
    expect(lookOf(b.dev)).toEqual(hub.doc);
  });

  it("nothing is sent while nothing changes", () => {
    const hub = new Hub();
    const a = hub.add(device({ "vibe.drives": "1" }, "plume", "neon"));
    const b = hub.add(device());
    hub.settle();
    const sent = a.sent.length + b.sent.length;
    for (let i = 0; i < 10; i++) hub.settle();
    expect(a.sent.length + b.sent.length).toBe(sent);
  });
});

describe("createLookReplica", () => {
  const doc = (storage: Record<string, string>, scene = "plume", palette = "neon"): LookDoc => ({
    scene,
    palette,
    storage,
  });

  it("starts empty at revision zero", () => {
    const r = createLookReplica();
    expect(r.doc()).toBeNull();
    expect(r.rev()).toBe(0);
  });

  it("a snapshot replaces the document and revision", () => {
    const r = createLookReplica();
    r.onSnapshot(3, doc({ "vibe.drives": "1" }));
    expect(r.doc()).toEqual(doc({ "vibe.drives": "1" }));
    expect(r.rev()).toBe(3);
    r.onSnapshot(1, doc({ "vibe.hitAmount": "2" })); // a wiped room restarts the count
    expect(r.doc()).toEqual(doc({ "vibe.hitAmount": "2" }));
    expect(r.rev()).toBe(1);
    r.onSnapshot(0, null);
    expect(r.doc()).toBeNull();
    expect(r.rev()).toBe(0);
  });

  it("sanitises what it is handed", () => {
    const r = createLookReplica();
    r.onSnapshot(1, {
      scene: "plume",
      palette: "neon",
      storage: { "vibe.drives": "1", "not.vibe": "x", "vibe.num": 5 },
    } as unknown as LookDoc);
    expect(r.doc()?.storage).toEqual({ "vibe.drives": "1" });
  });

  it("applies the next patch and reports what changed", () => {
    const r = createLookReplica();
    r.onSnapshot(2, doc({ "vibe.drives": "1", "vibe.hitAmount": "2" }));
    const res = r.onPatch(3, { scene: "storm", set: { "vibe.drives": "9" }, del: ["vibe.hitAmount"] });
    expect(res.status).toBe("applied");
    if (res.status !== "applied") return;
    expect(res.doc).toEqual(doc({ "vibe.drives": "9" }, "storm"));
    expect(res.changed).toEqual({ scene: "storm", set: { "vibe.drives": "9" }, del: ["vibe.hitAmount"] });
    expect(r.doc()).toEqual(res.doc);
    expect(r.rev()).toBe(3);
  });

  it("changed holds only what actually differed", () => {
    const r = createLookReplica();
    r.onSnapshot(1, doc({ "vibe.drives": "1" }));
    const res = r.onPatch(2, { scene: "plume", set: { "vibe.drives": "1", "vibe.hitAmount": "2" } });
    expect(res.status === "applied" && res.changed).toEqual({ set: { "vibe.hitAmount": "2" } });
  });

  it("calls a patch it has seen stale, and a skipped one a gap", () => {
    const r = createLookReplica();
    r.onSnapshot(5, doc({ "vibe.drives": "1" }));
    expect(r.onPatch(5, { set: { "vibe.drives": "x" } })).toEqual({ status: "stale" });
    expect(r.onPatch(2, { set: { "vibe.drives": "x" } })).toEqual({ status: "stale" });
    expect(r.onPatch(7, { set: { "vibe.drives": "x" } })).toEqual({ status: "gap" });
    expect(r.doc()?.storage["vibe.drives"]).toBe("1");
    expect(r.rev()).toBe(5);
  });

  it("builds a first document from patches on an empty room", () => {
    const r = createLookReplica();
    r.onSnapshot(0, null);
    const res = r.onPatch(1, { scene: "plume", palette: "neon", set: { "vibe.drives": "1" } });
    expect(res.status).toBe("applied");
    expect(r.doc()).toEqual(doc({ "vibe.drives": "1" }));
  });

  it("a patch that would not fit asks for a resync", () => {
    const r = createLookReplica();
    r.onSnapshot(1, doc({}));
    const big = "x".repeat(60000);
    const set: Record<string, string> = {};
    for (let i = 0; i < 4; i++) set[`vibe.big${i}`] = big;
    expect(r.onPatch(2, { set })).toEqual({ status: "gap" });
  });

  it("follows what a phone publishes, through the room", () => {
    const hub = new Hub();
    const a = hub.add(device({ "vibe.drives": "1" }, "plume", "neon"));
    hub.settle();
    const replica = createLookReplica();
    replica.onSnapshot(hub.rev, hub.doc);
    a.dev.storage["vibe.hitAmount"] = "4";
    a.dev.scene = "storm";
    hub.settle();
    const patch: LookPatch = { scene: "storm", set: { "vibe.hitAmount": "4" } };
    const res = replica.onPatch(hub.rev, patch);
    expect(res.status).toBe("applied");
    expect(replica.doc()).toEqual(hub.doc);
  });
});
