import { describe, it, expect, vi, afterEach } from "vitest";
import {
  getDriveChoice,
  setDriveChoice,
  resetDriveChoice,
  getDriveSetting,
  setDriveSetting,
  resetDriveSetting,
  sanitizeDriveSetting,
  encodeDriveSetting,
  togglePatchSource,
  setSourceWeight,
  setSourceHeight,
  setSourceGrid,
  setPatchMix,
  getDriveLine,
  setDriveLineBand,
  setDriveLine,
  resetDriveLine,
  getDriveLineStrength,
  setDriveLineStrength,
  resetDriveLineStrength,
} from "../src/render/driveStore.ts";
import { driveSettingFromChoice, type DrivePatch } from "../src/render/drives.ts";
import { LINE_HEIGHT_DEFAULT, LINE_STRENGTH_DEFAULT, LINE_STRENGTH_MAX, LINE_STRENGTH_MIN } from "../src/audio/bandLine.ts";
import { NUM_BANDS } from "../src/audio/types.ts";
import type { SceneSetting } from "../src/render/sceneSettings.ts";

// vitest runs under environment: "node" (vitest.config.ts), so there is no
// localStorage global at all here for the plain round-trip tests below —
// this also proves the module tolerates that, same as every other store's
// own tests (sceneSettings.test.ts, bandLine.test.ts).

const FLASH: SceneSetting = {
  key: "flash",
  label: "Beat flash",
  min: 0,
  max: 1,
  step: 0.05,
  default: 0.6,
  drive: { default: "feature.onset" },
};

const SPARKLE: SceneSetting = {
  key: "sparkle",
  label: "Treble sparkle",
  min: 0,
  max: 1,
  step: 0.05,
  default: 0.4,
  drive: { default: "scene", sceneLabel: "Scene: treble hits + line" },
};

describe("driveStore: choice", () => {
  it("defaults to spec.drive.default for a setting that's never been touched", () => {
    expect(getDriveChoice("choice-scene-1", FLASH)).toBe("feature.onset");
    expect(getDriveChoice("choice-scene-1", SPARKLE)).toBe("scene");
  });

  it("round-trips a plain catalogue choice", () => {
    setDriveChoice("choice-scene-2", FLASH, "anim.lowOnset");
    expect(getDriveChoice("choice-scene-2", FLASH)).toBe("anim.lowOnset");
  });

  it("round-trips a grid choice", () => {
    setDriveChoice("choice-scene-3", FLASH, { source: "beat", grid: 3 });
    expect(getDriveChoice("choice-scene-3", FLASH)).toEqual({ source: "beat", grid: 3 });
  });

  it("round-trips a line choice", () => {
    setDriveChoice("choice-scene-4", SPARKLE, { source: "line" });
    expect(getDriveChoice("choice-scene-4", SPARKLE)).toEqual({ source: "line" });
  });

  it("resetDriveChoice returns to spec.drive.default", () => {
    setDriveChoice("choice-scene-5", FLASH, "anim.mid");
    resetDriveChoice("choice-scene-5", FLASH);
    expect(getDriveChoice("choice-scene-5", FLASH)).toBe("feature.onset");
  });

  it("keeps two settings on the same scene independent", () => {
    setDriveChoice("choice-scene-6", FLASH, "anim.mid");
    setDriveChoice("choice-scene-6", SPARKLE, { source: "line" });
    expect(getDriveChoice("choice-scene-6", FLASH)).toBe("anim.mid");
    expect(getDriveChoice("choice-scene-6", SPARKLE)).toEqual({ source: "line" });
  });

  it("doesn't leak between scenes", () => {
    setDriveChoice("choice-scene-7a", FLASH, "anim.lowOnset");
    setDriveChoice("choice-scene-7b", FLASH, "anim.highOnset");
    expect(getDriveChoice("choice-scene-7a", FLASH)).toBe("anim.lowOnset");
    expect(getDriveChoice("choice-scene-7b", FLASH)).toBe("anim.highOnset");
  });
});

