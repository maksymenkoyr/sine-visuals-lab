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

// Jev 1.13 input price per million tokens; output tokens (the noul answers)
// are free. https://docs.typesafe.ai/models
export const JEV_USD_PER_MTOK = 0.042;

/** Cost in USD of a judged run's `inputTokens` at the Jev pricing above. */
export function costUsd(inputTokens) {
  return (inputTokens / 1_000_000) * JEV_USD_PER_MTOK;
}

const VALID_VERDICTS = new Set(["stale", "fine", "missed"]);

/** Parse `--verdict` args, each of the form `ref=value` (e.g.
 *  `docs/x.md:42=stale`), into a `{ ref: value }` map. A ref can itself
 *  contain `=` or `:` (paths and hashes do), so each arg is split on its
 *  LAST `=`, not its first. Throws on a value outside stale/fine/missed. */
export function parseVerdicts(args) {
  const out = {};
  for (const arg of args) {
    const eq = arg.lastIndexOf("=");
    if (eq === -1) throw new Error(`Bad --verdict arg (expected ref=value): "${arg}"`);
    const ref = arg.slice(0, eq);
    const value = arg.slice(eq + 1);
    if (!VALID_VERDICTS.has(value)) {
      throw new Error(`Bad verdict "${value}" for ${ref} (expected stale, fine, or missed)`);
    }
    out[ref] = value;
  }
  return out;
}

// Calibration buckets for `summarizeRuns`: half-open except the last, which
// closes at 1 so a p of exactly 1 still lands somewhere.
const CALIBRATION_BUCKETS = [
  [0, 0.2, "[0,.2)"],
  [0.2, 0.4, "[.2,.4)"],
  [0.4, 0.6, "[.4,.6)"],
  [0.6, 0.8, "[.6,.8)"],
  [0.8, 1.0001, "[.8,1]"],
];

/** Aggregate parsed `runs.jsonl` lines into the numbers `doc-check --report`
 *  prints: totals/averages over judged runs (unjudged runs made no API call,
 *  so they're excluded from token/latency/cost figures), and effectiveness
 *  and calibration from whatever `--verdict` has recorded so far across all
 *  runs. Pure — the CLI does all the formatting. */
export function summarizeRuns(runs) {
  const judgedRuns = runs.filter((r) => r.mode === "judged");
  const unjudgedRuns = runs.filter((r) => r.mode === "unjudged");
  const models = [...new Set(judgedRuns.map((r) => r.model).filter(Boolean))].sort();

  const sum = (arr, f) => arr.reduce((n, x) => n + f(x), 0);
  const candidates = sum(judgedRuns, (r) => r.totals?.candidates ?? 0);
  const flagged = sum(judgedRuns, (r) => r.totals?.flagged ?? 0);
  const inputTokens = sum(judgedRuns, (r) => r.totals?.inputTokens ?? 0);
  const costTotal = sum(judgedRuns, (r) => r.totals?.costUsd ?? 0);
  const candidateChars = sum(judgedRuns, (r) => r.totals?.candidateChars ?? 0);
  const flaggedChars = sum(judgedRuns, (r) => r.totals?.flaggedChars ?? 0);
  const requestMs = judgedRuns.flatMap((r) => (r.requests ?? []).map((req) => req.ms));

  const totals = {
    candidates,
    flagged,
    inputTokens,
    costUsd: costTotal,
    costPerRunUsd: judgedRuns.length > 0 ? costTotal / judgedRuns.length : null,
    meanRequestMs: requestMs.length > 0 ? requestMs.reduce((a, b) => a + b, 0) / requestMs.length : null,
    maxRequestMs: requestMs.length > 0 ? Math.max(...requestMs) : null,
    readingSavedPct: candidateChars > 0 ? (1 - flaggedChars / candidateChars) * 100 : null,
  };

  // Every judgment across every run (judged or not — a candidate can be
  // hand-verdicted even unjudged), paired with that same run's recorded
  // verdict for its ref, if any.
  const allJudgments = [];
  for (const r of runs) {
    for (const j of r.judgments ?? []) {
      allJudgments.push({ ...j, runId: r.id, verdict: r.verdicts?.[j.ref] ?? null });
    }
  }
  const missedVerdicts = sum(runs, (r) => Object.values(r.verdicts ?? {}).filter((v) => v === "missed").length);

  const truePositives = allJudgments.filter((j) => j.flagged === true && j.verdict === "stale");
  const falsePositiveJudgments = allJudgments.filter((j) => j.flagged === true && j.verdict === "fine");
  const staleUnflagged = allJudgments.filter((j) => !j.flagged && j.verdict === "stale");
  const hasVerdicts = missedVerdicts > 0 || allJudgments.some((j) => j.verdict !== null);

  const effectiveness = {
    hasVerdicts,
    precision:
      truePositives.length + falsePositiveJudgments.length > 0
        ? truePositives.length / (truePositives.length + falsePositiveJudgments.length)
        : null,
    misses: missedVerdicts + staleUnflagged.length,
    staleUnflaggedCount: staleUnflagged.length,
    truePositiveCount: truePositives.length,
    falsePositiveCount: falsePositiveJudgments.length,
  };

  const verdicted = allJudgments.filter((j) => j.p !== null && (j.verdict === "stale" || j.verdict === "fine"));
  const calibration = CALIBRATION_BUCKETS.map(([lo, hi, bucket]) => {
    const inBucket = verdicted.filter((j) => j.p >= lo && j.p < hi);
    const staleCount = inBucket.filter((j) => j.verdict === "stale").length;
    return { bucket, count: inBucket.length, staleRate: inBucket.length > 0 ? staleCount / inBucket.length : null };
  });

  const falsePositives = falsePositiveJudgments
    .slice()
    .reverse()
    .slice(0, 10)
    .map((j) => ({ ref: j.ref, p: j.p, run: j.runId, excerpt: j.excerpt }));

  const recentRuns = runs.slice(-5).map((r) => ({
    id: r.id,
    branch: r.branch,
    mode: r.mode,
    candidates: r.totals?.candidates ?? 0,
    flagged: r.totals?.flagged ?? 0,
    inputTokens: r.totals?.inputTokens ?? 0,
    costUsd: r.totals?.costUsd ?? 0,
  }));

  return {
    runs: { total: runs.length, judged: judgedRuns.length, unjudged: unjudgedRuns.length, models },
    totals,
    effectiveness,
    calibration,
    falsePositives,
    recentRuns,
  };
}
