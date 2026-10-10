// The pure half of tools/workflow-stats.mjs: it turns one finished run of the
// plan-code-review workflow (.claude/workflows/plan-code-review.js) into one
// stats row per issue, and sums those rows per setup for the report. A setup
// is the workflow version plus the model and effort of each stage. Comparing
// setups is the point: "does Sonnet code better than Haiku for the cost?"
//
// A row joins three sources. The run record gives the args, the script, and
// each agent's tool calls, duration and peak context. The journal gives each
// agent's label and its structured return value. Each agent's transcript
// gives the model, effort and the tokens every API request was billed for.
// Agents can't report their own token use, so these files are the only
// honest source for it. The CLI reads them; everything here works on
// already-parsed values, so tests can feed it fixtures.
//
// Transcript gotchas, both measured on real runs:
// - One API request is logged as several entries, one per content block, and
//   each repeats the request's usage. `transcriptStats` counts each request
//   once (by `requestId`) or context gets double-counted.
// - `output_tokens` in an entry is a streaming snapshot taken before the
//   request finished, so it undercounts. It is kept as `outputSeen`, a floor,
//   and the cost estimate says so.
//
// Cost is an API-list-price estimate from `PRICES`, not a bill: a Claude Code
// subscription doesn't charge per token, but the estimate still ranks stages
// and setups fairly. Cache writes are priced at `CACHE_WRITE_MULT` × input,
// the one-hour cache Claude Code uses. A model with a `long` card bills a
// whole request at that card once its prompt (input plus cache write plus
// cache read) passes `long.above`, so `transcriptStats` keeps those requests'
// tokens apart as `longTokens` and `costOf` prices them on their own. Rows
// recorded before that split priced every request at the short card, which
// made a Haiku code stage look up to several times cheaper than it was.
//
// Agents are labelled "<stage> #<issue>", with " r<round>" on stages that run
// once per correction round. Version 1 and 2 runs have one review that fixes
// what it finds, and the report treats it as round 1. Version 1 runs (the
// first trial, before the workflow was saved) returned grades as free text
// such as "B-: reason" under `haiku_grade`. `parseGrade` reads both that and
// the later bare letter, so old rows stay comparable.
//
// A version 7 run with `fork` has two arms after the first review: the
// correction loop, and a copy of the branch that the first review fixed
// itself, graded by one `check` agent. The first review's transcript holds
// both its review and that fixing, so the CLI cuts it at `forkIndex`, the
// request that made the copy, and records the second half as its own
// `opusfix` agent. A row's `fork` then holds each arm's cost and grade after
// the first review, which is what the fork is for.
//
// A `solo` run has one `solo` agent per issue and one `grade` agent that
// grades its branch in place of a review. The grade is the measurement, not
// part of the setup, so it counts as both the first and the last review, the
// row's `cost` leaves it out, and `gradeCost` keeps it apart. A run pinned to
// a `base` commit (a benchmark) gets that commit in its setup key, so bench
// rows form their own series apart from everyday runs on origin/main. A
// solo run with `soloReview` has the usual last review in place of the grade
// agent; that review is part of the setup, so its cost counts.
//
// A run tagged `r<N>.<k>` is subrun k of run r<N>: the same setup run again
// on the same issues, to see how far one setup's results wander. Rows keep
// their subrun; everything a person reads merges them. `summarize` counts
// each issue of each run once, as the median of its subruns, and sets the
// spread between subruns beside it as the noise: a gap between setups
// smaller than that is not evidence. An issue whose subruns disagree past
// `UNSTEADY_GRADE_GAP`, or on ready-to-ship, is listed as unsteady, since
// a setup that can't repeat itself there points at the system, not the
// models. Rows without a subrun tag are each their own run, as before.
// `setupName` is the short name a setup goes by (v8-cr, v8-solo opus
// no-review), next to its full `setupKey`.
//
// The grade-runs workflow (.claude/workflows/grade-runs.js) is the outside
// measurement: `materials` is what its grader reads, `buildGradeRows` turns
// its run into grade rows, and `summarize` sets those grades beside each
// setup's own review.

/** Grade letters the review schema allows, best first, with their points. */
export const GRADE_POINTS = {
  A: 4, "A-": 3.7, "B+": 3.3, B: 3, "B-": 2.7, "C+": 2.3, C: 2, "C-": 1.7, D: 1, F: 0,
};

/** USD per million tokens, API list prices from the claude-api skill (2026-10). */
export const PRICES = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  // The skill lists no Haiku cache-read price; this assumes the usual tenth of
  // input, on both cards.
  "claude-haiku-5-5": {
    input: 0.1, output: 0.5, cacheRead: 0.01,
    long: { above: 100_000, input: 0.5, output: 2.5, cacheRead: 0.05 },
  },
};
export const CACHE_WRITE_MULT = 2;

/** Final-code-grade spread (in grade points) between subruns that marks an issue unsteady. */
export const UNSTEADY_GRADE_GAP = 1;

