#!/usr/bin/env node
// Collects the results of plan-code-review workflow runs
// (.claude/workflows/plan-code-review.js, launched by /plan-code-review) so
// stage models can be compared over many issues: grades, findings, and the
// minutes and tokens each stage used.
//
//   node tools/workflow-stats.mjs record wf_d5233a2c-fd5   # add a finished run
//   node tools/workflow-stats.mjs sweep                   # add every finished run not stored yet
//   node tools/workflow-stats.mjs report                  # per setup
//   node tools/workflow-stats.mjs report --issues         # plus one line per issue
//   node tools/workflow-stats.mjs report --json           # the raw rows
//   node tools/workflow-stats.mjs tokens [runId]           # per agent, latest run by default
//   node tools/workflow-stats.mjs materials 346 [--bench <sha>]  # what the side-by-side grader reads
//   node tools/workflow-stats.mjs export wf_d5233a2c-fd5   # one run's rows, to carry to another machine
//   node tools/workflow-stats.mjs import rows.jsonl        # add rows another machine exported
//   node tools/workflow-stats.mjs handoffs [--json] [--no-gh]  # handoffs to builder, per setup
//   node tools/workflow-stats.mjs handoff <id-prefix>          # one handoff in full, plan included
//   node tools/workflow-stats.mjs handoff-ship                  # from /ship: what the session changed after each coder
//   node tools/workflow-stats.mjs handoff-hook                  # Claude Code hook entry (stdin), see below
//
// `record` finds the run under ~/.claude/projects/*/*/workflows/<runId>.json,
// reads its journal and each agent's transcript next to it, and replaces any
// rows the store already has for that run, so recording twice is safe. Those
// files belong to the Claude Code session and are cleaned up with old
// sessions, so record a run soon after it finishes. `sweep` records every
// completed run of the plan-code-review workflow that the store lacks, from
// any session still on disk: the catch-up for runs nobody recorded.
//
// The store is one JSON row per issue in WORKFLOW_STATS_FILE, or
// ~/.claude/workflow-stats/runs.jsonl, kept outside any project repo on
// purpose: it's the owner's private log, and it outlives worktrees and
// branches. Nothing syncs it. A run recorded on another machine or in a cloud
// session comes over by hand: `export <runId>` there, `import` here. A shared
// database can come later, if the project is ever published.
// A run of the grade-runs workflow (.claude/workflows/grade-runs.js) records
// the same way, into GRADES next to the store: one row per issue holding the
// grader's grades of every run it compared, kept apart so recording a run
// again never drops its grades. `materials` prints what that grader reads.
//
// A handoff is a plan a Claude Code session hands to the builder subagent
// through the Agent tool. The hooks in .claude/settings.json call `handoff-hook`
// on PreToolUse and PostToolUse of the Agent tool and on SubagentStop. Only
// Agent calls (the tool names handoffHook checks) whose subagent_type is
// builder are recorded (rows from before its rename say haiku-coder). The
// PreToolUse hook keeps the plan and a snapshot of the working tree in PENDING; when the coder finishes, one row goes to
// HANDOFFS, next to the store and outside the repo, because a plan can name
// paid-scene code and the log stays private. The diff is taken between two
// snapshots of the working tree, each written as a git tree object through a
// temporary index, so no ref, stash or the real index is touched. Those objects
// are unreferenced, and git's gc removes them eventually. A background launch
// is completed by SubagentStop, not by its PostToolUse. A pending file stays
// until it is PENDING_DAYS old, since PostToolUse and SubagentStop may both
// finish the same handoff and the later one replaces the row. `handoff-ship` runs
// before /ship's rebase and records each handoff's review stage (the planner
// reading the coder's diff and fixing it; handoffStatsLib.mjs says what it
// counts), so its fixes hold only the session's own edits; a rebase first
// would count main's changes as the session's. The paid-scene
// checkout is gitignored, so edits made there don't show in the diff. The hook
// never blocks a tool call: any error is swallowed and it exits 0 printing
// nothing.
//
// `report` asks `gh` which branches have a merged PR, the slowest but most
// honest signal of whether a run's work was any good. Pass --no-gh to skip it.
//
// Row building and the per-setup sums live in workflowStatsLib.mjs; handoff
// rows live in handoffStatsLib.mjs.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { buildGradeRows, buildRows, forkIndex, latestGrades, materials, mergeRows, renderReport, summarize, transcriptStats } from "./workflowStatsLib.mjs";
import { addedChars, buildRow, parseNumstat, replaceRow, renderReport as renderHandoffReport, reviewStage, summarize as summarizeHandoffs } from "./handoffStatsLib.mjs";

