import { describe, it, expect } from "vitest";
import { buildDefaultEdits } from "../src/tuning/bakeDefaults.ts";
import type { SceneSetting } from "../src/render/sceneSettings.ts";

function spec(key: string, def: number, step = 0.1): SceneSetting {
  return { key, label: key, min: 0, max: 10, step, default: def };
}

describe("buildDefaultEdits", () => {
  it("emits nothing when every value already equals its default", () => {
    const specs = [spec("a", 1), spec("b", 2)];
    const edits = buildDefaultEdits(specs, (s) => s.default);
    expect(edits).toEqual([]);
  });

  it("emits from/to for a changed value", () => {
    const specs = [spec("a", 1)];
    const edits = buildDefaultEdits(specs, () => 3.8);
    expect(edits).toEqual([{ key: "a", from: 1, to: 3.8 }]);
  });

  it("rounds float dust to the spec's own step precision", () => {
    const specs = [spec("a", 1, 0.1)];
    const edits = buildDefaultEdits(specs, () => 0.7000000000000001);
    expect(edits).toEqual([{ key: "a", from: 1, to: 0.7 }]);
  });

  it("yields an integer for an integer step", () => {
    const specs = [spec("a", 1, 1)];
    const edits = buildDefaultEdits(specs, () => 4.0);
    expect(edits).toEqual([{ key: "a", from: 1, to: 4 }]);
  });

  it("skips a non-finite value", () => {
    const specs = [spec("a", 1)];
    const edits = buildDefaultEdits(specs, () => NaN);
    expect(edits).toEqual([]);
  });

  it("only emits edits for settings that actually changed, in one call", () => {
    const specs = [spec("a", 1), spec("b", 2), spec("c", 3)];
    const values: Record<string, number> = { a: 1, b: 5, c: 3 };
    const edits = buildDefaultEdits(specs, (s) => values[s.key]);
    expect(edits).toEqual([{ key: "b", from: 2, to: 5 }]);
  });
});