/** Every stage label the workflow uses, in run order. */
export const STAGES = ["plan", "code", "solo", "review", "replan", "fix", "finish", "opusfix", "check", "grade"];

/** @param {unknown} text @returns {string | null} the grade letter it starts with */
export function parseGrade(text) {
  if (typeof text !== "string") return null;
  const m = /^\s*([A-DF][+-]?)(?![A-Za-z])/.exec(text);
  return m && m[1] in GRADE_POINTS ? m[1] : null;
}

/**
 * Whether an agent's `blocked` field reports a real block. Agents have
 * written "none" there when nothing blocked them; the workflow script makes
 * the same check before it stops a loop.
 * @param {unknown} v
 */
export function wasBlocked(v) {
  return typeof v === "string" && v.trim() !== "" && !/^(none|n\/?a|no|null|nothing|-)\.?$/i.test(v.trim());
}

/** "review #346 r2" → { stage: "review", issue: 346, round: 2 } */
export function parseLabel(label) {
  const m = /^(plan|replan|code|solo|fix|review|finish|opusfix|check|grade)\s+#(\d+)(?:\s+r(\d+))?$/.exec(label ?? "");
  return m ? { stage: m[1], issue: Number(m[2]), round: m[3] ? Number(m[3]) : 1 } : null;
}

/**
 * What one agent used, from its transcript's parsed JSONL entries.
 * @param {any[]} entries
 */
export function transcriptStats(entries) {
  /** @type {Map<string, any>} */
  const requests = new Map();
  let model = null;
  let effort = null;
  let first = null;
  let last = null;
  let anon = 0;
  for (const e of entries) {
    if (e.timestamp) {
      const t = Date.parse(e.timestamp);
      if (first === null || t < first) first = t;
      if (last === null || t > last) last = t;
    }
    const usage = e.type === "assistant" ? e.message?.usage : null;
    if (!usage) continue;
    model ??= e.message.model ?? null;
    effort ??= e.effort ?? null;
    const key = e.requestId ?? e.message.id ?? `anon-${anon++}`;
    const r = requests.get(key) ?? { input: 0, cacheWrite: 0, cacheRead: 0, outputSeen: 0 };
    r.input = Math.max(r.input, usage.input_tokens ?? 0);
    r.cacheWrite = Math.max(r.cacheWrite, usage.cache_creation_input_tokens ?? 0);
    r.cacheRead = Math.max(r.cacheRead, usage.cache_read_input_tokens ?? 0);
    r.outputSeen = Math.max(r.outputSeen, usage.output_tokens ?? 0);
    requests.set(key, r);
  }
  const above = PRICES[model ?? ""]?.long?.above ?? Infinity;
  let tokens = NO_TOKENS;
  let longTokens = NO_TOKENS;
  let peakContext = 0;
  for (const r of requests.values()) {
    const prompt = r.input + r.cacheWrite + r.cacheRead;
    tokens = addTokens(tokens, r);
    if (prompt > above) longTokens = addTokens(longTokens, r);
    peakContext = Math.max(peakContext, prompt);
  }
  const minutes = first !== null && last !== null ? Math.round((last - first) / 600) / 100 : 0;
  return { model, effort, requests: requests.size, tokens, longTokens, peakContext, minutes };
}

/**
 * Where the first review of a fork run started fixing its copy: the index of
 * the first entry of the request that ran `git worktree add`, or -1.
 * @param {any[]} entries
 */
export function forkIndex(entries) {
  const at = entries.findIndex((e) => e.type === "assistant" && Array.isArray(e.message?.content) &&
    e.message.content.some((c) => c.type === "tool_use" && /\bworktree\s+add\b/.test(String(c.input?.command ?? ""))));
  if (at < 0) return -1;
  const id = entries[at].requestId;
  return id ? entries.findIndex((e) => e.requestId === id) : at;
}

/**
 * API-list-price estimate in USD for one agent's tokens, split by kind.
 * `longTokens` is the part of `tokens` from requests billed at the model's
 * `long` card.
 */
export function costOf(model, tokens, longTokens = NO_TOKENS) {
  const p = PRICES[model ?? ""];
  if (!p) return null;
  const card = (t, c) => ({
    input: (t.input * c.input) / 1e6,
    cacheWrite: (t.cacheWrite * c.input * CACHE_WRITE_MULT) / 1e6,
    cacheRead: (t.cacheRead * c.cacheRead) / 1e6,
    output: (t.outputSeen * c.output) / 1e6,
  });
  const long = p.long ? longTokens : NO_TOKENS;
  const short = card({
    input: tokens.input - long.input,
    cacheWrite: tokens.cacheWrite - long.cacheWrite,
    cacheRead: tokens.cacheRead - long.cacheRead,
    outputSeen: tokens.outputSeen - long.outputSeen,
  }, p);
  const over = p.long ? card(long, p.long) : card(NO_TOKENS, p);
  const cost = {
    input: short.input + over.input,
    cacheWrite: short.cacheWrite + over.cacheWrite,
    cacheRead: short.cacheRead + over.cacheRead,
    output: short.output + over.output,
  };
  return { ...cost, total: cost.input + cost.cacheWrite + cost.cacheRead + cost.output };
}

