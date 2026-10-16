#!/usr/bin/env node
// Removes this repo's worktrees whose pull request has merged, so finished
// work stops piling up on disk (each one carries its own node_modules). Claude
// Code only cleans up a worktree that ends with no changes; one whose branch
// went on to a merged PR stays forever. The SessionStart hook
// (.claude/hooks/session-start.sh) runs this in the background with --yes.
//
//   node tools/prune-worktrees.mjs            # dry run: say what would go
//   node tools/prune-worktrees.mjs --yes      # remove them
//   node tools/prune-worktrees.mjs --yes --min-age-hours 0
//   node tools/prune-worktrees.mjs --yes --hook   # what the hook runs
//
// A worktree goes only when every check passes, otherwise it stays and the
// reason is printed:
//   - its branch has a merged PR at least --min-age-hours old (default in
//     DEFAULT_MIN_AGE_HOURS), so a session still wrapping up after the merge
//     isn't pulled out from under it;
//   - the branch tip is that PR's merged head, or behind it, so no commit
//     made after the merge is lost (the branch itself is kept either way);
//   - no uncommitted change to a tracked file, and it isn't locked;
//   - no running process has its working directory inside it;
//   - a private scenes checkout inside it (src/render/scenes/private/, a
//     separate clone) has no uncommitted change, stash or unpushed commit.
// Files git doesn't track — ignored ones included — that aren't build output
// or caches (the names in CACHE_NAMES) are copied first to
// <git common dir>/worktree-archive/<date>-<worktree name>/, with a
// worktree.json saying where they came from. That folder also holds
// prune.log, one line per removal. --hook skips the run when the last one was
// under MIN_RUN_GAP_MS ago: every session start fires the hook, and parallel
// jobs start in bursts.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, appendFileSync, writeFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";

const DEFAULT_MIN_AGE_HOURS = 24;
// Untracked or ignored paths dropped without archiving: rebuilt by npm, tsc,
// vite or Python, or re-downloaded (tools/.cache holds reference media).
const CACHE_NAMES = new Set(["node_modules", "dist", ".vite", ".vite-cache", "__pycache__", ".wrangler", "test-results", "playwright-report", ".DS_Store"]);
const CACHE_PATHS = ["tools/.cache/"];
const PRIVATE_DIR = "src/render/scenes/private/";
const MIN_RUN_GAP_MS = 60 * 60 * 1000;

const args = process.argv.slice(2);
const apply = args.includes("--yes");
const fromHook = args.includes("--hook");
const ageAt = args.indexOf("--min-age-hours");
const minAgeHours = ageAt >= 0 ? Number(args[ageAt + 1]) : DEFAULT_MIN_AGE_HOURS;

const run = (cmd, argv, opts = {}) => execFileSync(cmd, argv, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20, ...opts });
const ok = (cmd, argv, opts) => {
  try {
    run(cmd, argv, opts);
    return true;
  } catch {
    return false;
  }
};
const git = (cwd, ...argv) => run("git", ["-C", cwd, ...argv]);

const commonDir = git(".", "rev-parse", "--path-format=absolute", "--git-common-dir").trim();
const archiveRoot = path.join(commonDir, "worktree-archive");
mkdirSync(archiveRoot, { recursive: true });
const logLines = [];
const say = (line) => {
  console.log(line);
  logLines.push(line);
};
// Reasons a worktree stays are printed, not logged: they repeat every run.
const note = (line) => console.log(line);

// One run at a time; a lock older than an hour is from a run that died.
const lock = path.join(archiveRoot, ".lock");
const stamp = path.join(archiveRoot, ".last-run");
if (apply) {
  if (existsSync(lock) && Date.now() - statSync(lock).mtimeMs > 60 * 60 * 1000) rmSync(lock, { recursive: true });
  try {
    mkdirSync(lock);
  } catch {
    process.exit(0);
  }
  if (fromHook && existsSync(stamp) && Date.now() - statSync(stamp).mtimeMs < MIN_RUN_GAP_MS) {
    rmSync(lock, { recursive: true });
    process.exit(0);
  }
}

try {
  main();
} finally {
  if (apply) {
    writeFileSync(stamp, "");
    if (logLines.length) appendFileSync(path.join(archiveRoot, "prune.log"), logLines.map((l) => `${new Date().toISOString()} ${l}\n`).join(""));
    rmSync(lock, { recursive: true });
  }
}

