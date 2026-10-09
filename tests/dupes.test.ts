// Tests for the copy-paste check: the pure judging and clone ranking in
// tools/dupesLib.mjs, and the jscpd runs behind tools/dupes.mjs. The end-to-end
// cases run real jscpd over a scratch tree whose layout is fixed below, so the
// exact figures they expect are the ones that layout produces.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { judge, runJscpd, topClones } from "../tools/dupesLib.mjs";
import type { JscpdReport } from "../tools/dupesLib.d.mts";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const IGNORE = ["**/scenes/private/**"];
const MIN_TOKENS = 50;
const MAX_SIZE = "10mb";

// `n` distinct exported functions. Each literal depends on the seed and the
// line, so no two lines match, no run of 50 tokens repeats inside one file, and
// files with different seeds share no run either. `js` strips the types, for
// the .mjs copies.
function body(seed: number, n: number, js = false): string {
  const lines: string[] = [];
  for (let i = 0; i < n; i++) {
    const p = ((seed * 7919 + i * 104729) % 9000) + 1000;
    const q = ((i * 31337 + seed) % 9000) + 1000;
    lines.push(
      js
        ? `export function f${seed}_${i}(a, b) { return a * ${p} + b * ${q}; }`
        : `export function f${seed}_${i}(a: number, b: number): number { return a * ${p} + b * ${q}; }`,
    );
  }
  return lines.join("\n") + "\n";
}

let scratch = "";

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), "dupes-test-"));
  // runJscpd looks for jscpd under its root's node_modules, and the scratch
  // tree has none, so it borrows this checkout's install.
  symlinkSync(join(REPO, "node_modules"), join(scratch, "node_modules"), "junction");
  const files: [string, string][] = [
    ["src/a.ts", body(1, 100)],
    ["src/b.ts", body(1, 100)],
    ["src/c.ts", body(2, 100)],
    ["src/scenes/private/p1.ts", body(3, 100)],
    ["src/scenes/private/p2.ts", body(3, 100)],
    ["tests/t1.ts", body(4, 100)],
    ["tests/t2.ts", body(4, 100)],
    ["tools/x.mjs", body(5, 50, true)],
    ["tools/y.mjs", body(5, 50, true)],
  ];
  for (const [rel, text] of files) {
    mkdirSync(dirname(join(scratch, rel)), { recursive: true });
    writeFileSync(join(scratch, rel), text);
  }
  mkdirSync(join(scratch, "empty"));
});

afterAll(() => {
  // Unlink the borrowed install first, so the recursive delete can never reach
  // through it into the real node_modules.
  try {
    unlinkSync(join(scratch, "node_modules"));
  } catch {
    // already gone
  }
  rmSync(scratch, { recursive: true, force: true });
});

function scan(paths: string[], ignore: string[] = IGNORE) {
  return runJscpd({ root: scratch, paths, ignore, minTokens: MIN_TOKENS, maxSize: MAX_SIZE });
}

describe("runJscpd on the scratch tree", () => {
  it("scans only the paths it is given, and skips the ignored private copies", () => {
    const t = scan(["src"]).statistics.total;
    expect(t.lines).toBe(300);
    expect(t.duplicatedLines).toBe(100);
    expect(t.percentage).toBeCloseTo(33.33, 1);
    expect(t.clones).toBe(1);
  });

  it("covers the .mjs pair alongside .ts", () => {
    const t = scan(["src", "tools"]).statistics.total;
    expect(t.lines).toBe(400);
    expect(t.duplicatedLines).toBe(150);
    expect(t.percentage).toBeCloseTo(37.5, 2);
    expect(t.clones).toBe(2);
  });

  it("throws when a path does not exist", () => {
    expect(() => scan(["tests-that-do-not-exist"])).toThrow("path does not exist");
  });

  it("throws when the scan analyzes no files", () => {
    expect(() => scan(["empty"])).toThrow(/analyzed no files/);
  });
});

function fixture(percentage: number, sources: number): JscpdReport {
  return {
    statistics: { total: { percentage, lines: 1000, duplicatedLines: 0, clones: 0, sources } },
    duplicates: [],
  };
}

describe("judge", () => {
  it("passes a figure exactly at the limit", () => {
    expect(judge(fixture(2.5, 3), 2.5).over).toBe(false);
  });

  it("fails a figure just over the limit", () => {
    expect(judge(fixture(2.5000001, 3), 2.5).over).toBe(true);
  });

  it("flags a scan with no files as empty, not as 0%", () => {
    expect(judge(fixture(0, 0), 2.5).empty).toBe(true);
  });
});

describe("topClones", () => {
  it("lists the largest copies first, with paths relative to the root", () => {
    const clone = (lines: number, a: string, b: string) => ({
      lines,
      firstFile: { name: a, start: 3 },
      secondFile: { name: b, start: 40 },
    });
    const report: JscpdReport = {
      statistics: fixture(0, 3).statistics,
      duplicates: [
        clone(12, "/fake/root/src/x.ts", "/fake/root/tools/y.mjs"),
        clone(8, "/fake/root/src/small.ts", "/fake/root/src/small2.ts"),
        clone(30, "/fake/root/src/render/a.ts", "/fake/root/server/b.ts"),
      ],
    };
    expect(topClones(report, 2, "/fake/root")).toEqual([
      { lines: 30, a: "src/render/a.ts:3", b: "server/b.ts:40" },
      { lines: 12, a: "src/x.ts:3", b: "tools/y.mjs:40" },
    ]);
  });
});