/**
 * The store's rows with `added` in place of any rows for the same runs:
 * recording a run twice replaces it, and a run never appears twice.
 */
export function mergeRows(stored, added) {
  const runs = new Set(added.map((r) => r.runId));
  return [...stored.filter((r) => !runs.has(r.runId)), ...added];
}

/** The setup a row ran under, as one readable key. */
export function setupKey(row) {
  const st = (name) => {
    const s = row.stages[name];
    return s ? `${name} ${shortModel(s.model)}/${s.effort ?? "?"}` : `${name} -`;
  };
  const bench = row.base ? ` · bench ${row.base.slice(0, 8)}` : "";
  if (row.solo) {
    const g = row.stages.review ?? row.stages.grade;
    return `v${row.version} · ${st("solo")} · ${row.stages.review ? "reviewed" : "graded"} by ${g ? `${shortModel(g.model)}/${g.effort ?? "?"}` : "-"}${bench}`;
  }
  const loops = row.maxRounds ? ` · up to ${row.maxRounds} correction round(s)` : "";
  return `v${row.version} · ${st("plan")} · ${st("code")} · ${st("review")}${loops}${row.forkRun ? " · Opus-fix fork" : ""}${bench}`;
}

/** The short name a setup goes by: "v8", "v8-cr", "v8-solo opus no-review". */
export function setupName(row) {
  if (row.solo) {
    const model = /(opus|sonnet|haiku)/.exec(row.stages.solo?.model ?? "")?.[1] ?? "?";
    return `v${row.version}-solo ${model} ${row.stages.review ? "+review" : "no-review"}`;
  }
  return `v${row.version}${row.maxRounds ? "-cr" : ""}${row.forkRun ? "-fork" : ""}`;
}

/**
 * Which run a row belongs to. A tag "r13.2" is subrun 2 of run r13; any other
 * row is its own run, keyed by its run ID, since workflows launched without a
 * tag all share the default one.
 * @returns {{ run: string, name: string, subrun: number | null }}
 */
export function runOf(row) {
  const m = /^(.+)\.(\d+)$/.exec(row.tag ?? "");
  return m ? { run: m[1], name: m[1], subrun: Number(m[2]) } : { run: row.runId, name: row.tag ?? row.runId, subrun: null };
}

function shortModel(model) {
  return (model ?? "?").replace(/^claude-/, "");
}

function addTokens(a, b) {
  return {
    input: a.input + b.input,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    cacheRead: a.cacheRead + b.cacheRead,
    outputSeen: a.outputSeen + b.outputSeen,
  };
}

const NO_TOKENS = { input: 0, cacheWrite: 0, cacheRead: 0, outputSeen: 0 };

/**
 * One row per issue for a finished run.
 * @param {{
 *   record: { runId: string, workflowName?: string, timestamp?: string, script?: string, args?: unknown },
 *   agents: { label: string, result: any, transcript: ReturnType<typeof transcriptStats>, progress?: { toolCalls?: number, durationMs?: number } }[],
 *   recordedAt: string,
 * }} run
 */
