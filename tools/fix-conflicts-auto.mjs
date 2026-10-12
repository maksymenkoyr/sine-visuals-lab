#!/usr/bin/env node
// The no-model pass of tools/fix-conflicts.sh: for every conflicted file
// whose conflicts are only "both sides added lines here" or "both made the
// same change", write the settled text and `git add` it. Rules and why in the
// tools/fixConflictsLib.mjs header. A file with some conflicts it can't
// settle is rewritten with just those left as ours/theirs markers; a file it
// shouldn't touch (binary, lockfile, added or deleted on one side) is left
// exactly as git wrote it. Always exits 0: the shell script looks at what is
// still conflicted afterwards.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { autoResolvable, parseDiff3, resolveSegments } from "./fixConflictsLib.mjs";

const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

/** One side of an unmerged file (stage 1 base, 2 ours, 3 theirs), or null. */
function stage(n, file) {
  const r = spawnSync("git", ["show", `:${n}:${file}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
}

const files = git("diff", "--name-only", "--diff-filter=U").split("\n").filter(Boolean);
const dir = mkdtempSync(join(tmpdir(), "fix-conflicts-"));
try {
  for (const file of files) {
    if (!autoResolvable(file)) continue;
    const [base, ours, theirs] = [1, 2, 3].map((n) => stage(n, file));
    if (base === null || ours === null || theirs === null || [base, ours, theirs].some((s) => s.includes("\0"))) continue;
    const paths = ["ours", "base", "theirs"].map((name) => join(dir, name));
    writeFileSync(paths[0], ours);
    writeFileSync(paths[1], base);
    writeFileSync(paths[2], theirs);
    const merged = spawnSync("git", ["merge-file", "-p", "--diff3", "-L", "ours", "-L", "base", "-L", "theirs", ...paths], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    if (merged.status === null || merged.status < 0 || merged.status > 127) continue;
    const { text, settled, left } = resolveSegments(parseDiff3(merged.stdout));
    if (settled === 0 && merged.status > 0) continue; // nothing gained
    if (left === 0 && file.endsWith(".json")) {
      try {
        JSON.parse(text);
      } catch {
        continue; // keep git's markers; the model looks at it
      }
    }
    writeFileSync(file, text);
    if (left === 0) {
      git("add", "--", file);
      console.log(`auto-resolved ${file} (${settled} conflict${settled === 1 ? "" : "s"}, no model)`);
    } else {
      console.log(`partly resolved ${file}: ${settled} settled, ${left} need judgment`);
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
