/**
 * Pure string-surgery for rewriting a scene's `default:` number literals in
 * place. No `node:fs` here on purpose — this is imported both by
 * vite-tuning-plugin.ts (which does the actual read/write) and by
 * tests/sceneDefaultsPatch.test.ts (which never touches disk, working from
 * inline fixtures shaped like a real settings array instead — a test against
 * the real scene files would break every time someone retunes a scene).
 *
 * The whole scheme rests on one fact true of every settings-bearing scene
 * file: a `key: "…",` line and its `default: …,` line always alternate, one
 * setting after another (see meshGrid.ts, caustics.ts). That's what lets
 * indexKeys bound each setting's search region at the *next* key line without
 * parsing the file as JS — no AST, no risk of a formatter fighting the diff.
 * The same bound covers caustics.ts's SPARKLE, a spec declared standalone
 * outside its SETTINGS array and referenced by identity as a macro.driver:
 * its region just ends at the following spec's key line like any other.
 *
 * Safety model: an edit names `from` (the value the browser's bundle
 * believes is compiled in) as well as `to`. A region is patched only when the
 * `default:` literal found there parses to exactly `from` — a mismatch almost
 * always means the page is stale relative to disk, so patchSceneDefaults
 * refuses the *whole* payload rather than writing part of it. Per-key
 * results still come back, so the caller can name the offender.
 */

export interface DefaultEdit {
  key: string;
  from: number;
  to: number;
}

export type EditStatus =
  | "applied"
  | "already"
  | "key-missing"
  | "key-ambiguous"
  | "default-missing"
  | "default-ambiguous"
  | "from-mismatch"
  | "bad-value";

export interface EditResult {
  key: string;
  status: EditStatus;
  /** The value actually found at the default: site, when status explains why
   *  nothing was applied and a value was findable at all (from-mismatch). */
  found?: number;
}

export type PatchOutcome =
  | { ok: true; text: string; results: EditResult[] }
  | { ok: false; results: EditResult[] };

export interface SceneFileCandidate {
  path: string;
  text: string;
}

export type LocateOutcome =
  | { ok: true; path: string; text: string }
  | { ok: false; reason: "no-match" | "ambiguous"; paths: string[] };

// Backstop bounding a setting's search region when it's the last one in a
// file (or the last before a long run of unrelated code) — without this a
// default-missing key could scan clear to EOF.
export const SPEC_SCAN_LIMIT = 2000;

const KEY_RE = /^[ \t]*key: "([A-Za-z0-9_]+)",[ \t]*$/gm;
// Captures the "default:" prefix (with its exact whitespace) separately from
// the numeric literal, so replacement re-uses the prefix verbatim and only
// swaps the number. The lookahead on the comma is what keeps a trailing
// `// comment` on the same line untouched — the match never extends past the
// digits themselves.
const DEFAULT_RE = /^([ \t]*default:[ \t]*)(-?\d+(?:\.\d+)?)(?=,)/m;

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`sceneDefaultsPatch: not finite: ${n}`);
  const s = String(n);
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`sceneDefaultsPatch: won't round-trip: ${s}`);
  return s;
}

interface KeyOccurrence {
  key: string;
  /** Index of the character right after the matched key: line (its \n),
   *  i.e. where this setting's search region starts. */
  regionStart: number;
}

function indexKeys(source: string): KeyOccurrence[] {
  const out: KeyOccurrence[] = [];
  KEY_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = KEY_RE.exec(source)) !== null) {
    out.push({ key: m[1], regionStart: m.index + m[0].length });
  }
  return out;
}

/**
 * Locate every default: site for the requested keys, bounding each one's
 * search to [end of its own key: line, start of the next key: line or the
 * scan limit — whichever comes first]. Reused by both patchSceneDefaults
 * (to build edits) and a would-be dry run, since the two must agree on what
 * "the current default" means.
 */
type Site =
  | { status: "applied"; start: number; end: number; value: number }
  | { status: Exclude<EditStatus, "applied" | "already" | "from-mismatch" | "bad-value"> };

