/**
 * Git/fs orchestration for per-scene versions — the counting rules and
 * territory/ownership are tools/sceneVersionLib.mjs's header; this file only
 * reads git and the checkout to feed that pure rule, the same split
 * tools/app-version.mjs (git) / tools/appVersionLib.mjs (rule) has for the
 * build-wide version.
 *
 * `computeSceneVersions({ root, channel })` does the real work, once:
 *
 *  1. Territory, from the *current* checkout on disk (§ sceneVersionLib.mjs):
 *     read `src/render/scenes/index.ts`, resolve each registered scene's
 *     entry file and walk its closure, plus the app owner's closure
 *     (`src/app.ts` + `src/tv.ts`, stopping at the registry) purely to steal
 *     shared files away from scenes.
 *  2. The release list: strict `vX.Y.Z` tags merged into `origin/production`
 *     (every channel but stable) or into `HEAD` (stable — the commit being
 *     released may not be tagged yet, so it's appended as one more "release"
 *     with patch 0 when it carries no such tag itself; a re-run of an
 *     already-tagged commit needs no appending, since that tag is already
 *     `--merged HEAD`). Sorted oldest first.
 *  3. One diff per release (empty-tree for the first), intersected against
 *     every scene's territory at once, plus that release's own
 *     `sceneMajors.json` (`git show <rev>:path`) — together, one scene's
 *     `{changed, major}` release history for tools/sceneVersionLib.mjs's
 *     `sceneVersion`.
 *  4. The scene's *current* major, read off the live checkout (not a
 *     historical commit) — so a major bumped on `main` but not yet released
 *     shows up immediately, the invariant `sceneVersion`'s own header
 *     explains.
 *  5. PATCH: on stable, always 0 (a release resets it, same as the app's
 *     own `nextStable`). Otherwise, one `git log --first-parent --name-only`
 *     over every first-parent commit since `merge-base(origin/production,
 *     HEAD)`, counted per scene.
 *  6. `dev` only: `git status --porcelain` (tracked and untracked) against
 *     each scene's territory decides its `+dev` suffix.
 *
 * Unavailable git or no `origin/production` (a shallow CI checkout, or a
 * fresh clone nobody's fetched) returns `null` — logged once as a warning,
 * never thrown: a scene simply shows no version rather than failing a build
 * or a dev server over it (mirrors tools/app-version.mjs's own
 * `origin/production` guard, but softer — that one's a CLI that's allowed to
 * exit non-zero, this is read by a page that still has to render).
 *
 * `getCachedSceneVersions` memoizes the last `{root, channel}` result (one
 * in-flight promise, not a cache per key — a process only ever builds one
 * root/channel at a time) so `vite-build-info-plugin.ts` (version.json's
 * `scenes`/`scenesChanged`) and `vite-scene-versions-plugin.ts` (the
 * per-scene `setSceneVersions` call) share one git read instead of paying for
 * it twice per build. `clearSceneVersionsCache()` is
 * `vite-scene-versions-plugin.ts`'s dev-server file-watcher hook, so an
 * edited scene's `+dev` mark is never stale.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { parseTag } from "./appVersionLib.mjs";
import {
  fileClosure,
  formatSceneVersion,
  intersects,
  majorOf,
  ownedFiles,
  parseRegistryImports,
  parseSceneMajors,
  resolveImport,
  sceneVersion,
} from "./sceneVersionLib.mjs";

const REGISTRY_REL = "src/render/scenes/index.ts";
const APP_ENTRIES = ["src/app.ts", "src/tv.ts"];
const SCENE_MAJORS_REL = "src/render/scenes/sceneMajors.json";
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

function warn(message) {
  console.warn(`[scene-versions] ${message}`);
}

function makeGit(root) {
  return (...args) => {
    try {
      return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
    } catch (err) {
      throw new Error(`git ${args.join(" ")}: ${err.message}`);
    }
  };
}

function makeReadFile(root) {
  return (rel) => {
    try {
      return readFileSync(path.join(root, rel), "utf8");
    } catch {
      return null;
    }
  };
}

function makeExists(root) {
  return (rel) => existsSync(path.join(root, rel));
}

/** Territory (unit -> Set<repo-relative path>) and each registered binding's
 *  unit, from the checkout at `root` — see this file's header, § 1. */
