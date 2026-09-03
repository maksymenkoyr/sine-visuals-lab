import { describe, it, expect, afterEach } from "vitest";
import { causticsScene } from "../src/render/scenes/caustics.ts";
import { meshGridScene } from "../src/render/scenes/meshGrid.ts";
import { stormScene } from "../src/render/scenes/storm.ts";
import { setSceneSetting, type SceneSetting } from "../src/render/sceneSettings.ts";
import { NEUTRAL } from "../src/render/musicProfile.ts";
import {
  advanceAutoTune,
  resolveSceneSetting,
  resolveSensitivity,
  resolveExpansion,
  resolveSmoothing,
  getSensitivitySpec,
  getExpansionSpec,
  getSmoothingSpec,
  setAutoEnabled,
} from "../src/render/autoTune.ts";
import { clearAllOverrides, clearOverride, getOverride, isAutoPinned, setAutoPinned, setOverride } from "../src/tuning/overrides.ts";
import { clearAllPins, getPin, setPin } from "../src/tuning/pins.ts";

afterEach(() => {
  clearAllOverrides();
  setAutoPinned(false);
  clearAllPins();
});

const ALL_SETTINGS: SceneSetting[] = [
  ...(causticsScene.settings ?? []),
  ...(meshGridScene.settings ?? []),
  ...(stormScene.settings ?? []),
  getSensitivitySpec(),
  getExpansionSpec(),
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

describe("pin vs. override precedence", () => {
  const SPEC: SceneSetting = { key: "drift", label: "Drift", min: 0, max: 1, step: 0.05, default: 0.5, auto: { tempo: 0.4 } };

  it("a pin beats both the manual store and an auto target, same as an override", () => {
    const sceneId = "scene-pinres-1";
    setSceneSetting(sceneId, SPEC, 0.9);
    advanceAutoTune(1, { ...NEUTRAL, tempo: 1 }); // would push well away from 0.9 or the pin if either were used
    setPin(sceneId, SPEC.key, 4.2); // outside SPEC's 0..1 range — the whole point of a pin
    expect(resolveSceneSetting(sceneId, SPEC)).toBe(4.2);
  });

  it("clearing a pin falls back exactly to the manual value that was there before", () => {
    const sceneId = "scene-pinres-2";
    setAutoEnabled(sceneId, SPEC.key, false); // isolate this test from auto's music-driven target
    setSceneSetting(sceneId, SPEC, 0.42);
    setPin(sceneId, SPEC.key, 99);
    expect(resolveSceneSetting(sceneId, SPEC)).toBe(99);
    clearAllPins();
    expect(resolveSceneSetting(sceneId, SPEC)).toBeCloseTo(0.42);
  });

  it("a file override wins over a pin — a stale pin can never shadow a key a scripted push explicitly sets", () => {
    const sceneId = "scene-pinres-3";
    setPin(sceneId, SPEC.key, 4.2);
    setOverride(sceneId, SPEC.key, 0.13);
    expect(resolveSceneSetting(sceneId, SPEC)).toBe(0.13);
  });

  it("auto pin still beats a plain manual value once no pin or override is active", () => {
    const sceneId = "scene-pinres-4";
    setSceneSetting(sceneId, SPEC, 0.77);
    advanceAutoTune(1, { ...NEUTRAL, tempo: 1 });
    setAutoPinned(true);
    expect(resolveSceneSetting(sceneId, SPEC)).toBeCloseTo(0.77);
  });

  it("a pin on one (scene, key) pair does not leak to another", () => {
    setPin("scene-pinres-5", SPEC.key, 4.2);
    expect(getPin("scene-pinres-6", SPEC.key)).toBeUndefined();
  });
});

describe("regression: inert when no overrides or pins are active", () => {
  // The property that matters most — with the tuning layer completely
  // unused (no overrides, no pins, no auto-pin), resolveSceneSetting/
  // resolveSensitivity/resolveExpansion/resolveSmoothing must behave
  // exactly as they did before tuning/overrides.ts and tuning/pins.ts
  // existed, for every real setting on the two scenes the workflow targets
  // first.
  it.each(ALL_SETTINGS.map((s, i) => [s.label, s, i] as const))(
    "resolveSceneSetting(%s) matches manual value with auto off and no override or pin",
    (_label, spec, row) => {
      // One scene id per row rather than per key: two scenes may legitimately
      // use the same key (meshGrid and storm both have a `flow`), and the auto
      // slew is state on the (scene, key) pair — sharing an id would leave
      // this row resolving part-way from the previous row's default.
      const sceneId = `scene-regress-${row}-${spec.key}`;
      setSceneSetting(sceneId, spec, spec.default);
      advanceAutoTune(1, NEUTRAL);
      expect(getOverride(sceneId, spec.key)).toBeUndefined();
      expect(getPin(sceneId, spec.key)).toBeUndefined();
      expect(isAutoPinned()).toBe(false);
      expect(resolveSceneSetting(sceneId, spec)).toBeCloseTo(spec.default, 10);
    },
  );

  it("resolveSensitivity/Expansion/Smoothing are untouched when no override or pin is active", () => {
    const sceneId = "scene-regress-pseudo";
    advanceAutoTune(1, NEUTRAL);
    expect(resolveSensitivity(sceneId)).toBeCloseTo(getSensitivitySpec().default, 10);
    expect(resolveExpansion(sceneId)).toBeCloseTo(getExpansionSpec().default, 10);
    expect(resolveSmoothing(sceneId)).toBeCloseTo(getSmoothingSpec().default, 10);
  });
});
