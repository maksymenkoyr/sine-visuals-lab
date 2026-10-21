#!/usr/bin/env node
// The issue difficulty correction loop (docs/issue-labels.md): an issue is
// filed with a guess at its difficulty and its token use, and once the work
// is done /ship records what it actually took, so the guesses can be checked
// and, later, a model trained to correct them.
//
//   npm run difficulty -- record 412 --actual mid --human no --tokens session --pr 450 --why "…"
//   npm run difficulty -- record 412 --actual mid --human no --labels "bug,low dif" --print
//   npm run difficulty -- tokens [session-id …]
//   npm run difficulty -- export [--out data.jsonl] [--from issues.json] [--any-author]
//   npm run difficulty -- report [--from issues.json] [--any-author]
//
// `record` reads the issue's labels with `gh` (the prediction), posts the
// record as an issue comment and relabels the issue to match. With `--print`
// it touches nothing: give the current labels with `--labels`, and it prints
// the comment and the full label list for posting another way (the GitHub
// MCP's add_issue_comment and issue_write, whose labels replace the old ones).
// `--human` defaults to what the issue was filed with.
//
// `--tokens` is a comma list summed into the count: a number (`3.2M`), a
// Claude Code session id, or `session` for the one running this
// ($CLAUDE_CODE_SESSION_ID). A session counts with every agent it started,
// from the transcripts under ~/.claude/projects, through transcriptStats in
// workflowStatsLib.mjs. A session's transcript can sit under more than one
// project folder (it follows the session into a worktree), so every copy is
// read and requests are counted once. `tokens` prints the same count.
//
// `export` writes one JSON row per issue that has a record (fields: the
// datasetRows doc in difficultyLib.mjs), from `gh issue list` or a saved dump
// of it (`gh issue list --state all --limit 2000 --json
// number,title,body,labels,comments > issues.json`). `report` sums the same
// rows: how often the filed difficulty held, and which way it was off.
//
// The record format and every label name live in difficultyLib.mjs.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  buildRecord,
  datasetRows,
  formatTokens,
  labelEdits,
  labelsAfter,
  parseLevel,
  parseTokens,
  readLabels,
  renderComment,
  renderSummary,
  summarize,
} from "./difficultyLib.mjs";
import { transcriptStats } from "./workflowStatsLib.mjs";

const [cmd, ...rest] = process.argv.slice(2);

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) args._.push(a);
    else if (["--print", "--any-author"].includes(a)) args[a.slice(2)] = true;
    else args[a.slice(2)] = argv[++i];
  }
  return args;
}

function gh(args, input) {
  return execFileSync("gh", args, { encoding: "utf8", input, stdio: [input === undefined ? "ignore" : "pipe", "pipe", "inherit"], maxBuffer: 256 * 1024 * 1024 });
}

function parseYesNo(text, fallback) {
  if (text === undefined) return fallback;
  if (/^(yes|y|true)$/i.test(text)) return true;
  if (/^(no|n|false)$/i.test(text)) return false;
  throw new Error(`--human takes yes or no, got "${text}"`);
}

function readJsonl(path) {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

function tokensOf(entries) {
  const t = transcriptStats(entries).tokens;
  return t.input + t.cacheWrite + t.cacheRead + t.outputSeen;
}

/** Every token a session and its agents were billed for. */
function sessionTokens(id) {
  const root = join(homedir(), ".claude", "projects");
  const main = [];
  const agents = new Map();
  for (const dir of existsSync(root) ? readdirSync(root) : []) {
    const file = join(root, dir, `${id}.jsonl`);
    if (existsSync(file)) main.push(...readJsonl(file));
    const sub = join(root, dir, id, "subagents");
    if (existsSync(sub)) for (const f of readdirSync(sub)) if (f.endsWith(".jsonl")) agents.set(f, [...(agents.get(f) ?? []), ...readJsonl(join(sub, f))]);
  }
  if (main.length === 0) throw new Error(`no transcript for session ${id} under ${root}`);
  return [...agents.values()].reduce((sum, entries) => sum + tokensOf(entries), tokensOf(main));
}

/** The `--tokens` list, summed. */
function countTokens(list) {
  let sum = 0;
  for (const part of String(list).split(",").map((s) => s.trim()).filter(Boolean)) {
    if (part === "session") {
      const id = process.env.CLAUDE_CODE_SESSION_ID;
      if (!id) throw new Error("--tokens session needs $CLAUDE_CODE_SESSION_ID (run it from Claude Code), or give a session id or a count");
      sum += sessionTokens(id);
    } else if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(part)) sum += sessionTokens(part);
    else sum += parseTokens(part);
  }
  return sum;
}

