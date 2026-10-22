import { describe, expect, it } from "vitest";
import { DRIVE_ADD_GROUPS, driveSourceColor, driveSourceLabel } from "../src/ui/driveSources.ts";

describe("add groups", () => {
  it("every group has choices, and each choice a label and a colour", () => {
    expect(DRIVE_ADD_GROUPS.length).toBeGreaterThan(0);
    for (const g of DRIVE_ADD_GROUPS) {
      expect(g.choices.length).toBeGreaterThan(0);
      for (const c of g.choices) {
        expect(driveSourceLabel(c)).not.toBe("");
        expect(driveSourceColor(c)).not.toBe("");
      }
    }
  });
});
