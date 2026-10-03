import { afterEach, describe, expect, it, vi } from "vitest";

// The per-scene stores (Sensitivity, Expansion, Smoothing and the band fader
// bank) and the band split seed an in-memory cache from localStorage once, at
// module load. Applying a snapshot from outside — the pop-out's Cue, a room
// look reaching a TV — only works if each of them re-reads after the write,
// which is the hook these tests exercise. A store is created at import, so
// each case installs its localStorage first and takes a fresh import.

function makeFakeLocalStorage(init: Record<string, string> = {}) {
  const raw = new Map<string, string>(Object.entries(init));
  return {
    raw,
    get length() {
      return raw.size;
    },
    key: (i: number) => [...raw.keys()][i] ?? null,
    getItem: (k: string) => raw.get(k) ?? null,
    setItem: (k: string, v: string) => void raw.set(k, v),
    removeItem: (k: string) => void raw.delete(k),
  };
}

const original = (globalThis as { localStorage?: unknown }).localStorage;

async function fresh(init: Record<string, string> = {}) {
  const fake = makeFakeLocalStorage(init);
  (globalThis as { localStorage?: unknown }).localStorage = fake;
  vi.resetModules();
  const sens = await import("../src/audio/sensitivity.ts");
  const gains = await import("../src/audio/bandGains.ts");
  const split = await import("../src/audio/bandSplit.ts");
  const synced = await import("../src/net/syncedStores.ts");
  return { fake, sens, gains, split, synced };
}

afterEach(() => {
  (globalThis as { localStorage?: unknown }).localStorage = original;
  vi.resetModules();
});

