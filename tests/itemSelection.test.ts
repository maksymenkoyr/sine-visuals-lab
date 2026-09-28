import { describe, it, expect } from "vitest";
import {
  allItemsSelected,
  editingHeading,
  formatMixedSummary,
  primarySelection,
  sameSelection,
  soloSelection,
  toggleItemSelection,
} from "../src/ui/widgets/itemSelection.ts";

describe("soloSelection", () => {
  it("replaces the whole selection with just the one index", () => {
    expect(soloSelection(2)).toEqual([2]);
    expect(soloSelection(0)).toEqual([0]);
  });
});

describe("toggleItemSelection", () => {
  it("adds an unselected index, keeping the result ascending", () => {
    expect(toggleItemSelection([0], 2)).toEqual([0, 2]);
    expect(toggleItemSelection([2], 0)).toEqual([0, 2]);
  });

  it("removes an already-selected index", () => {
    expect(toggleItemSelection([0, 2], 0)).toEqual([2]);
    expect(toggleItemSelection([0, 1, 2], 1)).toEqual([0, 2]);
  });

  it("never empties the selection — toggling the last member off is a no-op", () => {
    expect(toggleItemSelection([1], 1)).toEqual([1]);
  });

  it("dedupes if asked to toggle an index already present via a malformed caller", () => {
    // Same index twice in a row: add then remove returns to the start.
    const once = toggleItemSelection([0], 3);
    expect(toggleItemSelection(once, 3)).toEqual([0]);
  });
});

describe("allItemsSelected", () => {
  it("returns every index ascending", () => {
    expect(allItemsSelected(4)).toEqual([0, 1, 2, 3]);
    expect(allItemsSelected(1)).toEqual([0]);
  });
});

describe("sameSelection", () => {
  it("true for equal ascending arrays, false otherwise", () => {
    expect(sameSelection([0, 2], [0, 2])).toBe(true);
    expect(sameSelection([0, 2], [0])).toBe(false);
    expect(sameSelection([0, 2], [2, 0])).toBe(false);
  });
});

describe("primarySelection", () => {
  it("is the minimum — first in code order", () => {
    expect(primarySelection([2, 0, 3])).toBe(0);
    expect(primarySelection([3])).toBe(3);
    expect(primarySelection([0, 1, 2, 3])).toBe(0);
  });
});

describe("editingHeading", () => {
  it("names every selected label when not all are selected", () => {
    expect(editingHeading(["PP-A1", "PP-C3"], false, "strains")).toBe("Editing PP-A1 + PP-C3");
    expect(editingHeading(["PP-A1"], false, "strains")).toBe("Editing PP-A1");
  });
  it("falls back to 'Editing all <noun>' once everything is selected", () => {
    expect(editingHeading(["PP-A1", "PP-B2", "PP-C3", "PP-D4"], true, "strains")).toBe("Editing all strains");
  });
});

describe("formatMixedSummary", () => {
  it("joins label:text parts with the dot separator, under one Mixed prefix", () => {
    expect(
      formatMixedSummary([
        { label: "PP-A1", text: "Bass level" },
        { label: "PP-C3", text: "Scene" },
      ]),
    ).toBe("Mixed — PP-A1: Bass level · PP-C3: Scene");
  });
});
