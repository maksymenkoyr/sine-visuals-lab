// The pure half of the handoff log, the record of plans a Claude Code session
// hands to the haiku-coder subagent through the Agent tool. tools/workflow-stats.mjs
// writes one row per handoff from the Claude Code hooks and reads the rows back
// for its `handoffs`, `handoff` and `handoff-ship` commands. This file turns
// already-parsed values into those rows and sums them per setup, so tests can
// feed it fixtures. Nothing here touches the disk or git.
//
// A setup is the model and effort of the planner (the session that wrote the
// plan) and of the coder (the subagent), so setups can be compared: how much
// plan went into how much code and what each side cost.
//
// After the coder, the planner reads its diff against the plan and fixes what
// it finds: the handoff's review stage, the same stage the reviewer agent runs
// in the plan-code-review workflow, done here by the planner itself. Its cost
// is the session's requests from the coder's finish to the next coder's start
// or to `handoff-ship`, so it includes /ship's own steps before that call and
// any other work the session did meanwhile. Its fixes are the lines the
// session changed in that span.
//
// The planner's request is found in the session transcript by the tool_use id
// of the Agent call. The coder's usage comes from its own transcript, read with
// the same reader as the workflow stats (workflowStatsLib.mjs), which counts
// each API request once. Plan size is measured in characters and the change in
// added characters, so a plan and its diff are compared on the same scale.

import { costOf, transcriptStats } from "./workflowStatsLib.mjs";

/** "claude-opus-5-5" → "opus-5-5"; a missing model reads "?". */
export function shortModel(model) {
  return (model ?? "?").replace(/^claude-/, "");
}

/** "opus-5-5/xhigh → haiku-5-5/high", the planner's setup and then the coder's. */
export function setupTag(planner, coder) {
  return `${shortModel(planner.model)}/${planner.effort ?? "?"} → ${shortModel(coder.model)}/${coder.effort ?? "?"}`;
}

/**
 * The model and effort of the last real assistant message in a transcript,
 * skipping the synthetic messages Claude Code writes without calling the API.
 * @param {any[]} entries
 * @returns {{ model: string | null, effort: string | null }}
 */
export function lastModelEffort(entries) {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    const model = e.message?.model;
    if (e.type === "assistant" && model && model !== "<synthetic>") return { model, effort: e.effort ?? null };
  }
  return { model: null, effort: null };
}

/**
 * The planner's request that made the Agent call with this tool_use id: its
 * model, effort, tokens and cost. A request is logged as one entry per content
 * block, so the entries sharing its requestId are summed as one request.
 * @param {any[]} entries the session transcript
 * @param {string} toolUseId
 */
export function plannerRequest(entries, toolUseId) {
  const at = entries.find((e) => e.type === "assistant" && Array.isArray(e.message?.content) &&
    e.message.content.some((c) => c.type === "tool_use" && c.id === toolUseId));
  if (!at) return null;
  const same = at.requestId ? entries.filter((e) => e.requestId === at.requestId) : [at];
  const stats = transcriptStats(same);
  const model = stats.model ?? at.message.model ?? null;
  return {
    model,
    effort: stats.effort ?? at.effort ?? null,
    tokens: stats.tokens,
    cost: costOf(model, stats.tokens, stats.longTokens)?.total ?? null,
  };
}

/**
 * The text of the coder's last message that has any text, which is its report.
 * @param {any[]} entries the coder's transcript
 */
export function finalText(entries) {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    const texts = e.type === "assistant" && Array.isArray(e.message?.content)
      ? e.message.content.filter((c) => c.type === "text")
      : [];
    if (texts.length) return texts.map((c) => c.text).join("\n");
  }
  return "";
}

/**
 * Parses `git diff --numstat` output: one line per file, added and removed
 * line counts then the path. A binary file shows "-" for both counts.
 * @param {string} text
 * @returns {{ files: number, added: number, removed: number, paths: string[] }}
 */
export function parseNumstat(text) {
  const paths = [];
  let added = 0;
  let removed = 0;
  for (const line of text.split("\n")) {
    if (!line) continue;
    const [a, r, ...path] = line.split("\t");
    added += /^\d+$/.test(a) ? Number(a) : 0;
    removed += /^\d+$/.test(r) ? Number(r) : 0;
    paths.push(path.join("\t"));
  }
  return { files: paths.length, added, removed, paths };
}

/**
 * The characters added by a unified diff: the lines that start with "+",
 * minus the "+++" file headers, each counted without its "+".
 * @param {string} diffText
 */
export function addedChars(diffText) {
  let n = 0;
  for (const line of diffText.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) n += line.length - 1;
  }
  return n;
}

/**
 * The stored row for one finished handoff.
 * @param {{ pending: any, sessionEntries: any[], agentEntries: any[], change: any, status: string | null, toolUses: number | null, recordedAt: string }} run
 */
export function buildRow({ pending, sessionEntries, agentEntries, change, status, toolUses, recordedAt }) {
  const stats = transcriptStats(agentEntries);
  const request = plannerRequest(sessionEntries, pending.id);
  const planner = request ? { model: request.model, effort: request.effort } : lastModelEffort(sessionEntries);
  const coder = { agent: pending.agent, model: stats.model, effort: stats.effort };
  return {
    id: pending.id, recordedAt, startedAt: pending.startedAt,
    session: pending.session, transcript: pending.transcript ?? null,
    cwd: pending.cwd, branch: pending.branch, headBefore: pending.headBefore,
    title: pending.title,
    planner,
    coder,
    setup: setupTag(planner, coder),
    plan: pending.plan, planChars: pending.plan.length,
    plannerRequest: request,
    report: finalText(agentEntries), status,
    coderStats: {
      requests: stats.requests,
      tokens: stats.tokens,
      longTokens: stats.longTokens,
      peakContext: stats.peakContext,
      minutes: stats.minutes,
      cost: costOf(stats.model, stats.tokens, stats.longTokens)?.total ?? null,
      toolUses,
    },
    change,
    review: null, shippedAt: null,
  };
}

