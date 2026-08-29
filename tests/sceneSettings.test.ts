import { describe, it, expect } from "vitest";
import {
  getSceneSetting,
  setSceneSetting,
  resetSceneSettings,
  type SceneSetting,
} from "../src/render/sceneSettings.ts";

const FOCUS: SceneSetting = { key: "focus", label: "Focus", min: 0, max: 1, step: 0.05, default: 0.7 };
const BREATHE: SceneSetting = { key: "breathe", label: "Breathe", min: 0, max: 1, step: 0.05, default: 0.35 };

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

  it("resetSceneSettings restores every listed spec to its default", () => {
    setSceneSetting("scene-d", FOCUS, 0.9);
    setSceneSetting("scene-d", BREATHE, 0.1);
    resetSceneSettings("scene-d", [FOCUS, BREATHE]);
    expect(getSceneSetting("scene-d", FOCUS)).toBe(FOCUS.default);
    expect(getSceneSetting("scene-d", BREATHE)).toBe(BREATHE.default);
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
