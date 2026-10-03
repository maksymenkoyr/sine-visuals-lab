/**
 * The body of a Stable GitHub Release — the pure half (tests/releaseNotes.test.ts);
 * tools/release-notes.mjs reads git and GitHub and hands the facts in here.
 * Modelled on the GitHub CLI's own release pages: an optional hand-written
 * lead, then "What's Changed" with one line per pull request
 * (`title by @author in #N`) under a heading for the part of the app it
 * changed, then a Full Changelog compare link.
 *
 * **Highlights** — the hand-written lead — come from the release pull request
 * itself: `npm run release` (tools/release-pr.mjs) opens it with an empty
 * "## Highlights" section, and whatever is written there before merging
 * opens the Release (`extractHighlights`). Left empty, the Release is just
 * the generated list.
 *
 * **Categories** (`CATEGORIES`, in page order) are worked out per pull
 * request from its title and the files it touched — `categorize` — since PRs
 * here carry no labels. A pull request that registers a scene in
 * `src/render/scenes/index.ts` is a new scene; a title whose `Area:` prefix
 * names a scene is that scene's change, and one that names a product area
 * (`PREFIX_AREAS`) goes there; otherwise the product area with the most
 * touched files wins, and docs/tooling only when no product file moved.
 */

import { unitNameFromImportPath } from "./sceneVersionLib.mjs";

/** Page order. `key` is what `categorize` returns. */
export const CATEGORIES = [
  { key: "newScene", title: "🆕 New scenes" },
  { key: "scenes", title: "🎨 Scenes" },
  { key: "sound", title: "🔊 Sound & beat" },
  { key: "output", title: "📺 Output & rooms" },
  { key: "app", title: "🎛 Controls & app" },
  { key: "other", title: "📚 Docs & tooling" },
];