export function buildRows({ record, agents, recordedAt }) {
  const version = Number(/WORKFLOW_VERSION\s*=\s*(\d+)/.exec(record.script ?? "")?.[1] ?? 1);
  const titles = issueTitles(record.args);
  const maxRounds = version >= 3 ? Number(argsObject(record.args).maxRounds ?? /DEFAULT_MAX_ROUNDS\s*=\s*(\d+)/.exec(record.script ?? "")?.[1] ?? 0) : 0;
  /** @type {Map<number, any[]>} */
  const byIssue = new Map();
  for (const a of agents) {
    const at = parseLabel(a.label);
    if (!at) continue;
    const t = a.transcript;
    const entry = {
      label: a.label, stage: at.stage, round: at.round,
      model: t.model, effort: t.effort,
      requests: t.requests, toolCalls: a.progress?.toolCalls ?? null,
      minutes: a.progress?.durationMs ? Math.round(a.progress.durationMs / 600) / 100 : t.minutes,
      peakContext: t.peakContext, tokens: t.tokens, longTokens: t.longTokens ?? NO_TOKENS,
      cost: costOf(t.model, t.tokens, t.longTokens),
      result: a.result,
    };
    if (!byIssue.has(at.issue)) byIssue.set(at.issue, []);
    byIssue.get(at.issue).push(entry);
  }
  const rows = [];
  for (const [issue, list] of [...byIssue].sort((x, y) => x[0] - y[0])) {
    const one = (stage, round = 1) => list.find((a) => a.stage === stage && a.round === round) ?? null;
    const plan = one("plan")?.result ?? null;
    const code = one("code")?.result ?? null;
    const solo = one("solo")?.result ?? null;
    const grade = one("grade");
    const reviews = list.filter((a) => a.stage === "review").sort((a, b) => a.round - b.round);
    const firstReview = reviews[0]?.result ?? grade?.result ?? null;
    const lastReview = reviews.at(-1)?.result ?? grade?.result ?? null;
    const soloRun = !!one("solo");
    const finish = one("finish")?.result ?? null;
    const stages = {};
    for (const name of STAGES) {
      const ss = list.filter((a) => a.stage === name);
      if (!ss.length) continue;
      stages[name] = {
        model: ss[0].model, effort: ss[0].effort, agents: ss.length,
        minutes: ss.reduce((s, a) => s + a.minutes, 0),
        requests: ss.reduce((s, a) => s + a.requests, 0),
        toolCalls: ss.reduce((s, a) => s + (a.toolCalls ?? 0), 0),
        peakContext: Math.max(...ss.map((a) => a.peakContext)),
        tokens: ss.reduce((s, a) => addTokens(s, a.tokens), NO_TOKENS),
        cost: ss.reduce((s, a) => s + (a.cost?.total ?? 0), 0),
      };
      const built = name === "code" ? code : name === "solo" ? solo : null;
      if (built) {
        Object.assign(stages[name], { typecheckPassed: built.typecheck_passed ?? null, testsPassed: built.tests_passed ?? null, deviations: built.deviations ?? "" });
      }
    }
    const findingsOf = (r) => (r?.findings ?? []).map((f) => ({
      id: f.id ?? null, line: f.line ?? null, severity: f.severity ?? null, origin: f.origin ?? null, kind: f.kind ?? null,
      fixed: f.fixed ?? null, file: f.file ?? null, summary: f.summary ?? "",
    }));
    const open = (r) => findingsOf(r).filter((f) => f.severity !== "nit" && !f.fixed).length;
    const selfFixed = (lastReview?.self_fixed ?? []).length;
    const opusfix = one("opusfix");
    const check = one("check");
    const fixes = list.filter((a) => a.stage === "fix").sort((a, b) => a.round - b.round);
    const codeCommit = code?.commit ?? solo?.commit ?? null;
    const costOfStages = (pred) => list.filter(pred).reduce((s, a) => s + (a.cost?.total ?? 0), 0);
    rows.push({
      runId: record.runId,
      workflow: record.workflowName ?? null,
      version,
      maxRounds,
      forkRun: version >= 7 && argsObject(record.args).fork === true && !soloRun,
      solo: soloRun,
      base: argsObject(record.args).base ?? null,
      tag: argsObject(record.args).tag ?? null,
      runStartedAt: record.timestamp ?? null,
      recordedAt,
      issue,
      title: plan?.title ?? solo?.title ?? titles.get(issue) ?? null,
      branch: code?.branch ?? solo?.branch ?? plan?.branch ?? null,
      alreadyDone: plan?.already_done ?? solo?.already_done ?? null,
      stages,
      agents: list.map(({ result, ...a }) => a),
      reviewRounds: reviews.length,
      // From version 3 the loop's reviews don't fix; the run converged if the
      // last review left nothing above a nit open before the reviewer's model
      // fixed anything itself (a finish step, or from version 6 the last
      // review's own `self_fixed`).
      converged: version >= 3 && !soloRun ? open(lastReview) === 0 && !selfFixed : null,
      planGrade: parseGrade(firstReview?.plan_grade),
      codeGrade: parseGrade(firstReview?.code_grade ?? firstReview?.haiku_grade),
      finalCodeGrade: parseGrade(lastReview?.code_grade ?? lastReview?.haiku_grade),
      issueResolved: (finish ?? lastReview)?.issue_resolved ?? null,
      readyToShip: (finish ?? lastReview)?.ready_to_ship ?? null,
      finalTypecheck: (finish ?? lastReview)?.typecheck_passed ?? null,
      finalTests: (finish ?? lastReview)?.tests_passed ?? null,
      findings: findingsOf(firstReview),
      findingsByRound: reviews.map((r) => ({ round: r.round, findings: findingsOf(r.result) })),
      finishFixes: finish ? findingsOf(finish).filter((f) => f.fixed).length : selfFixed,
      // A fix round that was blocked or fixed nothing; a run with these
      // measured the sandbox, not the models.
      stalledFixes: list.filter((a) => a.stage === "fix" && (wasBlocked(a.result?.blocked) || !(a.result?.addressed ?? []).length)).length,
      // Both arms after the first review, when it forked. The loop's grade is
      // `finalCodeGrade`, taken before a last review's own fixes.
      fork: opusfix || check ? {
        fixed: (reviews[0]?.result?.fork_fixed ?? []).length,
        fixCost: opusfix?.cost?.total ?? null,
        checkCost: check?.cost?.total ?? null,
        codeGrade: parseGrade(check?.result?.code_grade),
        open: check ? open(check.result) : null,
        readyToShip: check?.result?.ready_to_ship ?? null,
        loopCost: costOfStages((a) => a.stage === "fix" || a.stage === "replan" || (a.stage === "review" && a.round > 1)),
        loopOpen: open(lastReview) + selfFixed,
      } : null,
      cost: costOfStages((a) => a.stage !== "grade"),
      gradeCost: grade?.cost?.total ?? null,
      // What a side-by-side grader (`materials`, `buildGradeRows`) reads: the
      // plan, the commit the coder handed over, and the branch's last commit.
      planText: plan?.plan ?? null,
      commits: {
        base: code?.base ?? solo?.base ?? argsObject(record.args).base ?? null,
        code: codeCommit,
        final: lastReview?.final_commit || fixes.map((f) => f.result?.commit).filter(Boolean).at(-1) || codeCommit,
      },
      selfFixedIds: lastReview?.self_fixed ?? [],
    });
  }
  return rows;
}

