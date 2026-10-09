import { afterEach, describe, expect, it, vi } from "vitest";
import { SCENE_MASTER_KEY, SCENE_SETTINGS_KEY, type SceneSetting } from "../src/render/sceneSettings.ts";

// A mirrored store that is handed text it cannot read keeps what it had
// (net/syncedStores.ts's header). Every case applies its snapshots the way the
// pop-out's Cue and a room's TV do, through applySyncedStorage, so the store's
// own reload hook is what is under test. A missing key still means the
// defaults, and a readable out-of-range number still clamps.
//
// Each store seeds its cache from localStorage at import, so every case
// installs its own fake localStorage and imports fresh modules after it. The
// fake and fresh() are the same pattern as perSceneReload.test.ts.

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
  const synced = await import("../src/net/syncedStores.ts");
  return { fake, synced };
}

afterEach(() => {
  (globalThis as { localStorage?: unknown }).localStorage = original;
  vi.resetModules();
});

describe("the two strict readers", () => {
  it("parseSyncedObject: absent or empty is null, a plain object is kept, anything else throws", async () => {
    const { parseSyncedObject } = await import("../src/net/syncedStores.ts");
    expect(parseSyncedObject(null)).toBeNull();
    expect(parseSyncedObject("")).toBeNull();
    expect(parseSyncedObject('{"a":1}')).toEqual({ a: 1 });
    // Breaks: dropping the Array check makes "[1]" stop throwing; dropping the null check makes "null" stop throwing.
    for (const bad of ["[1]", "null", "7", "{x"]) expect(() => parseSyncedObject(bad), bad).toThrow();
  });

  it("parseSyncedNumber: absent is null, a finite number is kept, anything else throws", async () => {
    const { parseSyncedNumber } = await import("../src/net/syncedStores.ts");
    expect(parseSyncedNumber(null)).toBeNull();
    expect(parseSyncedNumber("2.5")).toBe(2.5);
    for (const bad of ["abc", "Infinity"]) expect(() => parseSyncedNumber(bad), bad).toThrow();
  });
});

const FOCUS: SceneSetting = { key: "focus", label: "Focus", min: 0, max: 1, step: 0.05, default: 0.7 };

describe("scene settings (vibe.sceneSettings)", () => {
  // Break: restoring the old clear-then-loadInitial hook gives FOCUS.default on the first bad text.
  it("keeps every scene's values on unreadable text, then rereads a valid snapshot wholesale", async () => {
    const { fake, synced } = await fresh({
      [SCENE_SETTINGS_KEY]: JSON.stringify({ "scene-a": { focus: 0.4 }, "scene-b": { focus: 0.15 } }),
    });
    const { getSceneSetting } = await import("../src/render/sceneSettings.ts");
    const { getSensitivity } = await import("../src/audio/sensitivity.ts");
    expect(getSceneSetting("scene-a", FOCUS)).toBe(0.4);

    for (const junk of ["{not json", "[0.4]", "null", "42", '"x"', '{"scene-a":']) {
      synced.applySyncedStorage(
        { [SCENE_SETTINGS_KEY]: junk, "vibe.sensitivity": JSON.stringify({ "scene-a": 2.5 }) },
        fake,
      );
      expect(getSceneSetting("scene-a", FOCUS), junk).toBe(0.4);
      expect(getSceneSetting("scene-b", FOCUS), junk).toBe(0.15);
      // One unreadable key in a snapshot does not hold back the readable ones.
      expect(getSensitivity("scene-a"), junk).toBe(2.5);
    }

    synced.applySyncedStorage({ [SCENE_SETTINGS_KEY]: JSON.stringify({ "scene-a": { focus: 0.9 } }) }, fake);
    expect(getSceneSetting("scene-a", FOCUS)).toBe(0.9);
    expect(getSceneSetting("scene-b", FOCUS)).toBe(FOCUS.default); // gone from the snapshot

    synced.applySyncedStorage({}, fake);
    expect(getSceneSetting("scene-a", FOCUS)).toBe(FOCUS.default);
  });
});

