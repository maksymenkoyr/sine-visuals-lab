import { describe, it, expect } from "vitest";
import {
  getSceneSetting,
  getSceneSettingRate,
  getSceneSettingBeatOverride,
  setSceneSetting,
  setSceneSettingRate,
  setSceneSettingBeatOverride,
  resetSceneSettings,
  type SceneSetting,
} from "../src/render/sceneSettings.ts";
import type { BeatOverride, BeatRate } from "../src/render/settingBeatRate.ts";

const FOCUS: SceneSetting = { key: "focus", label: "Focus", min: 0, max: 1, step: 0.05, default: 0.7 };
const BREATHE: SceneSetting = {
  key: "breathe",
  label: "Breathe",
  min: 0,
  max: 1,
  step: 0.05,
  default: 0.35,
  rate: { kind: "phase", rest: 4 },
};
const FLASH: SceneSetting = {
  key: "flash",
  label: "Flash",
  min: 0,
  max: 1,
  step: 0.05,
  default: 0.6,
  rate: { kind: "override" },
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

  it("resetSceneSettings restores a phase setting's value and rate to rest", () => {
    setSceneSetting("scene-d", FOCUS, 0.9);
    setSceneSetting("scene-d", BREATHE, 0.1);
    setSceneSettingRate("scene-d", BREATHE, 8);
    resetSceneSettings("scene-d", [FOCUS, BREATHE]);
    expect(getSceneSetting("scene-d", FOCUS)).toBe(FOCUS.default);
    expect(getSceneSetting("scene-d", BREATHE)).toBe(BREATHE.default);
    expect(getSceneSettingRate("scene-d", BREATHE)).toBe(4);
  });

  it("resetSceneSettings restores an override setting's pin to Scene", () => {
    setSceneSettingBeatOverride("scene-d2", FLASH, 3);
    resetSceneSettings("scene-d2", [FLASH]);
    expect(getSceneSettingBeatOverride("scene-d2", FLASH)).toBeNull();
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

describe("scene setting beat rate (phase form)", () => {
  it("returns 1 for a setting with no `rate` field at all", () => {
    expect(getSceneSettingRate("rate-test-1", FOCUS)).toBe(1);
  });

  it("returns 1 for an override-kind setting", () => {
    expect(getSceneSettingRate("rate-test-1b", FLASH)).toBe(1);
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
    expect(getSceneSettingRate("rate-test-4", BREATHE)).toBe(4);
  });

  it("is a no-op on a setting with no `rate` field", () => {
    setSceneSetting("rate-test-5", FOCUS, 0.3);
    setSceneSettingRate("rate-test-5", FOCUS, 2 as unknown as BeatRate);
    expect(getSceneSettingRate("rate-test-5", FOCUS)).toBe(1);
  });

  it("is a no-op on an override-kind setting", () => {
    setSceneSettingRate("rate-test-5b", FLASH, 2 as unknown as BeatRate);
    expect(getSceneSettingRate("rate-test-5b", FLASH)).toBe(1);
  });
});

describe("scene setting beat override (override form)", () => {
  it("returns null (Scene) for a setting with no `rate` field at all", () => {
    expect(getSceneSettingBeatOverride("ov-test-1", FOCUS)).toBeNull();
  });

  it("returns null for a phase-kind setting", () => {
    expect(getSceneSettingBeatOverride("ov-test-1b", BREATHE)).toBeNull();
  });

  it("returns null (Scene) for an override-capable setting never pinned", () => {
    expect(getSceneSettingBeatOverride("ov-test-2", FLASH)).toBeNull();
  });

  it("round-trips a chosen grid index", () => {
    setSceneSettingBeatOverride("ov-test-3", FLASH, 3);
    expect(getSceneSettingBeatOverride("ov-test-3", FLASH)).toBe(3);
  });

  it("setting back to null clears the stored pin rather than storing null", () => {
    setSceneSettingBeatOverride("ov-test-4", FLASH, 3);
    setSceneSettingBeatOverride("ov-test-4", FLASH, null);
    expect(getSceneSettingBeatOverride("ov-test-4", FLASH)).toBeNull();
  });

  it("falls back to Scene for a stored value that isn't a valid grid index", () => {
    setSceneSettingBeatOverride("ov-test-5", FLASH, 99 as unknown as BeatOverride);
    expect(getSceneSettingBeatOverride("ov-test-5", FLASH)).toBeNull();
  });

  it("is a no-op on a setting with no `rate` field", () => {
    setSceneSettingBeatOverride("ov-test-6", FOCUS, 2);
    expect(getSceneSettingBeatOverride("ov-test-6", FOCUS)).toBeNull();
  });

  it("is a no-op on a phase-kind setting", () => {
    setSceneSettingBeatOverride("ov-test-6b", BREATHE, 2);
    expect(getSceneSettingBeatOverride("ov-test-6b", BREATHE)).toBeNull();
  });

  it("keeps override and rate stores independent per key within the same scene", () => {
    setSceneSettingRate("ov-test-7", BREATHE, 8);
    setSceneSettingBeatOverride("ov-test-7", FLASH, 1);
    expect(getSceneSettingRate("ov-test-7", BREATHE)).toBe(8);
    expect(getSceneSettingBeatOverride("ov-test-7", FLASH)).toBe(1);
  });
});