/** The PR number a squash-merged commit's subject ends with — `… (#123)`. */
export function prNumberFromSubject(subject) {
  const m = /\(#(\d+)\)\s*$/.exec(subject);
  return m ? Number(m[1]) : null;
}

/** The subject without its trailing `(#N)`. */
export function stripPrSuffix(subject) {
  return subject.replace(/\s*\(#\d+\)\s*$/, "");
}

/** The hand-written lead from a release pull request's body: everything
 *  under a `## Highlights` heading up to the next `##` heading or a `---`
 *  rule, HTML comments removed. "" when there's no such section or it's
 *  empty. */
export function extractHighlights(body) {
  if (!body) return "";
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((l) => /^##\s+Highlights\s*$/i.test(l.trim()));
  if (start < 0) return "";
  const out = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/.test(line) || /^-{3,}\s*$/.test(line.trim())) break;
    out.push(line);
  }
  return out.join("\n").replace(/<!--[\s\S]*?-->/g, "").trim();
}

/** Scene units a commit registers: `+import { fooScene } from "./foo.ts"`
 *  lines of its diff to `src/render/scenes/index.ts`. */
export function addedSceneUnits(registryDiff) {
  const units = [];
  const re = /^\+[ \t]*import\s*\{\s*([^}]+?)\s*\}\s*from\s*["'](\.\/[^"']+)["']/gm;
  let m;
  while ((m = re.exec(registryDiff ?? ""))) {
    if (!/Scene\b/.test(m[1]) || /privateScenes/.test(m[2])) continue;
    units.push(unitNameFromImportPath(m[2]));
  }
  return units;
}

/** A scene's display name from its entry module's source: the `name: "…"`
 *  right after the scene object's `id:`, or the second argument of
 *  `createFullscreenScene("id", "Name", …)`. Null if it's written neither
 *  way (the caller falls back to the unit name). */
export function sceneNameFromSource(source) {
  const m =
    /\bid:\s*[^,\n]+,\s*name:\s*["']([^"']+)["']/.exec(source ?? "") ??
    /\bcreateFullscreenScene\(\s*[^,()]+,\s*["']([^"']+)["']/.exec(source ?? "");
  return m ? m[1] : null;
}

const SOUND_RE = /^src\/audio\/|^src\/render\/[^/]*(drive|beat|tempo|metronome|musicProfile|autoTune|onset|silence)[^/]*$/i;
const OUTPUT_RE = /^src\/net\/|^server\/|^src\/tv\.ts$|^tv\.html$|^wrangler\.toml$|^src\/ui\/output/i;
const SCENE_RE = /^src\/render\/scenes\/|^docs\/scenes\//;
const APP_RE = /^src\/|^index\.html$|^public\//;

// A title's `Area:` prefix that names a product area outright — checked
// before the file counts, since a feature's UI files often outnumber the
// files of the thing it is about (an Output-window change is mostly panel).
const PREFIX_AREAS = [
  ["output", /\b(output|pop-?out|room|pairing|tv|cue)\b/],
  ["sound", /\b(drives?|beat|tempo|bpm|metronome|mic|input|hits?|onset|gate|silence)\b/],
];

/** One file's product area, or "other" (docs, tools, CI, config), or null
 *  for a test — which says nothing about what a PR changed for a visitor. */
export function areaOfFile(path) {
  if (/^tests\//.test(path)) return null;
  if (SCENE_RE.test(path)) return "scenes";
  if (SOUND_RE.test(path)) return "sound";
  if (OUTPUT_RE.test(path)) return "output";
  if (APP_RE.test(path)) return "app";
  return "other";
}

/** Which `CATEGORIES` key a change goes under — see this file's header.
 *  `sceneNames` is every registered scene's display name. */
export function categorize({ subject, files, newScenes = [], sceneNames = [] }) {
  if (newScenes.length > 0) return "newScene";
  const prefix = /^([^:]{1,60}):/.exec(stripPrSuffix(subject))?.[1]?.toLowerCase() ?? "";
  if (prefix && sceneNames.some((n) => new RegExp(`(^|[^\\w])${escapeRe(n.toLowerCase())}([^\\w]|$)`).test(prefix))) {
    return "scenes";
  }
  // No prefix: the whole title says what it's about instead.
  const about = prefix || stripPrSuffix(subject).toLowerCase();
  for (const [area, re] of PREFIX_AREAS) if (re.test(about)) return area;
  const counts = { scenes: 0, sound: 0, output: 0, app: 0 };
  for (const f of files) {
    const area = areaOfFile(f);
    if (area && area !== "other") counts[area]++;
  }
  let best = "other";
  let bestCount = 0;
  for (const key of ["scenes", "sound", "output", "app"]) {
    if (counts[key] > bestCount) {
      best = key;
      bestCount = counts[key];
    }
  }
  return best;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** One "What's Changed" line. */
export function formatEntry({ subject, pr, author, sha }) {
  const title = stripPrSuffix(subject);
  const by = author ? ` by @${author}` : "";
  if (pr) return `* ${title}${by} in #${pr}`;
  return `* ${title}${by}${sha ? ` (${sha.slice(0, 7)})` : ""}`;
}

/**
 * The whole Release body.
 *  - `entries`: `{ subject, pr, author, sha, category, newScenes }` per
 *    commit, newest first (as `git log` gives them).
 *  - `sceneVersions`: `{ unit, name, version }` for each scene this release
 *    changed, or [] (the build's version.json `scenesChanged`).
 *  - `prevTag` / `tag`: for the compare link; it's left out without both.
 */
export function renderNotes({ highlights = "", entries, sceneVersions = [], repo, prevTag, tag, siteUrl }) {
  const out = [];
  if (highlights) out.push(highlights, "");

  out.push("## What's Changed", "");
  if (entries.length === 0) out.push("Nothing new since the last release — a redeploy.", "");
  for (const { key, title } of CATEGORIES) {
    const group = entries.filter((e) => e.category === key);
    if (group.length === 0) continue;
    // Scene lines sort by title so one scene's changes sit together; the
    // rest keep newest-first.
    const ordered = key === "scenes" ? [...group].sort((a, b) => stripPrSuffix(a.subject).localeCompare(stripPrSuffix(b.subject))) : group;
    out.push(`### ${title}`, "", ...ordered.map(formatEntry), "");
  }

  if (sceneVersions.length > 0) {
    out.push("## Scene versions", "", "| Scene | Version |", "|---|---|");
    for (const s of [...sceneVersions].sort((a, b) => (a.name ?? a.unit).localeCompare(b.name ?? b.unit))) {
      out.push(`| ${s.name ?? s.unit} (\`${s.unit}\`) | ${s.version} |`);
    }
    out.push("");
  }

  if (siteUrl) out.push(`**Live at** ${siteUrl}`, "");
  if (repo && prevTag && tag) out.push(`**Full Changelog**: https://github.com/${repo}/compare/${prevTag}...${tag}`);
  return out.join("\n").trimEnd() + "\n";
}
