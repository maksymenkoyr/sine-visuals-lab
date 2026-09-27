import { describe, expect, it } from "vitest";
import { COLOUR_WORDS, splitHintText } from "../src/ui/hintSwatches";

describe("splitHintText", () => {
  it("leaves colour-free text as one plain run", () => {
    expect(splitHintText("How far the corridor stays visible")).toEqual([
      { text: "How far the corridor stays visible" },
    ]);
  });

  it("marks each colour word, keeping the original casing and order", () => {
    expect(splitHintText("Green ticks fired; red ticks stopped.")).toEqual([
      { text: "Green", color: COLOUR_WORDS.green },
      { text: " ticks fired; " },
      { text: "red", color: COLOUR_WORDS.red },
      { text: " ticks stopped." },
    ]);
  });

  it("prefers the longer phrase and splits on a slash", () => {
    const runs = splitHintText("glows hot red instead of ice blue; the blue/red pair; white-hot peaks");
    expect(runs.filter((r) => "color" in r).map((r) => r.text)).toEqual([
      "red",
      "ice blue",
      "blue",
      "red",
      "white-hot",
    ]);
    expect(runs[3]).toEqual({ text: "ice blue", color: COLOUR_WORDS["ice blue"] });
  });

  it("ignores colour words inside longer words", () => {
    expect(splitHintText("reduced hundred bluetooth")).toEqual([{ text: "reduced hundred bluetooth" }]);
  });

  it("lets a caller swap in the colour actually drawn", () => {
    expect(splitHintText("Beats (red)", { red: "#123456" })).toEqual([
      { text: "Beats (" },
      { text: "red", color: "#123456" },
      { text: ")" },
    ]);
  });
});
