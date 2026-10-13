import { describe, it, expect } from "vitest";
import { isUiV2, setUiV2 } from "../src/ui/uiVersion.ts";

describe("ui version", () => {
  // vitest runs under environment: "node", so there is no location or
  // localStorage here — this also proves the module tolerates that.
  it("starts on the layout everybody has", () => {
    expect(isUiV2()).toBe(false);
  });

  it("flips to v2 and back", () => {
    setUiV2(true);
    expect(isUiV2()).toBe(true);
    setUiV2(false);
    expect(isUiV2()).toBe(false);
  });
});
