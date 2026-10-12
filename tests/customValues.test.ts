import { describe, it, expect, afterEach } from "vitest";
import {
  clearAllCustomValues,
  clearCustomValue,
  customReach,
  customValueSnapshot,
  fitCustom,
  getCustomValue,
  getSliderStretch,
  resetCustomValue,
  setCustomValue,
  sliderSpan,
  stretchSlider,
} from "../src/render/customValues.ts";
import { resetSceneSettings, setSceneSetting, type SceneSetting } from "../src/render/sceneSettings.ts";

afterEach(() => {
  clearAllCustomValues();
});

describe("custom values map", () => {
  it("getCustomValue returns undefined until set, then the set value", () => {
    expect(getCustomValue("scene-pin-1", "amplitude")).toBeUndefined();
    setCustomValue("scene-pin-1", "amplitude", 1.5);
    expect(getCustomValue("scene-pin-1", "amplitude")).toBe(1.5);
  });

  // The load-bearing case: this is the one property that distinguishes a pin
  // from sceneSettings.ts's store, whose clamp() would silently clip either
  // of these to a spec's min/max. A pin has no spec at all — nothing here
  // clamps.
  it("round-trips a value far outside any plausible spec range unchanged", () => {
    setCustomValue("scene-pin-huge", "focus", 4.2);
    expect(getCustomValue("scene-pin-huge", "focus")).toBe(4.2);
    setCustomValue("scene-pin-huge", "negative", -999);
    expect(getCustomValue("scene-pin-huge", "negative")).toBe(-999);
  });

  it("rejects non-finite values, leaving any existing pin untouched", () => {
    setCustomValue("scene-pin-nan", "focus", 0.5);
    setCustomValue("scene-pin-nan", "focus", NaN);
    expect(getCustomValue("scene-pin-nan", "focus")).toBe(0.5);
    setCustomValue("scene-pin-nan", "focus", Infinity);
    expect(getCustomValue("scene-pin-nan", "focus")).toBe(0.5);
  });

  it("clearCustomValue removes exactly the one key", () => {
    setCustomValue("scene-pin-2", "a", 1);
    setCustomValue("scene-pin-2", "b", 2);
    clearCustomValue("scene-pin-2", "a");
    expect(getCustomValue("scene-pin-2", "a")).toBeUndefined();
    expect(getCustomValue("scene-pin-2", "b")).toBe(2);
  });

  it("clearCustomValue on a key that was never set is a no-op", () => {
    expect(() => clearCustomValue("scene-pin-missing", "nope")).not.toThrow();
  });

  it("clearAllCustomValues drops every key regardless of scene", () => {
    setCustomValue("scene-pin-3", "a", 1);
    setCustomValue("scene-pin-4", "b", 2);
    clearAllCustomValues();
    expect(getCustomValue("scene-pin-3", "a")).toBeUndefined();
    expect(getCustomValue("scene-pin-4", "b")).toBeUndefined();
  });

  it("keeps different keys within the same scene independent", () => {
    setCustomValue("scene-pin-5", "focus", 0.1);
    setCustomValue("scene-pin-5", "breathe", 0.9);
    expect(getCustomValue("scene-pin-5", "focus")).toBe(0.1);
    expect(getCustomValue("scene-pin-5", "breathe")).toBe(0.9);
  });

  it("keeps the same key independent across different scenes", () => {
    setCustomValue("scene-pin-6a", "focus", 0.2);
    setCustomValue("scene-pin-6b", "focus", 0.8);
    expect(getCustomValue("scene-pin-6a", "focus")).toBe(0.2);
    expect(getCustomValue("scene-pin-6b", "focus")).toBe(0.8);
  });

  it("customValueSnapshot reports every active pin, keyed by scene:key", () => {
    setCustomValue("scene-pin-7", "focus", 3);
    setCustomValue("scene-pin-8", "breathe", -1);
    const snap = customValueSnapshot();
    expect(snap["scene-pin-7:focus"]).toBe(3);
    expect(snap["scene-pin-8:breathe"]).toBe(-1);
  });

  // vitest runs under environment: "node" (vitest.config.ts), so there is no
  // localStorage global at all here — proves the module tolerates that
  // (getCustomValue/setCustomValue/clearCustomValue all reach through the same lazy store() /
  // persist() as sceneSettings.ts's equivalent functions).
  it("works with no localStorage global — everything above already proved this, this just names it", () => {
    expect(typeof localStorage).toBe("undefined");
    setCustomValue("scene-pin-nostore", "focus", 1);
    expect(getCustomValue("scene-pin-nostore", "focus")).toBe(1);
  });
});

