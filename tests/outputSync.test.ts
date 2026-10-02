import { describe, it, expect } from "vitest";
import {
  createCueController,
  createFrameInbox,
  createOutputPresence,
  stateKey,
  type OutputState,
  type WireFrame,
} from "../src/net/outputSync.ts";
import { applySyncedStorage, captureSyncedStorage, registerSyncedStore } from "../src/net/syncedStores.ts";

const params = { sens: 1, exp: 1, smoothing: 1 };
const state = (scene: string, storage: Record<string, string> = {}, palette = "neon"): OutputState => ({
  scene,
  palette,
  storage,
  params,
});

describe("stateKey", () => {
  it("ignores storage key order and params", () => {
    const a = stateKey({ ...state("x", { a: "1", b: "2" }), params: { sens: 1, exp: 1, smoothing: 1 } });
    const b = stateKey({ ...state("x", { b: "2", a: "1" }), params: { sens: 3, exp: 2, smoothing: 0 } });
    expect(a).toBe(b);
  });
  it("tells scene, palette and stored values apart", () => {
    const base = stateKey(state("x", { a: "1" }));
    expect(stateKey(state("y", { a: "1" }))).not.toBe(base);
    expect(stateKey(state("x", { a: "2" }))).not.toBe(base);
    expect(stateKey(state("x", { a: "1" }, "mono"))).not.toBe(base);
  });
});

