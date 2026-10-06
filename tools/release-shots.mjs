#!/usr/bin/env node
// Hosts a release's pictures and prints one markdown image line per file, for
// the notes `/release` writes (.claude/commands/release.md).
//
//   npm run release-shots -- <image>...
//
// The files become assets of the Insiders pre-release of the build that ships
// — the newest `vX.Y.Z-beta` tag on origin/main (deploy.yml publishes one per
// push) — so they cost the repo nothing and live as long as that pre-release,
// which nothing deletes. `npm run pr-shots` is the place for a PR review's
// screenshots instead: its branch is safe to delete, and a Release's pictures
// must outlast it. A file of the same name replaces the one before it.
//
// The repo is public: never a paid scene.

import { execFileSync } from "node:child_process";
import path from "node:path";

const files = process.argv.slice(2);
if (!files.length) {
  console.error("usage: npm run release-shots -- <image>...");
  process.exit(1);
}
const run = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();

run("git", ["fetch", "-q", "--tags", "origin", "main"]);
const tag = run("git", ["describe", "--tags", "--abbrev=0", "--match", "v*-beta", "origin/main"]);
const repo = run("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]);
run("gh", ["release", "upload", tag, ...files, "--clobber", "--repo", repo]);
console.error(`uploaded to ${tag}`);
for (const f of files) {
  // GitHub stores an asset under its file name with spaces turned to dots.
  const name = path.basename(f).replace(/ /g, ".");
  console.log(`![${path.parse(f).name}](https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(name)})`);
}
