import { afterEach, describe, expect, it, vi } from "vitest";

// The band fader bank's per-scene stores seed an in-memory cache from
// localStorage once, at module load. Applying a snapshot from outside — the pop-out's Cue, a room
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
  const gains = await import("../src/audio/bandGains.ts");
  const synced = await import("../src/net/syncedStores.ts");
  return { fake, gains, synced };
}

afterEach(() => {
  (globalThis as { localStorage?: unknown }).localStorage = original;
  vi.resetModules();
});

// One fader's store key; every fader goes through the same factory.
const F0 = "vibe.bandFader.0";

describe("per-scene setting reload", () => {
  it("replaces the cache with what the applied snapshot holds", async () => {
    const { fake, gains, synced } = await fresh({ [F0]: JSON.stringify({ a: 2, b: 3 }) });
    expect(gains.getBandGain("a", 0)).toBe(2);
    expect(gains.getBandGain("b", 0)).toBe(3);

    synced.applySyncedStorage({ [F0]: JSON.stringify({ a: 1.5, c: 0.5 }) }, fake);
    expect(gains.getBandGain("a", 0)).toBe(1.5);
    expect(gains.getBandGain("c", 0)).toBe(0.5);
    expect(gains.getBandGain("b", 0)).toBe(gains.BAND_GAIN_DEFAULT); // gone from the snapshot -> default
  });

  it("a snapshot that lacks the key resets the store to its defaults", async () => {
    const { fake, gains, synced } = await fresh({ [F0]: JSON.stringify({ a: 2 }) });
    expect(gains.getBandGain("a", 0)).toBe(2);
    synced.applySyncedStorage({}, fake);
    expect(fake.raw.has(F0)).toBe(false);
    expect(gains.getBandGain("a", 0)).toBe(gains.BAND_GAIN_DEFAULT);
  });

  it("covers every band fader through the one factory", async () => {
    const { fake, gains, synced } = await fresh();
    synced.applySyncedStorage(
      {
        "vibe.bandFader.0": JSON.stringify({ s: 0 }),
        "vibe.bandFader.3": JSON.stringify({ s: 2.5 }),
      },
      fake,
    );
    expect(gains.getBandGain("s", 0)).toBe(0);
    expect(gains.getBandGain("s", 3)).toBe(2.5);
    expect(gains.getBandGain("s", 1)).toBe(gains.BAND_GAIN_DEFAULT);
  });

  it("keeps what it had on unreadable text, and resets on an empty one", async () => {
    const { fake, gains, synced } = await fresh({ [F0]: JSON.stringify({ a: 2 }) });
    for (const junk of ["not json", "[1,2,3]", "null", "42", '"text"', "]["]) {
      synced.applySyncedStorage({ [F0]: junk }, fake);
      expect(gains.getBandGain("a", 0), junk).toBe(2);
    }
    // Empty text is "absent", so it resets exactly like a missing key.
    synced.applySyncedStorage({ [F0]: "" }, fake);
    expect(gains.getBandGain("a", 0)).toBe(gains.BAND_GAIN_DEFAULT);
    // Entries that are not finite numbers are dropped; the rest are kept.
    synced.applySyncedStorage({ [F0]: '{"a":"loud","b":null,"c":{"x":1},"d":3}' }, fake);
    expect(gains.getBandGain("a", 0)).toBe(gains.BAND_GAIN_DEFAULT);
    expect(gains.getBandGain("b", 0)).toBe(gains.BAND_GAIN_DEFAULT);
    expect(gains.getBandGain("c", 0)).toBe(gains.BAND_GAIN_DEFAULT);
    expect(gains.getBandGain("d", 0)).toBe(3);
  });

  it("still clamps what it reads back", async () => {
    const { fake, gains, synced } = await fresh();
    synced.applySyncedStorage({ [F0]: JSON.stringify({ hot: 999, cold: -5 }) }, fake);
    expect(gains.getBandGain("hot", 0)).toBe(gains.BAND_GAIN_MAX);
    expect(gains.getBandGain("cold", 0)).toBe(gains.BAND_GAIN_MIN);
  });

  it("does not write anything while reloading", async () => {
    const { fake, gains, synced } = await fresh();
    const writes: string[] = [];
    const set = fake.setItem;
    fake.setItem = (k, v) => {
      writes.push(k);
      set(k, v);
    };
    synced.applySyncedStorage({ [F0]: JSON.stringify({ a: 2 }) }, fake);
    expect(writes).toEqual([F0]); // only the apply's own write
    expect(gains.getBandGain("a", 0)).toBe(2);
  });

  it("keeps working for ordinary set/get afterwards", async () => {
    const { fake, gains, synced } = await fresh();
    synced.applySyncedStorage({ [F0]: JSON.stringify({ a: 2 }) }, fake);
    gains.setBandGain("b", 0, 3);
    expect(JSON.parse(fake.raw.get(F0) as string)).toEqual({ a: 2, b: 3 });
  });

  it("drops entries that are not finite numbers at module start", async () => {
    const { gains } = await fresh({ [F0]: JSON.stringify({ a: 2, bad: "x" }) });
    expect(gains.getBandGain("a", 0)).toBe(2);
    expect(gains.getBandGain("bad", 0)).toBe(gains.BAND_GAIN_DEFAULT);
  });
});