function argsObject(args) {
  return args && typeof args === "object" && !Array.isArray(args) ? args : {};
}

function issueTitles(args) {
  const list = Array.isArray(args) ? args : argsObject(args).issues ?? [];
  const m = new Map();
  for (const i of list) if (i && typeof i === "object" && i.title) m.set(Number(i.n), i.title);
  return m;
}

/**
 * What the side-by-side grader (.claude/workflows/grade-runs.js) reads for
 * one issue: every recorded run of it from the same base (`bench`, or null
 * for runs on origin/main), named by run ID only, so the grader can't tell
 * which setup made which. The reviewer's own grades stay out too: the report
 * sets them against the grader's instead. Rows recorded before `commits`
 * existed are left out, since the grader can't find their code.
 * @param {any[]} rows
 * @param {number} issue
 * @param {string | null} [bench]
 */
export function materials(rows, issue, bench = null) {
  const runs = rows
    .filter((r) => r.issue === issue && !r.alreadyDone && r.commits?.code && (r.base ?? null) === bench)
    .sort((a, b) => String(a.runStartedAt ?? "").localeCompare(String(b.runStartedAt ?? "")) || a.runId.localeCompare(b.runId));
  const out = [];
  for (const r of runs) {
    const c = r.commits;
    out.push(`=== run ${r.runId} ===`, `base ${c.base ?? "?"} · code ${c.code} · final ${c.final ?? c.code}`);
    if (r.solo && !r.stages.review) {
      out.push("One agent built this alone: no plan and no review. Grade only its code (code and final are the same commit).", "");
      continue;
    }
    if (r.solo) out.push("One agent built this alone, with no plan; one review then fixed what it found.", "--- the review's findings, on the code commit ---");
    else out.push("--- plan ---", r.planText ?? "(not recorded)", "--- first review's findings, on the code commit ---");
    out.push(...(r.findings.length
      ? r.findings.map((f) => `- [${f.id ?? "?"}] ${f.severity}, ${f.origin}, ${f.kind}: ${f.file}${f.line ? `:${f.line}` : ""}: ${f.summary}`)
      : ["(none)"]));
    if (r.reviewRounds > 1) out.push(`The coder then had ${r.reviewRounds - 1} correction round(s) before the last review.`);
    out.push(`--- the reviewer then fixed these itself, up to the final commit: ${r.selfFixedIds?.length ? r.selfFixedIds.join(", ") : "none"}`, "");
  }
  return { runs: runs.map((r) => r.runId), text: out.join("\n") };
}

/**
 * One row per issue for a finished grade-runs run: the grader's grades of
 * every run it compared. Stored apart from the run rows, so recording a run
 * again doesn't drop its grades.
 * @param {Parameters<typeof buildRows>[0]} run
 */
export function buildGradeRows({ record, agents, recordedAt }) {
  const rows = [];
  for (const a of agents) {
    const m = /^rungrade\s+#(\d+)$/.exec(a.label ?? "");
    if (!m || !a.result) continue;
    const t = a.transcript;
    const cost = costOf(t.model, t.tokens, t.longTokens);
    rows.push({
      runId: record.runId,
      workflow: record.workflowName ?? null,
      recordedAt,
      issue: Number(m[1]),
      bench: argsObject(record.args).base ?? null,
      agents: [{
        label: a.label, stage: "rungrade", round: 1, model: t.model, effort: t.effort,
        requests: t.requests, toolCalls: a.progress?.toolCalls ?? null, minutes: t.minutes,
        peakContext: t.peakContext, tokens: t.tokens, longTokens: t.longTokens ?? NO_TOKENS, cost,
      }],
      cost: cost?.total ?? null,
      runs: (a.result.runs ?? []).map((g) => ({
        runId: g.run_id,
        planGrade: parseGrade(g.plan_grade),
        codeGrade: parseGrade(g.code_grade),
        reviewGrade: parseGrade(g.review_grade),
        finalCodeGrade: parseGrade(g.final_code_grade),
        findingsReal: (g.findings_real ?? []).length,
        findingsWrong: (g.findings_wrong ?? []).length,
        missed: g.missed ?? [],
        finalOpen: g.final_open ?? [],
        reasons: { plan: g.plan_reason ?? "", code: g.code_reason ?? "", review: g.review_reason ?? "", finalCode: g.final_code_reason ?? "" },
      })),
      ranking: a.result.ranking ?? [],
      notes: a.result.notes ?? "",
    });
  }
  return rows;
}

