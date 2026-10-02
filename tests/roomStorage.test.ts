import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoomOverlay, installRoomStorage, wantsControllerStorage } from "../src/net/roomStorage.ts";
import { applyRoomStorage, captureRoomStorage } from "../src/net/syncedStores.ts";

function fakeReal(init: Record<string, string> = {}) {
  const m = new Map<string, string>(Object.entries(init));
  const storage = {
    m,
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  };
  return storage as typeof storage & Storage;
}

function enumerate(s: Storage): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i++) out.push(s.key(i) as string);
  return out;
}

describe("room overlay", () => {
  it("holds room keys in memory and never touches the real storage for them", () => {
    const real = fakeReal({ "vibe.sceneSettings": "phone's own" });
    const o = createRoomOverlay(real, false);
    expect(o.getItem("vibe.sceneSettings")).toBeNull(); // not seeded
    o.setItem("vibe.sceneSettings", "room's");
    o.setItem("vibe.bandFader.1", "{}");
    expect(o.getItem("vibe.sceneSettings")).toBe("room's");
    expect(real.m.get("vibe.sceneSettings")).toBe("phone's own");
    expect(real.m.has("vibe.bandFader.1")).toBe(false);
    o.removeItem("vibe.sceneSettings");
    expect(o.getItem("vibe.sceneSettings")).toBeNull();
    expect(real.m.get("vibe.sceneSettings")).toBe("phone's own");
  });

  it("passes every other key straight through to the real storage", () => {
    const real = fakeReal({ "vibe.deviceId": "abc", "vibe.looks": "[1]" });
    const o = createRoomOverlay(real, false);
    expect(o.getItem("vibe.deviceId")).toBe("abc");
    expect(o.getItem("vibe.looks")).toBe("[1]");
    o.setItem("vibe.looks", "[1,2]");
    o.setItem("svl.usageMe", "1");
    o.setItem("vibe.preview.size", "half");
    expect(real.m.get("vibe.looks")).toBe("[1,2]");
    expect(real.m.get("svl.usageMe")).toBe("1");
    expect(real.m.get("vibe.preview.size")).toBe("half");
    o.removeItem("vibe.deviceId");
    expect(real.m.has("vibe.deviceId")).toBe(false);
    expect(o.getItem("missing")).toBeNull();
  });

  it("enumerates and clears only the room keys", () => {
    const real = fakeReal({ "vibe.deviceId": "abc", "vibe.looks": "[1]", "svl.tvSession": "{}" });
    const o = createRoomOverlay(real, false);
    expect(o.length).toBe(0);
    o.setItem("vibe.sceneSettings", "a");
    o.setItem("vibe.drives", "b");
    o.setItem("vibe.looks", "[2]"); // goes through, not counted
    expect(o.length).toBe(2);
    expect(enumerate(o).sort()).toEqual(["vibe.drives", "vibe.sceneSettings"]);
    expect(o.key(2)).toBeNull();
    o.clear();
    expect(o.length).toBe(0);
    expect(real.m.get("vibe.looks")).toBe("[2]");
    expect(real.m.get("vibe.deviceId")).toBe("abc");
  });

  it("seeds from the real room keys only when asked", () => {
    const init = {
      "vibe.sceneSettings": "tuned",
      "vibe.sensitivity": "{}",
      "vibe.looks": "[1]",
      "vibe.deviceId": "abc",
      "vibe.silenceGateClosed": "0.1",
    };
    const seeded = createRoomOverlay(fakeReal(init), true);
    expect(enumerate(seeded).sort()).toEqual(["vibe.sceneSettings", "vibe.sensitivity"]);
    expect(seeded.getItem("vibe.sceneSettings")).toBe("tuned");
    const empty = createRoomOverlay(fakeReal(init), false);
    expect(empty.length).toBe(0);
  });

  it("applying a look never deletes the device's own keys", () => {
    const real = fakeReal({ "vibe.looks": "[saved]", "vibe.deviceId": "abc", "vibe.sceneSettings": "mine" });
    const o = createRoomOverlay(real, true);
    applyRoomStorage({ "vibe.drives": "from the room" }, o);
    expect(o.getItem("vibe.drives")).toBe("from the room");
    expect(o.getItem("vibe.sceneSettings")).toBeNull(); // the room's look lacked it
    expect(real.m.get("vibe.looks")).toBe("[saved]");
    expect(real.m.get("vibe.deviceId")).toBe("abc");
    expect(real.m.get("vibe.sceneSettings")).toBe("mine"); // the real copy is untouched
    expect(captureRoomStorage(o)).toEqual({ "vibe.drives": "from the room" });
  });

  it("copes with a missing or throwing real storage", () => {
    const none = createRoomOverlay(null, true);
    none.setItem("vibe.sceneSettings", "x");
    none.setItem("vibe.looks", "y");
    expect(none.getItem("vibe.sceneSettings")).toBe("x");
    expect(none.getItem("vibe.looks")).toBeNull();

    const boom = fakeReal();
    boom.getItem = () => {
      throw new Error("blocked");
    };
    boom.setItem = () => {
      throw new Error("full");
    };
    boom.removeItem = () => {
      throw new Error("blocked");
    };
    const o = createRoomOverlay(boom, false);
    expect(o.getItem("vibe.looks")).toBeNull();
    expect(() => o.setItem("vibe.looks", "x")).not.toThrow();
    expect(() => o.removeItem("vibe.looks")).not.toThrow();

    const unreadable = fakeReal({ "vibe.sceneSettings": "x" });
    Object.defineProperty(unreadable, "length", {
      get() {
        throw new Error("blocked");
      },
    });
    expect(createRoomOverlay(unreadable, true).length).toBe(0);
  });

  it("stores room values as text", () => {
    const o = createRoomOverlay(fakeReal(), false);
    o.setItem("vibe.sceneMaster", 2 as unknown as string);
    expect(o.getItem("vibe.sceneMaster")).toBe("2");
  });
});

describe("installRoomStorage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("replaces window.localStorage with the overlay", () => {
    const win: { localStorage?: unknown } = {};
    vi.stubGlobal("window", win);
    expect(installRoomStorage({ seed: false })).toBe(true);
    const o = win.localStorage as Storage;
    o.setItem("vibe.drives", "x");
    expect(o.getItem("vibe.drives")).toBe("x");
    expect(o.length).toBe(1);
  });

  it("reports false when the property cannot be replaced", () => {
    const win = Object.freeze({});
    vi.stubGlobal("window", win);
    expect(installRoomStorage({ seed: true })).toBe(false);
  });

  it("reports false with no window at all", () => {
    expect(installRoomStorage({ seed: true })).toBe(false);
  });
});

describe("wantsControllerStorage", () => {
  it("is true for a controller link or an adopt link", () => {
    expect(wantsControllerStorage("?room=ABCD&role=controller&k=abc")).toBe(true);
    expect(wantsControllerStorage("?role=controller")).toBe(true);
    expect(wantsControllerStorage("?adopt=ABCD&n=xyz")).toBe(true);
    expect(wantsControllerStorage("?audio=synthetic&adopt=ABCD")).toBe(true);
  });

  it("is false for everything else", () => {
    expect(wantsControllerStorage("")).toBe(false);
    expect(wantsControllerStorage("?")).toBe(false);
    expect(wantsControllerStorage("?audio=synthetic&bpm=120")).toBe(false);
    expect(wantsControllerStorage("?room=ABCD&role=host")).toBe(false);
    expect(wantsControllerStorage("?room=ABCD&k=abc")).toBe(false);
    expect(wantsControllerStorage("?role=Controller")).toBe(false);
  });
});
