import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TRANSITION_BARS,
  TRANSITION_DEFAULT,
  crossfadeOptions,
  getSceneTransition,
  parseTransition,
  setSceneTransition,
} from "../src/render/sceneTransition.ts";
import { applySyncedStorage } from "../src/net/syncedStores.ts";
import { stateKey } from "../src/net/outputSync.ts";

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

afterEach(() => {
  vi.unstubAllGlobals();
  setSceneTransition(TRANSITION_DEFAULT);
});

describe("parseTransition", () => {
  it("reads a stored value", () => {
    expect(parseTransition(JSON.stringify({ style: "cut", bars: 4 }))).toEqual({ style: "cut", bars: 4 });
  });
  it("falls back to the defaults for missing, broken or out-of-range values", () => {
    expect(parseTransition(null)).toEqual(TRANSITION_DEFAULT);
    expect(parseTransition("{not json")).toEqual(TRANSITION_DEFAULT);
    expect(parseTransition(JSON.stringify({ style: "wipe", bars: 3 }))).toEqual(TRANSITION_DEFAULT);
    expect(parseTransition("null")).toEqual(TRANSITION_DEFAULT);
  });
  it("accepts every Length the list offers", () => {
    for (const bars of TRANSITION_BARS) expect(parseTransition(JSON.stringify({ style: "fade", bars })).bars).toBe(bars);
  });
});

describe("the store", () => {
  it("keeps the bars while Cut is picked, for the next Fade", () => {
    setSceneTransition({ bars: 4 });
    setSceneTransition({ style: "cut" });
    expect(setSceneTransition({ style: "fade" })).toEqual({ style: "fade", bars: 4 });
  });

  it("stores a change and forgets the key at the defaults", () => {
    const storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);
    setSceneTransition({ style: "cut" });
    expect(JSON.parse(storage.m.get("vibe.transition")!)).toEqual({ style: "cut", bars: TRANSITION_DEFAULT.bars });
    setSceneTransition(TRANSITION_DEFAULT);
    expect(storage.m.has("vibe.transition")).toBe(false);
  });

  it("re-seeds from a snapshot, as the pop-out and a TV receive it", () => {
    const storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);
    applySyncedStorage({ "vibe.transition": JSON.stringify({ style: "fade", bars: 2 }) }, storage);
    expect(getSceneTransition()).toEqual({ style: "fade", bars: 2 });
  });

  it("never reads as the output differing from the preview", () => {
    const base = { scene: "chladni", palette: "p", params: { sens: 1, exp: 1, smoothing: 1 } };
    const a = stateKey({ ...base, storage: {} });
    const b = stateKey({ ...base, storage: { "vibe.transition": JSON.stringify({ style: "cut", bars: 1 }) } });
    expect(a).toBe(b);
  });
});

describe("crossfadeOptions", () => {
  it("fades over the stored bars", () => {
    expect(crossfadeOptions({ style: "fade", bars: 2 }, false)).toEqual({ bars: 2 });
  });
  it("cuts when Cut is picked", () => {
    expect(crossfadeOptions({ style: "cut", bars: 2 }, false)).toEqual({ cut: true });
  });
  it("always cuts on the floor preset, even a held Play", () => {
    expect(crossfadeOptions({ style: "fade", bars: 2 }, true, 3000)).toEqual({ cut: true });
  });
  it("a held Play's glide wins over the stored transition", () => {
    expect(crossfadeOptions({ style: "cut", bars: 2 }, false, 3000)).toEqual({ lengthMs: 3000 });
    expect(crossfadeOptions({ style: "fade", bars: 2 }, false, 3000)).toEqual({ lengthMs: 3000 });
  });
});
