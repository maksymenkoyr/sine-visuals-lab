import { describe, it, expect } from "vitest";
import { lookIconFilter } from "../src/ui/lookIcon.ts";
import { funnyLookName } from "../src/render/lookNames.ts";

describe("lookIconFilter", () => {
  it("gives the same name the same tint, with the hue filled in", () => {
    expect(lookIconFilter("Zeb Zab Zib")).toBe(lookIconFilter("Zeb Zab Zib"));
    expect(lookIconFilter("Zeb Zab Zib")).toMatch(/hue-rotate\(\d+deg\)/);
    expect(lookIconFilter("Zeb Zab Zib")).not.toContain("#");
  });

  it("tints different looks differently", () => {
    const taken: string[] = [];
    for (let i = 0; i < 40; i++) taken.push(funnyLookName(taken));
    const filters = new Set(taken.map(lookIconFilter));
    expect(filters.size).toBeGreaterThan(30);
  });
});