/**
 * The newest grade of each run of each issue, keyed "<runId>#<issue>".
 * @param {any[]} gradeRows
 */
export function latestGrades(gradeRows) {
  const m = new Map();
  for (const row of [...gradeRows].sort((a, b) => String(a.recordedAt).localeCompare(String(b.recordedAt)))) {
    for (const g of row.runs) m.set(`${g.runId}#${row.issue}`, g);
  }
  return m;
}

/**
 * Sums rows per setup, each issue of each run once: the median over its
 * subruns (`runOf`). `prState` maps a branch to its PR state (OPEN, MERGED,
 * CLOSED) when the caller could ask GitHub.
 * @param {any[]} rows
 * @param {Map<string, string>} [prState]
 * @param {Map<string, any>} [grades] from `latestGrades`
 */
export function summarize(rows, prState = new Map(), grades = new Map()) {
  /** @type {Map<string, Map<string, any[]>>} setup → "<run>#<issue>" → its subruns' rows */
  const groups = new Map();
  for (const r of rows) {
    if (r.alreadyDone) continue;
    const k = setupKey(r);
    if (!groups.has(k)) groups.set(k, new Map());
    const items = groups.get(k);
    const ik = `${runOf(r).run}#${r.issue}`;
    if (!items.has(ik)) items.set(ik, []);
    items.get(ik).push(r);
  }
  return [...groups].map(([setup, byItem]) => {
    const items = [...byItem.values()];
    const rs = items.flat();
    // One value per issue of a run: the median of what its subruns gave.
    const per = (f) => items.map((sub) => median(sub.map(f).filter(isNum))).filter(isNum);
    const avg = (f) => mean(per(f));
    const total = (f) => per(f).reduce((a, b) => a + b, 0);
    const flag = (f) => (r) => (f(r) ? 1 : 0);
    const points = (key) => (r) => GRADE_POINTS[r[key]];
    const findings = rs.flatMap((r) => r.findings);
    const withOrigin = findings.filter((f) => f.origin);
    const count = (r, pred) => r.findings.filter(pred).length;
    const stages = {};
    for (const name of STAGES) {
      const of = (f) => (r) => (r.stages[name] ? f(r.stages[name]) : undefined);
      const used = per(of(() => 1)).length;
      if (!used) continue;
      stages[name] = {
        issuesUsing: used,
        agents: avg(of((s) => s.agents)),
        minutes: avg(of((s) => s.minutes)),
        requests: avg(of((s) => s.requests)),
        contextTokens: avg(of((s) => s.tokens.input + s.tokens.cacheWrite + s.tokens.cacheRead)),
        outputSeen: avg(of((s) => s.tokens.outputSeen)),
        cost: avg(of((s) => s.cost)),
      };
    }
    const converged = per((r) => (r.converged === null ? undefined : r.converged ? 1 : 0));
    return {
      setup,
      name: setupName(rs[0]),
      issues: items.length,
      subruns: rs.length,
      runs: new Set(rs.map((r) => runOf(r).run)).size,
      resolved: total(flag((r) => r.issueResolved)),
      readyToShip: total(flag((r) => r.readyToShip)),
      merged: total(flag((r) => prState.get(r.branch) === "MERGED")),
      converged: converged.length ? converged.reduce((a, b) => a + b, 0) : null,
      stalledFixes: total((r) => r.stalledFixes ?? 0),
      reviewRounds: avg((r) => r.reviewRounds),
      planGrade: avg(points("planGrade")),
      codeGrade: avg(points("codeGrade")),
      finalCodeGrade: avg(points("finalCodeGrade")),
      findingsPerIssue: {
        blocking: avg((r) => count(r, (f) => f.severity === "blocking")) ?? 0,
        shouldFix: avg((r) => count(r, (f) => f.severity === "should-fix")) ?? 0,
        nit: avg((r) => count(r, (f) => f.severity === "nit")) ?? 0,
      },
      fromPlanShare: withOrigin.length ? withOrigin.filter((f) => f.origin === "plan").length / withOrigin.length : null,
      weakTests: total((r) => count(r, (f) => f.kind === "weak-test")),
      bugs: total((r) => count(r, (f) => f.kind === "bug")),
      costPerIssue: avg((r) => r.cost),
      fork: forkSummary(rs.map((r) => r.fork).filter(Boolean)),
      grader: graderSummary(items, grades),
      noise: noiseSummary(items, grades),
      stages,
    };
  });
}

/**
 * How far the subruns of one issue of one run wandered, over the issues run
 * more than once: the mean of each one's max minus min, and the unsteady
 * ones by name.
 * @param {any[][]} items
 * @param {Map<string, any>} grades
 */
