#!/usr/bin/env node
// Narrows /wrap's doc-rot check (.claude/commands/wrap.md step 4) so Claude
// reads only the doc paragraphs a branch's changes are likely to have made
// wrong, instead of grepping and re-reading every doc itself.
//
// It finds the code files this branch changed against a base ref, greps the
// docs for paragraphs citing those files or the top-level identifiers the
// diff added/removed (in `code spans`, see candidateParagraphs), then asks TypeSafe's Jev model (a cheap yes/no judge) which
// of those paragraphs the change actually made wrong.
//
//   npm run doc-check                    # base = merge-base with origin/main
//   npm run doc-check -- <base-ref>      # e.g. HEAD~3, a commit, a branch
//   npm run doc-check -- --threshold 0.5 # flag probability (default 0.5)
//   npm run doc-check -- --all           # also print candidates below threshold
//   npm run doc-check -- --verbose       # trace each request/question to stderr as it completes
//
// Auth: TYPESAFE_API_KEY, from the environment or from the main checkout's
// gitignored `.env` at the repo root (see fromDotEnv, same pattern as
// tools/usage.mjs). Without a key this still runs the grep narrowing and
// prints the unjudged candidate paragraphs — useful on its own, since most
// of the value is in not having to grep by hand.
//
// Every run (judged or not) is appended to tools/.cache/doc-check/runs.jsonl
// under the MAIN checkout (shared across worktrees); a judged run also saves
// the exact request/response bodies under tools/.cache/doc-check/<id>/, so
// the literal prompt and answer can be inspected. Two more subcommands read
// that trace instead of doing any narrowing:
//
//   npm run doc-check -- --verdict <ref>=<stale|fine|missed> ...  # [--run <id>], default latest
//   npm run doc-check -- --report        # precision/calibration/cost across all recorded runs

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, globSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  buildRequest,
  candidateParagraphs,
  chunk,
  costUsd,
  MAX_QUESTIONS,
  parseVerdicts,
  splitParagraphs,
  summarizeRuns,
  touchedNames,
} from "./docCheckLib.mjs";

const CODE_EXTENSIONS = [".ts", ".tsx", ".mjs", ".js", ".glsl", ".py", ".json", ".toml"];
const CONCURRENCY = 4;
const API_URL = "https://api.typesafe.ai/v1/systemone";

function parseArgs(argv) {
  const args = { base: null, threshold: 0.5, all: false, verbose: false, report: false, run: null, verdicts: null };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--threshold") {
      args.threshold = Number(argv[++i]);
      if (!Number.isFinite(args.threshold) || args.threshold < 0 || args.threshold > 1) {
        console.error("doc-check: --threshold needs a number from 0 to 1");
        process.exit(2);
      }
    } else if (a === "--all") {
      args.all = true;
    } else if (a === "--verbose") {
      args.verbose = true;
    } else if (a === "--report") {
      args.report = true;
    } else if (a === "--run") {
      args.run = argv[++i];
    } else if (a === "--verdict") {
      args.verdicts = [];
      while (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
        args.verdicts.push(argv[++i]);
      }
    } else {
      rest.push(a);
    }
  }
  if (rest.length > 0) args.base = rest[0];
  return args;
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function tryGit(args) {
  try {
    return git(args);
  } catch {
    return null;
  }
}

// The main checkout's root, even when this process runs from a worktree —
// so the trace and .env at the repo root are shared and found from anywhere.
function mainRoot() {
  try {
    return dirname(execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).trim());
  } catch {
    return ".";
  }
}

function fromDotEnv(name) {
  try {
    return readFileSync(join(mainRoot(), ".env"), "utf8").match(new RegExp(`^${name}\\s*=\\s*"?([^"\\s]+)"?`, "m"))?.[1] ?? null;
  } catch {
    return null;
  }
}

function cacheDir() {
  return join(mainRoot(), "tools", ".cache", "doc-check");
}

function runsPath() {
  return join(cacheDir(), "runs.jsonl");
}