function record(args) {
  const issue = Number(args._[0]);
  if (!Number.isInteger(issue) || issue <= 0) throw new Error("record needs an issue number");
  if (!args.actual) throw new Error("record needs --actual low|mid|high");
  if (args.print && args.labels === undefined) throw new Error("--print needs the issue's current labels in --labels (comma-separated)");

  const labels =
    args.labels !== undefined
      ? args.labels.split(",").map((s) => s.trim()).filter(Boolean)
      : JSON.parse(gh(["issue", "view", String(issue), "--json", "labels"])).labels.map((l) => l.name);
  const predicted = readLabels(labels);
  const tokens = args.tokens !== undefined ? countTokens(args.tokens) : null;
  const actual = { dif: parseLevel(args.actual), tokens, human: parseYesNo(args.human, predicted.human) };
  const rec = buildRecord({ issue, predicted, actual, pr: args.pr ? Number(args.pr) : null, why: args.why ?? "" });
  const body = renderComment(rec);

  if (args.print) {
    console.log(`--- comment for #${issue} ---\n${body}\n--- labels for #${issue} ---\n${JSON.stringify(labelsAfter(labels, rec.actual))}`);
    return;
  }
  gh(["issue", "comment", String(issue), "--body-file", "-"], body);
  const { add, remove } = labelEdits(predicted, rec.actual);
  if (add.length || remove.length) {
    gh(["issue", "edit", String(issue), ...add.flatMap((l) => ["--add-label", l]), ...remove.flatMap((l) => ["--remove-label", l])]);
  }
  const tok = tokens === null ? "" : `, tokens ${formatTokens(tokens)} (filed ${predicted.tok ?? "unlabeled"})`;
  console.log(`#${issue}: recorded ${actual.dif} (filed ${predicted.dif ?? "unlabeled"})${tok}, human ${actual.human ? "yes" : "no"}` + (add.length || remove.length ? `; labels +[${add}] -[${remove}]` : ""));
}

function loadRows(args) {
  const issues = args.from
    ? JSON.parse(readFileSync(args.from, "utf8"))
    : JSON.parse(gh(["issue", "list", "--state", "all", "--limit", "2000", "--json", "number,title,body,labels,comments"]));
  return datasetRows(issues, args["any-author"] ? { trusted: null } : undefined);
}

function main() {
  const args = parseArgs(rest);
  if (cmd === "record") record(args);
  else if (cmd === "tokens") {
    const n = countTokens(args._.length ? args._.join(",") : "session");
    console.log(`${n} tokens (${formatTokens(n)})`);
  } else if (cmd === "export") {
    const text = loadRows(args).map((r) => JSON.stringify(r)).join("\n") + "\n";
    if (args.out) writeFileSync(args.out, text);
    else process.stdout.write(text);
  } else if (cmd === "report") console.log(renderSummary(summarize(loadRows(args))));
  else {
    console.error("usage: npm run difficulty -- record <issue> --actual low|mid|high [--tokens session|<id>|3.2M,…] [--human yes|no] [--pr N] [--why text] [--labels a,b --print]\n       npm run difficulty -- tokens [session-id …]\n       npm run difficulty -- export [--out file] [--from issues.json] [--any-author]\n       npm run difficulty -- report [--from issues.json] [--any-author]");
    process.exit(1);
  }
}

try {
  main();
} catch (e) {
  console.error(`difficulty: ${e.message}`);
  process.exit(1);
}