function computeTerritory(root) {
  const readFile = makeReadFile(root);
  const exists = makeExists(root);
  const registrySource = readFile(REGISTRY_REL);
  if (registrySource == null) throw new Error(`${REGISTRY_REL} not found under ${root}`);

  const closures = new Map();
  const bindingToUnit = new Map();
  for (const { binding, unit, path: specifier } of parseRegistryImports(registrySource)) {
    bindingToUnit.set(binding, unit);
    if (closures.has(unit)) continue; // a scene registers one entry
    const entryFile = resolveImport(REGISTRY_REL, specifier, exists);
    if (!entryFile) {
      warn(`${REGISTRY_REL}: couldn't resolve "${specifier}" (unit "${unit}") — it gets no version`);
      continue;
    }
    closures.set(unit, fileClosure([entryFile], readFile, exists));
  }
  closures.set("app", fileClosure(APP_ENTRIES, readFile, exists, { stopAt: new Set([REGISTRY_REL]) }));

  const territory = ownedFiles(closures);
  territory.delete("app"); // only existed to steal shared files from scenes
  return { territory, bindingToUnit };
}

/** Strict `vX.Y.Z` tags merged into `mergedRef`, resolved to their commit and
 *  sorted oldest first. Null if `mergedRef` can't be read at all (no such
 *  ref locally — the caller's cue to give up on scene versions entirely). */
function releaseList(git, mergedRef) {
  let raw;
  try {
    raw = git("tag", "--merged", mergedRef);
  } catch {
    return null;
  }
  const releases = [];
  for (const tag of raw ? raw.split("\n").filter(Boolean) : []) {
    const version = parseTag(tag);
    if (!version) continue; // an Insider -beta tag, or anything non-strict
    const sha = git("rev-list", "-n", "1", tag);
    releases.push({ tag, version, sha });
  }
  releases.sort(
    (a, b) => a.version.major - b.version.major || a.version.minor - b.version.minor || a.version.patch - b.version.patch,
  );
  return releases;
}

function diffFiles(git, fromSha, toSha) {
  const out = git("diff", "--name-only", fromSha, toSha);
  return out ? out.split("\n").filter(Boolean) : [];
}

function sceneMajorsAt(git, sha) {
  let text;
  try {
    text = git("show", `${sha}:${SCENE_MAJORS_REL}`);
  } catch {
    text = null; // the file didn't exist yet at that commit
  }
  return parseSceneMajors(text);
}

/** One `git log --first-parent --name-only` over `base..HEAD`, split into
 *  one changed-file list per commit — § 5's "one call, not per scene". Each
 *  commit is separated by a NUL byte (`%x00`) so a commit message containing
 *  a blank line can't be mistaken for the next commit's boundary. */
function commitFileLists(git, base, head) {
  const raw = git("log", "--first-parent", "--name-only", "--format=%x00", `${base}..${head}`);
  if (!raw) return [];
  return raw
    .split("\0")
    .slice(1) // the text before the first marker is empty
    .map((chunk) => chunk.split("\n").map((line) => line.trim()).filter(Boolean));
}

/** Tracked and untracked working-tree changes, repo-relative — same
 *  porcelain reading as vite-scene-links-plugin.ts's `changedSceneFiles`,
 *  duplicated rather than shared across the .mjs/.ts boundary. */
function dirtyFiles(root) {
  const raw = execFileSync("git", ["status", "--porcelain", "-z", "--untracked-files=all"], {
    cwd: root,
    encoding: "utf8",
  });
  const files = [];
  const entries = raw.split("\0");
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;
    files.push(entry.slice(3));
    if (entry[0] === "R" || entry[0] === "C") i++; // a rename's old path has no meaning here
  }
  return files;
}