describe("driveStore: getDriveSetting/setDriveSetting — the patch API", () => {
  it("defaults to defaultDriveSetting(spec) for a setting that's never been touched", () => {
    expect(getDriveSetting("setting-scene-1", FLASH)).toEqual(driveSettingFromChoice("feature.onset"));
    expect(getDriveSetting("setting-scene-1", SPARKLE)).toBe("scene");
  });

  it("round-trips a real multi-source patch", () => {
    const patch: DrivePatch = {
      mix: "gate",
      sources: [
        { choice: "anim.lowOnset", weight: 1.5, height: "fixed" },
        { choice: "anim.mid", weight: 0.6 },
      ],
    };
    setDriveSetting("setting-scene-2", FLASH, patch);
    expect(getDriveSetting("setting-scene-2", FLASH)).toEqual(patch);
  });

  it("getDriveChoice/setDriveChoice (the Revision-3 picker shim) and getDriveSetting/setDriveSetting agree on a one-source patch", () => {
    setDriveChoice("setting-scene-3", FLASH, "anim.highOnset");
    expect(getDriveSetting("setting-scene-3", FLASH)).toEqual(driveSettingFromChoice("anim.highOnset"));

    setDriveSetting("setting-scene-4", FLASH, driveSettingFromChoice("anim.mid"));
    expect(getDriveChoice("setting-scene-4", FLASH)).toBe("anim.mid");
  });

  it("resetDriveSetting (and its resetDriveChoice alias) return to spec.drive.default", () => {
    setDriveSetting("setting-scene-5", FLASH, { mix: "max", sources: [{ choice: "anim.mid", weight: 1 }] });
    resetDriveSetting("setting-scene-5", FLASH);
    expect(getDriveSetting("setting-scene-5", FLASH)).toEqual(driveSettingFromChoice("feature.onset"));

    setDriveChoice("setting-scene-6", FLASH, "anim.mid");
    resetDriveChoice("setting-scene-6", FLASH);
    expect(getDriveChoice("setting-scene-6", FLASH)).toBe("feature.onset");
  });

});

describe("driveStore: sanitizeDriveSetting / encodeDriveSetting", () => {
  it("accepts a bare DriveChoice, including scene", () => {
    expect(sanitizeDriveSetting("anim.lowOnset")).toEqual(driveSettingFromChoice("anim.lowOnset"));
    expect(sanitizeDriveSetting("scene")).toBe("scene");
    expect(sanitizeDriveSetting({ source: "beat", grid: 3 })).toEqual(driveSettingFromChoice({ source: "beat", grid: 3 }));
  });

  it("accepts a compact {m,s} patch and clamps an out-of-range weight rather than rejecting it", () => {
    const sanitized = sanitizeDriveSetting({ m: "add", s: [{ c: "anim.mid", w: 9 }] });
    expect(sanitized).toEqual({ mix: "add", sources: [{ choice: "anim.mid", weight: 2 }] });
  });

  it("rejects a garbage mix, a malformed source, or an unknown height", () => {
    expect(sanitizeDriveSetting({ m: "nonsense", s: [{ c: "anim.mid" }] })).toBeNull();
    expect(sanitizeDriveSetting({ m: "add", s: [{ c: "not-a-real-signal" }] })).toBeNull();
    expect(sanitizeDriveSetting({ m: "add", s: [{ c: "anim.mid", h: "wrong" }] })).toBeNull();
    expect(sanitizeDriveSetting(42)).toBeNull();
    expect(sanitizeDriveSetting(null)).toBeNull();
  });

  it("encodeDriveSetting/sanitizeDriveSetting round-trip through the compact wire shape", () => {
    const patch: DrivePatch = {
      mix: "max",
      sources: [
        { choice: "anim.lowOnset", weight: 0.5, height: "loud" },
        { choice: { source: "beat", grid: 2 }, weight: 1 },
      ],
    };
    expect(sanitizeDriveSetting(encodeDriveSetting(patch))).toEqual(patch);
  });

  it("encodeDriveSetting prefers the bare-choice form for the identity one-source/weight-1/Graded shape", () => {
    expect(encodeDriveSetting(driveSettingFromChoice("anim.lowOnset"))).toBe("anim.lowOnset");
    expect(encodeDriveSetting("scene")).toBe("scene");
  });
});

