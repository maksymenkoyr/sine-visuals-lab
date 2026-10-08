#!/usr/bin/env node
// Prints a Stable GitHub Release's body (markdown) for the commits since the
// last release — what the page says and why is tools/releaseNotesLib.mjs's
// header; this file only gathers the facts from git and GitHub.
//
//   node tools/release-notes.mjs [--tag vX.Y.Z] [--from <ref>] [--to <ref>]
//        [--version-json dist/version.json] [--pr-body <file>] [--repo owner/name] [--prs]
//
// --from defaults to the newest strict vX.Y.Z tag in --to's history, or, run
// from main (whose history never holds the release tags — they sit on
// production's merge commits), the newest one on origin/production.
// --pr-body is a file holding the release pull request's body; its written
// notes open the page. --prs prints only the release's pull request numbers,
// one per line (release.yml comments on each). --version-json adds the scene
// versions this release changed. Authors come from GitHub (`gh`), and a line
// just goes without its "by @…" when that fails.
//
// Run by .github/workflows/release.yml on the production commit it
// publishes, and by tools/release-pr.mjs for the preview it puts in the
// release pull request; run it by hand on main to see the next release's page.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { formatVersion, latestRelease } from "./appVersionLib.mjs";
import { parseRegistryImports, resolveImport } from "./sceneVersionLib.mjs";
import {
  addedSceneUnits,
  categorize,
  changesFromLog,
  extractReleaseNotes,
  renderNotes,
  sceneNameFromSource,
} from "./releaseNotesLib.mjs";

const REGISTRY = "src/render/scenes/index.ts";
const STABLE_URL = "https://www.sinevisualslab.com";

const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 << 20 }).trim();
const lines = (text) => (text ? text.split("\n") : []);

const { values: opts } = parseArgs({
  options: {
    tag: { type: "string" },
    from: { type: "string" },
    to: { type: "string", default: "HEAD" },
    "version-json": { type: "string" },
    "pr-body": { type: "string" },
    repo: { type: "string" },
    prs: { type: "boolean" },
  },
});

function previousTag(to) {
  const newest = (ref) => latestRelease(lines(git("tag", "--merged", ref)).filter((t) => t !== opts.tag));
  let v = newest(to);
  if (!v) {
    try {
      v = newest("origin/production");
    } catch {
      v = null;
    }
  }
  return v ? `v${formatVersion(v)}` : null;
}

function repoName() {
  if (opts.repo) return opts.repo;
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  try {
    return execFileSync("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

/** unit → display name for every scene registered in the checkout. */
function sceneNames() {
  const names = new Map();
  if (!existsSync(REGISTRY)) return names;
  for (const { unit, path } of parseRegistryImports(readFileSync(REGISTRY, "utf8"))) {
    const file = resolveImport(REGISTRY, path, existsSync);
    const name = file ? sceneNameFromSource(readFileSync(file, "utf8")) : null;
    names.set(unit, name ?? unit);
  }
  return names;
}

/** PR number → author login, in one GraphQL call. Empty on any failure. */
function prAuthors(repo, prs) {
  const authors = new Map();
  if (!repo || prs.length === 0) return authors;
  const [owner, name] = repo.split("/");
  const fields = prs.map((n) => `p${n}: pullRequest(number: ${n}) { author { login } }`).join("\n");
  const query = `query { repository(owner: "${owner}", name: "${name}") { ${fields} } }`;
  try {
    const out = execFileSync("gh", ["api", "graphql", "-f", `query=${query}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const repoData = JSON.parse(out).data?.repository ?? {};
    for (const n of prs) {
      const login = repoData[`p${n}`]?.author?.login;
      if (login) authors.set(n, login);
    }
  } catch {
    // GraphQL refuses the whole query if any one PR number doesn't resolve
    // (a `(#N)` that was an issue): fall back to one call each.
    for (const n of prs) {
      try {
        const login = execFileSync("gh", ["api", `repos/${repo}/pulls/${n}`, "-q", ".user.login"], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }).trim();
        if (login) authors.set(n, login);
      } catch {
        // no author for this one
      }
    }
  }
  return authors;
}

const to = opts.to;
const from = opts.from ?? previousTag(to);
const repo = repoName();
const names = sceneNames();
const nameList = [...names.values()];

const log = git("log", "--format=%x1e%H%x1f%P%x1f%s%x1f%b", ...(from ? [`${from}..${to}`] : [to]))
  .split("\x1e")
  .filter((rec) => rec.trim())
  .map((rec) => {
    const [sha, parents, subject, body = ""] = rec.trim().split("\x1f");
    return { sha, parents: parents.split(" ").filter(Boolean), subject, body };
  });
const changes = changesFromLog(log, (sha) => lines(git("rev-list", `${sha}^1..${sha}^2`)));
const prNumbers = [...new Set(changes.map((c) => c.pr).filter(Boolean))];
if (opts.prs) {
  process.stdout.write(prNumbers.sort((a, b) => a - b).map((n) => `${n}\n`).join(""));
  process.exit(0);
}
const authors = prAuthors(repo, prNumbers);

const entries = changes.map((c) => {
  // A merged pull request is everything since its first parent; a single
  // commit is its own diff.
  const files = lines(c.base ? git("diff", "--name-only", c.base, c.sha) : git("diff-tree", "--no-commit-id", "--name-only", "-r", c.sha));
  const registryDiff = () =>
    c.base ? git("diff", "--unified=0", c.base, c.sha, "--", REGISTRY) : git("show", "--format=", "--unified=0", c.sha, "--", REGISTRY);
  const newScenes = files.includes(REGISTRY) ? addedSceneUnits(registryDiff()).filter((u) => names.has(u)) : [];
  return { ...c, author: authors.get(c.pr) ?? null, newScenes, category: categorize({ subject: c.subject, files, newScenes, sceneNames: nameList }) };
});

let sceneVersions = [];
if (opts["version-json"]) {
  const info = JSON.parse(readFileSync(opts["version-json"], "utf8"));
  sceneVersions = (info.scenesChanged ?? []).map((unit) => ({ unit, name: names.get(unit), version: info.scenes?.[unit] ?? "?" }));
}

const notes = opts["pr-body"] && existsSync(opts["pr-body"]) ? extractReleaseNotes(readFileSync(opts["pr-body"], "utf8")) : "";

process.stdout.write(
  renderNotes({ notes, entries, sceneVersions, repo, prevTag: from, tag: opts.tag ?? null, siteUrl: opts.tag ? STABLE_URL : null }),
);