describe("createCueController", () => {
  it("seeds the output once, then holds it however the preview is tuned", () => {
    const sent: string[] = [];
    const c = createCueController((s) => void sent.push(s.scene));
    c.preview(state("a"));
    c.preview(state("b"));
    c.preview(state("b", { k: "v" }));
    expect(sent).toEqual(["a"]);
    expect(c.differs()).toBe(true);
    expect(c.following()).toBe(false);
    expect(c.held()?.scene).toBe("a");
  });

  it("holding Cue puts the preview on the output and follows live edits", () => {
    const sent: string[] = [];
    const c = createCueController((s) => void sent.push(s.scene));
    c.preview(state("a"));
    c.preview(state("b"));
    c.setCue(true);
    expect(sent).toEqual(["a", "b"]);
    expect(c.differs()).toBe(false);
    expect(c.following()).toBe(true);
    c.preview(state("b")); // unchanged -> nothing sent
    c.preview(state("c"));
    expect(sent).toEqual(["a", "b", "c"]);
  });

  it("releasing Cue puts back what the output had", () => {
    const sent: string[] = [];
    const c = createCueController((s) => void sent.push(s.scene));
    c.preview(state("a"));
    c.preview(state("b"));
    c.setCue(true);
    c.setCue(false);
    expect(sent).toEqual(["a", "b", "a"]);
    expect(c.held()?.scene).toBe("a");
    expect(c.differs()).toBe(true);
    c.preview(state("c")); // and it is held again
    expect(sent).toEqual(["a", "b", "a"]);
  });

  it("a Cue with nothing apart sends nothing either way", () => {
    const sent: string[] = [];
    const c = createCueController((s) => void sent.push(s.scene));
    c.preview(state("a"));
    c.setCue(true);
    c.setCue(false);
    expect(sent).toEqual(["a"]);
  });

  it("Play sends the whole preview, settings included, for good", () => {
    const sent: OutputState[] = [];
    const c = createCueController((s) => void sent.push(s));
    c.preview(state("a"));
    c.preview(state("b", { k: "v" }));
    c.go();
    expect(sent.at(-1)).toEqual(state("b", { k: "v" }));
    expect(c.differs()).toBe(false);
    c.setCue(true);
    c.setCue(false); // nothing to put back: the program is the preview
    expect(sent).toHaveLength(2);
    c.preview(state("c")); // and it stays held afterwards
    expect(sent).toHaveLength(2);
  });

  it("Play while Cue is held makes that look the one a release returns to", () => {
    const sent: string[] = [];
    const c = createCueController((s) => void sent.push(s.scene));
    c.preview(state("a"));
    c.preview(state("b"));
    c.setCue(true);
    c.go();
    c.setCue(false);
    expect(sent).toEqual(["a", "b", "b"]);
    expect(c.held()?.scene).toBe("b");
  });

  it("a Play can ask for a glide length, which travels with the send, unless Cue is held", () => {
    const sent: Array<[string, number | undefined]> = [];
    const c = createCueController((s, g) => void sent.push([s.scene, g]));
    c.preview(state("a"));
    c.preview(state("a", { k: "v" }));
    c.go(6000);
    c.preview(state("a", { k: "w" }));
    c.setCue(true);
    c.go(6000);
    expect(sent).toEqual([
      ["a", undefined],
      ["a", 6000],
      ["a", undefined], // Cue: the preview goes on at once
      ["a", undefined], // Play under Cue: nothing to glide from
    ]);
  });

  it("a setting-only change counts as a difference", () => {
    const c = createCueController(() => undefined);
    c.preview(state("a", { s: "1" }));
    c.preview(state("a", { s: "2" }));
    expect(c.differs()).toBe(true);
  });

  it("an output that opens (or reconnects) gets the preview as its program", () => {
    const sent: string[] = [];
    const c = createCueController((s) => void sent.push(s.scene));
    c.preview(state("a"));
    c.preview(state("b"));
    c.outputOpened();
    expect(sent.at(-1)).toBe("b");
    expect(c.differs()).toBe(false);
    c.preview(state("c"));
    c.setCue(true);
    c.setCue(false);
    expect(sent.at(-1)).toBe("b");
  });

  it("an undelivered push leaves held() at what the output really has, until resync", () => {
    const sent: string[] = [];
    let delivered = true;
    const c = createCueController((s) => {
      if (!delivered) return false;
      sent.push(s.scene);
      return true;
    });
    c.preview(state("a"));
    delivered = false;
    c.preview(state("b"));
    c.go();
    expect(sent).toEqual(["a"]);
    expect(c.held()?.scene).toBe("a");
    expect(c.differs()).toBe(true);
    delivered = true;
    c.resync();
    expect(sent).toEqual(["a", "b"]);
    expect(c.held()?.scene).toBe("b");
    expect(c.differs()).toBe(false);
    c.resync(); // nothing left to catch up
    expect(sent).toEqual(["a", "b"]);
  });

  it("resync also re-sends the program after a Cue release that was dropped", () => {
    const sent: string[] = [];
    let delivered = true;
    const c = createCueController((s) => {
      if (!delivered) return false;
      sent.push(s.scene);
      return true;
    });
    c.preview(state("a"));
    c.preview(state("b"));
    c.setCue(true); // output shows b
    delivered = false;
    c.setCue(false); // the put-back to a never arrives
    expect(c.held()?.scene).toBe("b");
    delivered = true;
    c.resync();
    expect(sent).toEqual(["a", "b", "a"]);
    expect(c.held()?.scene).toBe("a");
  });

  it("differs() and following() reuse the preview's key instead of rebuilding it", () => {
    let keyReads = 0;
    const counted = new Proxy({ a: "1", b: "2" } as Record<string, string>, {
      ownKeys(t) {
        keyReads++;
        return Reflect.ownKeys(t);
      },
    });
    const c = createCueController(() => undefined);
    c.preview(state("a", counted));
    const afterPreview = keyReads;
    for (let i = 0; i < 100; i++) {
      c.differs();
      c.following();
    }
    expect(keyReads).toBe(afterPreview);
  });

  it("differs() follows the preview through Play and back", () => {
    const c = createCueController(() => undefined);
    c.preview(state("a", { k: "1" }));
    c.go();
    c.preview(state("a", { k: "2" }));
    expect(c.differs()).toBe(true);
    c.go();
    expect(c.differs()).toBe(false);
    c.preview(state("a", { k: "1" }));
    expect(c.differs()).toBe(true);
    c.preview(state("a", { k: "2" }));
    expect(c.differs()).toBe(false);
  });

  it("closing forgets what the output had", () => {
    const c = createCueController(() => undefined);
    c.preview(state("a"));
    c.outputClosed();
    expect(c.held()).toBeNull();
    expect(c.differs()).toBe(false);
  });
});

const frame = (over: Partial<WireFrame> = {}): WireFrame => ({
  time: 0,
  bands: new Float32Array(24),
  energy: 0,
  level: 0,
  onset: false,
  pulseOnset: false,
  bpm: 0,
  onsetPhase: 0,
  beatRatio: null,
  wavePeak: null,
  ...over,
});

