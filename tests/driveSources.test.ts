import { describe, expect, it } from "vitest";
import { DRIVE_ADD_GROUPS, driveSourceColor, driveSourceDescription, driveSourceLabel } from "../src/ui/driveSources.ts";
import { BAND_SIGNALS, SIGNALS } from "../src/render/signals.ts";

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

describe("the instruments", () => {
  it("every catalogue entry has a label, a description and a colour", () => {
    for (const id of Object.keys(SIGNALS) as (keyof typeof SIGNALS)[]) {
      expect(driveSourceLabel(id), id).toBeTruthy();
      expect(driveSourceDescription(id), id).toBeTruthy();
      expect(driveSourceColor(id), id).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("the add groups list Kick, Clap, Hats and Chord as hits and their levels beside the band levels", () => {
    const labels = (name: string) => DRIVE_ADD_GROUPS.find((g) => g.label === name)!.choices.map((c) => driveSourceLabel(c));
    expect(labels("Hits")).toEqual(["Any hit", "Kick", "Clap", "Hats", "Chord", "Drop"]);
    const levels = labels("Levels");
    for (const level of ["Kick level", "Clap level", "Hats level", "Chord level", "Bass level", "Mid level", "Treble level"]) expect(levels).toContain(level);
    expect(levels).not.toContain("Kick band");
  });
});

describe("band sources", () => {
  // SignalId's template-literal band member lets the label/description/colour
  // records type-check with a band missing, so this is the only guard.
  it("every band has a label, a description and a colour, and neighbours differ in colour", () => {
    for (const [n, id] of BAND_SIGNALS.entries()) {
      expect(driveSourceLabel(id)).toBe(SIGNALS[id].label);
      expect(driveSourceLabel(id)).toBeTruthy();
      expect(driveSourceDescription(id)).toBeTruthy();
      expect(driveSourceColor(id)).toMatch(/^#[0-9a-f]{6}$/i);
      if (n > 0) expect(driveSourceColor(id)).not.toBe(driveSourceColor(BAND_SIGNALS[n - 1]));
    }
  });
});
