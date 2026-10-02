import { describe, it, expect, afterEach } from "vitest";
import { applyTuningParams } from "../src/tuning/bus.ts";
import { clearAllOverrides, getOverride, isAutoPinned, setAutoPinned } from "../src/tuning/overrides.ts";

afterEach(() => {
  clearAllOverrides();
  setAutoPinned(false);
});

describe("applyTuningParams", () => {
  it("an explicit autoPin:true pins", () => {
    applyTuningParams({ scene: "x", autoPin: true, settings: {} });
    expect(isAutoPinned()).toBe(true);
  });

  it("a push without autoPin lets go of an earlier pin, like a dropped setting", () => {
    applyTuningParams({ scene: "x", autoPin: true, settings: { a: 1 } });
    expect(isAutoPinned()).toBe(true);
    expect(getOverride("x", "a")).toBe(1);
    applyTuningParams({ scene: "x", settings: {} });
    expect(isAutoPinned()).toBe(false);
    expect(getOverride("x", "a")).toBeUndefined();
  });

  it("autoPin:false unpins", () => {
    applyTuningParams({ autoPin: true });
    applyTuningParams({ autoPin: false });
    expect(isAutoPinned()).toBe(false);
  });
});
