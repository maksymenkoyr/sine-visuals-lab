import { describe, it, expect, vi, afterEach } from "vitest";
import {
  getDriveChoice,
  setDriveChoice,
  resetDriveChoice,
  getDriveLine,
  setDriveLineBand,
  setDriveLine,
  resetDriveLine,
  getDriveLineStrength,
  setDriveLineStrength,
  resetDriveLineStrength,
} from "../src/render/driveStore.ts";
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
    expect(persisted.caustics?.flash?.choice).toEqual({ source: "beat", grid: 3 });
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