function readRuns() {
  const path = runsPath();
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function writeRuns(runs) {
  writeFileSync(runsPath(), runs.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

function appendRun(run) {
  mkdirSync(cacheDir(), { recursive: true });
  appendFileSync(runsPath(), JSON.stringify(run) + "\n");
}

function runId(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function hashOf(text) {
  return createHash("sha1").update(text).digest("hex").slice(0, 10);
}

function isCodeFile(path) {
  if (path.startsWith("docs/")) return false;
  if (path.endsWith(".md")) return false;
  if (path === "package-lock.json") return false;
  return CODE_EXTENSIONS.some((ext) => path.endsWith(ext));
}

function changedFiles(base) {
  const tracked = git(["diff", "--name-only", base])
    .split("\n")
    .filter(Boolean);
  const untracked = git(["ls-files", "--others", "--exclude-standard"])
    .split("\n")
    .filter(Boolean);
  return [...new Set([...tracked, ...untracked])].filter(isCodeFile);
}

function diffFor(path, base, untracked) {
  if (untracked.has(path)) {
    if (!existsSync(path)) return "";
    const content = readFileSync(path, "utf8");
    return content
      .split("\n")
      .map((l) => `+${l}`)
      .join("\n");
  }
  try {
    return git(["diff", base, "--", path]);
  } catch {
    return "";
  }
}

function docFiles() {
  const candidates = ["AGENTS.md", "CLAUDE.md", "README.md", "CONTRIBUTING.md"];
  const paths = candidates.filter((p) => existsSync(p));
  const docsGlob = globSync("docs/**/*.md").filter((p) => p !== "docs/status.md");
  const commandsGlob = globSync(".claude/commands/*.md");
  return [...paths, ...docsGlob, ...commandsGlob].filter((p) => existsSync(p));
}

function collapseWhitespace(s) {
  return s.replace(/\s+/g, " ").trim();
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Returns { json, attempts } — `attempts` lets the caller trace retry cost.
async function postWithRetry(url, body, key) {
  const backoffs = [1000, 2000, 4000, 8000];
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 429 || res.status === 529) {
      if (attempt >= backoffs.length) {
        const text = await res.text();
        throw new Error(`${res.status} ${url}: ${text.slice(0, 500)}`);
      }
      const retryAfter = res.headers.get("retry-after");
      const wait = retryAfter ? Number(retryAfter) * 1000 : backoffs[attempt];
      await sleep(Number.isFinite(wait) ? wait : backoffs[attempt]);
      continue;
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${res.status} ${url}: ${text.slice(0, 500)}`);
    }
    return { json: await res.json(), attempts: attempt + 1 };
  }
}

// Runs `tasks` (each a zero-arg async function) with at most `limit` in
// flight at once, returning results in the same order as `tasks`.
async function runWithConcurrency(tasks, limit) {
  const results = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

function fmtUsd(n) {
  return `$${n.toFixed(6)}`;
}

function pct(n) {
  return n == null ? "n/a" : `${n.toFixed(0)}%`;
}

function printReport(s) {
  console.log(`runs: ${s.runs.total} total, ${s.runs.judged} judged, ${s.runs.unjudged} unjudged`);
  console.log(`models seen: ${s.runs.models.length > 0 ? s.runs.models.join(", ") : "none"}`);

  if (s.runs.judged === 0) {
    console.log("no judged runs yet");
  } else {
    console.log(
      `totals: ${s.totals.candidates} candidates, ${s.totals.flagged} flagged, ${s.totals.inputTokens} input tokens, ${fmtUsd(s.totals.costUsd)} total (${fmtUsd(s.totals.costPerRunUsd)}/run)`,
    );
    console.log(
      `request latency: mean ${s.totals.meanRequestMs == null ? "n/a" : Math.round(s.totals.meanRequestMs) + " ms"}, max ${s.totals.maxRequestMs == null ? "n/a" : Math.round(s.totals.maxRequestMs) + " ms"}`,
    );
    console.log(`reading saved: ${s.totals.readingSavedPct == null ? "n/a" : s.totals.readingSavedPct.toFixed(1) + "%"}`);
  }

  if (!s.effectiveness.hasVerdicts) {
    console.log("effectiveness: n/a (no verdicts yet)");
  } else {
    const precisionPct = s.effectiveness.precision == null ? null : s.effectiveness.precision * 100;
    console.log(
      `effectiveness: precision ${pct(precisionPct)}, ${s.effectiveness.misses} misses (${s.effectiveness.staleUnflaggedCount} unflagged-but-stale)`,
    );
    console.log("calibration:");
    for (const b of s.calibration) {
      console.log(`  ${b.bucket}  n=${b.count}  stale rate=${b.staleRate == null ? "n/a" : pct(b.staleRate * 100)}`);
    }
    if (s.falsePositives.length > 0) {
      console.log("false positives (flagged, but verdict fine):");
      for (const fp of s.falsePositives) {
        console.log(`  ${fp.ref} p=${fp.p.toFixed(2)} run=${fp.run}`);
        console.log(`    ${fp.excerpt}`);
      }
    }
  }

  console.log("last runs:");
  for (const r of s.recentRuns) {
    console.log(`  ${r.id} ${r.branch} ${r.mode} ${r.candidates}→${r.flagged} ${r.inputTokens} tok ${fmtUsd(r.costUsd)}`);
  }
}

function handleVerdicts(args) {
  const verdictMap = parseVerdicts(args.verdicts);
  const runs = readRuns();
  if (runs.length === 0) {
    console.error("doc-check: no runs recorded yet (tools/.cache/doc-check/runs.jsonl is empty or missing)");
    process.exit(1);
  }
  const targetId = args.run ?? runs[runs.length - 1].id;
  const run = runs.find((r) => r.id === targetId);
  if (!run) {
    console.error(`doc-check: no run ${targetId} in runs.jsonl`);
    process.exit(1);
  }
  run.verdicts = run.verdicts ?? {};
  let recorded = 0;
  for (const [ref, value] of Object.entries(verdictMap)) {
    if ((value === "stale" || value === "fine") && !run.judgments.some((j) => j.ref === ref)) {
      console.error(`doc-check: warning — ${ref} is not a judgment in run ${targetId}, recording anyway`);
    }
    run.verdicts[ref] = value;
    recorded++;
  }
  writeRuns(runs);
  console.log(`verdicts: ${targetId} — ${recorded} recorded`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.report) {
    printReport(summarizeRuns(readRuns()));
    return;
  }
  if (args.verdicts) {
    handleVerdicts(args);
    return;
  }

  const base = args.base ?? git(["merge-base", "HEAD", "origin/main"]);

  const untracked = new Set(git(["ls-files", "--others", "--exclude-standard"]).split("\n").filter(Boolean));
  const files = changedFiles(base);

  if (files.length === 0) {
    console.log(`doc-check: 0 changed files, 0 paragraphs mention them, 0 flagged (≥${args.threshold}) — 0 input tokens`);
    return;
  }

  const docs = docFiles().map((path) => ({ path, paragraphs: splitParagraphs(readFileSync(path, "utf8")) }));

  // Per changed file: names touched, diff text, and the doc paragraphs that
  // mention any of them (tagged with which doc they came from). Each
  // candidate also carries the judgment fields (p/flagged) the API call
  // fills in below, so the same objects can be traced either way.
  const perFile = files.map((path) => {
    const diffText = diffFor(path, base, untracked);
    const names = touchedNames(path, diffText);
    const candidates = [];
    for (const doc of docs) {
      for (const c of candidateParagraphs(doc.paragraphs, names)) {
        candidates.push({ doc: doc.path, ...c, p: null, flagged: null });
      }
    }
    return { path, diffText, names, candidates };
  });

  const totalCandidates = perFile.reduce((n, f) => n + f.candidates.length, 0);

  const key = process.env.TYPESAFE_API_KEY ?? fromDotEnv("TYPESAFE_API_KEY");

  // Trace bookkeeping shared by every path below (judged or not).
  const id = runId(new Date());
  let mode = "unjudged";
  let runModel = null;
  let totalTokens = 0;
  let runMs = 0;
  const requestsTrace = [];

  function finish() {
    const judgments = perFile.flatMap((f) =>
      f.candidates.map((c) => ({
        ref: `${c.doc}:${c.line}`,
        doc: c.doc,
        line: c.line,
        file: f.path,
        names: c.names,
        p: c.p,
        flagged: c.flagged,
        hash: hashOf(c.text),
        excerpt: collapseWhitespace(c.text).slice(0, 200),
      })),
    );
    const run = {
      id,
      at: new Date().toISOString(),
      mode,
      branch: tryGit(["rev-parse", "--abbrev-ref", "HEAD"]),
      head: tryGit(["rev-parse", "--short", "HEAD"]),
      base,
      threshold: args.threshold,
      model: runModel,
      files,
      requests: requestsTrace,
      judgments,
      totals: {
        candidates: totalCandidates,
        flagged: judgments.filter((j) => j.flagged === true).length,
        inputTokens: totalTokens,
        costUsd: costUsd(totalTokens),
        ms: runMs,
        candidateChars: perFile.reduce((n, f) => n + f.candidates.reduce((m, c) => m + c.text.length, 0), 0),
        flaggedChars: perFile.reduce((n, f) => n + f.candidates.reduce((m, c) => m + (c.flagged ? c.text.length : 0), 0), 0),
      },
      verdicts: {},
    };
    appendRun(run);
    if (mode === "judged") {
      console.log(
        `trace: ${id} — ${requestsTrace.length} requests, ${runMs} ms, ${fmtUsd(run.totals.costUsd)}, model ${runModel}; Claude reads ${run.totals.flaggedChars} of ${run.totals.candidateChars} candidate chars (${join(cacheDir(), id)}/)`,
      );
    } else {
      console.log(`trace: ${id} (unjudged)`);
    }
  }

  if (!key) {
    console.log(
      `doc-check: ${files.length} changed files, ${totalCandidates} paragraphs mention them, 0 flagged (≥${args.threshold}) — 0 input tokens`,
    );
    if (totalCandidates === 0) {
      finish();
      return;
    }
    console.log("No TYPESAFE_API_KEY — listing candidates unjudged (add it to .env at the repo root to judge them).");
    for (const f of perFile) {
      for (const c of f.candidates) {
        console.log(`${c.doc}:${c.line}  [names: ${c.names.join(", ")}]`);
        console.log(`    ${collapseWhitespace(c.text).slice(0, 200)}`);
      }
    }
    finish();
    return;
  }

  if (totalCandidates === 0) {
    console.log(`doc-check: ${files.length} changed files, 0 paragraphs mention them, 0 flagged (≥${args.threshold}) — 0 input tokens`);
    finish();
    return;
  }

  // Build one request per chunk of MAX_QUESTIONS candidates, per file.
  const requests = [];
  for (const f of perFile) {
    if (f.candidates.length === 0) continue;
    for (const group of chunk(f.candidates, MAX_QUESTIONS)) {
      requests.push({ file: f.path, diffText: f.diffText, group });
    }
  }
  requests.forEach((req, n) => (req.n = n));

  const flagged = [];
  const unflagged = [];

  const traceDir = join(cacheDir(), id);
  mkdirSync(traceDir, { recursive: true });

  const runStart = Date.now();
  try {
    const tasks = requests.map((req) => async () => {
      const body = buildRequest(req.file, req.diffText, req.group);
      const t0 = Date.now();
      const { json, attempts } = await postWithRetry(API_URL, body, key);
      const ms = Date.now() - t0;
      const inputTokens = json.usage?.input_tokens ?? 0;
      totalTokens += inputTokens;
      runModel = runModel ?? json.model ?? null;

      writeFileSync(join(traceDir, `req-${req.n}.json`), JSON.stringify(body, null, 2));
      writeFileSync(join(traceDir, `res-${req.n}.json`), JSON.stringify(json, null, 2));
      requestsTrace.push({ n: req.n, file: req.file, questions: req.group.length, inputTokens, ms, attempts, model: json.model ?? null });

      if (args.verbose) {
        console.error(`req ${req.n} ${req.file}: ${req.group.length} q, ${inputTokens} tok, ${ms} ms, ${attempts} attempt(s)`);
      }

      req.group.forEach((c, i) => {
        const answer = json.answers?.[`p${i}`];
        // A 200 reply with a missing answer (error body, changed response
        // shape, renamed key) must not pass as "fine" — fail loud instead.
        if (typeof answer?.noul !== "number" || !Number.isFinite(answer.noul)) {
          throw new Error(
            `doc-check: no answer p${i} for ${req.file} (response shape changed?) — see ${join(traceDir, `res-${req.n}.json`)}`,
          );
        }
        const p = answer.noul;
        c.p = p;
        c.flagged = p >= args.threshold;
        if (args.verbose) console.error(`  ${p.toFixed(2)}  ${c.doc}:${c.line}  [${c.names.join(", ")}]`);
        const entry = { ...c };
        if (c.flagged) flagged.push(entry);
        else unflagged.push(entry);
      });
    });
    await runWithConcurrency(tasks, CONCURRENCY);
  } catch (err) {
    console.error(String(err.message ?? err));
    process.exit(1);
  }
  mode = "judged";
  runMs = Date.now() - runStart;
  requestsTrace.sort((a, b) => a.n - b.n);

  flagged.sort((a, b) => b.p - a.p);
  unflagged.sort((a, b) => b.p - a.p);

  console.log(
    `doc-check: ${files.length} changed files, ${totalCandidates} paragraphs mention them, ${flagged.length} flagged (≥${args.threshold}) — ${totalTokens} input tokens`,
  );

  function printEntry(c) {
    console.log(`${c.doc}:${c.line}  p=${c.p.toFixed(2)}  [names: ${c.names.join(", ")}]`);
    console.log(`    ${collapseWhitespace(c.text).slice(0, 200)}`);
  }

  for (const c of flagged) printEntry(c);

  if (args.all && unflagged.length > 0) {
    console.log("below threshold:");
    for (const c of unflagged) printEntry(c);
  }

  finish();
}

main().catch((err) => {
  console.error(String(err?.stack ?? err));
  process.exit(1);
});
