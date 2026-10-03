import { describe, it, expect } from "vitest";
import { formatMixedSummary } from "../src/ui/widgets/itemSelection.ts";

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
