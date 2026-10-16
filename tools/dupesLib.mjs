// Helpers for tools/dupes.mjs, the copy-paste check: the argument list for
// jscpd, the verdict on its report, the largest copies for a failure message,
// and the one call that runs jscpd and reads its report back. Unit-tested by
// tests/dupes.test.ts, which points runJscpd at a scratch tree, so the scope
// and the limit live only in tools/dupes.mjs.
//
// jscpd is a devDependency, pinned exactly in package.json. It is a Rust
// binary reached through its run-jscpd.js launcher under node_modules. Its
// report's percentage is the share of LINES that sit inside a copy, counting
// one side of each copy only: a copied block adds its lines once, not twice.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

/** The argv for jscpd's launcher. Every path is relative to the run's root.
 *  The json reporter writes `jscpd-report.json` into `outDir`. `--absolute`
 *  makes clone names absolute, so topClones can make them relative again.
 *  `--fail-on-empty` turns a scan that matches no files into a non-zero exit,
 *  so it can't read as a clean 0%. */
export function jscpdArgs({ paths, ignore, minTokens, maxSize, outDir }) {
  return [
    ...paths,
    "--format", "typescript,javascript",
    "--min-tokens", String(minTokens),
    "--max-size", maxSize,
    "--ignore", ignore.join(","),
    "--reporters", "json",
    "--output", outDir,
    "--absolute",
    "--no-colors",
    "--fail-on-empty",
  ];
}

/** Reduce a parsed jscpd report to what the CLI prints and judges. `over` is
 *  strict: a figure exactly at the limit passes. `empty` is a scan that found
 *  no files, which must fail rather than read as 0%. */
export function judge(report, limit) {
  const t = report.statistics.total;
  return {
    percent: t.percentage,
    lines: t.lines,
    duplicatedLines: t.duplicatedLines,
    clones: t.clones,
    files: t.sources,
    empty: t.sources === 0,
    over: t.percentage > limit,
  };
}

/** The `n` largest copies, largest first, as `{ lines, a, b }`. `a` and `b`
 *  are `path:startLine`, with the path relative to `root`. */
export function topClones(report, n, root) {
  const where = (loc) => `${relative(root, loc.name)}:${loc.start}`;
  return [...report.duplicates]
    .sort((x, y) => y.lines - x.lines)
    .slice(0, n)
    .map((d) => ({ lines: d.lines, a: where(d.firstFile), b: where(d.secondFile) }));
}

/** Run jscpd over `paths` (relative to `root`) and return its parsed report.
 *  Throws with jscpd's own output when it exits non-zero, for example for a
 *  path that does not exist or a scan that matched no files. The launcher is
 *  looked up under `root`'s node_modules, so `root` needs its own install. */
export function runJscpd({ root, paths, ignore, minTokens, maxSize }) {
  const outDir = mkdtempSync(join(tmpdir(), "dupes-"));
  try {
    const launcher = join(root, "node_modules", "jscpd", "run-jscpd.js");
    const args = jscpdArgs({ paths, ignore, minTokens, maxSize, outDir });
    try {
      execFileSync(process.execPath, [launcher, ...args], {
        cwd: root,
        encoding: "utf8",
        stdio: "pipe",
      });
    } catch (err) {
      const output = [err.stdout, err.stderr].filter(Boolean).join("").trim();
      throw new Error(output || err.message);
    }
    return JSON.parse(readFileSync(join(outDir, "jscpd-report.json"), "utf8"));
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}
