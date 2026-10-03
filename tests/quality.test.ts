import { describe, expect, it } from "vitest";
import { presetAllows, presetRank, QUALITY_PRESET_ORDER } from "../src/render/quality.ts";

describe("presetRank / presetAllows", () => {
  it("ranks the presets weakest to strongest", () => {
    const ranks = QUALITY_PRESET_ORDER.map(presetRank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(presetRank("floor")).toBeLessThan(presetRank("high"));
  });

  it("a scene with no minQuality runs everywhere", () => {
    for (const p of QUALITY_PRESET_ORDER) expect(presetAllows({}, p)).toBe(true);
  });

  it("a scene runs at its minQuality and above, never below", () => {
    expect(presetAllows({ minQuality: "mid" }, "low")).toBe(false);
    expect(presetAllows({ minQuality: "mid" }, "floor")).toBe(false);
    expect(presetAllows({ minQuality: "mid" }, "mid")).toBe(true);
    expect(presetAllows({ minQuality: "mid" }, "high")).toBe(true);
    expect(presetAllows({ minQuality: "floor" }, "floor")).toBe(true);
  });
});
