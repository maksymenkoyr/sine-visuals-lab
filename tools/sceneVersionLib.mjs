/**
 * Per-scene MAJOR.MINOR.PATCH — the same idea as tools/appVersionLib.mjs's
 * build-wide version, one level down: every registered scene gets its own
 * number, counted from the same git history but scoped to the files that
 * scene alone owns. tools/sceneVersions.mjs is the git/fs orchestration that
 * calls these (one diff per release, one `git log` for patch); this file is
 * everything pure enough to unit-test without a repo on disk
 * (tests/sceneVersion.test.ts) — import parsing, territory/ownership, the
 * version rule itself, and formatting.
 *
 * **Territory** — which files are "a scene's own" — is a static import
 * closure from the scene's entry module, the one
 * `src/render/scenes/index.ts` imports it from: `import { fooScene } from
 * "./foo.ts"` makes `foo.ts` the entry, and every relative import it
 * reaches (recursing through `.ts` files; a non-`.ts` file, e.g. a shader
 * string or `clips.bin`, is a leaf) belongs to it too. A **unit name** — the
 * key everything here and `src/render/scenes/sceneMajors.json` uses — comes
 * from that import path: the file's own basename for a direct file
 * (`"./caustics.ts"` → `"caustics"`), or the folder for anything nested
 * (`"./sky/sky.ts"`, `"./tessera/index.ts"` → `"sky"`, `"tessera"`) —
 * `unitNameFromImportPath`. A file reachable from two or more scenes' closures
 * is shared and belongs to no scene — the same rule
 * `vite-scene-links-plugin.ts`'s `scenesInFlight` uses for "which scene is a
 * changed file working on" — and so is a file the app's own core reaches
 * (the closure of `src/app.ts` and `src/tv.ts`, *not* descending into
 * `src/render/scenes/index.ts` itself, which would just pull in every scene
 * again): that closure is computed as one more owner, named `"app"`, purely
 * to steal shared files away from scenes, then discarded — `ownedFiles`.
 * Territory is computed once, from the *current* checkout, and applied to
 * every release in a scene's history; a renamed scene's older commits are
 * read under its new name, which is wrong for them, so a rename loses that
 * history (nothing tracks it back).
 *
 * **The version rule.** A scene's MAJOR is set by hand, per scene, in
 * `src/render/scenes/sceneMajors.json` (absent = 0) — bump it there to open
 * a new major for that scene, the same deliberate, per-scene act
 * `package.json`'s own `version` is for the whole app. Given the scene's
 * Stable release history oldest-first (each release says whether it shipped
 * a change to the scene's territory, and what the scene's major was in that
 * release's own `sceneMajors.json`) and the scene's *current* major (read
 * from the build's own checkout, so a major raised on `main` but not yet
 * released already shows up) — `sceneVersion`:
 *
 *  - MINOR counts, among releases at the current major, how many changed the
 *    scene — except the release that *first* lands at that major doesn't
 *    also count toward the minor, or a fresh major would open at N.1.0
 *    instead of N.0.0. For major 0 there's no such exception: a scene's
 *    first-ever release is 0.1.0, same reasoning appVersionLib.mjs's
 *    `nextStable` gives the app as a whole (0.0.0 isn't a release anyone
 *    would cut).
 *  - PATCH is the count of first-parent commits on `main` since the last
 *    Stable release that touched the scene's territory (0 for a Stable
 *    build itself, which resets every scene's patch the same way
 *    `nextStable` resets the app's).
 *
 * A scene not yet released at its current major (no history entry carries
 * it) gets minor 0 outright: `M.0.P`.
 *
 * Formatting appends `+dev` — `dev` builds only — when the scene's own
 * territory has an uncommitted change; `formatSceneVersion`'s own doc says
 * more.
 */

import posixPath from "node:path/posix";

// ---------------------------------------------------------------------------
// Import parsing
// ---------------------------------------------------------------------------