describe("auto-tune choices (vibe.sceneAuto)", () => {
  // Real keys default to manual and pseudo-keys to auto, so the pair below
  // covers both directions of the default. Break: the old hook gives false
  // for "drift" and true for "@sensitivity" on "{oops".
  it("keeps the choices on unreadable text, and resets to each key's default when absent", async () => {
    const { fake, synced } = await fresh({
      "vibe.sceneAuto": JSON.stringify({ "scene-a": { drift: true, "@sensitivity": false } }),
    });
    const { isAutoEnabled } = await import("../src/render/autoTune.ts");
    expect(isAutoEnabled("scene-a", "drift")).toBe(true);
    expect(isAutoEnabled("scene-a", "@sensitivity")).toBe(false);

    synced.applySyncedStorage({ "vibe.sceneAuto": "{oops" }, fake);
    expect(isAutoEnabled("scene-a", "drift")).toBe(true);
    expect(isAutoEnabled("scene-a", "@sensitivity")).toBe(false);

    synced.applySyncedStorage({}, fake);
    expect(isAutoEnabled("scene-a", "drift")).toBe(false);
    expect(isAutoEnabled("scene-a", "@sensitivity")).toBe(true);
  });
});

describe("device dials (vibe.sceneMaster)", () => {
  // Break: the old load() returns SCENE_MASTER_DEFAULT on "abc" (Number("abc") is NaN, clamped to the default).
  it("keeps the dial on unreadable text, still clamps a readable one, and resets when absent", async () => {
    const { fake, synced } = await fresh({ [SCENE_MASTER_KEY]: "1.5" });
    const { getSceneMaster, SCENE_MASTER_MAX, SCENE_MASTER_DEFAULT } = await import("../src/render/sceneSettings.ts");
    expect(getSceneMaster()).toBe(1.5);

    for (const junk of ["abc", "Infinity"]) {
      synced.applySyncedStorage({ [SCENE_MASTER_KEY]: junk }, fake);
      expect(getSceneMaster(), junk).toBe(1.5);
    }
    // Readable but out of range: clamped, not treated as unreadable.
    synced.applySyncedStorage({ [SCENE_MASTER_KEY]: "9" }, fake);
    expect(getSceneMaster()).toBe(SCENE_MASTER_MAX);

    synced.applySyncedStorage({}, fake);
    expect(getSceneMaster()).toBe(SCENE_MASTER_DEFAULT);
  });
});

const SPARKLE: SceneSetting = { key: "sparkle", label: "Treble sparkle", min: 0, max: 1, step: 0.05, default: 0.4 };

describe("drive line strength (vibe.drives)", () => {
  // Break: the old hook does Object.assign(cache, loadInitial()), and loadInitial
  // accepts a JSON array, so "[]" clears the cache and the strength falls to its default.
  it("keeps the line strength on unreadable text, and resets when absent", async () => {
    const { fake, synced } = await fresh({
      "vibe.drives": JSON.stringify({ "scene-a": { sparkle: { lineStrength: 0.37 } } }),
    });
    const { getDriveLineStrength } = await import("../src/render/driveStore.ts");
    const { LINE_STRENGTH_DEFAULT } = await import("../src/audio/bandLine.ts");
    expect(getDriveLineStrength("scene-a", SPARKLE)).toBe(0.37);

    for (const junk of ["[]", "{x"]) {
      synced.applySyncedStorage({ "vibe.drives": junk }, fake);
      expect(getDriveLineStrength("scene-a", SPARKLE), junk).toBe(0.37);
    }

    synced.applySyncedStorage({}, fake);
    expect(getDriveLineStrength("scene-a", SPARKLE)).toBe(LINE_STRENGTH_DEFAULT);
  });
});

