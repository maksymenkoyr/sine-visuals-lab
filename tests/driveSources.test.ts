import { afterEach, describe, expect, it } from "vitest";
import { addShapingNode, listShapingNodes, removeShapingNode } from "../src/render/shapingNodes.ts";
import { driveAddGroups, driveSourceColor, driveSourceLabel, shapingInputGroups, shapingNodeLabel } from "../src/ui/driveSources.ts";

// The shaping nodes are one shared in-memory list: every test removes what it adds.
afterEach(() => {
  for (const n of [...listShapingNodes()]) removeShapingNode(n.id);
});

describe("shaping node labels", () => {
  it("a node reads as its input's label plus 'shaped', and the second on the same input as 'shaped 2'", () => {
    const base = driveSourceLabel("anim.low");
    const first = addShapingNode("anim.low")!;
    const second = addShapingNode("anim.low")!;
    expect(driveSourceLabel({ source: "shaped", id: first.id })).toBe(`${base} shaped`);
    expect(driveSourceLabel({ source: "shaped", id: second.id })).toBe(`${base} shaped 2`);
    expect(shapingNodeLabel(second.id)).toBe(`${base} shaped 2`);
  });

  it("a node that is gone reads as removed", () => {
    expect(driveSourceLabel({ source: "shaped", id: "n999999" })).toBe("Removed shaping node");
  });

  it("a node takes its input's colour, and a missing node a neutral one", () => {
    const node = addShapingNode("anim.high")!;
    expect(driveSourceColor({ source: "shaped", id: node.id })).toBe(driveSourceColor("anim.high"));
    expect(driveSourceColor({ source: "shaped", id: "n999999" })).toBe("#8a92a3");
  });
});

describe("add groups", () => {
  it("has a final Shaped group only while a node exists", () => {
    expect(driveAddGroups().some((g) => g.label === "Shaped")).toBe(false);
    const node = addShapingNode("anim.low")!;
    const groups = driveAddGroups();
    const last = groups[groups.length - 1]!;
    expect(last.label).toBe("Shaped");
    expect(last.choices).toEqual([{ source: "shaped", id: node.id }]);
  });

  it("the shaping column's input groups hold only plain signals, with no Line group", () => {
    const groups = shapingInputGroups();
    expect(groups.length).toBeGreaterThan(0);
    for (const g of groups) {
      expect(g.choices.length).toBeGreaterThan(0);
      for (const c of g.choices) expect(typeof c).toBe("string");
    }
    expect(groups.some((g) => g.label === "Line")).toBe(false);
  });
});