describe("customReach / fitCustom", () => {
  it("reaches one more slider's width past either end", () => {
    expect(customReach({ min: -1, max: 1, step: 0.01 })).toEqual({ lo: -3, hi: 3 });
    expect(customReach({ min: 0.5, max: 3, step: 0.05 })).toEqual({ lo: 0, hi: 5.5 });
  });

  it("never goes below 0 on a slider that starts at 0 or above", () => {
    expect(customReach({ min: 0, max: 1, step: 0.05 })).toEqual({ lo: 0, hi: 2 });
  });

  it("gives counts, toggles and options no custom value", () => {
    expect(customReach({ min: 1, max: 12, step: 1 })).toBeNull();
    expect(customReach({ min: 0, max: 1, step: 1, type: "boolean" })).toBeNull();
    expect(customReach({ min: 0, max: 3, step: 1, type: "enum" }, true)).toBeNull();
  });

  it("lifts the bound in a dev build, counts included", () => {
    expect(customReach({ min: 1, max: 12, step: 1 }, true)).toEqual({ lo: -Infinity, hi: Infinity });
    expect(fitCustom({ min: 0, max: 1, step: 0.01 }, 40, true)).toBe(40);
  });

  it("is no custom value inside the slider, and bounded past it", () => {
    const range = { min: 0, max: 1, step: 0.01 };
    expect(fitCustom(range, 0.5)).toBeNull();
    expect(fitCustom(range, 1)).toBeNull();
    expect(fitCustom(range, 1.5)).toBe(1.5);
    expect(fitCustom(range, 40)).toBe(2);
    expect(fitCustom(range, -0.5)).toBe(0);
    expect(fitCustom(range, Number.NaN)).toBeNull();
  });
});

describe("a write to the setting itself", () => {
  it("drops its custom value, and only that one", () => {
    const spec: SceneSetting = { key: "glow", label: "Glow", min: 0, max: 1, step: 0.01, default: 0.5 };
    setCustomValue("scene-custom-write", "glow", 1.6);
    setCustomValue("scene-custom-write", "other", 1.2);
    setSceneSetting("scene-custom-write", spec, 0.3);
    expect(getCustomValue("scene-custom-write", "glow")).toBeUndefined();
    expect(getCustomValue("scene-custom-write", "other")).toBe(1.2);
  });
});

describe("the slider's stretch", () => {
  const spec: SceneSetting = { key: "glow", label: "Glow", min: 0, max: 1, step: 0.01, default: 0.5 };

  it("outlives the custom value: a write inside the slider keeps it", () => {
    setCustomValue("scene-stretch-1", "glow", 1.5);
    stretchSlider("scene-stretch-1", "glow", 1.5);
    setSceneSetting("scene-stretch-1", spec, 0.8);
    expect(getCustomValue("scene-stretch-1", "glow")).toBeUndefined();
    expect(getSliderStretch("scene-stretch-1", "glow")).toBe(1.5);
    expect(customValueSnapshot()["scene-stretch-1:glow"]).toBeUndefined();
  });

  it("is left alone by a new custom value, and moved only by stretchSlider", () => {
    stretchSlider("scene-stretch-2", "glow", 1.5);
    setCustomValue("scene-stretch-2", "glow", 1.2);
    expect(getSliderStretch("scene-stretch-2", "glow")).toBe(1.5);
    stretchSlider("scene-stretch-2", "glow", 1.8);
    expect(getSliderStretch("scene-stretch-2", "glow")).toBe(1.8);
  });

  it("goes with the value on a reset, and on the Scene card's Reset", () => {
    setCustomValue("scene-stretch-3", "glow", 1.5);
    stretchSlider("scene-stretch-3", "glow", 1.5);
    resetCustomValue("scene-stretch-3", "glow");
    expect(getCustomValue("scene-stretch-3", "glow")).toBeUndefined();
    expect(getSliderStretch("scene-stretch-3", "glow")).toBeUndefined();

    stretchSlider("scene-stretch-4", "glow", 1.5);
    resetSceneSettings("scene-stretch-4", [spec]);
    expect(getSliderStretch("scene-stretch-4", "glow")).toBeUndefined();
  });

  it("widens the slider's span to the stretch and the value, whichever end", () => {
    expect(sliderSpan({ min: 0, max: 1 }, 1.5, undefined)).toEqual({ lo: 0, hi: 1.5 });
    expect(sliderSpan({ min: -1, max: 1 }, undefined, -2)).toEqual({ lo: -2, hi: 1 });
    expect(sliderSpan({ min: 0, max: 1 }, 1.5, 1.2)).toEqual({ lo: 0, hi: 1.5 });
    expect(sliderSpan({ min: 0, max: 1 })).toEqual({ lo: 0, hi: 1 });
  });
});
