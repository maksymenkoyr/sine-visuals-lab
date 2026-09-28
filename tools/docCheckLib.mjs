// Pure helpers for tools/doc-check.mjs: no I/O, no network, unit-tested by
// tests/docCheck.test.ts. Splitting this out keeps the CLI's git/fetch glue
// separate from the text-matching logic that's worth testing directly.

// A request carries at most this many questions, so a heavily cited file's
// paragraphs plus its diff stay well inside the model's per-request context;
// the CLI chunks bigger files across requests.
export const MAX_QUESTIONS = 60;

/** Split `text` into paragraphs separated by one or more blank lines. A
 *  fenced code block (```…```) stays whole as one paragraph even if it
 *  contains blank lines. Paragraphs that are only a single heading line
 *  (`#...`) are dropped — a heading alone makes no claim to check.
 *  Returns `[{ line, text }]`, `line` = 1-based line of the paragraph's
 *  first line. */
export function splitParagraphs(text) {
  const lines = text.split("\n");
  const paragraphs = [];
  let current = [];
  let currentLine = 0;
  let inFence = false;

  function flush() {
    if (current.length === 0) return;
    const body = current.join("\n");
    const isHeadingOnly = current.length === 1 && /^\s*#/.test(current[0]);
    if (body.trim() !== "" && !isHeadingOnly) {
      paragraphs.push({ line: currentLine, text: body });
    }
    current = [];
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const isFenceLine = /^\s*```/.test(raw);

    if (inFence) {
      current.push(raw);
      if (isFenceLine) inFence = false;
      continue;
    }

    if (raw.trim() === "") {
      flush();
      continue;
    }

    if (current.length === 0) currentLine = i + 1;
    current.push(raw);
    if (isFenceLine) inFence = true;
  }
  flush();

  return paragraphs;
}

// Anchored at column 0 after the +/- marker: only top-level declarations.
// Indented ones are locals (`line`, `seen`, …) that no doc cites, and they
// swamped the candidate list with every paragraph using the same word.
const DECL_RE = /^[+-](?:export\s+)?(?:default\s+)?(?:async\s+)?(?:const|let|var|function\*?|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/;

/** Names worth searching docs for after a change to `path`: the repo path
 *  itself, its basename, and identifiers declared at top level on
 *  added/removed diff lines (not the `+++`/`---` file headers).
 *  Identifiers shorter than 4 characters are dropped as too generic to be a
 *  meaningful doc reference. Deduped, order preserved. */
export function touchedNames(path, diffText) {
  const names = [];
  const seen = new Set();
  function add(name) {
    if (!name || seen.has(name)) return;
    seen.add(name);
    names.push(name);
  }

  add(path);
  const basename = path.split("/").pop();
  add(basename);

  const lines = (diffText ?? "").split("\n");
  for (const line of lines) {
    if (!/^[+-]/.test(line)) continue;
    if (/^(\+\+\+|---)/.test(line)) continue;
    const ident = DECL_RE.exec(line)?.[1];
    if (ident && ident.length >= 4) add(ident);
  }

  return names;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Paragraphs that cite any of `names`. A full repo path (contains `/`)
 *  matches anywhere as a plain substring. Anything else — a basename or an
 *  identifier — must appear inside an inline code span, the way these docs
 *  cite code (`drives.ts`, `MUSIC_DIALS`): bare prose words like "line" or
 *  "index.ts" in passing are too common to be references. Identifiers match
 *  at a word boundary within the span, so `drive` doesn't match `drives`.
 *  Returns each candidate paragraph with the subset of names it matched. */
export function candidateParagraphs(paragraphs, names) {
  const candidates = [];
  for (const p of paragraphs) {
    const spans = p.text.match(/`[^`\n]+`/g) ?? [];
    const matched = [];
    for (const name of names) {
      let hit;
      if (name.includes("/")) {
        hit = p.text.includes(name);
      } else {
        // `\b` treats `$` as a non-word character, so it could never match at
        // the edge of a `$`-prefixed identifier; this lookaround counts `$`
        // as an identifier character.
        const re = new RegExp(`(?<![\\w$])${escapeRegExp(name)}(?![\\w$])`);
        hit = spans.some((span) => re.test(span));
      }
      if (hit) matched.push(name);
    }
    if (matched.length > 0) candidates.push({ ...p, names: matched });
  }
  return candidates;
}

/** Build the TypeSafe systemone request body judging whether each candidate
 *  paragraph is made wrong by the diff to `path`. `diffText` is truncated to
 *  `maxDiffChars`, marked with a trailing "truncated" note, to keep the
 *  request small. */
export function buildRequest(path, diffText, candidates, { maxDiffChars = 24000 } = {}) {
  const diff =
    diffText.length > maxDiffChars
      ? diffText.slice(0, maxDiffChars) + "\n… [diff truncated]"
      : diffText;

  const questions = {};
  candidates.forEach((c, i) => {
    questions[`p${i}`] = {
      type: "noul",
      instructions: {
        paragraph: c.text,
        question:
          "Does `paragraph` make a claim about `file` that the change in `diff` has made wrong or out of date — a renamed or removed symbol, a changed behaviour, default or meaning?",
      },
      criteria: {
        true: "The paragraph now states something false about the changed code, or names a symbol, file or param the diff renamed or removed.",
        false: "The paragraph is still accurate, only mentions the file in passing, or is a dated history/measurement entry recording what was true at that time.",
      },
    };
  });

  return {
    model: "jev-latest",
    state: { file: path, diff },
    questions,
  };
}

/** Split `array` into chunks of at most `size`. */
export function chunk(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
  return out;
}
