import { describe, it, expect, afterEach } from "vitest";
import { causticsScene } from "../src/render/scenes/caustics.ts";
import { meshGridScene } from "../src/render/scenes/meshGrid.ts";
import { setSceneSetting, type SceneSetting } from "../src/render/sceneSettings.ts";
import { NEUTRAL } from "../src/render/musicProfile.ts";
import {
  advanceAutoTune,
  resolveSceneSetting,
  resolveSensitivity,
  resolveAcceleration,
  resolveSmoothing,
  getSensitivitySpec,
  getAccelerationSpec,
  getSmoothingSpec,
  setAutoEnabled,
} from "../src/render/autoTune.ts";
import { clearAllOverrides, clearOverride, getOverride, isAutoPinned, setAutoPinned, setOverride } from "../src/tuning/overrides.ts";

afterEach(() => {
  clearAllOverrides();
  setAutoPinned(false);
});

const ALL_SETTINGS: SceneSetting[] = [
  ...(causticsScene.settings ?? []),
  ...(meshGridScene.settings ?? []),
  getSensitivitySpec(),
  getAccelerationSpec(),
  getSmoothingSpec(),
];

describe("overrides map", () => {
  it("getOverride returns undefined until set, then the set value", () => {
    expect(getOverride("scene-ov-1", "amplitude")).toBeUndefined();
    setOverride("scene-ov-1", "amplitude", 1.5);
    expect(getOverride("scene-ov-1", "amplitude")).toBe(1.5);
  });

  it("clearOverride removes exactly the one key", () => {
    setOverride("scene-ov-2", "a", 1);
    setOverride("scene-ov-2", "b", 2);
    clearOverride("scene-ov-2", "a");
    expect(getOverride("scene-ov-2", "a")).toBeUndefined();
    expect(getOverride("scene-ov-2", "b")).toBe(2);
  });

  it("clearAllOverrides drops every key regardless of scene", () => {
    setOverride("scene-ov-3", "a", 1);
    setOverride("scene-ov-4", "b", 2);
    clearAllOverrides();
    expect(getOverride("scene-ov-3", "a")).toBeUndefined();
    expect(getOverride("scene-ov-4", "b")).toBeUndefined();
  });

  it("setAutoPinned/isAutoPinned round-trip", () => {
    expect(isAutoPinned()).toBe(false);
    setAutoPinned(true);
    expect(isAutoPinned()).toBe(true);
  });
});

describe("override wins over resolve()", () => {
  const SPEC: SceneSetting = { key: "drift", label: "Drift", min: 0, max: 1, step: 0.05, default: 0.5, auto: { tempo: 0.4 } };

  it("an active override beats both the manual store and an auto target", () => {
    const sceneId = "scene-ovres-1";
    setSceneSetting(sceneId, SPEC, 0.9);
    advanceAutoTune(1, { ...NEUTRAL, tempo: 1 }); // would push well away from 0.9 or the override if either were used
    setOverride(sceneId, SPEC.key, 0.13);
    expect(resolveSceneSetting(sceneId, SPEC)).toBe(0.13);
  });

  it("clearing the override falls back exactly to the manual value that was there before", () => {
    const sceneId = "scene-ovres-2";
    setAutoEnabled(sceneId, SPEC.key, false); // isolate this test from auto's music-driven target
    setSceneSetting(sceneId, SPEC, 0.42);
    setOverride(sceneId, SPEC.key, 0.99);
    expect(resolveSceneSetting(sceneId, SPEC)).toBe(0.99);
    clearOverride(sceneId, SPEC.key);
    expect(resolveSceneSetting(sceneId, SPEC)).toBeCloseTo(0.42);
  });

  it("auto pin bypasses computeAutoTarget entirely, returning the manual value even with no explicit override set", () => {
    const sceneId = "scene-ovres-3";
    setSceneSetting(sceneId, SPEC, 0.77);
    advanceAutoTune(1, { ...NEUTRAL, tempo: 1 }); // strong auto pull away from 0.77
    const unpinned = resolveSceneSetting(sceneId, SPEC);
    expect(unpinned).not.toBeCloseTo(0.77, 2); // sanity: auto really was pulling it away

    setAutoPinned(true);
    expect(resolveSceneSetting(sceneId, SPEC)).toBeCloseTo(0.77);
  });

  it("an override on one (scene, key) pair does not leak to another", () => {
    setOverride("scene-ovres-4", SPEC.key, 0.2);
    expect(getOverride("scene-ovres-5", SPEC.key)).toBeUndefined();
  });
});

describe("regression: inert when no overrides are active", () => {
  // The property that matters most — with the tuning layer completely
  // unused (no overrides, no pin), resolveSceneSetting/resolveSensitivity/
  // resolveAcceleration/resolveSmoothing must behave exactly as they did
  // before tuning/overrides.ts existed, for every real setting on the two
  // scenes the workflow targets first.
  it.each(ALL_SETTINGS.map((s) => [s.label, s] as const))(
    "resolveSceneSetting(%s) matches manual value with auto off and no override",
    (_label, spec) => {
      const sceneId = `scene-regress-${spec.key}`;
      setSceneSetting(sceneId, spec, spec.default);
      advanceAutoTune(1, NEUTRAL);
      expect(getOverride(sceneId, spec.key)).toBeUndefined();
      expect(isAutoPinned()).toBe(false);
      expect(resolveSceneSetting(sceneId, spec)).toBeCloseTo(spec.default, 10);
    },
  );

  it("resolveSensitivity/Acceleration/Smoothing are untouched when no override or pin is active", () => {
    const sceneId = "scene-regress-pseudo";
    advanceAutoTune(1, NEUTRAL);
    expect(resolveSensitivity(sceneId)).toBeCloseTo(getSensitivitySpec().default, 10);
    expect(resolveAcceleration(sceneId)).toBeCloseTo(getAccelerationSpec().default, 10);
    expect(resolveSmoothing(sceneId)).toBeCloseTo(getSmoothingSpec().default, 10);
  });
});
