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
//
// Auth: TYPESAFE_API_KEY, from the environment or from the main checkout's
// gitignored `.env` at the repo root (see fromDotEnv, same pattern as
// tools/usage.mjs). Without a key this still runs the grep narrowing and
// prints the unjudged candidate paragraphs — useful on its own, since most
// of the value is in not having to grep by hand.

import { execFileSync } from "node:child_process";
import { existsSync, globSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  buildRequest,
  candidateParagraphs,
  chunk,
  MAX_QUESTIONS,
  splitParagraphs,
  touchedNames,
} from "./docCheckLib.mjs";

const CODE_EXTENSIONS = [".ts", ".tsx", ".mjs", ".js", ".glsl", ".py", ".json", ".toml"];
const CONCURRENCY = 4;
const API_URL = "https://api.typesafe.ai/v1/systemone";

function parseArgs(argv) {
  const args = { base: null, threshold: 0.5, all: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--threshold") {
      args.threshold = Number(argv[++i]);
    } else if (a === "--all") {
      args.all = true;
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

function fromDotEnv(name) {
  let root = ".";
  try {
    // --git-common-dir is the main checkout's .git, even from a worktree.
    root = dirname(execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).trim());
  } catch {}
  try {
    return readFileSync(join(root, ".env"), "utf8").match(new RegExp(`^${name}\\s*=\\s*"?([^"\\s]+)"?`, "m"))?.[1] ?? null;
  } catch {
    return null;
  }
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
    return res.json();
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const base = args.base ?? git(["merge-base", "HEAD", "origin/main"]);

  const untracked = new Set(git(["ls-files", "--others", "--exclude-standard"]).split("\n").filter(Boolean));
  const files = changedFiles(base);

  if (files.length === 0) {
    console.log("doc-check: 0 changed files, 0 paragraphs mention them, 0 flagged (≥0.5) — 0 input tokens");
    return;
  }

  const docs = docFiles().map((path) => ({ path, paragraphs: splitParagraphs(readFileSync(path, "utf8")) }));

  // Per changed file: names touched, diff text, and the doc paragraphs that
  // mention any of them (tagged with which doc they came from).
  const perFile = files.map((path) => {
    const diffText = diffFor(path, base, untracked);
    const names = touchedNames(path, diffText);
    const candidates = [];
    for (const doc of docs) {
      for (const c of candidateParagraphs(doc.paragraphs, names)) {
        candidates.push({ doc: doc.path, ...c });
      }
    }
    return { path, diffText, names, candidates };
  });

  const totalCandidates = perFile.reduce((n, f) => n + f.candidates.length, 0);

  const key = process.env.TYPESAFE_API_KEY ?? fromDotEnv("TYPESAFE_API_KEY");

  if (!key) {
    console.log(
      `doc-check: ${files.length} changed files, ${totalCandidates} paragraphs mention them, 0 flagged (≥0.5) — 0 input tokens`,
    );
    if (totalCandidates === 0) return;
    console.log("No TYPESAFE_API_KEY — listing candidates unjudged (add it to .env at the repo root to judge them).");
    for (const f of perFile) {
      for (const c of f.candidates) {
        console.log(`${c.doc}:${c.line}  [names: ${c.names.join(", ")}]`);
        console.log(`    ${collapseWhitespace(c.text).slice(0, 200)}`);
      }
    }
    return;
  }

  if (totalCandidates === 0) {
    console.log(`doc-check: ${files.length} changed files, 0 paragraphs mention them, 0 flagged (≥0.5) — 0 input tokens`);
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

  let totalTokens = 0;
  const flagged = [];
  const unflagged = [];

  try {
    const tasks = requests.map((req) => async () => {
      const body = buildRequest(req.file, req.diffText, req.group);
      const json = await postWithRetry(API_URL, body, key);
      totalTokens += json.usage?.input_tokens ?? 0;
      req.group.forEach((c, i) => {
        const answer = json.answers?.[`p${i}`];
        const p = answer?.noul ?? 0;
        const entry = { ...c, p };
        if (p >= args.threshold) flagged.push(entry);
        else unflagged.push(entry);
      });
    });
    await runWithConcurrency(tasks, CONCURRENCY);
  } catch (err) {
    console.error(String(err.message ?? err));
    process.exit(1);
  }

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
}

main().catch((err) => {
  console.error(String(err?.stack ?? err));
  process.exit(1);
});
