#!/usr/bin/env node
// Collects the results of plan-code-review workflow runs
// (.claude/workflows/plan-code-review.js, launched by /plan-code-review) so
// stage models can be compared over many issues: grades, findings, and the
// minutes and tokens each stage used.
//
//   npm run workflow-stats -- record wf_d5233a2c-fd5   # add a finished run
//   npm run workflow-stats -- sweep                   # add every finished run not stored yet
//   npm run workflow-stats -- report                  # per setup
//   npm run workflow-stats -- report --issues         # plus one line per issue
//   npm run workflow-stats -- report --json           # the raw rows
//   npm run workflow-stats -- tokens [runId]           # per agent, latest run by default
//   npm run workflow-stats -- import rows.jsonl        # add rows another machine recorded
//
// `record` finds the run under ~/.claude/projects/*/*/workflows/<runId>.json,
// reads its journal and each agent's transcript next to it, and replaces any
// rows the store already has for that run, so recording twice is safe. Those
// files belong to the Claude Code session and are cleaned up with old
// sessions, so record a run soon after it finishes. `sweep` records every
// completed run of the plan-code-review workflow that the store lacks, from
// any session still on disk: the catch-up for runs nobody recorded.
//
// The store is one JSON row per issue. It sits outside this repo on purpose:
// it's the owner's private log, and it outlives worktrees and branches. Where
// it lives, first match wins:
// - WORKFLOW_STATS_REPO, a clone of the owner's private log repo: the store
//   is its runs.jsonl, every command pulls before reading, and `record`,
//   `sweep` and `import` commit and push what they add, so local and cloud
//   sessions share one log. Two sessions recording at once can't lose rows:
//   a push that is refused fetches, rebuilds the file from the remote's rows
//   plus this session's (`mergeRows`, by run) and pushes again. Offline, the
//   commit waits in the clone and the next write pushes it.
// - WORKFLOW_STATS_FILE, a plain file, synced by nothing.
// - ~/.claude/workflow-stats/runs.jsonl, the same.
// `report` asks `gh` which branches have a merged PR, the slowest but most
// honest signal of whether a run's work was any good. Pass --no-gh to skip it.
//
// Row building and the per-setup sums live in workflowStatsLib.mjs.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { buildRows, forkIndex, mergeRows, renderReport, summarize, transcriptStats } from "./workflowStatsLib.mjs";

const REPO = process.env.WORKFLOW_STATS_REPO || null;
const STORE = REPO ? join(REPO, "runs.jsonl") : (process.env.WORKFLOW_STATS_FILE ?? join(homedir(), ".claude", "workflow-stats", "runs.jsonl"));
const PUSH_TRIES = 3;
const PROJECTS = join(homedir(), ".claude", "projects");

const [cmd, ...rest] = process.argv.slice(2);