/** `{ byUnit, byBinding, changedUnits }` for every registered scene, or
 *  `null` if git/`origin/production` wasn't available — see this file's
 *  header. `changedUnits` (stable only) is which units the release being cut
 *  right now changes. */
export async function computeSceneVersions({ root, channel }) {
  let territory, bindingToUnit;
  try {
    ({ territory, bindingToUnit } = computeTerritory(root));
  } catch (err) {
    warn(`couldn't compute scene territory: ${err.message}`);
    return null;
  }

  const git = makeGit(root);
  const mergedRef = channel === "stable" ? "HEAD" : "origin/production";
  const releases = releaseList(git, mergedRef);
  if (releases === null) {
    warn(`"${mergedRef}" isn't available in this checkout — no scene versions this build`);
    return null;
  }

  if (channel === "stable") {
    let headSha = null;
    try {
      headSha = git("rev-parse", "HEAD");
    } catch {
      /* left null; the loop below still runs off the tagged releases alone */
    }
    if (headSha && !releases.some((r) => r.sha === headSha)) {
      releases.push({ tag: null, version: null, sha: headSha });
    }
  }

  // One diff (and one sceneMajors.json read) per release, not per scene.
  const perUnitHistory = new Map([...territory.keys()].map((unit) => [unit, []]));
  let prevSha = EMPTY_TREE;
  for (const release of releases) {
    const changedFiles = diffFiles(git, prevSha, release.sha);
    const majorsAtRelease = sceneMajorsAt(git, release.sha);
    for (const [unit, files] of territory) {
      perUnitHistory.get(unit).push({ changed: intersects(changedFiles, files), major: majorOf(majorsAtRelease, unit) });
    }
    prevSha = release.sha;
  }

  const currentMajors = parseSceneMajors(makeReadFile(root)(SCENE_MAJORS_REL));

  let patchByUnit;
  if (channel === "stable") {
    patchByUnit = new Map([...territory.keys()].map((unit) => [unit, 0]));
  } else {
    let base;
    try {
      base = git("merge-base", "origin/production", "HEAD");
    } catch {
      warn("no merge-base with origin/production — no scene versions this build");
      return null;
    }
    const commitFiles = commitFileLists(git, base, "HEAD");
    patchByUnit = new Map([...territory.keys()].map((unit) => [unit, 0]));
    for (const files of commitFiles) {
      for (const [unit, terr] of territory) {
        if (intersects(files, terr)) patchByUnit.set(unit, patchByUnit.get(unit) + 1);
      }
    }
  }

  let dirty = [];
  if (channel === "dev") {
    try {
      dirty = dirtyFiles(root);
    } catch {
      dirty = [];
    }
  }

  const byUnit = {};
  const changedUnits = [];
  for (const [unit, files] of territory) {
    const history = perUnitHistory.get(unit);
    const currentMajor = majorOf(currentMajors, unit);
    const version = sceneVersion(history, currentMajor, patchByUnit.get(unit) ?? 0);
    byUnit[unit] = formatSceneVersion(version, channel === "dev" && intersects(dirty, files));
    if (channel === "stable" && history[history.length - 1]?.changed) changedUnits.push(unit);
  }

  const byBinding = {};
  for (const [binding, unit] of bindingToUnit) {
    if (unit in byUnit) byBinding[binding] = byUnit[unit];
  }

  return { byUnit, byBinding, changedUnits };
}

let cache = null; // { key, promise }

/** `computeSceneVersions`, memoized by `{root, channel}` — see this file's
 *  header for why two plugins share one call. */
export function getCachedSceneVersions({ root, channel }) {
  const key = `${root}\u0000${channel}`;
  if (!cache || cache.key !== key) {
    cache = { key, promise: computeSceneVersions({ root, channel }) };
  }
  return cache.promise;
}

/** Drops the memoized result — vite-scene-versions-plugin.ts's dev-server
 *  file watcher, so an edited scene's `+dev` mark is never stale. */
export function clearSceneVersionsCache() {
  cache = null;
}
