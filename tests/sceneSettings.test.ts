import { describe, it, expect } from "vitest";
import {
  getSceneSetting,
  setSceneSetting,
  resetSceneSettings,
  type SceneSetting,
} from "../src/render/sceneSettings.ts";

const FOCUS: SceneSetting = { key: "focus", label: "Focus", min: 0, max: 1, step: 0.05, default: 0.7 };
const BREATHE: SceneSetting = { key: "breathe", label: "Breathe", min: 0, max: 1, step: 0.05, default: 0.35 };
const DRAFT_WIDTH: SceneSetting = {
  key: "rippleWidth",
  label: "Ripple width",
  min: 0.4,
  max: 4,
  step: 0.05,
  default: 1.6,
  draft: true,
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

  it("resetSceneSettings restores every listed spec to its default", () => {
    setSceneSetting("scene-d", FOCUS, 0.9);
    setSceneSetting("scene-d", BREATHE, 0.1);
    resetSceneSettings("scene-d", [FOCUS, BREATHE]);
    expect(getSceneSetting("scene-d", FOCUS)).toBe(FOCUS.default);
    expect(getSceneSetting("scene-d", BREATHE)).toBe(BREATHE.default);
  });
});

describe("draft settings", () => {
  // A draft is a constant promoted to a dial so it can be scrubbed, before
  // anyone has decided whether it should ship. It behaves like any other
  // setting except for which store it lands in — see SceneSetting.draft.
  it("round-trips and clamps like a normal setting", () => {
    setSceneSetting("draft-scene", DRAFT_WIDTH, 2.5);
    expect(getSceneSetting("draft-scene", DRAFT_WIDTH)).toBeCloseTo(2.5);
    setSceneSetting("draft-scene", DRAFT_WIDTH, 99);
    expect(getSceneSetting("draft-scene", DRAFT_WIDTH)).toBe(DRAFT_WIDTH.max);
  });

  it("keeps a draft separate from a non-draft sharing its key and scene", () => {
    // The point of the separate store: scrubbing a draft must never write the
    // settings a user has saved. Same scene, same key, two different values.
    const shipped: SceneSetting = { ...DRAFT_WIDTH };
    delete (shipped as { draft?: true }).draft;

    setSceneSetting("shared-key-scene", shipped, 1.0);
    setSceneSetting("shared-key-scene", DRAFT_WIDTH, 3.0);

    expect(getSceneSetting("shared-key-scene", shipped)).toBeCloseTo(1.0);
    expect(getSceneSetting("shared-key-scene", DRAFT_WIDTH)).toBeCloseTo(3.0);
  });

  it("returns the spec default for a draft nobody has touched", () => {
    expect(getSceneSetting("untouched-scene", DRAFT_WIDTH)).toBe(DRAFT_WIDTH.default);
  });
});