describe("per-scene setting reload", () => {
  it("replaces the cache with what the applied snapshot holds", async () => {
    const { fake, sens, synced } = await fresh({ "vibe.sensitivity": JSON.stringify({ a: 2, b: 3 }) });
    expect(sens.getSensitivity("a")).toBe(2);
    expect(sens.getSensitivity("b")).toBe(3);

    synced.applySyncedStorage({ "vibe.sensitivity": JSON.stringify({ a: 1.5, c: 0.5 }) }, fake);
    expect(sens.getSensitivity("a")).toBe(1.5);
    expect(sens.getSensitivity("c")).toBe(0.5);
    expect(sens.getSensitivity("b")).toBe(sens.SENSITIVITY_DEFAULT); // gone from the snapshot -> default
  });

  it("a snapshot that lacks the key resets the store to its defaults", async () => {
    const { fake, sens, synced } = await fresh({ "vibe.smoothing": JSON.stringify({ a: 2 }) });
    expect(sens.getSmoothing("a")).toBe(2);
    synced.applySyncedStorage({}, fake);
    expect(fake.raw.has("vibe.smoothing")).toBe(false);
    expect(sens.getSmoothing("a")).toBe(sens.SMOOTHING_DEFAULT);
  });

  it("covers Expansion, Smoothing and every band fader through the one factory", async () => {
    const { fake, sens, gains, synced } = await fresh();
    synced.applySyncedStorage(
      {
        "vibe.expansion": JSON.stringify({ s: 2 }),
        "vibe.smoothing": JSON.stringify({ s: 0 }),
        "vibe.bandFader.0": JSON.stringify({ s: 0 }),
        "vibe.bandFader.3": JSON.stringify({ s: 2.5 }),
      },
      fake,
    );
    expect(sens.getExpansion("s")).toBe(2);
    expect(sens.getSmoothing("s")).toBe(0); // Off survives: the Smoothing floor is 0
    expect(gains.getBandGain("s", 0)).toBe(0);
    expect(gains.getBandGain("s", 3)).toBe(2.5);
    expect(gains.getBandGain("s", 1)).toBe(gains.BAND_GAIN_DEFAULT);
  });

  it("ignores garbage instead of throwing or keeping it", async () => {
    const { fake, sens, synced } = await fresh({ "vibe.sensitivity": JSON.stringify({ a: 2 }) });
    for (const junk of ["not json", "[1,2,3]", "null", "42", '"text"', ""]) {
      synced.applySyncedStorage({ "vibe.sensitivity": junk }, fake);
      expect(sens.getSensitivity("a"), junk).toBe(sens.SENSITIVITY_DEFAULT);
    }
    // Entries that are not finite numbers are dropped; the rest are kept.
    synced.applySyncedStorage({ "vibe.sensitivity": '{"a":"loud","b":null,"c":{"x":1},"d":3}' }, fake);
    expect(sens.getSensitivity("a")).toBe(sens.SENSITIVITY_DEFAULT);
    expect(sens.getSensitivity("b")).toBe(sens.SENSITIVITY_DEFAULT);
    expect(sens.getSensitivity("c")).toBe(sens.SENSITIVITY_DEFAULT);
    expect(sens.getSensitivity("d")).toBe(3);
  });

  it("still clamps what it reads back", async () => {
    const { fake, sens, synced } = await fresh();
    synced.applySyncedStorage({ "vibe.sensitivity": JSON.stringify({ hot: 999, cold: -5 }) }, fake);
    expect(sens.getSensitivity("hot")).toBe(sens.SENSITIVITY_MAX);
    expect(sens.getSensitivity("cold")).toBe(sens.SENSITIVITY_MIN);
  });

  it("does not run the legacy-key migration or remove legacy keys", async () => {
    const { fake, sens, synced } = await fresh();
    // A snapshot that carries the old names but lacks vibe.expansion.
    synced.applySyncedStorage(
      { "vibe.dynamics": JSON.stringify({ a: 2.5 }), "vibe.acceleration": JSON.stringify({ a: 3 }) },
      fake,
    );
    expect(sens.getExpansion("a")).toBe(sens.EXPANSION_DEFAULT); // not migrated in
    expect(fake.raw.has("vibe.dynamics")).toBe(true);
    expect(fake.raw.has("vibe.acceleration")).toBe(true);
    expect(fake.raw.has("vibe.expansion")).toBe(false); // and nothing written back
  });

  it("does not write anything while reloading", async () => {
    const { fake, sens, synced } = await fresh();
    const writes: string[] = [];
    const set = fake.setItem;
    fake.setItem = (k, v) => {
      writes.push(k);
      set(k, v);
    };
    synced.applySyncedStorage({ "vibe.sensitivity": JSON.stringify({ a: 2 }) }, fake);
    expect(writes).toEqual(["vibe.sensitivity"]); // only the apply's own write
    expect(sens.getSensitivity("a")).toBe(2);
  });

  it("keeps working for ordinary set/get afterwards", async () => {
    const { fake, sens, synced } = await fresh();
    synced.applySyncedStorage({ "vibe.sensitivity": JSON.stringify({ a: 2 }) }, fake);
    sens.setSensitivity("b", 3);
    expect(JSON.parse(fake.raw.get("vibe.sensitivity") as string)).toEqual({ a: 2, b: 3 });
  });

  it("loads exactly as before at module start", async () => {
    const { sens } = await fresh({
      "vibe.sensitivity": JSON.stringify({ a: 2, bad: "x" }),
      "vibe.dynamics": JSON.stringify({ a: 2.5 }),
    });
    expect(sens.getSensitivity("a")).toBe(2);
    expect(sens.getSensitivity("bad")).toBe(sens.SENSITIVITY_DEFAULT);
    expect(sens.getExpansion("a")).toBe(2.5); // the legacy migration still runs at load
  });
});

describe("band split reload", () => {
  it("re-reads the split and bumps the version so consumers rebuild", async () => {
    const { fake, split, synced } = await fresh();
    const before = split.bandSplitVersion();
    synced.applySyncedStorage({ "vibe.bandSplit": JSON.stringify({ lowMid: 4, midHigh: 20 }) }, fake);
    expect(split.getBandSplit()).toEqual({ lowMid: 4, midHigh: 20 });
    expect(split.bandSplitVersion()).toBeGreaterThan(before);
  });

  it("goes back to the default split when the snapshot lacks it", async () => {
    const { fake, split, synced } = await fresh({ "vibe.bandSplit": JSON.stringify({ lowMid: 4, midHigh: 20 }) });
    expect(split.getBandSplit().lowMid).toBe(4);
    synced.applySyncedStorage({}, fake);
    expect(split.getBandSplit()).toEqual({ lowMid: split.LOW_MID_DEFAULT, midHigh: split.MID_HIGH_DEFAULT });
  });

  it("clamps an out-of-range split from outside", async () => {
    const { fake, split, synced } = await fresh();
    synced.applySyncedStorage({ "vibe.bandSplit": JSON.stringify({ lowMid: -9, midHigh: 999 }) }, fake);
    const s = split.getBandSplit();
    expect(s.lowMid).toBeGreaterThanOrEqual(1);
    expect(s.midHigh).toBeGreaterThan(s.lowMid);
  });
});
