#!/usr/bin/env node
// Prints the version number for a build — `node tools/app-version.mjs stable`
// or `… insider` → e.g. `0.3.0` / `0.3.12` (no leading "v"). How each part
// moves is appVersionLib.mjs's header; this file only reads git.
//
// Run by .github/workflows/release.yml (stable, on the production branch's
// own checkout) and deploy.yml (insider, on main). Both need a full-history
// checkout (`fetch-depth: 0`) so the release tags and origin/production are
// there to read.
//
// `node tools/app-version.mjs label stable 0.3.0` prints that version's
// footer label instead (`0.3.0 - beta` — src/version.ts's versionLabel owns
// the text), which release.yml uses as the GitHub Release's title so the
// release list and the site's footer can't read differently. It needs no git.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { formatVersion, insiderVersion, latestRelease, nextStable } from "./appVersionLib.mjs";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const lines = (text) => (text ? text.split("\n") : []);

const pkgMajor = Number(JSON.parse(readFileSync("package.json", "utf8")).version.split(".")[0]);
const channel = process.argv[2];

if (channel === "label") {
  const [, , , labelChannel, version] = process.argv;
  if ((labelChannel !== "stable" && labelChannel !== "insider") || !/^\d+\.\d+\.\d+$/.test(version ?? "")) {
    console.error("usage: node tools/app-version.mjs label stable|insider X.Y.Z");
    process.exit(2);
  }
  const { versionLabel } = await import("../src/version.ts");
  console.log(versionLabel({ channel: labelChannel, version }));
} else if (channel === "stable") {
  // HEAD is the production commit being released. A re-run of the same
  // commit keeps the version it was already tagged with.
  const own = latestRelease(lines(git("tag", "--points-at", "HEAD")));
  const latest = latestRelease(lines(git("tag", "--merged", "HEAD")));
  console.log(formatVersion(own ?? nextStable(latest, pkgMajor)));
} else if (channel === "insider") {
  // HEAD is a commit on main. Release tags live on production's merge
  // commits, which main never contains — so read them off origin/production.
  let base;
  try {
    base = git("merge-base", "origin/production", "HEAD");
  } catch {
    console.error("app-version: no origin/production to count from — see .github/workflows/release.yml's header");
    process.exit(1);
  }
  const latest = latestRelease(lines(git("tag", "--merged", "origin/production")));
  const patch = Number(git("rev-list", "--count", "--first-parent", `${base}..HEAD`));
  console.log(formatVersion(insiderVersion(latest, patch, pkgMajor)));
} else {
  console.error("usage: node tools/app-version.mjs stable|insider | label stable|insider X.Y.Z");
  process.exit(2);
}