const STORE = process.env.WORKFLOW_STATS_FILE ?? join(homedir(), ".claude", "workflow-stats", "runs.jsonl");
const GRADES = join(dirname(STORE), "grades.jsonl");
const HANDOFFS = join(dirname(STORE), "handoffs.jsonl");
const PENDING = join(dirname(STORE), "handoff-pending");
/** Days a handoff's pending file is kept; any PreToolUse removes older ones. */
const PENDING_DAYS = 7;
const PROJECTS = join(homedir(), ".claude", "projects");

const [cmd, ...rest] = process.argv.slice(2);

function readJsonl(path) {
  return readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

function readStore(file = STORE) {
  return existsSync(file) ? readJsonl(file) : [];
}

/** Adds rows to the store (or GRADES), replacing any it has for the same runs. */
function saveRows(added, file = STORE) {
  mkdirSync(dirname(file), { recursive: true });
  const rows = mergeRows(readStore(file), added);
  writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
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

async function record(runId) {
  if (!runId) throw new Error("usage: workflow-stats record <runId>");
  const recordPath = findRunRecord(runId);
  if (!recordPath) throw new Error(`no run record for ${runId} under ${PROJECTS}`);
  await recordFrom(runId, recordPath);
}

async function sweep() {
  const stored = new Set([...readStore(), ...readStore(GRADES)].map((r) => r.runId));
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
      if (!["plan-code-review", "grade-runs"].includes(meta.workflowName) || meta.status !== "completed") continue;
      found++;
      await recordFrom(runId, join(dir, name));
    }
  }
  if (!found) console.log(`every completed plan-code-review and grade-runs run on disk is already recorded`);
}

async function recordFrom(runId, recordPath) {
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
  if (runRecord.workflowName === "grade-runs") {
    const grades = buildGradeRows({ record: runRecord, agents, recordedAt: new Date().toISOString() });
    saveRows(grades, GRADES);
    console.log(`recorded the grades of ${grades.length} issue(s) from ${runId} into ${GRADES}`);
    for (const g of grades) {
      console.log(`  #${g.issue} · ${g.runs.length} run(s) · $${(g.cost ?? 0).toFixed(2)} · best first: ${g.ranking.join(", ")}`);
      for (const r of g.runs) console.log(`    ${r.runId} plan ${r.planGrade ?? "-"} code ${r.codeGrade ?? "-"} review ${r.reviewGrade ?? "-"} final ${r.finalCodeGrade ?? "-"} · missed ${r.missed.length} · wrong ${r.findingsWrong}`);
    }
    return;
  }
  const rows = buildRows({ record: runRecord, agents, recordedAt: new Date().toISOString() });
  saveRows(rows);
  console.log(`recorded ${rows.length} issue(s) from ${runId} into ${STORE}`);
  for (const r of rows) {
    console.log(`  #${r.issue} plan ${r.planGrade ?? "-"} code ${r.codeGrade ?? "-"}→${r.finalCodeGrade ?? "-"} · ${r.reviewRounds} review(s) · $${r.cost.toFixed(2)}${r.alreadyDone ? " · already done" : ""}`);
  }
}

// One line per agent of one recorded run (the latest when no ID is given):
// where the tokens went and what they cost.
async function tokens(runId) {
  const all = [...readStore(), ...readStore(GRADES)];
  const id = runId ?? readStore().at(-1)?.runId;
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
      if (a.stage === "grade" || a.stage === "rungrade") graded += c?.total ?? 0;
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
    // REST, not `gh pr list`: cloud sessions refuse GraphQL. Pages are asked
    // for by number, since --paginate follows GitHub's numeric-id links, which
    // the cloud proxy refuses too.
    const jq = '.[] | [.head.ref, (if .merged_at then "MERGED" else (.state | ascii_upcase) end)] | @tsv';
    const states = new Map();
    for (let page = 1; ; page++) {
      const out = execFileSync("gh", ["api", `repos/{owner}/{repo}/pulls?state=all&per_page=100&page=${page}`, "--jq", jq], { encoding: "utf8" });
      const lines = out.split("\n").filter(Boolean);
      for (const line of lines) states.set(...line.split("\t"));
      if (lines.length < 100) return states;
    }
  } catch {
    console.warn("warning: listing PRs through gh api failed; merged counts show 0");
    return new Map();
  }
}