function main() {
  let prs;
  try {
    prs = JSON.parse(run("gh", ["pr", "list", "--state", "merged", "--limit", "1000", "--json", "number,headRefName,headRefOid,mergedAt"]));
  } catch {
    note("skipped: couldn't list merged PRs (offline or no gh login)");
    return;
  }
  const merged = new Map();
  for (const pr of prs) merged.set(pr.headRefName, [...(merged.get(pr.headRefName) ?? []), pr]);

  const busy = cwdsInUse();
  const [, ...worktrees] = parseWorktrees(git(".", "worktree", "list", "--porcelain"));
  let removed = 0;
  for (const wt of worktrees) {
    if (!wt.branch || wt.prunable) continue;
    const prsHere = merged.get(wt.branch);
    if (!prsHere) continue;
    const name = path.basename(wt.path);
    const reason = whyKeep(wt, prsHere, busy);
    if (reason) {
      note(`keep ${name} [${wt.branch}]: ${reason}`);
      continue;
    }
    const pr = prsHere.find((p) => p.headRefOid === wt.head) ?? prsHere[0];
    // A private scenes clone passed whyKeep's checks, so it's all on GitHub.
    const privateClone = existsSync(path.join(wt.path, PRIVATE_DIR, ".git"));
    const extras = extraFiles(wt.path).filter((f) => !(privateClone && f === PRIVATE_DIR));
    if (!apply) {
      note(`would remove ${name} [${wt.branch}, #${pr.number}]${extras.length ? `, archiving ${extras.join(" ")}` : ""}`);
      continue;
    }
    if (extras.length) {
      const dest = path.join(archiveRoot, `${new Date().toISOString().slice(0, 10)}-${name}`);
      for (const f of extras) cpSync(path.join(wt.path, f), path.join(dest, f), { recursive: true, preserveTimestamps: true });
      writeFileSync(path.join(dest, "worktree.json"), JSON.stringify({ path: wt.path, branch: wt.branch, head: wt.head, pr: pr.number, removed: new Date().toISOString() }, null, 2) + "\n");
    }
    if (!ok("git", ["-C", ".", "worktree", "remove", "--force", wt.path])) {
      say(`keep ${name} [${wt.branch}]: git worktree remove failed`);
      continue;
    }
    removed++;
    say(`removed ${name} [${wt.branch}, #${pr.number}]${extras.length ? `, archived ${extras.join(" ")}` : ""}`);
  }
  if (apply) git(".", "worktree", "prune");
  if (apply && removed) say(`removed ${removed} worktree(s); archive: ${archiveRoot}`);
}

function whyKeep(wt, prsHere, busy) {
  if (wt.locked) return "locked";
  const pr = prsHere.find((p) => p.headRefOid === wt.head) ?? prsHere.find((p) => isAncestor(wt.head, p));
  if (!pr) return "has commits its merged PR doesn't";
  const ageHours = (Date.now() - Date.parse(pr.mergedAt)) / 3.6e6;
  if (ageHours < minAgeHours) return `PR #${pr.number} merged ${ageHours.toFixed(1)} h ago`;
  if (git(wt.path, "status", "--porcelain", "--untracked-files=no").trim()) return "uncommitted changes";
  if (busy.some((d) => d === wt.path || d.startsWith(wt.path + "/"))) return "a process is working in it";
  const priv = path.join(wt.path, PRIVATE_DIR);
  if (existsSync(path.join(priv, ".git"))) {
    if (git(priv, "status", "--porcelain").trim()) return "private scenes checkout has uncommitted changes";
    if (git(priv, "log", "--branches", "--not", "--remotes", "--oneline").trim()) return "private scenes checkout has unpushed commits";
    if (git(priv, "stash", "list").trim()) return "private scenes checkout has a stash";
  }
  return null;
}

// The tip is behind the PR's merged head. That commit may only be on GitHub
// (pushed from elsewhere), so fetch the PR's head ref once when it's missing.
function isAncestor(tip, pr) {
  if (!ok("git", ["cat-file", "-e", `${pr.headRefOid}^{commit}`])) ok("git", ["fetch", "--quiet", "origin", `pull/${pr.number}/head`]);
  return ok("git", ["merge-base", "--is-ancestor", tip, pr.headRefOid]);
}

// Untracked and ignored paths, minus build output and caches. Git lists a
// directory once when everything in it is untracked or ignored.
function extraFiles(dir) {
  const out = git(dir, "status", "--porcelain", "-z", "--ignored", "--untracked-files=normal");
  return out
    .split("\0")
    .filter((e) => e.startsWith("?? ") || e.startsWith("!! "))
    .map((e) => e.slice(3))
    .filter((f) => !f.split("/").some((part) => CACHE_NAMES.has(part)))
    .filter((f) => !f.endsWith(".tsbuildinfo") && !CACHE_PATHS.some((p) => f.startsWith(p)));
}

function parseWorktrees(text) {
  return text
    .trim()
    .split("\n\n")
    .map((block) => {
      const wt = {};
      for (const line of block.split("\n")) {
        const [key, ...rest] = line.split(" ");
        wt[key] = rest.join(" ") || true;
      }
      return { path: wt.worktree, head: wt.HEAD, branch: wt.branch?.replace(/^refs\/heads\//, ""), locked: !!wt.locked, prunable: !!wt.prunable };
    });
}

// Working directories of every running process (macOS and Linux lsof).
function cwdsInUse() {
  try {
    return run("lsof", ["-d", "cwd", "-Fn"])
      .split("\n")
      .filter((l) => l.startsWith("n"))
      .map((l) => l.slice(1));
  } catch (e) {
    // lsof exits 1 when some processes can't be read; its output still holds.
    return String(e.stdout ?? "")
      .split("\n")
      .filter((l) => l.startsWith("n"))
      .map((l) => l.slice(1));
  }
}
