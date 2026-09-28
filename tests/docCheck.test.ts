import { describe, it, expect } from "vitest";
import {
  buildRequest,
  candidateParagraphs,
  chunk,
  MAX_QUESTIONS,
  splitParagraphs,
  touchedNames,
} from "../tools/docCheckLib.mjs";

describe("splitParagraphs", () => {
  it("splits on blank lines and reports the 1-based line of the first line", () => {
    const text = "para one\nstill one\n\npara two\n\n\npara three";
    const paragraphs = splitParagraphs(text);
    expect(paragraphs).toEqual([
      { line: 1, text: "para one\nstill one" },
      { line: 4, text: "para two" },
      { line: 7, text: "para three" },
    ]);
  });

  it("keeps a fenced code block whole even across blank lines inside it", () => {
    const text = "before\n\n```js\nconst a = 1;\n\nconst b = 2;\n```\n\nafter";
    const paragraphs = splitParagraphs(text);
    expect(paragraphs).toEqual([
      { line: 1, text: "before" },
      { line: 3, text: "```js\nconst a = 1;\n\nconst b = 2;\n```" },
      { line: 9, text: "after" },
    ]);
  });

  it("skips a paragraph that is only a heading line", () => {
    const text = "# Title\n\nSome real content.\n\n## Subheading\n\nMore content.";
    const paragraphs = splitParagraphs(text);
    expect(paragraphs.map((p) => p.text)).toEqual(["Some real content.", "More content."]);
  });
});

describe("touchedNames", () => {
  it("includes the path and its basename", () => {
    const names = touchedNames("src/render/drives.ts", "");
    expect(names).toContain("src/render/drives.ts");
    expect(names).toContain("drives.ts");
  });

  it("picks up identifiers declared on added/removed lines", () => {
    const diff = [
      "diff --git a/src/render/drives.ts b/src/render/drives.ts",
      "--- a/src/render/drives.ts",
      "+++ b/src/render/drives.ts",
      "@@ -1,3 +1,3 @@",
      "-export function driveFor(scene: Scene) {",
      "+export function driveForScene(scene: Scene) {",
      " const x = 1;",
    ].join("\n");
    const names = touchedNames("src/render/drives.ts", diff);
    expect(names).toContain("driveFor");
    expect(names).toContain("driveForScene");
    // The unchanged context line's declaration (none here) and the +++/---
    // file headers must never be scanned for identifiers.
    expect(names).not.toContain("a/src/render/drives.ts");
  });

  it("ignores +++/--- file header lines even though they start with +/-", () => {
    const diff = ["--- a/foo.ts", "+++ b/foo.ts", "+export const shortName = 1;"].join("\n");
    const names = touchedNames("foo.ts", diff);
    // "shortName" (>=4 chars) should be picked up, but nothing from the headers.
    expect(names).toContain("shortName");
    expect(names.some((n) => n.includes("a/foo.ts") && n !== "foo.ts")).toBe(false);
  });

  it("drops identifiers shorter than 4 characters", () => {
    const diff = ["+export const abc = 1;", "+export const longEnough = 2;"].join("\n");
    const names = touchedNames("foo.ts", diff);
    expect(names).not.toContain("abc");
    expect(names).toContain("longEnough");
  });

  it("dedupes repeated names", () => {
    const diff = ["+export function repeatedName() {}", "-export function repeatedName() {}"].join("\n");
    const names = touchedNames("foo.ts", diff);
    expect(names.filter((n) => n === "repeatedName")).toHaveLength(1);
  });

  it("skips indented (local) declarations", () => {
    const diff = ["+export function outerName() {", "+  const localName = 1;", "+}"].join("\n");
    const names = touchedNames("foo.ts", diff);
    expect(names).toContain("outerName");
    expect(names).not.toContain("localName");
  });
});

describe("candidateParagraphs", () => {
  const paragraphs = [
    { line: 1, text: "The drive system lives in `drives.ts` and is the settings backbone." },
    { line: 5, text: "Every scene reads `driveFor(scene)` to pick a source." },
    { line: 9, text: "A driveFor mentioned in bare prose, and src/render/drives.ts by path." },
  ];

  it("matches identifiers and basenames only inside code spans", () => {
    expect(candidateParagraphs(paragraphs, ["driveFor"]).map((c) => c.line)).toEqual([5]);
    expect(candidateParagraphs(paragraphs, ["drives.ts"]).map((c) => c.line)).toEqual([1]);
  });

  it("matches a full repo path anywhere", () => {
    const candidates = candidateParagraphs(paragraphs, ["src/render/drives.ts"]);
    expect(candidates.map((c) => c.line)).toEqual([9]);
  });

  it("matches an identifier only at a word boundary (drive must not match drives)", () => {
    const onlyPlural = [{ line: 1, text: "See `drives.ts` for the `drives` list." }];
    expect(candidateParagraphs(onlyPlural, ["drive"])).toHaveLength(0);
    expect(candidateParagraphs([{ line: 1, text: "Call `drive(x)`." }], ["drive"])).toHaveLength(1);
  });

  it("matches an identifier containing $ safely (escaped in the regex)", () => {
    const dollarParagraphs = [{ line: 1, text: "Uses the `$special` helper internally." }];
    expect(candidateParagraphs(dollarParagraphs, ["$special"])).toHaveLength(1);
  });

  it("collects all matched names per paragraph", () => {
    const candidates = candidateParagraphs(paragraphs, ["drive", "driveFor"]);
    expect(candidates.find((c) => c.line === 5)?.names).toEqual(["driveFor"]);
  });
});

describe("buildRequest", () => {
  const candidates = [
    { line: 1, text: "para a", names: ["a"] },
    { line: 2, text: "para b", names: ["b"] },
  ];

  it("builds one question per candidate, keyed p0, p1, ...", () => {
    const req = buildRequest("src/foo.ts", "diff text", candidates);
    expect(Object.keys(req.questions)).toEqual(["p0", "p1"]);
    expect(req.questions.p0.instructions.paragraph).toBe("para a");
    expect(req.questions.p1.instructions.paragraph).toBe("para b");
    expect(req.questions.p0.type).toBe("noul");
    expect(req.model).toBe("jev-latest");
    expect(req.state.file).toBe("src/foo.ts");
  });

  it("passes the diff through untouched when under the size limit", () => {
    const req = buildRequest("src/foo.ts", "short diff", candidates, { maxDiffChars: 24000 });
    expect(req.state.diff).toBe("short diff");
  });

  it("truncates a long diff and appends the truncation marker", () => {
    const longDiff = "x".repeat(100);
    const req = buildRequest("src/foo.ts", longDiff, candidates, { maxDiffChars: 20 });
    expect(req.state.diff.startsWith("x".repeat(20))).toBe(true);
    expect(req.state.diff.endsWith("\n… [diff truncated]")).toBe(true);
    expect(req.state.diff.length).toBe(20 + "\n… [diff truncated]".length);
  });
});

describe("chunk", () => {
  it("splits an array into chunks of the given size", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns a single chunk when the array is smaller than size", () => {
    expect(chunk([1, 2], 10)).toEqual([[1, 2]]);
  });

  it("exposes MAX_QUESTIONS as the request batch cap", () => {
    expect(MAX_QUESTIONS).toBe(60);
  });
});
