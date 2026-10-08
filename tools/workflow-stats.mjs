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
import { buildRows, renderReport, summarize, transcriptStats } from "./workflowStatsLib.mjs";

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
  const agents = [...labels].map(([agentId, label]) => {
    const tpath = join(dir, `agent-${agentId}.jsonl`);
    return {
      label,
      result: results.get(agentId) ?? null,
      transcript: transcriptStats(existsSync(tpath) ? readJsonl(tpath) : []),
    };
  });
  const rows = buildRows({ record: runRecord, agents, recordedAt: new Date().toISOString() });
  const kept = readStore().filter((r) => r.runId !== runId);
  mkdirSync(dirname(STORE), { recursive: true });
  writeFileSync(STORE, [...kept, ...rows].map((r) => JSON.stringify(r)).join("\n") + "\n");
  console.log(`recorded ${rows.length} issue(s) from ${runId} into ${STORE}`);
  for (const r of rows) {
    console.log(`  #${r.issue} plan ${r.planGrade ?? "-"} code ${r.codeGrade ?? "-"} · ${r.findings.length} finding(s)${r.alreadyDone ? " · already done" : ""}`);
  }
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
else {
  console.log("usage: workflow-stats record <runId> | report [--issues] [--json] [--no-gh]");
  process.exit(cmd ? 1 : 0);
}
