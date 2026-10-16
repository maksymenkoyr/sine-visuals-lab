import { describe, expect, it } from "vitest";
import { filterScenes } from "../src/ui/scenePicker.ts";

const SCENES = [{ name: "Neon Fluid" }, { name: "Chladni" }, { name: "Neon Gates" }, { name: "Crystal Wall" }];

describe("filterScenes", () => {
  it("keeps every scene, in order, for an empty or blank query", () => {
    expect(filterScenes(SCENES, "")).toEqual(SCENES);
    expect(filterScenes(SCENES, "   ")).toEqual(SCENES);
  });
  it("matches anywhere in the name, ignoring case", () => {
    expect(filterScenes(SCENES, "neon").map((s) => s.name)).toEqual(["Neon Fluid", "Neon Gates"]);
    expect(filterScenes(SCENES, "WALL").map((s) => s.name)).toEqual(["Crystal Wall"]);
  });
  it("needs every word", () => {
    expect(filterScenes(SCENES, "neon ga").map((s) => s.name)).toEqual(["Neon Gates"]);
    expect(filterScenes(SCENES, "neon wall")).toEqual([]);
  });
});
