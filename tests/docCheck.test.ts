import { describe, it, expect } from "vitest";
import {
  buildRequest,
  candidateParagraphs,
  chunk,
  costUsd,
  JEV_USD_PER_MTOK,
  MAX_QUESTIONS,
  parseVerdicts,
  splitParagraphs,
  summarizeRuns,
  touchedNames,
} from "../tools/docCheckLib.mjs";
import type { Judgment, Run, Verdict } from "../tools/docCheckLib.d.mts";

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

describe("costUsd", () => {
  it("prices input tokens at the Jev rate, output tokens free", () => {
    expect(costUsd(1_000_000)).toBeCloseTo(JEV_USD_PER_MTOK);
    expect(costUsd(0)).toBe(0);
  });

  it("scales linearly for a partial million", () => {
    expect(costUsd(500_000)).toBeCloseTo(JEV_USD_PER_MTOK / 2);
  });
});

describe("parseVerdicts", () => {
  it("parses ref=value pairs into a map", () => {
    expect(parseVerdicts(["docs/x.md:12=stale", "AGENTS.md:5=fine"])).toEqual({
      "docs/x.md:12": "stale",
      "AGENTS.md:5": "fine",
    });
  });

  it("throws on a value that isn't stale/fine/missed", () => {
    expect(() => parseVerdicts(["docs/x.md:12=maybe"])).toThrow();
  });

  it("throws on an arg with no =", () => {
    expect(() => parseVerdicts(["docs/x.md:12"])).toThrow();
  });

  it("splits on the LAST = so a ref containing : or = still works", () => {
    // A ref is "doc:line"; splitting on the last "=" keeps that intact even
    // if a path segment happened to contain "=".
    expect(parseVerdicts(["docs/a=b.md:7=missed"])).toEqual({ "docs/a=b.md:7": "missed" });
  });
});

describe("summarizeRuns", () => {
  function judgment(ref: string, opts: { p?: number; flagged?: boolean } = {}): Judgment {
    const [doc, line] = ref.split(":");
    return {
      ref,
      doc,
      line: Number(line),
      file: "src/foo.ts",
      names: ["foo"],
      p: opts.p ?? 0.9,
      flagged: opts.flagged ?? true,
      hash: "abc1234567",
      excerpt: "…",
    };
  }

  // Builds a minimal judged run; `verdicts` is the run's own recorded map,
  // keyed by judgment ref, the way `--verdict` writes it.
  function judgedRun(judgments: Judgment[], verdicts: Record<string, Verdict> = {}, overrides: Partial<Run> = {}): Run {
    return {
      id: "20260928-000000",
      at: "2026-09-28T00:00:00.000Z",
      mode: "judged",
      branch: "main",
      head: "abc123",
      base: "origin/main",
      threshold: 0.5,
      model: "jev-1.13",
      files: ["src/foo.ts"],
      requests: [{ n: 0, file: "src/foo.ts", questions: judgments.length, inputTokens: 1000, ms: 500, attempts: 1, model: "jev-1.13" }],
      judgments,
      totals: {
        candidates: judgments.length,
        flagged: judgments.filter((j) => j.flagged).length,
        inputTokens: 1000,
        costUsd: costUsd(1000),
        ms: 500,
        candidateChars: 100,
        flaggedChars: judgments.some((j) => j.flagged) ? 60 : 0,
      },
      verdicts,
      ...overrides,
    };
  }

  function unjudgedRun(overrides: Partial<Run> = {}): Run {
    return {
      id: "u1",
      at: "2026-09-28T00:00:00.000Z",
      mode: "unjudged",
      branch: "main",
      head: "abc123",
      base: "origin/main",
      threshold: 0.5,
      model: null,
      files: ["src/foo.ts"],
      requests: [],
      judgments: [],
      totals: { candidates: 3, flagged: 0, inputTokens: 0, costUsd: 0, ms: 0, candidateChars: 300, flaggedChars: 0 },
      verdicts: {},
      ...overrides,
    };
  }

  it("counts runs by mode and collects distinct models", () => {
    const runs = [judgedRun([judgment("docs/a.md:1")]), unjudgedRun({ id: "20260928-000001" })];
    const s = summarizeRuns(runs);
    expect(s.runs).toEqual({ total: 2, judged: 1, unjudged: 1, models: ["jev-1.13"] });
  });

  it("excludes unjudged runs from token/latency totals and averages", () => {
    const s = summarizeRuns([unjudgedRun()]);
    expect(s.totals.inputTokens).toBe(0);
    expect(s.totals.meanRequestMs).toBeNull();
    expect(s.totals.maxRequestMs).toBeNull();
    expect(s.totals.costPerRunUsd).toBeNull();
  });

  it("computes precision from flagged judgments with stale/fine verdicts", () => {
    const runs = [
      judgedRun(
        [judgment("docs/a.md:1"), judgment("docs/b.md:2"), judgment("docs/c.md:3")],
        { "docs/a.md:1": "stale", "docs/b.md:2": "stale", "docs/c.md:3": "fine" },
      ),
    ];
    const s = summarizeRuns(runs);
    expect(s.effectiveness.hasVerdicts).toBe(true);
    expect(s.effectiveness.precision).toBeCloseTo(2 / 3);
    expect(s.effectiveness.falsePositiveCount).toBe(1);
  });

  it("counts a missed verdict and an unflagged-but-stale judgment as misses", () => {
    const runs = [
      judgedRun(
        [judgment("docs/a.md:1", { flagged: false, p: 0.1 })],
        { "docs/a.md:1": "stale", "docs/never-flagged.md:99": "missed" },
      ),
    ];
    const s = summarizeRuns(runs);
    expect(s.effectiveness.misses).toBe(2);
    expect(s.effectiveness.staleUnflaggedCount).toBe(1);
  });

  it("reports n/a-shaped output when no verdicts exist", () => {
    const runs = [judgedRun([judgment("docs/a.md:1")])];
    const s = summarizeRuns(runs);
    expect(s.effectiveness.hasVerdicts).toBe(false);
    expect(s.effectiveness.precision).toBeNull();
    expect(s.calibration.every((b) => b.count === 0)).toBe(true);
  });

  it("buckets calibration by p, including p=1 in the top bucket", () => {
    const runs = [
      judgedRun(
        [judgment("docs/a.md:1", { p: 0.1 }), judgment("docs/b.md:2", { p: 1 }), judgment("docs/c.md:3", { p: 0.85 })],
        { "docs/a.md:1": "fine", "docs/b.md:2": "stale", "docs/c.md:3": "stale" },
      ),
    ];
    const s = summarizeRuns(runs);
    const low = s.calibration.find((b) => b.bucket === "[0,.2)")!;
    const top = s.calibration.find((b) => b.bucket === "[.8,1]")!;
    expect(low.count).toBe(1);
    expect(low.staleRate).toBe(0);
    expect(top.count).toBe(2);
    expect(top.staleRate).toBe(1);
  });
});