describe("custom values (vibe.customValues)", () => {
  // Break: the old hook sets the cache to null, so the next read reloads lazily,
  // parses "nope", gets {} and returns undefined.
  it("keeps the values on unreadable text, and drops them when the snapshot lacks the key", async () => {
    const { fake, synced } = await fresh({ "vibe.customValues": JSON.stringify({ "scene-a": { amp: 1.5 } }) });
    const { getCustomValue } = await import("../src/render/customValues.ts");
    expect(getCustomValue("scene-a", "amp")).toBe(1.5);

    synced.applySyncedStorage({ "vibe.customValues": "nope" }, fake);
    expect(getCustomValue("scene-a", "amp")).toBe(1.5);

    synced.applySyncedStorage({}, fake);
    expect(getCustomValue("scene-a", "amp")).toBeUndefined();
  });
});

describe("band split (vibe.bandSplit)", () => {
  // Break: a hook that bumps the version before reading moves the version on "{x".
  it("keeps the split and the version on unreadable text, and bumps the version once on a readable one", async () => {
    const { fake, synced } = await fresh({ "vibe.bandSplit": JSON.stringify({ lowMid: 4, midHigh: 20 }) });
    const { getBandSplit, bandSplitVersion, LOW_MID_DEFAULT, MID_HIGH_DEFAULT } = await import(
      "../src/audio/bandSplit.ts"
    );
    expect(getBandSplit()).toEqual({ lowMid: 4, midHigh: 20 });
    const before = bandSplitVersion();

    synced.applySyncedStorage({ "vibe.bandSplit": "{x" }, fake);
    expect(getBandSplit()).toEqual({ lowMid: 4, midHigh: 20 });
    expect(bandSplitVersion()).toBe(before);

    synced.applySyncedStorage({ "vibe.bandSplit": JSON.stringify({ lowMid: 3, midHigh: 10 }) }, fake);
    expect(getBandSplit()).toEqual({ lowMid: 3, midHigh: 10 });
    expect(bandSplitVersion()).toBe(before + 1);

    synced.applySyncedStorage({}, fake);
    expect(getBandSplit()).toEqual({ lowMid: LOW_MID_DEFAULT, midHigh: MID_HIGH_DEFAULT });
  });
});

describe("hit shape (vibe.hitKnee, vibe.hitTailLow, …)", () => {
  // Per field: the bad knee keeps 2.5 while the readable tail and floor apply.
  // Break: the old reload sets knee to HIT_KNEE_DEFAULT; a version that skips
  // the whole reload on any bad field leaves tail.low at 0.5.
  it("keeps only the field that cannot be read, and applies the rest of the snapshot", async () => {
    const { fake, synced } = await fresh({ "vibe.hitKnee": "2.5", "vibe.hitTailLow": "0.5" });
    const { getHitShape } = await import("../src/audio/hitStrength.ts");
    expect(getHitShape().knee).toBe(2.5);
    expect(getHitShape().tail.low).toBe(0.5);

    synced.applySyncedStorage({ "vibe.hitKnee": "zzz", "vibe.hitTailLow": "3", "vibe.hitFloor": "0.3" }, fake);
    expect(getHitShape().knee).toBe(2.5);
    expect(getHitShape().tail.low).toBe(3);
    expect(getHitShape().floor).toBe(0.3);
  });
});

describe("silence gate marks (vibe.silenceGateClosed, vibe.silenceGateOpen)", () => {
  // Break: the old reload gives closed = SILENCE_GATE_CLOSED_DEFAULT on "nan?".
  it("keeps an unreadable mark and applies the other one", async () => {
    const { fake, synced } = await fresh({ "vibe.silenceGateClosed": "0.2", "vibe.silenceGateOpen": "0.4" });
    const { getSilenceGate } = await import("../src/audio/silenceGate.ts");
    expect(getSilenceGate()).toEqual({ closed: 0.2, open: 0.4 });

    synced.applySyncedStorage({ "vibe.silenceGateClosed": "nan?", "vibe.silenceGateOpen": "0.5" }, fake);
    expect(getSilenceGate()).toEqual({ closed: 0.2, open: 0.5 });
  });
});
