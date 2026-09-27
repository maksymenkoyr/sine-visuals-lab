import { describe, it, expect, afterEach, vi } from "vitest";
import { causticsScene } from "../src/render/scenes/caustics.ts";
import {
  getSceneMaster,
  getSceneSetting,
  SCENE_MASTER_DEFAULT,
  SCENE_MASTER_MAX,
  SCENE_MASTER_MIN,
  setSceneMaster,
  setSceneSetting,
  type SceneSetting,
} from "../src/render/sceneSettings.ts";
import {
  advanceAutoTune,
  computeMacroTarget,
  resolveSceneSetting,
  resolveSensitivity,
  setAutoEnabled,
  SENSITIVITY_AUTO_KEY,
} from "../src/render/autoTune.ts";
import { setSensitivity } from "../src/audio/sensitivity.ts";
import { NEUTRAL } from "../src/render/musicProfile.ts";
import { clearAllPins, setPin } from "../src/tuning/pins.ts";

// The device-wide scene master: raw multiply at resolveSceneSetting, once,
// on the final resolved value — see resolveSceneSetting's own doc and
// sceneSettings.ts's store for the rules these tests pin down.

const NUMERIC: SceneSetting = { key: "amt", label: "Amount", min: 0, max: 1, step: 0.05, default: 0.5 };
const AUTO_SPEC: SceneSetting = {
  key: "amtAuto",
  label: "Amount",
  min: 0,
  max: 1,
  step: 0.05,
  default: 0.5,
  auto: { tempo: 0.4 },
};
const ENUM_SPEC: SceneSetting = {
  key: "style",
  label: "Style",
  min: 0,
  max: 2,
  step: 1,
  default: 0,
  type: "enum",
  options: ["A", "B", "C"],
};
const BOOL_SPEC: SceneSetting = { key: "glow", label: "Glow", min: 0, max: 1, step: 1, default: 1, type: "boolean" };

afterEach(() => {
  setSceneMaster(SCENE_MASTER_DEFAULT);
  clearAllPins();
});

describe("scene master store", () => {
  it("starts at the identity default", () => {
    expect(getSceneMaster()).toBe(SCENE_MASTER_DEFAULT);
  });

  it("clamps into [min, max] on write", () => {
    setSceneMaster(5);
    expect(getSceneMaster()).toBe(SCENE_MASTER_MAX);
    setSceneMaster(-1);
    expect(getSceneMaster()).toBe(SCENE_MASTER_MIN);
  });

  it("falls back to the identity default for non-finite input", () => {
    setSceneMaster(NaN);
    expect(getSceneMaster()).toBe(SCENE_MASTER_DEFAULT);
    setSceneMaster(Infinity);
    expect(getSceneMaster()).toBe(SCENE_MASTER_DEFAULT);
  });
});

describe("resolveSceneSetting applies the master", () => {
  it("is bit-for-bit identity at master 1", () => {
    const sceneId = "master-identity";
    setSceneSetting(sceneId, NUMERIC, 0.8);
    setSceneMaster(1);
    expect(resolveSceneSetting(sceneId, NUMERIC)).toBe(0.8);
  });

  it("multiplies a manual value raw", () => {
    const sceneId = "master-manual";
    setAutoEnabled(sceneId, NUMERIC.key, false);
    setSceneSetting(sceneId, NUMERIC, 0.8);
    setSceneMaster(0.5);
    expect(resolveSceneSetting(sceneId, NUMERIC)).toBe(0.4);
  });

  it("clamps the product back into the spec's own [min, max]", () => {
    const sceneId = "master-clamp";
    setAutoEnabled(sceneId, NUMERIC.key, false);
    setSceneSetting(sceneId, NUMERIC, 0.9);
    setSceneMaster(2);
    expect(resolveSceneSetting(sceneId, NUMERIC)).toBe(NUMERIC.max);
  });

  it("floors to the spec's min at master 0", () => {
    const sceneId = "master-zero";
    setAutoEnabled(sceneId, NUMERIC.key, false);
    setSceneSetting(sceneId, NUMERIC, 0.8);
    setSceneMaster(0);
    expect(resolveSceneSetting(sceneId, NUMERIC)).toBe(NUMERIC.min);
  });

  it("scales an auto-resolved value too", () => {
    const sceneId = "master-auto";
    setAutoEnabled(sceneId, AUTO_SPEC.key, true);
    advanceAutoTune(1, { ...NEUTRAL, tempo: 1 }); // pulls well off the default
    setSceneMaster(1);
    const atOne = resolveSceneSetting(sceneId, AUTO_SPEC);
    expect(atOne).not.toBe(AUTO_SPEC.default); // sanity: auto really moved it
    setSceneMaster(0.5);
    expect(resolveSceneSetting(sceneId, AUTO_SPEC)).toBe(atOne * 0.5);
  });

  it("leaves an enum's chip index alone", () => {
    const sceneId = "master-enum";
    setSceneSetting(sceneId, ENUM_SPEC, 1);
    setSceneMaster(2);
    expect(resolveSceneSetting(sceneId, ENUM_SPEC)).toBe(1);
  });

  it("leaves a boolean alone", () => {
    const sceneId = "master-bool";
    setSceneSetting(sceneId, BOOL_SPEC, 1);
    setSceneMaster(0);
    expect(resolveSceneSetting(sceneId, BOOL_SPEC)).toBe(1);
  });

  it("does not reach the Input card's Sensitivity/Expansion/Smoothing", () => {
    const sceneId = "master-sensitivity";
    setAutoEnabled(sceneId, SENSITIVITY_AUTO_KEY, false);
    setSensitivity(sceneId, 1.5);
    setSceneMaster(2);
    expect(resolveSensitivity(sceneId)).toBe(1.5);
  });

  it("leaves a DEV pin untouched — an out-of-range typed value must survive", () => {
    const sceneId = "master-pin";
    setAutoEnabled(sceneId, NUMERIC.key, false);
    setSceneSetting(sceneId, NUMERIC, 0.9);
    setPin(sceneId, NUMERIC.key, 0.9);
    setSceneMaster(0.5);
    expect(resolveSceneSetting(sceneId, NUMERIC)).toBe(0.9);
    clearAllPins();
    expect(resolveSceneSetting(sceneId, NUMERIC)).toBe(0.45);
  });
});