// Matches `import`/`export … from "x"`, a bare `import "x"`, and dynamic
// `import("x")`. Deliberately line-oblivious (scans the whole source with the
// `g` flag, not per line) since a real import can wrap across lines
// (`import {\n  a,\n} from "./x.ts"`) — the lazy middle excludes `(`/`)`
// (so it can't cross into a call or a dynamic import) and `=`/`;` (so it
// can't cross an assignment, e.g. `export const X = "not-a-module";`, which
// would otherwise read as an import of whatever string followed). A
// specifier this still mismatches on (an unrelated string literal that
// happens to start with ".") is harmless: `resolveImport` only ever acts on
// one that resolves to a real file.
const STATIC_IMPORT_RE = /\b(?:import|export)\b[^'"()=;]*?["']([^"']+)["']/g;
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

/** Every relative import specifier a `.ts` source references — static
 *  (`import`/`export … from`, side-effect `import "x"`) and dynamic
 *  (`import("x")`) — with any `?query` (`?raw`, `?url`, `?worker&url`, …)
 *  stripped. Bare (package) specifiers are dropped: this repo's own file
 *  graph is the point, not node_modules. Order isn't meaningful; each
 *  specifier appears once. */
export function parseImportSpecifiers(source) {
  const specs = new Set();
  for (const re of [STATIC_IMPORT_RE, DYNAMIC_IMPORT_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(source))) {
      const spec = m[1];
      if (spec.startsWith(".")) specs.add(spec.replace(/\?.*$/, ""));
    }
  }
  return [...specs];
}

/** The scene registry's own `import { binding } from "./path"` lines
 *  (`src/render/scenes/index.ts`, one per registered scene) as
 *  `{ binding, unit, path }` triples, in source order — `unit` is
 *  `unitNameFromImportPath(path)` and `path` is the raw (still relative,
 *  unresolved) specifier, since both a git-side reader
 *  (tools/sceneVersions.mjs, resolving it to build a territory) and the
 *  build-side plugin (vite-scene-versions-plugin.ts, matching it against the
 *  binding already in scope in that same module) need it.
 *
 *  A named import only counts as a *scene* if its binding is also passed to
 *  a `registerScene(binding)` call somewhere in the same source — the actual
 *  mechanism that makes something a scene, not just its being imported from a
 *  relative path. That one check is what keeps the registry's own non-scene
 *  imports out: `listScenes`/`registerScene` themselves (from `"../scene.ts"`)
 *  and `collectPrivateScenes` (from `"./privateScenes.ts"`, used to build the
 *  paid scenes checked out under `private/` — never registered this way, so a
 *  paid scene never gets a public version computed for it either). `import
 *  { a, b as c } from "./x"` yields a triple named `c` (not `b`) if `c` is
 *  what's registered — the registry doesn't rename an import today, but
 *  nothing stops it. */
export function parseRegistryImports(source) {
  const registered = new Set();
  const registerCallRe = /\bregisterScene\(\s*([A-Za-z_$][\w$]*)\s*\)/g;
  let rm;
  while ((rm = registerCallRe.exec(source))) registered.add(rm[1]);

  const importRe = /^[ \t]*import\s*\{\s*([^}]+?)\s*\}\s*from\s*["'](\.[^"']+)["']/gm;
  const out = [];
  let m;
  while ((m = importRe.exec(source))) {
    const path = m[2];
    const unit = unitNameFromImportPath(path);
    for (const part of m[1].split(",")) {
      const binding = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (binding && registered.has(binding)) out.push({ binding, unit, path });
    }
  }
  return out;
}

/** A scene's unit name from the import path the registry uses for it — see
 *  this file's header. Just the first path segment once `./` and a trailing
 *  `.ts` are stripped: a direct file has no further segment, so that segment
 *  *is* its basename; a nested one's first segment is its folder. */