/**
 * The review stage of one handoff: the planner session's requests after
 * `from` and up to `to`, and the lines it changed in that span.
 * @param {{ sessionEntries: any[], from: string, to: string, fixes: { files: number, added: number, removed: number, paths: string[] } }} span
 */
export function reviewStage({ sessionEntries, from, to, fixes }) {
  const start = Date.parse(from);
  const end = Date.parse(to);
  const inSpan = sessionEntries.filter((e) => {
    const t = e.timestamp ? Date.parse(e.timestamp) : NaN;
    return t > start && t <= end;
  });
  const stats = transcriptStats(inSpan);
  return {
    by: "planner",
    model: stats.model,
    effort: stats.effort,
    requests: stats.requests,
    tokens: stats.tokens,
    minutes: stats.minutes,
    cost: stats.requests ? costOf(stats.model, stats.tokens, stats.longTokens)?.total ?? null : null,
    fixes,
  };
}

/**
 * The rows without any row of the same id, with `row` appended.
 * @param {any[]} rows
 * @param {any} row
 */
export function replaceRow(rows, row) {
  return [...rows.filter((r) => r.id !== row.id), row];
}

/** The median of the non-null values, or null when there are none. */
function median(xs) {
  const s = xs.filter((x) => x !== null && x !== undefined).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** The mean of the non-null values, or null when there are none. */
function mean(xs) {
  const v = xs.filter((x) => x !== null && x !== undefined);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

/**
 * One summary per setup, the setups with the most handoffs first. A plan's
 * ratio is its characters over the characters the coder added, for the rows
 * whose change added any.
 * @param {any[]} rows
 * @param {Map<string, string>} prStates branch → "MERGED" | "OPEN" | "CLOSED"
 */
export function summarize(rows, prStates = new Map()) {
  /** @type {Map<string, any[]>} */
  const groups = new Map();
  for (const r of rows) {
    if (!groups.has(r.setup)) groups.set(r.setup, []);
    groups.get(r.setup).push(r);
  }
  const summaries = [...groups].map(([setup, rs]) => {
    const withChange = rs.filter((r) => r.change);
    const sized = rs.filter((r) => r.change && r.change.addedChars > 0);
    const reviewed = rs.filter((r) => r.review);
    const fixLines = (r) => r.review.fixes.added + r.review.fixes.removed;
    return {
      setup,
      n: rs.length,
      medianPlanChars: median(rs.map((r) => r.planChars)),
      medianAddedChars: median(withChange.map((r) => r.change.addedChars)),
      medianRatio: median(sized.map((r) => r.planChars / r.change.addedChars)),
      meanCoderCost: mean(rs.map((r) => r.coderStats?.cost ?? null)),
      meanPlannerCost: mean(rs.map((r) => r.plannerRequest?.cost ?? null)),
      reviewed: reviewed.length,
      withReviewFixes: reviewed.filter((r) => fixLines(r) > 0).length,
      meanReviewFixLines: mean(reviewed.map(fixLines)),
      meanReviewCost: mean(reviewed.map((r) => r.review.cost)),
      merged: rs.filter((r) => prStates.get(r.branch) === "MERGED").length,
    };
  });
  return summaries.sort((a, b) => b.n - a.n);
}

/**
 * The plain-text report: one line per setup, then one line per handoff.
 * @param {any[]} summaries from summarize()
 * @param {any[]} rows
 */
export function renderReport(summaries, rows) {
  const dash = "–";
  const num = (x, d = 0) => (x === null || x === undefined ? dash : x.toFixed(d));
  const usd = (x) => (x === null || x === undefined ? dash : `$${x.toFixed(3)}`);
  const out = [];
  for (const s of summaries) {
    out.push([
      s.setup,
      `n ${s.n}`,
      `plan ${num(s.medianPlanChars)} chars`,
      `added ${num(s.medianAddedChars)} chars`,
      `plan/change ${num(s.medianRatio, 2)}`,
      `coder ${usd(s.meanCoderCost)}`,
      `planner ${usd(s.meanPlannerCost)}`,
      `review ${usd(s.meanReviewCost)}`,
      `review fixed ${s.withReviewFixes}/${s.reviewed}`,
      `fix lines ${num(s.meanReviewFixLines, 1)}`,
      `merged ${s.merged}/${s.n}`,
    ].join("  "));
  }
  out.push("");
  for (const r of rows) {
    out.push([
      r.startedAt.slice(0, 10),
      r.id.slice(0, 12),
      r.setup,
      r.title,
      `${r.planChars} chars`,
      r.change ? `+${r.change.added}/-${r.change.removed}` : "no diff",
      usd(r.coderStats?.cost ?? null),
      r.review ? `review ${usd(r.review.cost)} fixed ${r.review.fixes.added + r.review.fixes.removed}` : "not reviewed",
    ].join("  "));
  }
  return out.join("\n");
}