describe("createFrameInbox", () => {
  it("is empty before the first frame", () => {
    const i = createFrameInbox();
    expect(i.take()).toBeNull();
    expect(i.ageMs(1000)).toBe(Infinity);
  });

  it("keeps a hit that lands between two output ticks, and fires it once", () => {
    const i = createFrameInbox();
    i.push(frame({ onset: true, pulseOnset: true }), 0);
    i.push(frame({ energy: 0.5 }), 5); // a later frame without the edge
    const first = i.take()!;
    expect(first.onset).toBe(true);
    expect(first.pulseOnset).toBe(true);
    expect(first.energy).toBe(0.5); // but the newest values
    expect(i.take()!.onset).toBe(false); // consumed
  });

  it("holds the last params across frames that omit them", () => {
    const i = createFrameInbox();
    i.push(frame({ p: { sens: 2, exp: 1.5, smoothing: 0.5 } }), 0);
    i.push(frame(), 10);
    expect(i.params()).toEqual({ sens: 2, exp: 1.5, smoothing: 0.5 });
  });

  it("reports frame age", () => {
    const i = createFrameInbox();
    i.push(frame(), 100);
    expect(i.ageMs(350)).toBe(250);
  });
});

describe("createOutputPresence", () => {
  it("is open for the timeout after a heartbeat, and reports the first one", () => {
    const p = createOutputPresence(1000);
    expect(p.isOpen(0)).toBe(false);
    expect(p.seen(0)).toBe(true);
    expect(p.seen(500)).toBe(false);
    expect(p.isOpen(1400)).toBe(true);
    expect(p.isOpen(1600)).toBe(false);
    expect(p.seen(2000)).toBe(true);
  });
  it("closes at once on a goodbye", () => {
    const p = createOutputPresence(1000);
    p.seen(0);
    p.bye();
    expect(p.isOpen(1)).toBe(false);
  });
});

function fakeStorage(init: Record<string, string> = {}) {
  const m = new Map<string, string>(Object.entries(init));
  return {
    m,
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

describe("syncedStores", () => {
  it("captures every key except the private ones, registered or not", () => {
    const live = fakeStorage({
      "vibe.sceneSettings": "{}",
      "vibe.someFutureStore": "1",
      "vibe.deviceId": "abc",
      "vibe.keyTips": "{}",
      "vibe.quality": "high",
      "vibe.powerMode": "off",
      "vibe.output.quality": "high",
      "vibe.output.powerMode": "off",
      "vibe.preview.quality": "floor",
      "vibe.preview.size": "half",
      "vibe.output.resolution": "0.5",
      "vibe.preview.resolution": "0.5",
      // Pairing sessions hold room secrets: never mirrored to the pop-out.
      "svl.hostRoom": "{}",
      "svl.controllerSession": "{}",
      "svl.tvSession": "{}",
      "svl.pendingAdopt": "{}",
    });
    expect(captureSyncedStorage(live)).toEqual({ "vibe.sceneSettings": "{}", "vibe.someFutureStore": "1" });
  });

  it("a resolution change in the preview window is not a difference for the output", () => {
    const at = (resolution: string) =>
      state("x", captureSyncedStorage(fakeStorage({ "vibe.sceneSettings": "{}", "vibe.preview.resolution": resolution })));
    expect(stateKey(at("1"))).toBe(stateKey(at("0.5")));
  });

  it("applies a snapshot wholesale and runs the store hooks after the write", () => {
    const priv = fakeStorage({ "vibe.stale": "x", "vibe.deviceId": "keep" });
    let loaded: string | undefined;
    registerSyncedStore("t.synced", () => {
      loaded = priv.getItem("t.synced") ?? undefined;
    });
    applySyncedStorage({ "t.synced": "held" }, priv);
    expect(priv.getItem("t.synced")).toBe("held");
    expect(loaded).toBe("held"); // the store re-read after the write
    expect(priv.getItem("vibe.stale")).toBeNull(); // not in the snapshot -> gone
    expect(priv.getItem("vibe.deviceId")).toBe("keep"); // private keys are left alone
  });

  it("does not count continuously rewritten keys as a difference", () => {
    const a = stateKey(state("x", { "vibe.silenceGateClosed": "0.1" }));
    const b = stateKey(state("x", { "vibe.silenceGateClosed": "0.2" }));
    expect(a).toBe(b);
  });
});