function noiseSummary(items, grades) {
  const multi = items.filter((sub) => sub.length > 1);
  if (!multi.length) return null;
  const spreadOf = (sub, f) => {
    const xs = sub.map(f).filter(isNum);
    return xs.length > 1 ? Math.max(...xs) - Math.min(...xs) : undefined;
  };
  const spread = (f) => mean(multi.map((sub) => spreadOf(sub, f)).filter(isNum));
  const graded = (r) => GRADE_POINTS[grades.get(`${r.runId}#${r.issue}`)?.codeGrade];
  const unsteady = multi.filter((sub) =>
    new Set(sub.map((r) => !!r.readyToShip)).size > 1 ||
    (spreadOf(sub, (r) => GRADE_POINTS[r.finalCodeGrade]) ?? 0) >= UNSTEADY_GRADE_GAP);
  return {
    issues: multi.length,
    codeGrade: spread((r) => GRADE_POINTS[r.codeGrade]),
    finalCodeGrade: spread((r) => GRADE_POINTS[r.finalCodeGrade]),
    graderCodeGrade: spread(graded),
    cost: spread((r) => r.cost),
    readyDiffered: multi.filter((sub) => new Set(sub.map((r) => !!r.readyToShip)).size > 1).length,
    unsteady: unsteady.map((sub) => ({
      run: runOf(sub[0]).name,
      issue: sub[0].issue,
      finalCodeGrades: sub.map((r) => r.finalCodeGrade ?? "-"),
      readyToShip: sub.map((r) => !!r.readyToShip),
    })),
  };
}

function graderSummary(items, grades) {
  const gradeOf = (r) => grades.get(`${r.runId}#${r.issue}`);
  const gradedItems = items.filter((sub) => sub.some(gradeOf));
  if (!gradedItems.length) return null;
  // Per issue of a run, the median over the subruns the grader saw.
  const per = (f) => gradedItems.map((sub) => median(sub.filter(gradeOf).map((r) => f(gradeOf(r), r)).filter(isNum))).filter(isNum);
  const avg = (f) => mean(per(f));
  const points = (key) => (g) => GRADE_POINTS[g[key]];
  const reviewed = (f) => (g, r) => (g.reviewGrade ? f(g, r) : undefined);
  return {
    issues: gradedItems.length,
    planGrade: avg(points("planGrade")),
    codeGrade: avg(points("codeGrade")),
    reviewGrade: avg(points("reviewGrade")),
    finalCodeGrade: avg(points("finalCodeGrade")),
    findingsReal: avg(reviewed((g) => g.findingsReal)),
    findingsWrong: avg(reviewed((g) => g.findingsWrong)),
    missed: avg(reviewed((g) => g.missed.length)),
    missedBlocking: avg(reviewed((g) => g.missed.filter((x) => x.severity === "blocking").length)),
    finalOpen: avg((g) => g.finalOpen.filter((x) => x.severity !== "nit").length),
    // Positive: the reviewer graded the code higher than the grader did.
    reviewerGap: avg((g, r) => GRADE_POINTS[r.codeGrade] - GRADE_POINTS[g.codeGrade]),
  };
}

function forkSummary(fs) {
  if (!fs.length) return null;
  const grade = (xs) => mean(xs.map((g) => GRADE_POINTS[g]).filter((x) => x !== undefined));
  return {
    issues: fs.length,
    fixCost: mean(fs.map((f) => f.fixCost ?? 0)),
    checkCost: mean(fs.map((f) => f.checkCost ?? 0)),
    codeGrade: grade(fs.map((f) => f.codeGrade)),
    open: mean(fs.map((f) => f.open ?? 0)),
    loopCost: mean(fs.map((f) => f.loopCost)),
    loopOpen: mean(fs.map((f) => f.loopOpen)),
  };
}

function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function isNum(x) {
  return typeof x === "number" && !Number.isNaN(x);
}

