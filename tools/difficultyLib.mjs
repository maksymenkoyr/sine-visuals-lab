// Pure helpers for the issue difficulty and token labels
// (docs/issue-labels.md): no I/O, no network, unit-tested by
// tests/difficulty.test.ts. Two callers share them, so the label names live
// in one place:
//   - .claude/hooks/issue-labels.mjs, which refuses a new issue without a
//     difficulty and a token label (checkNewIssue);
//   - tools/difficulty.mjs, the correction loop: after the work is done, /ship
//     records the difficulty the task actually had and the tokens it took
//     next to what it was filed with, and `export` turns those records into a
//     dataset for a future model that corrects the labels at filing time.
//
// A record is an issue comment: a readable line for people, then the record
// itself as JSON inside an HTML comment (`<!-- difficulty-record {...} -->`),
// so the issue stays the store and no container or worktree has to keep it.
// `v` is RECORD_VERSION; bump it when a field changes meaning, and teach
// parseRecords the old shape rather than dropping it. The token fields
// (`tok`, `tokens`) came later without a bump: a record without them reads
// as one with no token guess or count.

/** Easiest to hardest; a level's index is how hard it is. */
const LEVELS = ["low", "mid", "high"];
const DIFFICULTY_LABELS = { low: "low dif", mid: "mid dif", high: "high dif" };
const HUMAN_LABEL = "human";

/** Token buckets, smallest first; a bucket's index is how big it is. A
 *  count falls in the first bucket it is `below`. What counts is every token
 *  the work's sessions and their agents were billed for, cache reads
 *  included: over a week of this repo's sessions (2026-10-21) that spread
 *  across all four buckets, while without cache reads nearly none passed 1M. */
const TOKEN_BUCKETS = [
  { tok: "100K", below: 1e5, label: "<100K tok" },
  { tok: "1M", below: 1e6, label: "<1M tok" },
  { tok: "10M", below: 1e7, label: "<10M tok" },
  { tok: "10M+", below: Infinity, label: ">10M tok" },
];
const TOKS = TOKEN_BUCKETS.map((b) => b.tok);
const TOKEN_LABELS = TOKEN_BUCKETS.map((b) => b.label);
const RECORD_MARKER = "difficulty-record";
const RECORD_VERSION = 1;

/** Author associations whose records `export` trusts by default: anyone else
 *  can comment on a public issue, and a forged record would skew the data. */
const TRUSTED_ASSOCIATIONS = ["OWNER", "MEMBER", "COLLABORATOR"];

function labelName(l) {
  return typeof l === "string" ? l : l.name;
}

/** The difficulty, token bucket and `human` an issue's labels say. Labels
 *  are strings or `{ name }`. With more than one difficulty label the hardest
 *  wins, as docs/issue-labels.md says to pick for the hardest part; with more
 *  than one token label the biggest wins. */
export function readLabels(labels) {
  const names = labels.map(labelName);
  let dif = null;
  for (const level of LEVELS) if (names.includes(DIFFICULTY_LABELS[level])) dif = level;
  let tok = null;
  for (const b of TOKEN_BUCKETS) if (names.includes(b.label)) tok = b.tok;
  return { dif, tok, human: names.includes(HUMAN_LABEL) };
}

function tokLabel(tok) {
  return TOKEN_BUCKETS.find((b) => b.tok === tok)?.label ?? null;
}

/** The bucket a token count falls in. */
export function bucketOf(tokens) {
  return TOKEN_BUCKETS.find((b) => tokens < b.below).tok;
}

/** Parse a token count given on the command line: `450000`, `450K`, `3.2M`. */
export function parseTokens(text) {
  const m = /^\s*(\d+(?:\.\d+)?)\s*([kKmM]?)\s*$/.exec(String(text ?? ""));
  if (!m) throw new Error(`a token count is a number with an optional K or M, got "${text}"`);
  return Math.round(Number(m[1]) * { "": 1, k: 1e3, m: 1e6 }[m[2].toLowerCase()]);
}