async function report(flags) {
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
  console.log(renderReport(summarize(rows, prState, latestGrades(readStore(GRADES))), rows, { listIssues: flags.includes("--issues"), prState }));
}

async function importRows(path) {
  if (!path) throw new Error("usage: workflow-stats import <rows.jsonl>");
  const all = readJsonl(path);
  // Grade rows hold a `runs` list; run rows never do.
  const grades = all.filter((r) => Array.isArray(r.runs));
  const rows = all.filter((r) => !Array.isArray(r.runs));
  if (rows.length) saveRows(rows);
  if (grades.length) saveRows(grades, GRADES);
  const runs = new Set(all.map((r) => r.runId));
  console.log(`imported ${rows.length} run row(s) and ${grades.length} grade row(s) from ${runs.size} run(s)`);
}

function exportRows(runId) {
  if (!runId) throw new Error("usage: workflow-stats export <runId>");
  const rows = [...readStore(), ...readStore(GRADES)].filter((r) => r.runId === runId);
  if (!rows.length) throw new Error(`no recorded run ${runId} in ${STORE} or ${GRADES}`);
  process.stdout.write(rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

function printMaterials(args) {
  const issue = Number(args[0]);
  if (!issue) throw new Error("usage: workflow-stats materials <issue> [--bench <sha>]");
  const at = args.indexOf("--bench");
  const { runs, text } = materials(readStore(), issue, at >= 0 ? args[at + 1] ?? null : null);
  if (!runs.length) {
    console.log(`no recorded run of #${issue} with commits on that base in ${STORE}`);
    return;
  }
  console.log(`${runs.length} run(s) of #${issue}\n\n${text}`);
}

// Handoffs. The hook side must never throw into Claude Code: handoffHook
// catches everything, and the helpers below it are only called from there or
// from the handoff commands.

/** git in cwd: its trimmed stdout. */
function git(cwd, args, env) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", env: env ?? process.env, stdio: ["ignore", "pipe", "ignore"] }).trim();
}

/**
 * The working tree as a git tree object. `git add -A` runs against a copy of
 * the real index, so the real index, refs and stash are left alone.
 */
function snapshotTree(cwd) {
  const top = git(cwd, ["rev-parse", "--show-toplevel"]);
  const index = resolve(top, git(top, ["rev-parse", "--git-path", "index"]));
  const tmp = join(tmpdir(), `handoff-index-${process.pid}-${Date.now()}`);
  try {
    if (existsSync(index)) copyFileSync(index, tmp);
    const env = { ...process.env, GIT_INDEX_FILE: tmp };
    git(top, ["add", "-A"], env);
    return git(top, ["write-tree"], env);
  } finally {
    rmSync(tmp, { force: true });
  }
}

/** The diff between two snapshots: the numstat summary, its added characters, and both trees. */
function diffChange(cwd, preTree, postTree) {
  return {
    ...parseNumstat(git(cwd, ["diff", "--numstat", preTree, postTree])),
    addedChars: addedChars(git(cwd, ["diff", "--unified=0", preTree, postTree])),
    preTree,
    postTree,
  };
}

/** The directory of the subagent's transcripts, from the hook input. */
function subagentsDir(input) {
  return input.agent_transcript_path
    ? dirname(input.agent_transcript_path)
    : join(dirname(input.transcript_path), input.session_id, "subagents");
}

/** readJsonl that skips lines it can't parse, and reads a missing file as no entries. */
function readJsonlSafe(path) {
  if (!existsSync(path)) return [];
  const entries = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // A line still being written when the hook ran.
    }
  }
  return entries;
}

/** The id of the Agent call: its tool_use id, or a hash of the session and the plan when the hook gives none. */
function handoffId(input) {
  return input.tool_use_id ?? createHash("sha1").update(input.session_id + input.tool_input.prompt).digest("hex").slice(0, 16);
}