function findDefaultSites(source: string, keys: readonly string[]): Map<string, Site> {
  const occurrences = indexKeys(source);
  const result = new Map<string, Site>();

  for (const key of keys) {
    const matches = occurrences.filter((o) => o.key === key);
    if (matches.length === 0) {
      result.set(key, { status: "key-missing" });
      continue;
    }
    if (matches.length > 1) {
      result.set(key, { status: "key-ambiguous" });
      continue;
    }
    const occ = matches[0];
    const idx = occurrences.indexOf(occ);
    const nextRegionStart = idx + 1 < occurrences.length ? occurrences[idx + 1].regionStart : Infinity;
    const hardEnd = occ.regionStart + SPEC_SCAN_LIMIT;
    const regionEnd = Math.min(nextRegionStart, hardEnd, source.length);
    const region = source.slice(occ.regionStart, regionEnd);

    // A region can legitimately contain more than one "default:" only if a
    // nested object between this key and the next also has one — not a shape
    // any scene file uses today, but detect it as ambiguous rather than
    // silently taking the first hit. DEFAULT_RE has no /g flag, so re-search
    // past the first match by hand.
    const first = DEFAULT_RE.exec(region);
    if (!first) {
      result.set(key, { status: "default-missing" });
      continue;
    }
    const rest = region.slice(first.index + first[0].length);
    if (DEFAULT_RE.test(rest)) {
      result.set(key, { status: "default-ambiguous" });
      continue;
    }

    const numStart = occ.regionStart + first.index + first[1].length;
    const numEnd = numStart + first[2].length;
    result.set(key, { status: "applied", start: numStart, end: numEnd, value: Number(first[2]) });
  }

  return result;
}

export function patchSceneDefaults(source: string, edits: readonly DefaultEdit[]): PatchOutcome {
  const sites = findDefaultSites(source, edits.map((e) => e.key));
  const results: EditResult[] = [];
  const splices: { start: number; end: number; text: string }[] = [];
  let refused = false;

  for (const edit of edits) {
    const site = sites.get(edit.key)!;
    if (site.status !== "applied") {
      results.push({ key: edit.key, status: site.status });
      refused = true;
      continue;
    }
    const { start, end, value } = site;
    if (value !== edit.from) {
      results.push({ key: edit.key, status: "from-mismatch", found: value });
      refused = true;
      continue;
    }
    let serialized: string;
    try {
      serialized = formatNumber(edit.to);
    } catch {
      results.push({ key: edit.key, status: "bad-value" });
      refused = true;
      continue;
    }
    if (value === edit.to) {
      results.push({ key: edit.key, status: "already" });
      continue;
    }
    results.push({ key: edit.key, status: "applied" });
    splices.push({ start, end, text: serialized });
  }

  if (refused) return { ok: false, results };

  // Descending offset order so an earlier splice's start/end never drifts
  // out from under a later one still to be applied.
  splices.sort((a, b) => b.start - a.start);
  let text = source;
  for (const s of splices) {
    text = text.slice(0, s.start) + s.text + text.slice(s.end);
  }
  return { ok: true, text, results };
}

export function locateSceneFile(
  candidates: readonly SceneFileCandidate[],
  sceneId: string,
  keys: readonly string[],
): LocateOutcome {
  const keyMatches = candidates.filter((c) => keys.every((k) => c.text.includes(`key: "${k}"`)));
  if (keyMatches.length === 0) return { ok: false, reason: "no-match", paths: [] };
  if (keyMatches.length === 1) return { ok: true, path: keyMatches[0].path, text: keyMatches[0].text };

  // Scene ids are declared inconsistently (a bare `const ID`, an exported
  // `..._ID`, or inline as createFullscreenScene's first argument), so a
  // plain string-literal search is the only thing that works across all of
  // them — see meshGrid.ts (const ID), dancers/index.ts (DANCERS_ID), and
  // caustics.ts (inline) for the three shapes this has to handle.
  const idMatches = keyMatches.filter((c) => c.text.includes(`"${sceneId}"`));
  if (idMatches.length === 1) return { ok: true, path: idMatches[0].path, text: idMatches[0].text };

  const paths = (idMatches.length > 0 ? idMatches : keyMatches).map((c) => c.path);
  return { ok: false, reason: "ambiguous", paths };
}
