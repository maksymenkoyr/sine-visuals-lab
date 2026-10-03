#!/usr/bin/env node
// Puts a couple of screenshots into a PR body. GitHub's image upload has no
// API, so this commits the files to the `pr-screenshots` branch (never merged,
// safe to delete) without touching your checkout, and prints one markdown
// image line per file to paste into the PR.
//
//   npm run pr-shots -- before.png after.png
//
// The repo is public: never a paid scene.

import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const BRANCH = "pr-screenshots";
const files = process.argv.slice(2);
if (!files.length) {
  console.error("usage: npm run pr-shots -- <image>...");
  process.exit(1);
}
const index = path.join(mkdtempSync(path.join(tmpdir(), "pr-shots-")), "index");
const git = (...args) =>
  execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_INDEX_FILE: index },
  }).trim();

let parent = null;
try {
  git("fetch", "-q", "origin", `+${BRANCH}:refs/remotes/origin/${BRANCH}`);
  parent = git("rev-parse", `origin/${BRANCH}`);
  git("read-tree", parent);
} catch {
  // First upload: the branch doesn't exist yet.
}
const dir = git("rev-parse", "--abbrev-ref", "HEAD").replace(/[^\w.-]+/g, "-");
for (const f of files)
  git("update-index", "--add", "--cacheinfo", `100644,${git("hash-object", "-w", f)},${dir}/${path.basename(f)}`);
const commit = git("commit-tree", git("write-tree"), ...(parent ? ["-p", parent] : []), "-m", dir);
git("push", "-q", "origin", `${commit}:refs/heads/${BRANCH}`);

const repo = git("remote", "get-url", "origin").replace(/^.*github\.com[:/]/, "").replace(/\.git$/, "");
for (const f of files)
  console.log(`![${path.parse(f).name}](https://raw.githubusercontent.com/${repo}/${commit}/${dir}/${path.basename(f)})`);
