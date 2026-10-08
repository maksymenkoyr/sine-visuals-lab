#!/usr/bin/env node
// Collects the results of plan-code-review workflow runs
// (.claude/workflows/plan-code-review.js, launched by /plan-code-review) so
// stage models can be compared over many issues: grades, findings, and the
// minutes and tokens each stage used.
//
//   npm run workflow-stats -- record wf_d5233a2c-fd5   # add a finished run
//   npm run workflow-stats -- report                  # per setup
//   npm run workflow-stats -- report --issues         # plus one line per issue
//   npm run workflow-stats -- report --json           # the raw rows
//   npm run workflow-stats -- tokens [runId]           # per agent, latest run by default
//
// `record` finds the run under ~/.claude/projects/*/*/workflows/<runId>.json,
// reads its journal and each agent's transcript next to it, and replaces any
// rows the store already has for that run, so recording twice is safe. Those
// files belong to the Claude Code session and go away with it, so record a
// run soon after it finishes.
//
// The store is one JSON row per issue, in WORKFLOW_STATS_FILE or
// ~/.claude/workflow-stats/runs.jsonl. It sits outside the repo on purpose:
// it's the owner's private log, and it outlives worktrees and branches.
// `report` asks `gh` which branches have a merged PR, the slowest but most
// honest signal of whether a run's work was any good. Pass --no-gh to skip it.
//
// Row building and the per-setup sums live in workflowStatsLib.mjs.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { buildRows, forkIndex, renderReport, summarize, transcriptStats } from "./workflowStatsLib.mjs";

const STORE = process.env.WORKFLOW_STATS_FILE ?? join(homedir(), ".claude", "workflow-stats", "runs.jsonl");
const PROJECTS = join(homedir(), ".claude", "projects");

const [cmd, ...rest] = process.argv.slice(2);