function readJsonl(path) {
  return readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

function readStore() {
  return existsSync(STORE) ? readJsonl(STORE) : [];
}

function writeStore(rows) {
  mkdirSync(dirname(STORE), { recursive: true });
  writeFileSync(STORE, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
}

/** git in the log repo; returns stdout, or null when the command fails. */
function git(...args) {
  try {
    return execFileSync("git", ["-C", REPO, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch {
    return null;
  }
}

/**
 * Bring the clone up to the remote, keeping rows only this clone has (a
 * commit an offline write left behind). Returns false when the remote
 * couldn't be reached, so the caller works on the local copy.
 */
function pullLog() {
  if (!REPO) return true;
  if (!existsSync(join(REPO, ".git"))) throw new Error(`WORKFLOW_STATS_REPO=${REPO} is not a git clone; clone the private log repo there first`);
  if (git("fetch", "--quiet", "origin") === null) {
    console.warn(`warning: couldn't reach the log repo's remote; using the local copy in ${REPO}`);
    return false;
  }
  const upstream = git("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}") ?? (git("rev-parse", "--verify", "--quiet", "origin/main") !== null ? "origin/main" : null);
  if (!upstream) return true; // an empty remote: the first push creates its branch
  const ours = readStore();
  if (git("reset", "--hard", "--quiet", upstream) === null) throw new Error(`couldn't reset ${REPO} to ${upstream}`);
  const theirs = readStore();
  const known = new Set(theirs.map((r) => r.runId));
  const onlyOurs = ours.filter((r) => !known.has(r.runId));
  if (onlyOurs.length) writeStore(mergeRows(theirs, onlyOurs));
  return true;
}

/** Adds rows to the store, replacing any it has for the same runs, and shares them. */
function saveRows(added, message) {
  if (!REPO) {
    writeStore(mergeRows(readStore(), added));
    return;
  }
  for (let attempt = 1; attempt <= PUSH_TRIES; attempt++) {
    const online = pullLog();
    writeStore(mergeRows(readStore(), added));
    git("add", "runs.jsonl");
    if (git("diff", "--cached", "--quiet") === null) git("commit", "--quiet", "-m", message);
    if (!online) break;
    if (git("push", "--quiet", "-u", "origin", "HEAD") !== null) return;
  }
  console.warn(`warning: ${message} is committed in ${REPO} but not pushed; the next record, sweep or import pushes it`);
}

/** Every session's workflows/ directory under ~/.claude/projects. */
function workflowDirs() {
  const dirs = [];
  for (const project of readdirSync(PROJECTS)) {
    const pdir = join(PROJECTS, project);
    let sessions;
    try {
      sessions = readdirSync(pdir, { withFileTypes: true }).filter((d) => d.isDirectory());
    } catch {
      continue;
    }
    for (const s of sessions) {
      const dir = join(pdir, s.name, "workflows");
      if (existsSync(dir)) dirs.push(dir);
    }
  }
  return dirs;
}

function findRunRecord(runId) {
  for (const dir of workflowDirs()) {
    const path = join(dir, `${runId}.json`);
    if (existsSync(path)) return path;
  }
  return null;
}

function record(runId) {
  if (!runId) throw new Error("usage: workflow-stats record <runId>");
  const recordPath = findRunRecord(runId);
  if (!recordPath) throw new Error(`no run record for ${runId} under ${PROJECTS}`);
  recordFrom(runId, recordPath);
}

function sweep() {
  pullLog();
  const stored = new Set(readStore().map((r) => r.runId));
  let found = 0;
  for (const dir of workflowDirs()) {
    for (const name of readdirSync(dir).filter((f) => /^wf_.*\.json$/.test(f))) {
      const runId = name.replace(/\.json$/, "");
      if (stored.has(runId)) continue;
      let meta;
      try {
        meta = JSON.parse(readFileSync(join(dir, name), "utf8"));
      } catch {
        continue;
      }
      if (meta.workflowName !== "plan-code-review" || meta.status !== "completed") continue;
      found++;
      recordFrom(runId, join(dir, name));
    }
  }
  if (!found) console.log(`every completed plan-code-review run on disk is already in ${STORE}`);
}

function recordFrom(runId, recordPath) {
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
  saveRows(rows, `record ${runId}`);
  console.log(`recorded ${rows.length} issue(s) from ${runId} into ${STORE}`);
  for (const r of rows) {
    console.log(`  #${r.issue} plan ${r.planGrade ?? "-"} code ${r.codeGrade ?? "-"}→${r.finalCodeGrade ?? "-"} · ${r.reviewRounds} review(s) · $${r.cost.toFixed(2)}${r.alreadyDone ? " · already done" : ""}`);
  }
}

// One line per agent of one recorded run (the latest when no ID is given):
// where the tokens went and what they cost.
function tokens(runId) {
  pullLog();
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
  let graded = 0;
  for (const r of rows) {
    for (const a of r.agents) {
      const t = a.tokens;
      const c = a.cost;
      if (a.stage === "grade") graded += c?.total ?? 0;
      else total += c?.total ?? 0;
      console.log(
        `${a.label.padEnd(19)} ${`${(a.model ?? "?").replace(/^claude-/, "")}/${a.effort ?? "?"}`.padEnd(20)}` +
        ` ${String(a.requests).padStart(3)} ${String(a.toolCalls ?? "-").padStart(5)} ${a.minutes.toFixed(1).padStart(4)}` +
        ` ${k(t.input).padStart(8)} ${k(t.cacheWrite).padStart(8)} ${k(t.cacheRead).padStart(8)} ${k(t.outputSeen).padStart(5)} ${k(a.peakContext).padStart(6)}` +
        ` ${usd(c?.total).padStart(7)}  (${c ? [c.input, c.cacheWrite, c.cacheRead, c.output].map((x) => x.toFixed(3)).join(" / ") : "-"})`,
      );
    }
  }
  console.log(`total ${usd(total)}${graded ? ` (+ ${usd(graded)} of grade agents, the measurement, not counted)` : ""}`);
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
  pullLog();
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

function importRows(path) {
  if (!path) throw new Error("usage: workflow-stats import <rows.jsonl>");
  const rows = readJsonl(path);
  const runs = new Set(rows.map((r) => r.runId));
  saveRows(rows, `import ${runs.size} run(s) from ${path.split("/").pop()}`);
  console.log(`imported ${rows.length} row(s) from ${runs.size} run(s) into ${STORE}`);
}

if (cmd === "record") record(rest[0]);
else if (cmd === "import") importRows(rest[0]);
else if (cmd === "sweep") sweep();
else if (cmd === "report") report(rest);
else if (cmd === "tokens") tokens(rest[0]);
else {
  console.log("usage: workflow-stats record <runId> | sweep | import <rows.jsonl> | report [--issues] [--json] [--no-gh] | tokens [runId]");
  process.exit(cmd ? 1 : 0);
}
