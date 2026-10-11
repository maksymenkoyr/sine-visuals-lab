#!/usr/bin/env node
// The copy-paste check: fails when too much of the code is duplicated. It
// exists to catch drift early, such as an agent copying a working scene's
// helpers instead of sharing them, while the copy is still small.
//
//   npm run dupes
//
// CI runs it in .github/workflows/deploy.yml, next to typecheck and test, so a
// copied scene fails the pull request. release.yml does not run it. The
// jscpd calls and the pure judging live in dupesLib.mjs.
//
// Scope: the directories in SCAN_PATHS. tests/ is left out because test setup
// repeats on purpose. The paid-scene checkout under
// src/render/scenes/private/ is gitignored, but IGNORE names it anyway, so a
// local run measures what CI measures.
//
// The figure is the share of lines that sit in a copy, counting one side of
// each copy. The limit is DUPES_LIMIT_PERCENT, and the figure is judged by
// lines because that is what jscpd reports as its percentage; its token-based
// figure is printed in the report but not judged. To retune the limit, run the
// tool, read the current figure, and set the limit with headroom above it: a
// real drift should fail, and one small new scene should not.
//
// Why jscpd 5 and not 4: jscpd 5 is a Rust binary that the package installs
// per platform. jscpd 4 skipped files past a line cap by default, which left
// the biggest scene files out of the count. The size cap here is MAX_SIZE,
// set high enough that no source file is skipped.
//
// Blind spot: GLSL inside TypeScript template strings is read as one string
// token, so copied shader code is not detected. A shader-aware check would be
// a separate change.

import { fileURLToPath } from "node:url";
import { judge, runJscpd, topClones } from "./dupesLib.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCAN_PATHS = ["src", "server", "tools"];
const IGNORE = ["**/scenes/private/**"];
const MIN_TOKENS = 50;
const MAX_SIZE = "10mb";
const DUPES_LIMIT_PERCENT = 2.5;
const SHOWN_CLONES = 5;

function main() {
  let report;
  try {
    report = runJscpd({ root: ROOT, paths: SCAN_PATHS, ignore: IGNORE, minTokens: MIN_TOKENS, maxSize: MAX_SIZE });
  } catch (err) {
    console.error(`dupes: jscpd could not run: ${err.message}`);
    process.exitCode = 2;
    return;
  }

  const verdict = judge(report, DUPES_LIMIT_PERCENT);
  if (verdict.empty) {
    console.error("dupes: scanned no files");
    process.exitCode = 1;
    return;
  }

  console.log(`dupes: ${verdict.percent.toFixed(2)}% of ${verdict.lines} lines duplicated (limit ${DUPES_LIMIT_PERCENT}%)`);
  if (verdict.over) {
    console.error("dupes: over the limit. The biggest copies:");
    for (const c of topClones(report, SHOWN_CLONES, ROOT)) {
      console.error(`  ${c.lines} lines: ${c.a} = ${c.b}`);
    }
    process.exitCode = 1;
  }
}

main();
