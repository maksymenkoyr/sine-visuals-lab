import { describe, it, expect } from "vitest";
import {
  addedLines,
  astGrepFindings,
  biomeFindings,
  compareToBaseline,
  finding,
  fingerprint,
  isPermissive,
  knipFindings,
  licenseProblems,
  missingNotices,
  testFilesDone,
} from "../tools/checkLib.mjs";

// The pure half of `npm run check` (tools/check.mjs header). The tools
// themselves aren't run here: each rule's own examples in rule-tests/ run as
// the first part of the check's rules step.

describe("isPermissive", () => {
  it("accepts the permissive ids and rejects copyleft ones", () => {
    for (const id of ["MIT", "ISC", "Apache-2.0", "BSD-3-Clause", "OFL-1.1", "0BSD"]) expect(isPermissive(id)).toBe(true);
    for (const id of ["GPL-3.0", "LGPL-3.0-or-later", "AGPL-3.0-only", "MPL-2.0", "UNLICENSED"]) expect(isPermissive(id)).toBe(false);
  });

  it("needs one permissive side of an OR and both sides of an AND", () => {
    expect(isPermissive("MIT OR Apache-2.0")).toBe(true);
    expect(isPermissive("(GPL-2.0 OR MIT)")).toBe(true);
    expect(isPermissive("Apache-2.0 AND LGPL-3.0-or-later")).toBe(false);
    expect(isPermissive("Apache-2.0 AND MIT")).toBe(true);
    expect(isPermissive("(MIT AND BSD-3-Clause) OR GPL-3.0")).toBe(true);
  });

  it("judges `X WITH exception` by X, and a missing license as not permissive", () => {
    expect(isPermissive("Apache-2.0 WITH LLVM-exception")).toBe(true);
    expect(isPermissive("GPL-2.0 WITH Classpath-exception-2.0")).toBe(false);
    expect(isPermissive(undefined)).toBe(false);
    expect(isPermissive("")).toBe(false);
  });
});

describe("licenseProblems", () => {
  const lock = {
    packages: {
      "": { version: "0.1.0" },
      "node_modules/ok": { version: "1.0.0", license: "MIT" },
      "node_modules/bad": { version: "2.0.0", license: "GPL-3.0" },
      "node_modules/a/node_modules/nested-bad": { version: "1.0.0", license: "AGPL-3.0" },
      "node_modules/@img/sharp-libvips-x": { version: "1.0.0", license: "LGPL-3.0-or-later" },
      "node_modules/none": { version: "1.0.0" },
    },
  };

  it("lists each non-permissive package by its own name, skipping listed exceptions", () => {
    expect(licenseProblems(lock, [{ name: "@img/sharp-*", reason: "dev only" }])).toEqual([
      { name: "bad", version: "2.0.0", license: "GPL-3.0" },
      { name: "nested-bad", version: "1.0.0", license: "AGPL-3.0" },
      { name: "none", version: "1.0.0", license: "(none listed)" },
    ]);
  });

  it("matches an exception without a * by its exact name only", () => {
    const names = licenseProblems(lock, [{ name: "@img/sharp", reason: "" }]).map((p) => p.name);
    expect(names).toContain("@img/sharp-libvips-x");
  });
});

describe("missingNotices", () => {
  it("lists runtime dependencies the notices file never names, ignoring dev ones", () => {
    const pkg = { dependencies: { fflate: "1", "qrcode-generator": "2" }, devDependencies: { vite: "6" } };
    expect(missingNotices(pkg, "## fflate (the share code)\n")).toEqual(["qrcode-generator"]);
  });
});

describe("baseline", () => {
  const a = finding("rules", "scene-reads-drive", "src/x.ts", 10, "  const f =   frame.onset; ", "msg");

  it("keys a finding by its code, not its line number", () => {
    const moved = { ...a, line: 99 };
    expect(fingerprint(moved)).toBe(fingerprint(a));
    expect(fingerprint(a)).toBe("rules | scene-reads-drive | src/x.ts | const f = frame.onset;");
  });

  it("reports what the baseline doesn't cover and what it no longer needs", () => {
    const b = finding("rules", "scene-reads-drive", "src/x.ts", 12, "const g = frame.level;", "msg");
    const { fresh, gone } = compareToBaseline([a], [fingerprint(b)]);
    expect(fresh).toEqual([a]);
    expect(gone).toEqual([fingerprint(b)]);
  });

  it("counts identical lines: one entry covers one of them, not both", () => {
    const twin = { ...a, line: 20 };
    const { fresh, gone } = compareToBaseline([a, twin], [fingerprint(a)]);
    expect(fresh).toEqual([twin]);
    expect(gone).toEqual([]);
  });
});

describe("tool output to findings", () => {
  it("reads ast-grep matches", () => {
    const [f] = astGrepFindings([
      { ruleId: "no-private-import", file: "src/a.ts", lines: 'import x from "./private/y";\nmore', message: "m", range: { start: { line: 4 } } },
    ]);
    expect(f).toMatchObject({ tool: "rules", rule: "no-private-import", file: "src/a.ts", line: 5, text: 'import x from "./private/y";' });
  });

  it("reads Biome diagnostics and keeps only lint ones", () => {
    const fs = biomeFindings(
      {
        diagnostics: [
          { category: "lint/suspicious/noGlobalIsFinite", message: "m", location: { path: "src/a.ts", start: { line: 3 } } },
          { category: "parse", message: "p", location: { path: "src/b.ts", start: { line: 1 } } },
        ],
      },
      (path, line) => `${path}@${line}`,
    );
    expect(fs).toEqual([finding("lint", "suspicious/noGlobalIsFinite", "src/a.ts", 3, "src/a.ts@3", "m")]);
  });

  it("reads knip issues, including duplicate exports listed as a group", () => {
    const fs = knipFindings({
      issues: [
        {
          file: "src/a.ts",
          exports: [{ name: "FOO", line: 2 }],
          types: [],
          duplicates: [[{ name: "A", line: 1 }, { name: "B" }]],
          files: [],
        },
      ],
    });
    expect(fs.map((f) => `${f.rule}:${f.text}:${f.line}`)).toEqual(["exports:FOO:2", "duplicates:A | B:1"]);
  });
});

describe("addedLines", () => {
  it("gives each added line its file and new line number", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -3,0 +4,2 @@ ctx",
      "+const a = 1;",
      "+const b = 2;",
      "@@ -10 +12 @@",
      "-old",
      "+new",
      "diff --git a/gone.ts b/gone.ts",
      "--- a/gone.ts",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-bye",
    ].join("\n");
    expect(addedLines(diff)).toEqual([
      { file: "src/a.ts", line: 4, text: "const a = 1;" },
      { file: "src/a.ts", line: 5, text: "const b = 2;" },
      { file: "src/a.ts", line: 12, text: "new" },
    ]);
  });
});

describe("testFilesDone", () => {
  it("counts finished test files in vitest's piped output, passed or failed, colour or not", () => {
    const out = [
      " RUN  v3",
      "",
      " ✓ tests/a.test.ts (3 tests) 4ms",
      " ❯ tests/b.test.ts (2 tests | 1 failed) 9ms",
      "\u001b[32m ✓\u001b[39m tests/c.test.ts (1 test) 2ms",
      " Test Files  3",
    ].join("\n");
    expect(testFilesDone(out)).toBe(3);
    expect(testFilesDone(" RUN  v3\n")).toBe(0);
  });
});