function readJsonl(path) {
  return readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

function readStore() {
  return existsSync(STORE) ? readJsonl(STORE) : [];
}

function findRunRecord(runId) {
  for (const project of readdirSync(PROJECTS)) {
    const pdir = join(PROJECTS, project);
    let sessions;
    try {
      sessions = readdirSync(pdir, { withFileTypes: true }).filter((d) => d.isDirectory());
    } catch {
      continue;
    }
    for (const s of sessions) {
      const path = join(pdir, s.name, "workflows", `${runId}.json`);
      if (existsSync(path)) return path;
    }
  }
  return null;
}

function record(runId) {
  if (!runId) throw new Error("usage: workflow-stats record <runId>");
  const recordPath = findRunRecord(runId);
  if (!recordPath) throw new Error(`no run record for ${runId} under ${PROJECTS}`);
  const runRecord = JSON.parse(readFileSync(recordPath, "utf8"));
  if (runRecord.status && runRecord.status !== "completed") {
    console.warn(`warning: run ${runId} is ${runRecord.status}; recording what finished`);
  }
  const dir = join(dirname(dirname(recordPath)), "subagents", "workflows", runId);
  const labels = new Map();
  const results = new Map();
  for (const e of readJsonl(join(dir, "journal.jsonl"))) {
    if (e.type === "started") labels.set(e.agentId, e.label);
    if (e.type === "result") results.set(e.agentId, e.result);
  }
  const progress = new Map(
    (runRecord.workflowProgress ?? []).filter((p) => p.type === "workflow_agent").map((p) => [p.agentId, p]),
  );
  const agents = [...labels].flatMap(([agentId, label]) => {
    const tpath = join(dir, `agent-${agentId}.jsonl`);
    const entries = existsSync(tpath) ? readJsonl(tpath) : [];
    const result = results.get(agentId) ?? null;
    // A forked first review also fixed its copy; that half is its own agent.
    const cut = result?.fork_commit && /^review #\d+ r1$/.test(label) ? forkIndex(entries) : -1;
    if (cut < 0) return [{ label, result, transcript: transcriptStats(entries), progress: progress.get(agentId) }];
    return [
      { label, result, transcript: transcriptStats(entries.slice(0, cut)) },
      { label: label.replace(/^review (#\d+) r1$/, "opusfix $1"), result: { fixed: result.fork_fixed ?? [], commit: result.fork_commit }, transcript: transcriptStats(entries.slice(cut)) },
    ];
  });
  const rows = buildRows({ record: runRecord, agents, recordedAt: new Date().toISOString() });
  const kept = readStore().filter((r) => r.runId !== runId);
  mkdirSync(dirname(STORE), { recursive: true });
  writeFileSync(STORE, [...kept, ...rows].map((r) => JSON.stringify(r)).join("\n") + "\n");
  console.log(`recorded ${rows.length} issue(s) from ${runId} into ${STORE}`);
  for (const r of rows) {
    console.log(`  #${r.issue} plan ${r.planGrade ?? "-"} code ${r.codeGrade ?? "-"}→${r.finalCodeGrade ?? "-"} · ${r.reviewRounds} review(s) · $${r.cost.toFixed(2)}${r.alreadyDone ? " · already done" : ""}`);
  }
}

// One line per agent of one recorded run (the latest when no ID is given):
// where the tokens went and what they cost.
function tokens(runId) {
  const all = readStore();
  const id = runId ?? all.at(-1)?.runId;
  const rows = all.filter((r) => r.runId === id);
  if (!rows.length) {
    console.log(runId ? `no recorded run ${runId}` : "no runs recorded yet");
    return;
  }
  const k = (x) => (x >= 1e6 ? `${(x / 1e6).toFixed(2)}M` : `${Math.round(x / 1e3)}k`);
  const usd = (x) => (x == null ? "-" : `$${x.toFixed(3)}`);
  console.log(`${id} · cost is an API-list-price estimate; output tokens are a floor`);
  console.log("agent               model/effort         req tools  min    fresh  c.write   c.read  out+   peak    cost  (fresh / write / read / out)");
  let total = 0;
  for (const r of rows) {
    for (const a of r.agents) {
      const t = a.tokens;
      const c = a.cost;
      total += c?.total ?? 0;
      console.log(
        `${a.label.padEnd(19)} ${`${(a.model ?? "?").replace(/^claude-/, "")}/${a.effort ?? "?"}`.padEnd(20)}` +
        ` ${String(a.requests).padStart(3)} ${String(a.toolCalls ?? "-").padStart(5)} ${a.minutes.toFixed(1).padStart(4)}` +
        ` ${k(t.input).padStart(8)} ${k(t.cacheWrite).padStart(8)} ${k(t.cacheRead).padStart(8)} ${k(t.outputSeen).padStart(5)} ${k(a.peakContext).padStart(6)}` +
        ` ${usd(c?.total).padStart(7)}  (${c ? [c.input, c.cacheWrite, c.cacheRead, c.output].map((x) => x.toFixed(3)).join(" / ") : "-"})`,
      );
    }
  }
  console.log(`total ${usd(total)}`);
}

function prStates() {
  try {
    const out = execFileSync("gh", ["pr", "list", "--state", "all", "--limit", "500", "--json", "headRefName,state"], { encoding: "utf8" });
    return new Map(JSON.parse(out).map((p) => [p.headRefName, p.state]));
  } catch {
    console.warn("warning: gh pr list failed; merged counts show 0");
    return new Map();
  }
}

function report(flags) {
  const rows = readStore();
  if (flags.includes("--json")) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  if (!rows.length) {
    console.log(`no runs recorded yet in ${STORE}`);
    return;
  }
  const prState = flags.includes("--no-gh") ? new Map() : prStates();
  console.log(renderReport(summarize(rows, prState), rows, { listIssues: flags.includes("--issues"), prState }));
}

if (cmd === "record") record(rest[0]);
else if (cmd === "report") report(rest);
else if (cmd === "tokens") tokens(rest[0]);
else {
  console.log("usage: workflow-stats record <runId> | report [--issues] [--json] [--no-gh] | tokens [runId]");
  process.exit(cmd ? 1 : 0);
}
