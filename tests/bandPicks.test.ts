import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NUM_BANDS } from "../src/audio/types.ts";

function memoryStorage(seed: Record<string, string> = {}) {
  const m = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

describe("band picks", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts empty and toggles a band on and off, kept sorted", async () => {
    vi.stubGlobal("localStorage", memoryStorage());
    const mod = await import("../src/ui/bandPicks.ts");
    expect(mod.getBandPicks()).toEqual([]);
    expect(mod.toggleBandPick(9)).toBe(true);
    expect(mod.toggleBandPick(3)).toBe(true);
    expect(mod.getBandPicks()).toEqual([3, 9]);
    expect(mod.isBandPicked(9)).toBe(true);
    expect(mod.toggleBandPick(9)).toBe(false);
    expect(mod.isBandPicked(9)).toBe(false);
    expect(mod.getBandPicks()).toEqual([3]);
  });

  it("persists across a reload", async () => {
    const storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);
    (await import("../src/ui/bandPicks.ts")).toggleBandPick(17);
    vi.resetModules();
    const again = await import("../src/ui/bandPicks.ts");
    expect(again.getBandPicks()).toEqual([17]);
  });

  it("drops out-of-range, non-integer and duplicate entries", async () => {
    vi.stubGlobal("localStorage", memoryStorage({ "vibe.bandPicks": JSON.stringify([5, -1, NUM_BANDS, 2.5, "4", 5, 0]) }));
    const mod = await import("../src/ui/bandPicks.ts");
    expect(mod.getBandPicks()).toEqual([0, 5]);
  });

  it("reads unreadable text as no picks", async () => {
    vi.stubGlobal("localStorage", memoryStorage({ "vibe.bandPicks": "{not json" }));
    const mod = await import("../src/ui/bandPicks.ts");
    expect(mod.getBandPicks()).toEqual([]);
  });

  it("works with no localStorage at all", async () => {
    const mod = await import("../src/ui/bandPicks.ts");
    expect(mod.toggleBandPick(1)).toBe(true);
    expect(mod.getBandPicks()).toEqual([1]);
  });
});