export function unitNameFromImportPath(specifier) {
  return specifier.replace(/^\.\//, "").replace(/\.ts$/, "").split("/")[0];
}

// ---------------------------------------------------------------------------
// Territory / ownership
// ---------------------------------------------------------------------------

/** Resolves a relative `specifier` imported from repo-relative `fromFile` to
 *  a real repo-relative file, given `exists(path) => boolean`: the exact
 *  joined path first, then with `.ts` appended, then `/index.ts` — the same
 *  order a bundler tries them. Null if none exist (a bare import that
 *  slipped through `parseImportSpecifiers`'s relative-only filter can't reach
 *  here, so in practice this only happens for a genuinely broken import). */
export function resolveImport(fromFile, specifier, exists) {
  const joined = posixPath.normalize(posixPath.join(posixPath.dirname(fromFile), specifier));
  for (const candidate of [joined, `${joined}.ts`, `${joined}/index.ts`]) {
    if (exists(candidate)) return candidate;
  }
  return null;
}

/** The set of files reachable from `entryFiles` (one path, or several —
 *  the app owner starts from two): each `.ts` file's relative imports are
 *  parsed and resolved (`readFile(path) => string | null`, `exists`), and
 *  recursed into; a resolved file that isn't `.ts`, or is in `opts.stopAt`,
 *  is included but not descended into (a shader string or `clips.bin` is a
 *  natural leaf; `stopAt` is how the app owner avoids walking back into
 *  `src/render/scenes/index.ts` and swallowing every scene). A `readFile`
 *  miss (shouldn't happen for a file `exists` just confirmed, but a git-show
 *  read can fail for other reasons) drops that file from the walk rather
 *  than throwing — a scene's territory should never crash a build over one
 *  unreadable file. */
export function fileClosure(entryFiles, readFile, exists, opts = {}) {
  const stopAt = opts.stopAt ?? new Set();
  const files = new Set();
  const stack = Array.isArray(entryFiles) ? [...entryFiles] : [entryFiles];
  while (stack.length > 0) {
    const file = stack.pop();
    if (files.has(file)) continue;
    files.add(file);
    if (!file.endsWith(".ts") || stopAt.has(file)) continue;
    const source = readFile(file);
    if (source == null) continue;
    for (const spec of parseImportSpecifiers(source)) {
      const resolved = resolveImport(file, spec, exists);
      if (resolved && !files.has(resolved)) stack.push(resolved);
    }
  }
  return files;
}

/** Assigns each file across every owner's closure to the one owner whose
 *  closure contains it; a file two or more owners reach belongs to none of
 *  them (same rule as `vite-scene-links-plugin.ts`'s `scenesInFlight`).
 *  Every owner in `closures` gets an entry in the result, even an empty one. */
export function ownedFiles(closures) {
  const ownerOf = new Map();
  for (const [owner, files] of closures) {
    for (const f of files) ownerOf.set(f, ownerOf.has(f) ? null : owner);
  }
  const result = new Map([...closures.keys()].map((owner) => [owner, new Set()]));
  for (const [file, owner] of ownerOf) {
    if (owner !== null) result.get(owner).add(file);
  }
  return result;
}

/** Whether any of `files` is in `territory` — one release's changed-file
 *  diff against a scene's territory, or the dev channel's dirty-file list
 *  against it. */
export function intersects(files, territory) {
  for (const f of files) if (territory.has(f)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// sceneMajors.json
// ---------------------------------------------------------------------------

/** Parses `src/render/scenes/sceneMajors.json`'s text (at some commit, or
 *  off disk) into a plain object — `{}` if `text` is null/empty, isn't valid
 *  JSON, or doesn't parse to a plain object, so a missing or corrupted file
 *  reads as "every scene is major 0" rather than failing a build. */
export function parseSceneMajors(text) {
  if (!text) return {};
  try {
    const obj = JSON.parse(text);
    return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : {};
  } catch {
    return {};
  }
}

/** A scene's major from a parsed `sceneMajors.json` — 0 if the unit has no
 *  entry, or its value isn't a non-negative integer. */
export function majorOf(sceneMajors, unit) {
  const v = sceneMajors[unit];
  return Number.isInteger(v) && v >= 0 ? v : 0;
}

// ---------------------------------------------------------------------------
// The version rule
// ---------------------------------------------------------------------------

/** `{major, minor, patch}` for one scene — see this file's header for the
 *  rule. `releases` is oldest-first; only the ones at `currentMajor` matter
 *  (`atMajor`). The subtraction is what keeps the major-landing release from
 *  double-counting: it's already "the M.0.0 release" by virtue of raising
 *  the major, so it doesn't also bump the minor the way every later changed
 *  release at that major does. */
export function sceneVersion(releases, currentMajor, patch) {
  const atMajor = releases.filter((r) => r.major === currentMajor);
  const changedCount = atMajor.filter((r) => r.changed).length;
  const landing = currentMajor > 0 && atMajor.length > 0 && atMajor[0].changed;
  const minor = changedCount - (landing ? 1 : 0);
  return { major: currentMajor, minor, patch };
}

/** `sceneVersion`'s result as the string a scene's version corner shows —
 *  `"0.2.3"`, or `"0.2.3+dev"` when `dirty` (dev channel only: the scene's
 *  own territory has an uncommitted change — see
 *  tools/sceneVersions.mjs's header). */
export function formatSceneVersion(v, dirty = false) {
  return `${v.major}.${v.minor}.${v.patch}${dirty ? "+dev" : ""}`;
}