describe("driveStore: patch-editing helpers (togglePatchSource, setSourceWeight, setSourceHeight, setSourceGrid, setPatchMix)", () => {
  // SPARKLE (not FLASH) throughout — its own drive.default is "scene", so
  // toggling the first source builds a fresh one-source patch rather than
  // adding alongside FLASH's own already-present Beat default.
  it("togglePatchSource adds then removes a source, landing back on scene when empty", () => {
    const sceneId = "patch-helper-1";
    togglePatchSource(sceneId, SPARKLE, "anim.lowOnset");
    expect(getDriveSetting(sceneId, SPARKLE)).toEqual(driveSettingFromChoice("anim.lowOnset"));
    togglePatchSource(sceneId, SPARKLE, "anim.lowOnset");
    expect(getDriveSetting(sceneId, SPARKLE)).toBe("scene");
  });

  it("setSourceWeight/setSourceHeight edit one source in place", () => {
    const sceneId = "patch-helper-2";
    togglePatchSource(sceneId, SPARKLE, "anim.lowOnset");
    setSourceWeight(sceneId, SPARKLE, "anim.lowOnset", 1.5);
    setSourceHeight(sceneId, SPARKLE, "anim.lowOnset", "fixed");
    expect(getDriveSetting(sceneId, SPARKLE)).toEqual({ mix: "add", sources: [{ choice: "anim.lowOnset", weight: 1.5, height: "fixed" }] });
  });

  it("setSourceGrid re-grids the patch's own grid source", () => {
    const sceneId = "patch-helper-3";
    togglePatchSource(sceneId, SPARKLE, { source: "beat", grid: 2 });
    setSourceGrid(sceneId, SPARKLE, 4);
    expect(getDriveSetting(sceneId, SPARKLE)).toEqual(driveSettingFromChoice({ source: "beat", grid: 4 }));
  });

  it("setPatchMix changes the mix without touching the sources", () => {
    const sceneId = "patch-helper-4";
    togglePatchSource(sceneId, SPARKLE, "anim.lowOnset");
    togglePatchSource(sceneId, SPARKLE, "anim.mid");
    setPatchMix(sceneId, SPARKLE, "max");
    const setting = getDriveSetting(sceneId, SPARKLE);
    expect(setting).not.toBe("scene");
    if (setting === "scene") throw new Error("unreachable");
    expect(setting.mix).toBe("max");
    expect(setting.sources).toHaveLength(2);
  });

  it("togglePatchSource on a setting already at a non-scene default adds alongside it, not in place of it", () => {
    const sceneId = "patch-helper-5";
    // FLASH's own default is plain Beat ("feature.onset"), not "scene" —
    // the first toggle here has to add a second source next to it.
    togglePatchSource(sceneId, FLASH, "anim.lowOnset");
    const setting = getDriveSetting(sceneId, FLASH);
    expect(setting).not.toBe("scene");
    if (setting === "scene") throw new Error("unreachable");
    expect(setting.sources.map((s) => s.choice)).toEqual(["feature.onset", "anim.lowOnset"]);
  });
});

describe("driveStore: line", () => {
  it("a setting that's never been drawn on reads as the undrawn default (flat top)", () => {
    const line = getDriveLine("line-scene-1", FLASH);
    for (let b = 0; b < NUM_BANDS; b++) expect(line[b]).toBe(LINE_HEIGHT_DEFAULT);
  });

  it("setDriveLineBand stores each band independently and clamps", () => {
    setDriveLineBand("line-scene-2", FLASH, 0, 1.5);
    setDriveLineBand("line-scene-2", FLASH, 5, -1);
    setDriveLineBand("line-scene-2", FLASH, 10, 0.4);
    const line = getDriveLine("line-scene-2", FLASH);
    expect(line[0]).toBe(1);
    expect(line[5]).toBe(0);
    expect(line[10]).toBeCloseTo(0.4);
  });

  it("setDriveLine round-trips a whole line", () => {
    const heights = Array.from({ length: NUM_BANDS }, (_, i) => i / NUM_BANDS);
    setDriveLine("line-scene-3", FLASH, heights);
    const line = getDriveLine("line-scene-3", FLASH);
    for (let b = 0; b < NUM_BANDS; b++) expect(line[b]).toBeCloseTo(heights[b] as number);
  });

  it("resetDriveLine returns to the undrawn default", () => {
    setDriveLineBand("line-scene-4", FLASH, 4, 0.8);
    resetDriveLine("line-scene-4", FLASH);
    const line = getDriveLine("line-scene-4", FLASH);
    for (let b = 0; b < NUM_BANDS; b++) expect(line[b]).toBe(LINE_HEIGHT_DEFAULT);
  });

  it("two drive settings on the same scene each draw their own line", () => {
    setDriveLineBand("line-scene-5", FLASH, 2, 0.9);
    setDriveLineBand("line-scene-5", SPARKLE, 2, 0.1);
    expect(getDriveLine("line-scene-5", FLASH)[2]).toBeCloseTo(0.9);
    expect(getDriveLine("line-scene-5", SPARKLE)[2]).toBeCloseTo(0.1);
  });

  it("getDriveLine writes into the caller's array when given one", () => {
    const mine = new Float32Array(NUM_BANDS);
    expect(getDriveLine("line-scene-6", FLASH, mine)).toBe(mine);
  });
});

