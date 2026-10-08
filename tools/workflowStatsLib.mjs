// The pure half of tools/workflow-stats.mjs: it turns one finished run of the
// plan-code-review workflow (.claude/workflows/plan-code-review.js) into one
// stats row per issue, and sums those rows per setup for the report. A setup
// is the workflow version plus the model and effort of each stage. Comparing
// setups is the point: "does Sonnet code better than Haiku for the cost?"
//
// A row joins three sources. The run record gives the args, script and start
// time. The journal gives each agent's label and its structured return value.
// Each agent's transcript gives the model, effort, turns, tokens and minutes
// it actually used. Agents can't report their own token use, so the
// transcript is the only honest source for it. The CLI reads those files;
// everything here works on already-parsed values, so tests can feed it
// fixtures.
//
// Version 1 runs (the first trial, before the workflow was saved) returned
// grades as free text such as "B-: reason" under `haiku_grade`. `parseGrade`
// reads both that and the later bare letter, so old rows stay comparable.
// Their findings have no origin or kind, and those stay null.

/** Grade letters the review schema allows, best first, with their points. */
export const GRADE_POINTS = {
  A: 4, "A-": 3.7, "B+": 3.3, B: 3, "B-": 2.7, "C+": 2.3, C: 2, "C-": 1.7, D: 1, F: 0,
};

/** @param {unknown} text @returns {string | null} the grade letter it starts with */
export function parseGrade(text) {
  if (typeof text !== "string") return null;
  const m = /^\s*([A-DF][+-]?)(?![A-Za-z])/.exec(text);
  return m && m[1] in GRADE_POINTS ? m[1] : null;
}

/** "plan #346" → { stage: "plan", issue: 346 } */
export function parseLabel(label) {
  const m = /^(plan|code|review)\s+#(\d+)$/.exec(label ?? "");
  return m ? { stage: m[1], issue: Number(m[2]) } : null;
}

/**
 * Sums what one agent used, from its transcript's parsed JSONL entries.
 * @param {any[]} entries
 */
export function transcriptStats(entries) {
  const s = {
    model: null, effort: null, turns: 0,
    tokens: { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 },
    minutes: 0,
  };
  let first = null;
  let last = null;
  for (const e of entries) {
    if (e.timestamp) {
      const t = Date.parse(e.timestamp);
      if (first === null || t < first) first = t;
      if (last === null || t > last) last = t;
    }
    const usage = e.type === "assistant" ? e.message?.usage : null;
    if (!usage) continue;
    s.turns++;
    s.model ??= e.message.model ?? null;
    s.effort ??= e.effort ?? null;
    s.tokens.input += usage.input_tokens ?? 0;
    s.tokens.cacheWrite += usage.cache_creation_input_tokens ?? 0;
    s.tokens.cacheRead += usage.cache_read_input_tokens ?? 0;
    s.tokens.output += usage.output_tokens ?? 0;
  }
  if (first !== null && last !== null) s.minutes = Math.round((last - first) / 600) / 100;
  return s;
}

/** The setup a row ran under, as one readable key. */
export function setupKey(row) {
  const st = (name) => {
    const s = row.stages[name];
    return s ? `${name} ${shortModel(s.model)}/${s.effort ?? "?"}` : `${name} -`;
  };
  return `v${row.version} · ${st("plan")} · ${st("code")} · ${st("review")}`;
}

function shortModel(model) {
  return (model ?? "?").replace(/^claude-/, "");
}

/**
 * One row per issue for a finished run.
 * @param {{
 *   record: { runId: string, workflowName?: string, timestamp?: string, script?: string, args?: unknown },
 *   agents: { label: string, result: any, transcript: ReturnType<typeof transcriptStats> }[],
 *   recordedAt: string,
 * }} run
 */
export function buildRows({ record, agents, recordedAt }) {
  const version = Number(/WORKFLOW_VERSION\s*=\s*(\d+)/.exec(record.script ?? "")?.[1] ?? 1);
  const titles = issueTitles(record.args);
  /** @type {Map<number, any>} */
  const byIssue = new Map();
  for (const a of agents) {
    const at = parseLabel(a.label);
    if (!at) continue;
    if (!byIssue.has(at.issue)) byIssue.set(at.issue, {});
    byIssue.get(at.issue)[at.stage] = a;
  }
  const rows = [];
  for (const [issue, st] of [...byIssue].sort((x, y) => x[0] - y[0])) {
    const plan = st.plan?.result ?? null;
    const code = st.code?.result ?? null;
    const review = st.review?.result ?? null;
    const stage = (name, extra) =>
      st[name] ? { ...st[name].transcript, ...extra } : null;
    rows.push({
      runId: record.runId,
      workflow: record.workflowName ?? null,
      version,
      runStartedAt: record.timestamp ?? null,
      recordedAt,
      issue,
      title: plan?.title ?? titles.get(issue) ?? null,
      branch: code?.branch ?? plan?.branch ?? null,
      alreadyDone: plan?.already_done ?? null,
      stages: {
        plan: stage("plan", {}),
        code: stage("code", code ? {
          typecheckPassed: code.typecheck_passed ?? null,
          testsPassed: code.tests_passed ?? null,
          deviations: code.deviations ?? "",
        } : {}),
        review: stage("review", {}),
      },
      planGrade: parseGrade(review?.plan_grade),
      codeGrade: parseGrade(review?.code_grade ?? review?.haiku_grade),
      issueResolved: review?.issue_resolved ?? null,
      readyToShip: review?.ready_to_ship ?? null,
      finalTypecheck: review?.typecheck_passed ?? null,
      finalTests: review?.tests_passed ?? null,
      findings: (review?.findings ?? []).map((f) => ({
        severity: f.severity ?? null,
        origin: f.origin ?? null,
        kind: f.kind ?? null,
        fixed: f.fixed ?? null,
        file: f.file ?? null,
        summary: f.summary ?? "",
      })),
    });
  }
  return rows;
}

