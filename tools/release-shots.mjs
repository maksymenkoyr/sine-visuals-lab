#!/usr/bin/env node
// Hosts a release's pictures and points the notes at them, for `/release`
// (.claude/commands/release.md).
//
//   npm run release-shots -- --notes <notes.md> <image>...
//
// The notes are written with each picture's local path (`src="stills/x.jpg"`,
// which is what their local preview shows); this uploads the files and
// rewrites every such `src` in <notes.md> to the hosted copy, in place.
// Without --notes it just prints each file's URL.
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
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const { values: opts, positionals: files } = parseArgs({ options: { notes: { type: "string" } }, allowPositionals: true });
if (!files.length) {
  console.error("usage: npm run release-shots -- [--notes <notes.md>] <image>...");
  process.exit(1);
}
const run = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();

run("git", ["fetch", "-q", "--tags", "origin", "main"]);
const tag = run("git", ["describe", "--tags", "--abbrev=0", "--match", "v*-beta", "origin/main"]);
const repo = run("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]);
run("gh", ["release", "upload", tag, ...files, "--clobber", "--repo", repo]);
console.error(`uploaded to ${tag}`);

// GitHub stores an asset under its file name with spaces turned to dots.
const urls = new Map(
  files.map((f) => [path.basename(f), `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(path.basename(f).replace(/ /g, "."))}`]),
);
if (!opts.notes) {
  for (const url of urls.values()) console.log(url);
  process.exit(0);
}
let missing = 0;
const notes = readFileSync(opts.notes, "utf8").replace(/src="(?:[^"]*\/)?([^"/]+\.(?:jpe?g|png|gif|webp))"/g, (m, name) => {
  const url = urls.get(name);
  if (!url) missing++;
  return url ? `src="${url}"` : m;
});
writeFileSync(opts.notes, notes);
console.error(`pointed ${opts.notes} at ${urls.size} pictures${missing ? `; ${missing} src left local (not among the files)` : ""}`);
