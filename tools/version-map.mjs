#!/usr/bin/env node
// Writes the version picture — a self-contained HTML page of how the build
// numbers have moved — from the release and build tags. What it draws and
// why is versionMapLib.mjs's header; this file only reads git.
//
//   node tools/version-map.mjs [--out FILE] [--main-ref REF]
//                              [--current-version X.Y.Z --current-commit SHA]
//
// Run by .github/workflows/deploy.yml on every Insiders deploy (writing
// dist/versions.html, with the build being deployed passed as --current-*
// because its own tag does not exist yet) and by `npm run versions`
// (writing tools/.cache/versions.html). It needs the tags and enough history
// to find where the latest release was cut: `git fetch --tags` locally; CI's
// full-history checkout has both.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { formatVersion, latestRelease, parseTag } from "./appVersionLib.mjs";
import { buildVersionMap, parseBuildTag, prFromSubject, renderVersionMap } from "./versionMapLib.mjs";
import { SOURCE_URL } from "../src/brand.ts";
import { versionLabel } from "../src/version.ts";

const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

const git = (...args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const gitOk = (...args) => {
  try {
    execFileSync("git", args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};
const lines = (text) => (text ? text.split("\n") : []);
const byVersion = (a, b) => a.major - b.major || a.minor - b.minor || a.patch - b.patch;

const mainRef = opt("--main-ref") ?? (gitOk("rev-parse", "--verify", "-q", "origin/main") ? "origin/main" : "HEAD");

// Every v* tag with the commit it points at (lightweight or annotated).
const refs = lines(git("for-each-ref", "--format=%(refname:short) %(objectname) %(*objectname)", "refs/tags/v*")).map((line) => {
  const [name, object, peeled] = line.split(" ");
  return { name, commit: peeled || object };
});

const releaseNames = refs.map((r) => r.name).filter((n) => parseTag(n));
const builds = refs.flatMap((r) => {
  const v = parseBuildTag(r.name);
  return v ? [{ ...v, version: formatVersion(v), commit: r.commit }] : [];
});
if (releaseNames.length === 0) console.error("version-map: no release tags found — `git fetch --tags` first? Drawing builds only.");

const subjects = new Map();
const wanted = [...builds.map((b) => b.commit)];
if (opt("--current-commit")) wanted.push(opt("--current-commit"));
if (wanted.length) {
  for (const line of lines(git("log", "--no-walk=unsorted", "--format=%H%x09%s", ...wanted))) {
    const [sha, ...rest] = line.split("\t");
    subjects.set(sha, rest.join("\t"));
  }
}
const prOf = (commit) => prFromSubject(subjects.get(commit) ?? "");

// Where the latest release was cut: the merge base of its tag and main,
// mapped back to the newest Insiders build at or before that commit. Builds
// of the same series after it shipped before the release existed, and count
// again from the cut — `ghostCounts` is where each lands in that count.
let cutVersion = null;
const ghostCounts = {};
const latest = latestRelease(releaseNames);
if (latest) {
  const tag = `v${formatVersion(latest)}`;
  let cutCommit = "";
  try {
    cutCommit = git("merge-base", tag, mainRef);
  } catch {
    console.error(`version-map: no merge base between ${tag} and ${mainRef}; drawing the release without a cut.`);
  }
  if (cutCommit) {
    const before = builds.filter((b) => byVersion(b, { ...latest, patch: 0 }) < 0).sort(byVersion).reverse();
    const cutBuild = before.find((b) => gitOk("merge-base", "--is-ancestor", b.commit, cutCommit));
    if (cutBuild) {
      cutVersion = cutBuild.version;
      for (const b of before) {
        if (b.major === cutBuild.major && b.minor === cutBuild.minor && b.patch > cutBuild.patch) {
          ghostCounts[b.version] = Number(git("rev-list", "--count", "--first-parent", `${cutCommit}..${b.commit}`));
        }
      }
    }
  }
}

const currentVersion = opt("--current-version");
const currentCommit = opt("--current-commit");
const map = buildVersionMap(
  {
    releases: releaseNames.map((n) => formatVersion(parseTag(n))),
    builds: builds.map((b) => ({ version: b.version, pr: prOf(b.commit) })),
    cutVersion,
    ghostCounts,
    current: currentVersion ? { version: currentVersion, pr: currentCommit ? prOf(currentCommit) : null } : null,
    generatedAt: new Date().toISOString(),
    commit: currentCommit ?? (gitOk("rev-parse", "HEAD") ? git("rev-parse", "HEAD") : null),
    repoUrl: SOURCE_URL,
  },
  (channel, version) => versionLabel({ channel, version }),
);

const out = resolve(opt("--out") ?? "tools/.cache/versions.html");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, renderVersionMap(map));
console.log(`version-map: wrote ${out} (Insiders ${map.labels.insidersNow ?? "none"}, Stable ${map.labels.stableNow ?? "none"})`);