describe("macro groups are scaled exactly once", () => {
  // Caustics' Sparkle group: SPARKLE is the driver, sparkleSpread a macro
  // sub-param following it. A naive master (scaling inside the public
  // resolve, including the driver read resolve() does for the displacement)
  // would compound across the relationship — the regression this pins down.
  const sparkle = causticsScene.settings!.find((s) => s.key === "sparkle")!;
  const spread = causticsScene.settings!.find((s) => s.key === "sparkleSpread")!;
  const sceneId = "caustics";

  it("scales the driver's displacement once, not twice", () => {
    setAutoEnabled(sceneId, sparkle.key, false);
    setSceneSetting(sceneId, sparkle, 0.9);
    setAutoEnabled(sceneId, spread.key, true);
    setSceneMaster(0.5);
    const resolved = resolveSceneSetting(sceneId, spread);
    // Displacement computed off the *unscaled* driver, then scaled once.
    const expected = computeMacroTarget(spread, 0.9, spread.default, sparkle.default) * 0.5;
    expect(resolved).toBeCloseTo(expected, 10);
    // What double-scaling would produce instead — keep the two apart.
    const doubleScaled = computeMacroTarget(spread, 0.9 * 0.5, spread.default, sparkle.default) * 0.5;
    expect(Math.abs(resolved - doubleScaled)).toBeGreaterThan(0.01);
  });

  it("driver and sub-param each come out scaled exactly once at master 1 (identity)", () => {
    setAutoEnabled(sceneId, sparkle.key, false);
    setSceneSetting(sceneId, sparkle, 0.9);
    setAutoEnabled(sceneId, spread.key, true);
    setSceneMaster(1);
    expect(resolveSceneSetting(sceneId, sparkle)).toBe(getSceneSetting(sceneId, sparkle));
    expect(resolveSceneSetting(sceneId, spread)).toBeCloseTo(
      computeMacroTarget(spread, 0.9, spread.default, sparkle.default),
      10,
    );
  });
});

// Last: exercises module-load seeding, so it re-imports a fresh copy of the
// module and must not run before the in-memory tests above share the original.
describe("scene master persistence", () => {
  const originalLocalStorage = (globalThis as { localStorage?: unknown }).localStorage;

  afterEach(() => {
    (globalThis as { localStorage?: unknown }).localStorage = originalLocalStorage;
    vi.resetModules();
  });

  it("seeds from a stored value and writes back on set", async () => {
    const fake = { getItem: vi.fn(() => "1.5"), setItem: vi.fn() };
    (globalThis as { localStorage?: unknown }).localStorage = fake;
    vi.resetModules();
    const fresh = await import("../src/render/sceneSettings.ts");
    expect(fresh.getSceneMaster()).toBe(1.5);
    fresh.setSceneMaster(0.25);
    expect(fake.setItem).toHaveBeenCalledWith("vibe.sceneMaster", "0.25");
  });

  it("an absent key means the identity default, not zero", async () => {
    const fake = { getItem: vi.fn(() => null), setItem: vi.fn() };
    (globalThis as { localStorage?: unknown }).localStorage = fake;
    vi.resetModules();
    const fresh = await import("../src/render/sceneSettings.ts");
    expect(fresh.getSceneMaster()).toBe(SCENE_MASTER_DEFAULT);
  });

  it("a corrupt stored value falls back to the identity default", async () => {
    const fake = { getItem: vi.fn(() => "not-a-number"), setItem: vi.fn() };
    (globalThis as { localStorage?: unknown }).localStorage = fake;
    vi.resetModules();
    const fresh = await import("../src/render/sceneSettings.ts");
    expect(fresh.getSceneMaster()).toBe(SCENE_MASTER_DEFAULT);
  });

  it("works with no localStorage global at all", async () => {
    (globalThis as { localStorage?: unknown }).localStorage = undefined;
    vi.resetModules();
    const fresh = await import("../src/render/sceneSettings.ts");
    expect(fresh.getSceneMaster()).toBe(SCENE_MASTER_DEFAULT);
    expect(() => fresh.setSceneMaster(1.5)).not.toThrow();
    expect(fresh.getSceneMaster()).toBe(1.5);
  });
});