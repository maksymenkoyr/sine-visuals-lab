import { describe, it, expect } from "vitest";
import { isFolded, setFolded, METERS_COLUMN } from "../src/ui/panelFolds.ts";

describe("panel fold persistence", () => {
  // vitest runs under environment: "node" (vitest.config.ts), so there is no
  // localStorage global at all here — this also proves the module tolerates that.
  it("defaults to open (not folded) for a card never set", () => {
    expect(isFolded("never-seen")).toBe(false);
  });

  it("round-trips folded and unfolded", () => {
    setFolded("scope", true);
    expect(isFolded("scope")).toBe(true);
    setFolded("scope", false);
    expect(isFolded("scope")).toBe(false);
  });

  it("keeps different card ids independent", () => {
    setFolded("signal", true);
    setFolded("rhythm", false);
    expect(isFolded("signal")).toBe(true);
    expect(isFolded("rhythm")).toBe(false);
  });

  it("hides the meters column under its own id without touching a card's", () => {
    setFolded(METERS_COLUMN, true);
    expect(isFolded(METERS_COLUMN)).toBe(true);
    expect(isFolded("bands")).toBe(false);
    setFolded(METERS_COLUMN, false);
    expect(isFolded(METERS_COLUMN)).toBe(false);
  });
});
