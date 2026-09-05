import { describe, it, expect } from "vitest";
import {
  getSceneSetting,
  getSceneSettingRate,
  setSceneSetting,
  setSceneSettingRate,
  resetSceneSettings,
  type SceneSetting,
} from "../src/render/sceneSettings.ts";
import type { BeatRate } from "../src/render/beatGrid.ts";

const FOCUS: SceneSetting = { key: "focus", label: "Focus", min: 0, max: 1, step: 0.05, default: 0.7 };
const BREATHE: SceneSetting = {
  key: "breathe",
  label: "Breathe",
  min: 0,
  max: 1,
  step: 0.05,
  default: 0.35,
  rate: { rest: 4 },
};

describe("scene settings persistence", () => {
  // vitest runs under environment: "node" (vitest.config.ts), so there is no
  // localStorage global at all here — this also proves the module tolerates that.
  it("returns the spec default for a scene that's never been set", () => {
    expect(getSceneSetting("nonexistent-scene", FOCUS)).toBe(FOCUS.default);
  });

  it("round-trips a value that's in range", () => {
    setSceneSetting("scene-a", FOCUS, 0.4);
    expect(getSceneSetting("scene-a", FOCUS)).toBeCloseTo(0.4);
  });

  it("clamps out-of-range values on set", () => {
    setSceneSetting("clamp-test", FOCUS, 999);
    expect(getSceneSetting("clamp-test", FOCUS)).toBe(FOCUS.max);
    setSceneSetting("clamp-test", FOCUS, -5);
    expect(getSceneSetting("clamp-test", FOCUS)).toBe(FOCUS.min);
  });

  it("falls back to default for a non-finite value", () => {
    setSceneSetting("nan-test", FOCUS, NaN);
    expect(getSceneSetting("nan-test", FOCUS)).toBe(FOCUS.default);
  });

  it("keeps different keys within the same scene independent", () => {
    setSceneSetting("scene-b", FOCUS, 0.1);
    setSceneSetting("scene-b", BREATHE, 0.9);
    expect(getSceneSetting("scene-b", FOCUS)).toBeCloseTo(0.1);
    expect(getSceneSetting("scene-b", BREATHE)).toBeCloseTo(0.9);
  });

  it("keeps the same key independent across different scenes", () => {
    setSceneSetting("scene-c1", FOCUS, 0.2);
    setSceneSetting("scene-c2", FOCUS, 0.8);
    expect(getSceneSetting("scene-c1", FOCUS)).toBeCloseTo(0.2);
    expect(getSceneSetting("scene-c2", FOCUS)).toBeCloseTo(0.8);
  });

  it("resetSceneSettings restores every listed spec to its default, and its rate to rest", () => {
    setSceneSetting("scene-d", FOCUS, 0.9);
    setSceneSetting("scene-d", BREATHE, 0.1);
    setSceneSettingRate("scene-d", BREATHE, 8);
    resetSceneSettings("scene-d", [FOCUS, BREATHE]);
    expect(getSceneSetting("scene-d", FOCUS)).toBe(FOCUS.default);
    expect(getSceneSetting("scene-d", BREATHE)).toBe(BREATHE.default);
    expect(getSceneSettingRate("scene-d", BREATHE)).toBe(BREATHE.rate!.rest);
  });

  it("rounds an enum setting to a whole option index and clamps it to the options", () => {
    const SKIN: SceneSetting = {
      key: "skin", label: "Skin", type: "enum", options: ["Skeleton", "Stick", "Neon"],
      min: 0, max: 2, step: 1, default: 0,
    };
    // A fractional value (a slider drag, a tuning override) must land on a chip.
    setSceneSetting("enum-test", SKIN, 0.7);
    expect(getSceneSetting("enum-test", SKIN)).toBe(1);
    setSceneSetting("enum-test", SKIN, 7);
    expect(getSceneSetting("enum-test", SKIN)).toBe(SKIN.max);
    setSceneSetting("enum-test", SKIN, -3);
    expect(getSceneSetting("enum-test", SKIN)).toBe(SKIN.min);
  });
});

describe("scene setting beat rate", () => {
  it("returns 1 for a setting with no `rate` field at all", () => {
    expect(getSceneSettingRate("rate-test-1", FOCUS)).toBe(1);
  });

  it("returns the spec's rest rate for a rate-capable setting never set", () => {
    expect(getSceneSettingRate("rate-test-2", BREATHE)).toBe(4);
  });

  it("round-trips a chosen rate", () => {
    setSceneSettingRate("rate-test-3", BREATHE, 2);
    expect(getSceneSettingRate("rate-test-3", BREATHE)).toBe(2);
  });

  it("falls back to rest for a stored value that isn't a valid BeatRate", () => {
    // Simulates a corrupted/stale localStorage entry (e.g. from a future
    // BEAT_RATES this build doesn't know) rather than trusting it verbatim.
    setSceneSettingRate("rate-test-4", BREATHE, 3 as unknown as BeatRate);
    expect(getSceneSettingRate("rate-test-4", BREATHE)).toBe(BREATHE.rate!.rest);
  });

  it("is a no-op on a setting with no `rate` field", () => {
    setSceneSetting("rate-test-5", FOCUS, 0.3);
    setSceneSettingRate("rate-test-5", FOCUS, 2 as unknown as BeatRate);
    expect(getSceneSettingRate("rate-test-5", FOCUS)).toBe(1);
  });
});