/** Writes the whole handoff store, one row per line. */
function writeHandoffs(rows) {
  mkdirSync(dirname(HANDOFFS), { recursive: true });
  writeFileSync(HANDOFFS, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
}

/**
 * Writes the row of a finished handoff. A later finish of the same handoff
 * (PostToolUse, then SubagentStop) replaces the row, and keeps what /ship set.
 */
function finishHandoff(pending, { subagents, status, toolUses }) {
  const agentEntries = pending.agentId ? readJsonlSafe(join(subagents, `agent-${pending.agentId}.jsonl`)) : [];
  const sessionEntries = readJsonlSafe(pending.transcript);
  let change = null;
  try {
    change = diffChange(pending.cwd, pending.preTree, snapshotTree(pending.cwd));
  } catch {
    // Not readable as a git tree: the row is kept without its diff.
  }
  const row = buildRow({ pending, sessionEntries, agentEntries, change, status, toolUses, recordedAt: new Date().toISOString() });
  const stored = readStore(HANDOFFS);
  const old = stored.find((r) => r.id === row.id);
  if (old) {
    row.review = old.review ?? null;
    row.shippedAt = old.shippedAt ?? null;
  }
  writeHandoffs(replaceRow(stored, row));
}

/**
 * The Claude Code hook entry. Reads the hook's JSON from stdin and records a
 * builder handoff from its PreToolUse, PostToolUse and SubagentStop events.
 * It never throws and prints nothing, so a broken hook can't block a tool call.
 */
function handoffHook() {
  try {
    const input = JSON.parse(readFileSync(0, "utf8"));
    const handoffCall = ["Agent", "Task"].includes(input.tool_name) && input.tool_input?.subagent_type === "builder";
    if (input.hook_event_name === "PreToolUse") {
      if (!handoffCall) return;
      const id = handoffId(input);
      mkdirSync(PENDING, { recursive: true });
      for (const name of readdirSync(PENDING)) {
        const old = join(PENDING, name);
        if (Date.now() - statSync(old).mtimeMs > PENDING_DAYS * 86_400_000) rmSync(old, { force: true });
      }
      writeFileSync(join(PENDING, `${id}.json`), JSON.stringify({
        id,
        startedAt: new Date().toISOString(),
        session: input.session_id,
        transcript: input.transcript_path,
        cwd: input.cwd,
        branch: git(input.cwd, ["branch", "--show-current"]),
        headBefore: git(input.cwd, ["rev-parse", "HEAD"]),
        title: input.tool_input.description ?? "",
        agent: "builder",
        plan: input.tool_input.prompt ?? "",
        preTree: snapshotTree(input.cwd),
        agentId: null,
      }));
    } else if (input.hook_event_name === "PostToolUse") {
      if (!handoffCall) return;
      const file = join(PENDING, `${handoffId(input)}.json`);
      if (!existsSync(file)) return;
      const pending = JSON.parse(readFileSync(file, "utf8"));
      const r = input.tool_response;
      pending.agentId = r?.agentId ?? pending.agentId;
      writeFileSync(file, JSON.stringify(pending));
      if (r?.status === "completed") {
        finishHandoff(pending, { subagents: subagentsDir(input), status: r.status, toolUses: r.totalToolUseCount ?? null });
      }
    } else if (input.hook_event_name === "SubagentStop") {
      const agentId = input.agent_id;
      if (!agentId) return;
      let pending = null;
      for (const name of existsSync(PENDING) ? readdirSync(PENDING) : []) {
        let p;
        try {
          p = JSON.parse(readFileSync(join(PENDING, name), "utf8"));
        } catch {
          continue;
        }
        if (p.agentId === agentId) {
          pending = p;
          break;
        }
      }
      if (!pending) {
        const metaPath = join(subagentsDir(input), `agent-${agentId}.meta.json`);
        if (!existsSync(metaPath)) return;
        const file = join(PENDING, `${JSON.parse(readFileSync(metaPath, "utf8")).toolUseId}.json`);
        if (!existsSync(file)) return;
        pending = JSON.parse(readFileSync(file, "utf8"));
        pending.agentId = agentId;
        writeFileSync(file, JSON.stringify(pending));
      }
      finishHandoff(pending, { subagents: subagentsDir(input), status: "completed", toolUses: null });
    }
  } catch {
    // The hook never blocks a tool call; a failure records nothing.
  }
}

/** `handoffs [--json] [--no-gh]`: every recorded handoff, summed per setup. */
function handoffs(flags) {
  const rows = readStore(HANDOFFS);
  if (flags.includes("--json")) {
    for (const r of rows) console.log(JSON.stringify(r));
    return;
  }
  if (!rows.length) {
    console.log("no handoffs recorded yet");
    return;
  }
  const states = flags.includes("--no-gh") ? new Map() : prStates();
  console.log(renderHandoffReport(summarizeHandoffs(rows, states), rows));
}

/** `handoff <id-prefix>`: one handoff in full, its plan last. */
function handoff(prefix) {
  if (!prefix) throw new Error("usage: workflow-stats handoff <id-prefix>");
  const hits = readStore(HANDOFFS).filter((r) => r.id.startsWith(prefix));
  if (hits.length !== 1) {
    throw new Error(hits.length ? `${hits.length} handoffs start with ${prefix}; give more of the id` : `no handoff starts with ${prefix}`);
  }
  const { plan, ...row } = hits[0];
  console.log(JSON.stringify(row, null, 2));
  console.log("--- plan ---");
  console.log(plan);
}

/** The session's transcript: the path the row kept, or the session's file under PROJECTS. */
function sessionTranscript(row) {
  if (row.transcript && existsSync(row.transcript)) return row.transcript;
  for (const dir of existsSync(PROJECTS) ? readdirSync(PROJECTS) : []) {
    const path = join(PROJECTS, dir, `${row.session}.jsonl`);
    if (existsSync(path)) return path;
  }
  return null;
}

/**
 * `handoff-ship`, run by /ship before its rebase: records each handoff's
 * review stage. The span runs from the coder's end to the next coder's start
 * (or to now): the diff over it is what the session fixed, and the session's
 * requests in it are what the review cost. Rows are updated in place, so the
 * store keeps its order.
 */
function handoffShip() {
  const cwd = process.cwd();
  const branch = git(cwd, ["branch", "--show-current"]);
  const stored = readStore(HANDOFFS);
  const rows = stored
    .filter((r) => r.branch === branch && r.shippedAt === null && r.change)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  if (!rows.length) return;
  const now = snapshotTree(cwd);
  const shippedAt = new Date().toISOString();
  for (let i = 0; i < rows.length; i++) {
    const next = rows[i + 1];
    const transcript = sessionTranscript(rows[i]);
    rows[i].review = reviewStage({
      sessionEntries: transcript ? readJsonlSafe(transcript) : [],
      from: rows[i].recordedAt,
      to: next?.startedAt ?? shippedAt,
      fixes: parseNumstat(git(cwd, ["diff", "--numstat", rows[i].change.postTree, next?.change.preTree ?? now])),
    });
    rows[i].shippedAt = shippedAt;
  }
  writeHandoffs(stored);
  const lines = rows.reduce((t, r) => ({ added: t.added + r.review.fixes.added, removed: t.removed + r.review.fixes.removed }), { added: 0, removed: 0 });
  const cost = rows.reduce((t, r) => t + (r.review.cost ?? 0), 0);
  console.log(`handoffs: ${rows.length} recorded for ${branch}, review fixed +${lines.added}/-${lines.removed} lines for $${cost.toFixed(3)}`);
}

if (cmd === "record") await record(rest[0]);
else if (cmd === "export") exportRows(rest[0]);
else if (cmd === "import") await importRows(rest[0]);
else if (cmd === "sweep") await sweep();
else if (cmd === "report") await report(rest);
else if (cmd === "tokens") await tokens(rest[0]);
else if (cmd === "materials") printMaterials(rest);
else if (cmd === "handoffs") handoffs(rest);
else if (cmd === "handoff") handoff(rest[0]);
else if (cmd === "handoff-ship") handoffShip();
else if (cmd === "handoff-hook") handoffHook();
else {
  console.log("usage: workflow-stats record <runId> | sweep | export <runId> | import <rows.jsonl> | report [--issues] [--json] [--no-gh] | tokens [runId] | materials <issue> [--bench <sha>] | handoffs [--json] [--no-gh] | handoff <id-prefix> | handoff-ship | handoff-hook");
  process.exit(cmd ? 1 : 0);
}
