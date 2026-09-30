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
  it("mirrors every change while Cue is off, and only changes", () => {
    const sent: string[] = [];
    const c = createCueController((s) => sent.push(s.scene));
    c.preview(state("a"));
    c.preview(state("a")); // unchanged -> nothing sent
    c.preview(state("b"));
    expect(sent).toEqual(["a", "b"]);
    expect(c.differs()).toBe(false);
  });

  it("holds the output while Cue is on and reports the difference", () => {
    const sent: string[] = [];
    const c = createCueController((s) => sent.push(s.scene));
    c.preview(state("a"));
    c.setCue(true);
    c.preview(state("b"));
    c.preview(state("b", { k: "v" }));
    expect(sent).toEqual(["a"]);
    expect(c.differs()).toBe(true);
    expect(c.held()?.scene).toBe("a");
  });

  it("Go sends the whole preview, settings included, and clears the difference", () => {
    const sent: OutputState[] = [];
    const c = createCueController((s) => sent.push(s));
    c.preview(state("a"));
    c.setCue(true);
    c.preview(state("b", { k: "v" }));
    c.go();
    expect(sent.at(-1)).toEqual(state("b", { k: "v" }));
    expect(c.differs()).toBe(false);
    expect(c.cueOn()).toBe(true); // Go does not turn Cue off
  });

  it("turning Cue off catches the output up to the preview", () => {
    const sent: string[] = [];
    const c = createCueController((s) => sent.push(s.scene));
    c.preview(state("a"));
    c.setCue(true);
    c.preview(state("b"));
    c.setCue(false);
    expect(sent).toEqual(["a", "b"]);
    expect(c.differs()).toBe(false);
  });

  it("a setting-only change counts as a difference under Cue", () => {
    const c = createCueController(() => undefined);
    c.preview(state("a", { s: "1" }));
    c.setCue(true);
    c.preview(state("a", { s: "2" }));
    expect(c.differs()).toBe(true);
  });

  it("an output that opens (or reconnects) gets the preview, even under Cue", () => {
    const sent: string[] = [];
    const c = createCueController((s) => sent.push(s.scene));
    c.preview(state("a"));
    c.setCue(true);
    c.preview(state("b"));
    c.outputOpened();
    expect(sent.at(-1)).toBe("b");
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

describe("syncedStores", () => {
  it("captures only registered keys and applies a snapshot through their reloaders", () => {
    const priv = new Map<string, string>([["t.synced", "old"]]);
    let loaded: string | undefined;
    registerSyncedStore("t.synced", () => {
      loaded = priv.get("t.synced");
    });
    const live = new Map<string, string>([
      ["t.synced", "live"],
      ["t.other", "untouched"],
    ]);
    expect(captureSyncedStorage({ getItem: (k) => live.get(k) ?? null })).toEqual({ "t.synced": "live" });

    const storage = {
      setItem: (k: string, v: string) => void priv.set(k, v),
      removeItem: (k: string) => void priv.delete(k),
    };
    applySyncedStorage({ "t.synced": "held" }, storage);
    expect(priv.get("t.synced")).toBe("held");
    expect(loaded).toBe("held"); // the store re-read after the write
    // A key the snapshot lacks is removed (a setting reset to default).
    applySyncedStorage({}, storage);
    expect(priv.has("t.synced")).toBe(false);
    expect(loaded).toBeUndefined();
  });
});