describe("driveStore: line strength", () => {
  it("defaults to LINE_STRENGTH_DEFAULT for an untouched setting", () => {
    expect(getDriveLineStrength("strength-scene-1", FLASH)).toBe(LINE_STRENGTH_DEFAULT);
  });

  it("round-trips and clamps to LINE_STRENGTH_MIN/MAX", () => {
    setDriveLineStrength("strength-scene-2", FLASH, 2.5);
    expect(getDriveLineStrength("strength-scene-2", FLASH)).toBe(2.5);
    setDriveLineStrength("strength-scene-2", FLASH, 999);
    expect(getDriveLineStrength("strength-scene-2", FLASH)).toBe(LINE_STRENGTH_MAX);
    setDriveLineStrength("strength-scene-2", FLASH, -1);
    expect(getDriveLineStrength("strength-scene-2", FLASH)).toBe(LINE_STRENGTH_MIN);
  });

  it("resetDriveLineStrength returns to the default", () => {
    setDriveLineStrength("strength-scene-3", FLASH, 3);
    resetDriveLineStrength("strength-scene-3", FLASH);
    expect(getDriveLineStrength("strength-scene-3", FLASH)).toBe(LINE_STRENGTH_DEFAULT);
  });
});

describe("driveStore with a stubbed localStorage", () => {
  // The legacy-grid snapshot and this store's own cache are both seeded once
  // at module load — so exercising "what's in storage at first import" means
  // installing a fake localStorage *before* a fresh import of the module,
  // via vi.resetModules(), same recipe as tests/bandLine.test.ts's old
  // stubbed-localStorage block (and tests/sensitivity.test.ts's legacy-key
  // migration tests).
  function makeFakeLocalStorage() {
    const store = new Map<string, string>();
    return {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      raw: store,
    };
  }

  const originalLocalStorage = (globalThis as { localStorage?: unknown }).localStorage;

  afterEach(() => {
    (globalThis as { localStorage?: unknown }).localStorage = originalLocalStorage;
    vi.resetModules();
  });

  it("migrates a scene's legacy non-Hits beat grid onto a Beat-default drive setting, once, persisting it", async () => {
    const fake = makeFakeLocalStorage();
    // Index 3 = "1 bar" (src/audio/beatGrid.ts's BEAT_GRIDS) — a real user
    // had picked something other than Hits for this scene's old, single,
    // per-scene grid.
    fake.setItem("vibe.beatGrid", JSON.stringify({ caustics: 3 }));
    (globalThis as { localStorage?: unknown }).localStorage = fake;

    vi.resetModules();
    const fresh = await import("../src/render/driveStore.ts");

    const choice = fresh.getDriveChoice("caustics", FLASH);
    expect(choice).toEqual({ source: "beat", grid: 3 });

    // Persisted — a second read doesn't just recompute the same migration,
    // it comes back from the new store's own cache.
    const again = fresh.getDriveChoice("caustics", FLASH);
    expect(again).toEqual({ source: "beat", grid: 3 });
    const persisted = JSON.parse(fake.raw.get("vibe.drives") ?? "{}");
    // The migration writes through setDriveSetting, so it lands in the
    // current `patch` field (encodeDriveSetting's compact wire shape), not
    // the legacy `choice` field — a one-source patch on a grid choice still
    // encodes as the bare choice object (see driveStore.ts's own header).
    expect(persisted.caustics?.flash?.patch).toEqual({ source: "beat", grid: 3 });
  });

  it("never migrates a setting whose default isn't the plain Beat catalogue choice", async () => {
    const fake = makeFakeLocalStorage();
    fake.setItem("vibe.beatGrid", JSON.stringify({ caustics: 3 }));
    (globalThis as { localStorage?: unknown }).localStorage = fake;

    vi.resetModules();
    const fresh = await import("../src/render/driveStore.ts");

    expect(fresh.getDriveChoice("caustics", SPARKLE)).toBe("scene");
  });

  it("never migrates a scene whose legacy grid was already Hits (index 0)", async () => {
    const fake = makeFakeLocalStorage();
    fake.setItem("vibe.beatGrid", JSON.stringify({ caustics: 0 }));
    (globalThis as { localStorage?: unknown }).localStorage = fake;

    vi.resetModules();
    const fresh = await import("../src/render/driveStore.ts");

    expect(fresh.getDriveChoice("caustics", FLASH)).toBe("feature.onset");
  });

  it("an explicitly stored choice always wins over the legacy migration", async () => {
    const fake = makeFakeLocalStorage();
    fake.setItem("vibe.beatGrid", JSON.stringify({ caustics: 3 }));
    fake.setItem("vibe.drives", JSON.stringify({ caustics: { flash: { choice: "anim.highOnset" } } }));
    (globalThis as { localStorage?: unknown }).localStorage = fake;

    vi.resetModules();
    const fresh = await import("../src/render/driveStore.ts");

    expect(fresh.getDriveChoice("caustics", FLASH)).toBe("anim.highOnset");
  });

  it("a garbage stored choice (foreign shape) falls back to the migration or the default rather than throwing", async () => {
    const fake = makeFakeLocalStorage();
    fake.setItem("vibe.drives", JSON.stringify({ "garbage-scene": { flash: { choice: { source: "not-real" } } } }));
    (globalThis as { localStorage?: unknown }).localStorage = fake;

    vi.resetModules();
    const fresh = await import("../src/render/driveStore.ts");

    expect(fresh.getDriveChoice("garbage-scene", FLASH)).toBe("feature.onset");
  });

  it("an entry written before this store had patches (bare `choice`, no `patch`) still reads back as its one-source patch", async () => {
    const fake = makeFakeLocalStorage();
    fake.setItem("vibe.drives", JSON.stringify({ "legacy-choice-scene": { flash: { choice: "anim.highOnset" } } }));
    (globalThis as { localStorage?: unknown }).localStorage = fake;

    vi.resetModules();
    const fresh = await import("../src/render/driveStore.ts");
    const drivesFresh = await import("../src/render/drives.ts");

    expect(fresh.getDriveSetting("legacy-choice-scene", FLASH)).toEqual(drivesFresh.driveSettingFromChoice("anim.highOnset"));
    expect(fresh.getDriveChoice("legacy-choice-scene", FLASH)).toBe("anim.highOnset");

    // A fresh write (through either API) supersedes the legacy field —
    // it never reappears once `patch` exists.
    fresh.setDriveChoice("legacy-choice-scene", FLASH, "anim.mid");
    const persisted = JSON.parse(fake.raw.get("vibe.drives") ?? "{}");
    expect(persisted["legacy-choice-scene"].flash.choice).toBeUndefined();
    expect(persisted["legacy-choice-scene"].flash.patch).toBe("anim.mid");
  });

  it("a garbage stored line falls back to the undrawn default", async () => {
    const fake = makeFakeLocalStorage();
    fake.setItem("vibe.drives", JSON.stringify({ "garbage-scene-2": { flash: { line: [0.1, 0.2] } } })); // wrong length
    (globalThis as { localStorage?: unknown }).localStorage = fake;

    vi.resetModules();
    const fresh = await import("../src/render/driveStore.ts");

    const line = fresh.getDriveLine("garbage-scene-2", FLASH);
    for (let b = 0; b < NUM_BANDS; b++) expect(line[b]).toBe(LINE_HEIGHT_DEFAULT);
  });
});