/** A token count the way the labels write it: 3.4M, 450K. */
export function formatTokens(n) {
  if (n >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
  return String(n);
}

const REFUSE =
  "Label this issue first (docs/issue-labels.md), then run it again. Judge three things: " +
  `(1) difficulty, one of ${LEVELS.map((l) => `"${DIFFICULTY_LABELS[l]}"`).join(", ")} ` +
  `(which model and effort should build it); (2) tokens, one of ${TOKEN_LABELS.map((l) => `"${l}"`).join(", ")} ` +
  "(every token the sessions and agents that build it will use, cache reads included); " +
  "(3) human, add it if the task needs a person at some point " +
  "or has more than a 30% chance of it (recording, listening, a device only they have, a decision left open).";

const REMIND =
  `Issue labels: you left off \`${HUMAN_LABEL}\`. Add it if the task needs a person, or has more than a ` +
  "30% chance of needing one at some point (docs/issue-labels.md).";

/** What the hook says about a new issue. `labels` is a label array (the
 *  GitHub MCP's issue_write) or the raw text of a `gh issue create` command,
 *  which is only searched for the label names. Returns `{ refuse }` with no
 *  difficulty or no token label, `{ remind }` with no `human`, or null. */
export function checkNewIssue(labels) {
  const has = (name) => labels.includes(name);
  if (!LEVELS.some((l) => has(DIFFICULTY_LABELS[l]))) return { refuse: REFUSE };
  if (!TOKEN_LABELS.some(has)) return { refuse: REFUSE };
  if (!has(HUMAN_LABEL)) return { remind: REMIND };
  return null;
}

/** Parse a level given on the command line: `mid` or `mid dif`. */
export function parseLevel(text) {
  const t = String(text ?? "").trim().replace(/\s*dif$/, "");
  if (!LEVELS.includes(t)) throw new Error(`difficulty must be one of ${LEVELS.join(", ")}, got "${text}"`);
  return t;
}

/** `under` when the task was harder (or bigger) than filed, `over` when
 *  easier, `agree` when the same, null when either side is missing. `order`
 *  is LEVELS for difficulty, the bucket names for tokens. */
function verdictOf(predicted, actual, order = LEVELS) {
  if (!predicted || !actual) return null;
  const d = order.indexOf(actual) - order.indexOf(predicted);
  return d > 0 ? "under" : d < 0 ? "over" : "agree";
}

/** One record. `predicted` is what the labels said before this record;
 *  `actual` is the judgement after the work, with `tokens` the measured
 *  count (null when none was given) and `tok` its bucket. */
export function buildRecord({ issue, predicted, actual, pr = null, why = "", at = new Date().toISOString() }) {
  const tokens = actual.tokens ?? null;
  return {
    v: RECORD_VERSION,
    issue,
    predicted: { dif: predicted.dif, tok: predicted.tok ?? null, human: predicted.human },
    actual: { dif: actual.dif, tok: tokens === null ? null : bucketOf(tokens), tokens, human: actual.human },
    pr,
    why,
    at,
  };
}

function difText(level) {
  return level ? `\`${DIFFICULTY_LABELS[level]}\`` : "no difficulty";
}

/** The issue comment that carries a record. `--` can't appear inside an HTML
 *  comment, so the JSON escapes it. */
export function renderComment(record) {
  const { predicted: p, actual: a } = record;
  const verdict = verdictOf(p.dif, a.dif);
  const head =
    verdict === "agree"
      ? `**Difficulty after the work:** ${difText(a.dif)}, as filed`
      : `**Difficulty after the work:** ${difText(a.dif)} (filed as ${difText(p.dif)})`;
  const human =
    a.human === p.human
      ? `human: ${a.human ? "yes" : "no"}, as filed`
      : `human: ${a.human ? "yes" : "no"} (filed as ${p.human ? "yes" : "no"})`;
  const filedTok = p.tok ? `\`${tokLabel(p.tok)}\`` : "no token label";
  const tokens =
    a.tokens == null
      ? ""
      : ` · tokens: ${formatTokens(a.tokens)}` + (a.tok === p.tok ? `, ${filedTok} as filed` : ` (filed as ${filedTok})`);
  const pr = record.pr ? ` · #${record.pr}` : "";
  const json = JSON.stringify(record).replace(/--/g, "-\\u002d");
  return [`${head}${tokens} · ${human}${pr}`, "", record.why || "_no reason given_", "", `<!-- ${RECORD_MARKER} ${json} -->`].join("\n");
}

/** Every record in a comment body, in order; a malformed one is skipped. */
export function parseRecords(body) {
  const out = [];
  const re = new RegExp(`<!--\\s*${RECORD_MARKER}\\s+(\\{[\\s\\S]*?\\})\\s*-->`, "g");
  for (const m of String(body ?? "").matchAll(re)) {
    try {
      const r = JSON.parse(m[1]);
      if (r && r.v === 1 && r.actual && LEVELS.includes(r.actual.dif)) out.push(r);
    } catch {
      // not ours, or hand-edited past parsing
    }
  }
  return out;
}

/** The label edits that make an issue's labels say `actual`. The token
 *  label is left alone when `actual` has no token bucket. */
export function labelEdits(current, actual) {
  const add = [];
  const remove = [];
  if (current.dif !== actual.dif) {
    add.push(DIFFICULTY_LABELS[actual.dif]);
    if (current.dif) remove.push(DIFFICULTY_LABELS[current.dif]);
  }
  if (actual.tok && current.tok !== actual.tok) {
    add.push(tokLabel(actual.tok));
    if (current.tok) remove.push(tokLabel(current.tok));
  }
  if (actual.human && !current.human) add.push(HUMAN_LABEL);
  if (!actual.human && current.human) remove.push(HUMAN_LABEL);
  return { add, remove };
}

/** An issue's full label list after `labelEdits`: what the GitHub MCP's
 *  issue_write needs, since it replaces the labels instead of editing them.
 *  Every difficulty label goes, not only the one readLabels picked, and every
 *  token label too when `actual` has a token bucket. */
export function labelsAfter(labels, actual) {
  const names = labels.map(labelName);
  const difNames = Object.values(DIFFICULTY_LABELS);
  const kept = names.filter((n) => !difNames.includes(n) && n !== HUMAN_LABEL && !(actual.tok && TOKEN_LABELS.includes(n)));
  return [...kept, DIFFICULTY_LABELS[actual.dif], ...(actual.tok ? [tokLabel(actual.tok)] : []), ...(actual.human ? [HUMAN_LABEL] : [])];
}

/** Dataset rows, one per issue that has a record, from issues shaped like
 *  `gh issue list --json number,title,body,labels,comments`. The prediction
 *  is the first record's (what the issue was filed with); the outcome is the
 *  last record's, so a later correction overrides an earlier one; the token
 *  outcome is the last record's that has a count. Records
 *  from comments whose author association isn't in `trusted` are ignored;
 *  pass `trusted: null` to take every author. */
export function datasetRows(issues, { trusted = TRUSTED_ASSOCIATIONS } = {}) {
  const rows = [];
  for (const issue of issues) {
    const records = [];
    for (const c of issue.comments ?? []) {
      if (trusted && !trusted.includes(c.authorAssociation)) continue;
      for (const r of parseRecords(c.body)) records.push({ ...r, by: c.author?.login ?? null });
    }
    if (records.length === 0) continue;
    records.sort((a, b) => String(a.at).localeCompare(String(b.at)));
    const first = records[0];
    const last = records[records.length - 1];
    const counted = [...records].reverse().find((r) => r.actual.tokens != null);
    const predicted = { dif: first.predicted.dif, tok: first.predicted.tok ?? null, human: first.predicted.human };
    const actual = { dif: last.actual.dif, tok: counted?.actual.tok ?? null, tokens: counted?.actual.tokens ?? null, human: last.actual.human };
    rows.push({
      issue: issue.number,
      title: issue.title,
      body: issue.body ?? "",
      predicted,
      actual,
      verdict: verdictOf(predicted.dif, actual.dif),
      tokVerdict: verdictOf(predicted.tok, actual.tok, TOKS),
      humanVerdict: first.predicted.human === last.actual.human ? "agree" : last.actual.human ? "missed" : "extra",
      pr: last.pr,
      why: last.why,
      at: last.at,
      by: last.by,
      records: records.length,
    });
  }
  return rows.sort((a, b) => a.issue - b.issue);
}

function grid(order) {
  return Object.fromEntries(order.map((p) => [p, Object.fromEntries(order.map((a) => [a, 0]))]));
}

/** How the labels at filing compare with the outcome, over dataset rows. */
export function summarize(rows) {
  const matrix = grid(LEVELS);
  const tokens = { judged: 0, agree: 0, under: 0, over: 0, matrix: grid(TOKS) };
  const s = { rows: rows.length, unlabeled: 0, agree: 0, under: 0, over: 0, humanMissed: 0, humanExtra: 0, matrix, tokens };
  for (const r of rows) {
    if (r.verdict === null) s.unlabeled++;
    else {
      s[r.verdict]++;
      matrix[r.predicted.dif][r.actual.dif]++;
    }
    if (r.tokVerdict) {
      tokens.judged++;
      tokens[r.tokVerdict]++;
      tokens.matrix[r.predicted.tok][r.actual.tok]++;
    }
    if (r.humanVerdict === "missed") s.humanMissed++;
    if (r.humanVerdict === "extra") s.humanExtra++;
  }
  return s;
}

/** The `report` text for a summary. */
export function renderSummary(s) {
  const judged = s.agree + s.under + s.over;
  const pct = (n) => (judged ? `${Math.round((100 * n) / judged)}%` : "n/a");
  const lines = [
    `${s.rows} issue(s) with a record, ${s.unlabeled} filed without a difficulty`,
    `difficulty: ${s.agree} agree (${pct(s.agree)}), ${s.under} harder than filed, ${s.over} easier than filed`,
    `human: ${s.humanMissed} needed but not labeled, ${s.humanExtra} labeled but not needed`,
    "",
    "filed \\ actual  " + LEVELS.map((l) => l.padStart(5)).join(""),
    ...LEVELS.map((p) => `${p.padEnd(16)}${LEVELS.map((a) => String(s.matrix[p][a]).padStart(5)).join("")}`),
  ];
  const t = s.tokens;
  const tp = (n) => (t.judged ? `${Math.round((100 * n) / t.judged)}%` : "n/a");
  lines.push(
    "",
    `tokens: ${t.judged} with a guess and a count; ${t.agree} agree (${tp(t.agree)}), ${t.under} bigger than filed, ${t.over} smaller than filed`,
    "filed \\ actual  " + TOKS.map((k) => k.padStart(6)).join(""),
    ...TOKS.map((p) => `${p.padEnd(16)}${TOKS.map((a) => String(t.matrix[p][a]).padStart(6)).join("")}`),
  );
  return lines.join("\n");
}