/** The plain-text report the CLI prints. */
export function renderReport(summaries, rows, { listIssues = false, prState = new Map() } = {}) {
  const out = [];
  const n = (x, d = 1) => (x === null || x === undefined ? "-" : x.toFixed(d));
  const mt = (x) => (x === null ? "-" : `${(x / 1e6).toFixed(2)}M`);
  const usd = (x) => (x === null ? "-" : `$${x.toFixed(2)}`);
  // A count over issues can be a half when two subruns split.
  const c = (x) => (x === null || x === undefined ? "-" : Number.isInteger(x) ? String(x) : x.toFixed(1));
  for (const s of summaries) {
    out.push(`${s.name}: ${s.setup}`);
    out.push(`  ${s.issues} issue(s) over ${s.runs} run(s)${s.subruns > s.issues ? ` (${s.subruns} subruns; each issue is their median)` : ""}` +
      ` · resolved ${c(s.resolved)} · ready to ship ${c(s.readyToShip)} · merged ${c(s.merged)}` +
      (s.converged === null ? "" : ` · converged without the reviewer fixing ${c(s.converged)}`) +
      (s.stalledFixes ? ` · STALLED fix rounds ${s.stalledFixes}` : ""));
    out.push(`  grades (A = 4): plan ${n(s.planGrade, 2)} · code at first review ${n(s.codeGrade, 2)} · code at last review ${n(s.finalCodeGrade, 2)} · review rounds ${n(s.reviewRounds)}`);
    out.push(`  first-review findings per issue: blocking ${n(s.findingsPerIssue.blocking)} · should-fix ${n(s.findingsPerIssue.shouldFix)} · nit ${n(s.findingsPerIssue.nit)}` +
      ` · from the plan ${s.fromPlanShare === null ? "-" : `${Math.round(s.fromPlanShare * 100)}%`} · weak tests ${c(s.weakTests)} · bugs ${c(s.bugs)}`);
    out.push(`  est. cost per issue ${usd(s.costPerIssue)} (API list price; output tokens are a floor)`);
    if (s.noise) {
      const z = s.noise;
      out.push(`  noise, max minus min between subruns (${z.issues} issue(s) run more than once): code grade at first review ${n(z.codeGrade, 2)} · at last review ${n(z.finalCodeGrade, 2)}` +
        (z.graderCodeGrade === null ? "" : ` · grader's code grade ${n(z.graderCodeGrade, 2)}`) +
        ` · cost ${usd(z.cost)} · ready to ship differed on ${z.readyDiffered}`);
      for (const u of z.unsteady) {
        out.push(`    unsteady: #${u.issue} ${u.run} · final code ${u.finalCodeGrades.join(" / ")} · ready ${u.readyToShip.map((x) => (x ? "yes" : "no")).join(" / ")}`);
      }
    }
    if (s.fork) {
      const loopGrade = mean(rows.filter((r) => r.fork && setupKey(r) === s.setup).map((r) => GRADE_POINTS[r.finalCodeGrade]).filter((x) => x !== undefined));
      out.push(`  after a first review with findings (${s.fork.issues} issue(s)), mean per issue:`);
      out.push(`    reviewer fixes it  ${usd(s.fork.fixCost)} fixing (+ ${usd(s.fork.checkCost)} check) · code grade after ${n(s.fork.codeGrade, 2)} · open after ${n(s.fork.open)}`);
      out.push(`    correction loop    ${usd(s.fork.loopCost)} fixes and re-reviews · code grade at last review ${n(loopGrade, 2)} · open at last review ${n(s.fork.loopOpen)}`);
    }
    if (s.grader) {
      const g = s.grader;
      const sign = (x) => (x === null ? "-" : `${x > 0 ? "+" : ""}${x.toFixed(2)}`);
      out.push(`  grader, side by side (${g.issues} issue(s)): plan ${n(g.planGrade, 2)} · code ${n(g.codeGrade, 2)} · review ${n(g.reviewGrade, 2)} · final code ${n(g.finalCodeGrade, 2)} · open at the end ${n(g.finalOpen)}`);
      out.push(`  review per issue, by the grader: real findings ${n(g.findingsReal)} · wrong ${n(g.findingsWrong)} · missed ${n(g.missed)} (blocking ${n(g.missedBlocking)}) · reviewer's code grade minus the grader's ${sign(g.reviewerGap)}`);
    }
    for (const [name, st] of Object.entries(s.stages)) {
      out.push(`  ${name.padEnd(7)} ${usd(st.cost)} · ${n(st.agents)} agent(s) · ${n(st.minutes)} min · ${n(st.requests, 0)} requests · ${mt(st.contextTokens)} context · ${n(st.outputSeen, 0)}+ output (mean per issue that ran it)` +
        (name === "grade" ? " · the measurement, not in the cost" : ""));
    }
    out.push("");
  }
  if (listIssues) {
    // One line per issue of a run; subruns' letters side by side, their median cost.
    const items = new Map();
    for (const r of rows) {
      const k = `${runOf(r).run}#${r.issue}`;
      if (!items.has(k)) items.set(k, []);
      items.get(k).push(r);
    }
    for (const sub of items.values()) {
      const r = sub[0];
      const all = (f) => sub.map((x) => f(x) ?? "-").join("/");
      const subs = sub.length > 1 ? ` (${sub.length} subruns)` : "";
      out.push(`#${r.issue} ${runOf(r).name}${subs} plan ${all((x) => x.planGrade)} code ${all((x) => x.codeGrade)}→${all((x) => x.finalCodeGrade)} · ${all((x) => x.reviewRounds)} review(s) · ${all((x) => x.findings.length)} first finding(s) · ${usd(median(sub.map((x) => x.cost).filter(isNum)))} · ${all((x) => prState.get(x.branch) ?? "no PR")} · ${sub.map((x) => x.branch ?? "").join(", ")}${r.alreadyDone ? " · already done" : ""}`);
    }
  }
  return out.join("\n");
}