function issueTitles(args) {
  const list = Array.isArray(args) ? args : (args && typeof args === "object" ? args.issues ?? [] : []);
  const m = new Map();
  for (const i of list) if (i && typeof i === "object" && i.title) m.set(Number(i.n), i.title);
  return m;
}

/**
 * Sums rows per setup. `prState` maps a branch to its PR state (OPEN,
 * MERGED, CLOSED) when the caller could ask GitHub.
 * @param {any[]} rows
 * @param {Map<string, string>} [prState]
 */
export function summarize(rows, prState = new Map()) {
  /** @type {Map<string, any[]>} */
  const groups = new Map();
  for (const r of rows) {
    if (r.alreadyDone) continue;
    const k = setupKey(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  return [...groups].map(([setup, rs]) => {
    const findings = rs.flatMap((r) => r.findings);
    const count = (pred) => findings.filter(pred).length;
    const withOrigin = findings.filter((f) => f.origin);
    const stages = {};
    for (const name of ["plan", "code", "review"]) {
      const ss = rs.map((r) => r.stages[name]).filter(Boolean);
      stages[name] = {
        minutes: mean(ss.map((s) => s.minutes)),
        turns: mean(ss.map((s) => s.turns)),
        contextTokens: mean(ss.map((s) => s.tokens.input + s.tokens.cacheWrite + s.tokens.cacheRead)),
        outputTokens: mean(ss.map((s) => s.tokens.output)),
      };
    }
    return {
      setup,
      issues: rs.length,
      runs: new Set(rs.map((r) => r.runId)).size,
      resolved: rs.filter((r) => r.issueResolved).length,
      readyToShip: rs.filter((r) => r.readyToShip).length,
      merged: rs.filter((r) => prState.get(r.branch) === "MERGED").length,
      planGrade: mean(rs.map((r) => GRADE_POINTS[r.planGrade]).filter((x) => x !== undefined)),
      codeGrade: mean(rs.map((r) => GRADE_POINTS[r.codeGrade]).filter((x) => x !== undefined)),
      findingsPerIssue: {
        blocking: count((f) => f.severity === "blocking") / rs.length,
        shouldFix: count((f) => f.severity === "should-fix") / rs.length,
        nit: count((f) => f.severity === "nit") / rs.length,
      },
      fromPlanShare: withOrigin.length ? withOrigin.filter((f) => f.origin === "plan").length / withOrigin.length : null,
      weakTests: count((f) => f.kind === "weak-test"),
      bugs: count((f) => f.kind === "bug"),
      stages,
    };
  });
}

function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/** The plain-text report the CLI prints. */
export function renderReport(summaries, rows, { listIssues = false, prState = new Map() } = {}) {
  const out = [];
  const n = (x, d = 1) => (x === null ? "-" : x.toFixed(d));
  const k = (x) => (x === null ? "-" : `${(x / 1e6).toFixed(2)}M`);
  for (const s of summaries) {
    out.push(s.setup);
    out.push(`  ${s.issues} issue(s) over ${s.runs} run(s) · resolved ${s.resolved} · ready to ship ${s.readyToShip} · merged ${s.merged}`);
    out.push(`  grades (A = 4): plan ${n(s.planGrade, 2)} · code ${n(s.codeGrade, 2)}`);
    out.push(`  findings per issue: blocking ${n(s.findingsPerIssue.blocking)} · should-fix ${n(s.findingsPerIssue.shouldFix)} · nit ${n(s.findingsPerIssue.nit)}` +
      ` · from the plan ${s.fromPlanShare === null ? "-" : `${Math.round(s.fromPlanShare * 100)}%`} · weak tests ${s.weakTests} · bugs ${s.bugs}`);
    for (const name of ["plan", "code", "review"]) {
      const st = s.stages[name];
      out.push(`  ${name.padEnd(6)} ${n(st.minutes)} min · ${n(st.turns, 0)} turns · ${k(st.contextTokens)} context · ${n(st.outputTokens, 0)} output tokens (mean per issue)`);
    }
    out.push("");
  }
  if (listIssues) {
    for (const r of rows) {
      const pr = prState.get(r.branch) ?? "no PR";
      const f = r.findings.length;
      out.push(`#${r.issue} ${r.runId} plan ${r.planGrade ?? "-"} code ${r.codeGrade ?? "-"} · ${f} finding(s) · ${pr} · ${r.branch ?? ""}${r.alreadyDone ? " · already done" : ""}`);
    }
  }
  return out.join("\n");
}
