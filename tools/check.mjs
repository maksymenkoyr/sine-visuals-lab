#!/usr/bin/env node
// `npm run check`: every automatic check this repo has, in one command, so a
// session finishing (the Stop hook, .claude/hooks/check-on-stop.sh), a push
// (.githooks/pre-push) and a pull request (deploy.yml) all fail on exactly
// the same things with the same messages.
//
//   npm run check                       # everything, the whole test suite
//   npm run check -- --changed          # the Stop and pre-push hooks' run: only the tests related to changed files
//   npm run check -- --only rules,lint  # some steps (names below)
//   npm run check -- --prune-baseline   # drop baseline entries that no longer occur
//   npm run check -- --accept-baseline  # record every current finding as known (a person's call, never an agent's)
//
// The steps, in order. Each prints ✓ or ✗; any ✗ makes the exit code 1.
// On a terminal (stderr is a TTY, as in a push) the running step shows a
// spinner, its place in the list, its seconds so far and, for tests, the files
// done; it then settles into its ✓ or ✗ line, and the end prints only the
// failures' details. Anywhere else (the Stop hook, CI, a pipe) nothing prints
// until the end, and that is the whole report.
//   typecheck  `npm run typecheck` (strict tsc, root and server/).
//   rules      ast-grep with the repo's own rules: one YAML file per rule in
//              rules/, each with examples in rule-tests/ that run first. A
//              rule is a review comment that kept repeating; add one the same
//              way (sgconfig.yml). A line that is right on purpose carries
//              `// ast-grep-ignore: <rule-id>` and the reason above it.
//   lint       Biome, with only the rules in biome.json that catch bugs (no
//              style rules, no formatter). Silence one line with
//              `// biome-ignore lint/<group>/<rule>: <reason>`.
//   knip       unused files, exports and dependencies (knip.jsonc).
//   dupes      the copy-paste check, when package.json has a `dupes` script.
//   licenses   every package in package-lock.json is permissively licensed
//              (PERMISSIVE / LICENSE_EXCEPTIONS in checkLib.mjs; CONTRIBUTING.md
//              says why), and every runtime dependency is named in
//              THIRD-PARTY-NOTICES.md.
//   secrets    gitleaks over the lines this branch adds against its base
//              (committed or not), with a pinned binary it downloads once
//              and checks by hash (GITLEAKS below). A false alarm gets
//              `gitleaks:allow` in a comment on that line.
//   tests      vitest: the whole suite, or with --changed only the tests
//              related to the changed files. Off CI each test and hook gets
//              LOCAL_TEST_LIMIT_MS instead of vitest's default: a push or a
//              Stop often runs while parallel agents load the machine, and
//              CPU-heavy tests then ran out of time with nothing wrong. CI
//              and a plain `npm test` keep the default, so a test that hangs
//              fails fast there.
//   size       builds the app (vite build, into a temporary directory) and
//              holds it to size-budget.json: for each page, the JS it loads
//              before its first paint (its entry chunk and every chunk that
//              one imports statically, from the build manifest), gzipped at
//              level 9, and the raw bytes pinAsset() fetches after load
//              (src/pinnedAssets.ts). Each budget keeps a margin above the
//              measured size, so a feature's few kB never fail it;
//              size-budget.json's `about` says how much and when to reset it.
//              Skipped in --changed runs, and wherever
//              src/render/scenes/private/ is checked out: paid scenes would
//              count, and CI measures the public tree on every pull request.
//              A push to main only warns: two pull requests each within
//              budget can merge into a main that isn't, and that mustn't hold
//              up the deploy. The next pull request then fails until the
//              build or size-budget.json is fixed.
//
// The baseline. rules, lint and knip were added to a codebase that already
// broke some of them, so check-baseline.json lists the findings that existed
// then and only new ones fail. An entry names the code, not the line number
// (fingerprint in checkLib.mjs), so editing elsewhere in the file doesn't
// matter; changing the flagged line itself makes it new. Fixing an old one
// leaves its entry unused: --prune-baseline drops those. The list should only
// shrink. Growing it (--accept-baseline) is for a person deciding a rule is
// wrong for existing code, never a way to get a change through.
//
// The base the secrets step diffs against: $CHECK_BASE when set (CI passes the
// PR's base commit), otherwise the merge-base with origin/main.
//
// $CHECK_REPORT_FILE, when set, names a file that also gets the end report.
// tools/fix-conflicts-pr.sh sets it around its push to tell a test that ran
// out of time from a real failure: piping the push's output instead would
// take the terminal away and hide the live line.

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, globSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import {
  addedLines,
  astGrepFindings,
  biomeFindings,
  compareSizes,
  compareToBaseline,
  fingerprint,
  firstPaintChunks,
  knipFindings,
  licenseProblems,
  missingNotices,
  pinnedFiles,
  testFilesDone,
} from "./checkLib.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_PATH = join(ROOT, "check-baseline.json");
const SIZE_BUDGET_PATH = join(ROOT, "size-budget.json");
const BIN = (name) => join(ROOT, "node_modules", ".bin", name);
const SHOW = 30;
const LOCAL_TEST_LIMIT_MS = 30_000;

const GITLEAKS = {
  version: "8.30.1",
  sha256: {
    darwin_arm64: "b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5",
    darwin_x64: "dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709",
    linux_arm64: "e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080",
    linux_x64: "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb",
  },
};

const STEPS = ["typecheck", "rules", "lint", "knip", "dupes", "licenses", "secrets", "tests", "size"];
const BASELINED = new Set(["rules", "lint", "knip"]);

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const onlyArg = args[args.indexOf("--only") + 1];
const only = args.includes("--only") && onlyArg ? new Set(onlyArg.split(",")) : null;
const changedMode = flag("--changed");
const prune = flag("--prune-baseline");
const accept = flag("--accept-baseline");
for (const name of only ?? []) {
  if (!STEPS.includes(name)) {
    console.error(`Unknown step "${name}". Steps: ${STEPS.join(", ")}`);
    process.exit(2);
  }
}

/** Runs a tool without blocking the progress line. `input` goes to its stdin;
 *  `onOut(stdoutSoFar)` fires as output arrives. */
function run(cmd, cmdArgs, { input = "", onOut, ...opts } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, cmdArgs, { cwd: ROOT, ...opts });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => {
      stdout += d;
      onOut?.(stdout);
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    child.stdin.on("error", () => {});
    child.on("error", (error) => resolve({ code: 1, out: String(error.message), stdout: "", error }));
    child.on("close", (code) => resolve({ code: code ?? 1, out: stdout + stderr, stdout, error: undefined }));
    child.stdin.end(input);
  });
}

/** Git answers in milliseconds, so it stays synchronous: its trimmed stdout, or null on failure. */
function git(...gitArgs) {
  const r = spawnSync("git", gitArgs, { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  return r.status === 0 ? r.stdout.trim() : null;
}

function tail(text, lines = 40) {
  return text.trimEnd().split("\n").slice(-lines).join("\n");
}

function base() {
  return process.env.CHECK_BASE || git("merge-base", "HEAD", "origin/main");
}

/** Files this branch changes against its base, plus untracked ones. */
function changedFiles(baseRef) {
  const tracked = baseRef ? (git("diff", "--name-only", "--diff-filter=d", baseRef) ?? "").split("\n") : [];
  const untracked = (git("ls-files", "--others", "--exclude-standard") ?? "").split("\n");
  return [...new Set([...tracked, ...untracked])].filter(Boolean);
}

const lineCache = new Map();
function lineOf(path, line) {
  if (!lineCache.has(path)) {
    let lines = [];
    try {
      lines = readFileSync(join(ROOT, path), "utf8").split("\n");
    } catch {}
    lineCache.set(path, lines);
  }
  return lineCache.get(path)[line - 1] ?? "";
}

function readBaseline() {
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, "utf8")).findings ?? [];
  } catch {
    return [];
  }
}

function writeBaseline(findings) {
  const doc = {
    about:
      "Findings that existed when their rule was added; only new ones fail `npm run check`. Should only shrink. See the tools/check.mjs header.",
    findings: [...findings].sort(),
  };
  writeFileSync(BASELINE_PATH, JSON.stringify(doc, null, 2) + "\n");
}

function listFindings(findings, hint) {
  const shown = findings
    .slice(0, SHOW)
    .map((f) => `  ${f.file}${f.line ? `:${f.line}` : ""}  [${f.rule}]  ${f.message}${f.text && !f.message.endsWith(f.text) ? `\n      ${f.text}` : ""}`);
  if (findings.length > SHOW) shown.push(`  …and ${findings.length - SHOW} more`);
  return shown.join("\n") + (hint ? `\n  ${hint}` : "");
}

// ---- The steps -------------------------------------------------------------

const steps = {
  async typecheck() {
    const r = await run("npm", ["run", "-s", "typecheck"]);
    return r.code === 0 ? { ok: true } : { ok: false, detail: tail(r.out) };
  },

  async rules() {
    const t = await run(BIN("ast-grep"), ["test", "--skip-snapshot-tests"]);
    if (t.code !== 0) return { ok: false, detail: "A rule no longer matches its own examples in rule-tests/:\n" + tail(t.out) };
    const r = await run(BIN("ast-grep"), ["scan", "--json=compact"]);
    let matches;
    try {
      matches = JSON.parse(r.stdout);
    } catch {
      return { ok: false, detail: tail(r.out) };
    }
    return {
      findings: astGrepFindings(matches),
      hint: "Fix the code, or if the line is right on purpose put `// ast-grep-ignore: <rule>` with the reason on the line above. The rule's own file in rules/ says why it exists.",
    };
  },

  async lint() {
    const r = await run(BIN("biome"), ["lint", "--reporter=json", "--max-diagnostics=none"]);
    let report;
    try {
      report = JSON.parse(r.stdout);
    } catch {
      return { ok: false, detail: tail(r.out) };
    }
    return {
      findings: biomeFindings(report, lineOf),
      hint: "Fix it, or if it's right on purpose put `// biome-ignore lint/<group>/<rule>: <reason>` on the line above. https://biomejs.dev/linter/rules/ explains each rule.",
    };
  },

  async knip() {
    const r = await run(BIN("knip"), ["--no-progress", "--reporter", "json", "--no-exit-code"]);
    let report;
    try {
      report = JSON.parse(r.stdout);
    } catch {
      return { ok: false, detail: tail(r.out) };
    }
    return {
      findings: knipFindings(report),
      hint: "Delete what nothing uses (or stop exporting it). If something uses it in a way knip can't see, say so in knip.jsonc.",
    };
  },

  async dupes() {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    if (!pkg.scripts?.dupes) return { skipped: "no `dupes` script yet" };
    const r = await run("npm", ["run", "-s", "dupes"]);
    return r.code === 0 ? { ok: true } : { ok: false, detail: tail(r.out) };
  },

  async licenses() {
    const lock = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8"));
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    const notices = readFileSync(join(ROOT, "THIRD-PARTY-NOTICES.md"), "utf8");
    const bad = licenseProblems(lock);
    const unnamed = missingNotices(pkg, notices);
    const lines = [];
    for (const p of bad) lines.push(`  ${p.name}@${p.version}: ${p.license}`);
    if (bad.length)
      lines.push(
        "  Pick a permissively licensed package instead (CONTRIBUTING.md). Allowing one anyway is a person's decision: LICENSE_EXCEPTIONS in tools/checkLib.mjs.",
      );
    for (const name of unnamed) lines.push(`  ${name} is a runtime dependency, so the client bundles it, but THIRD-PARTY-NOTICES.md doesn't name it. Add its section.`);
    return lines.length ? { ok: false, detail: lines.join("\n") } : { ok: true };
  },

  async secrets() {
    const baseRef = base();
    if (!baseRef) return { skipped: "no base to diff against (no origin/main and no CHECK_BASE)" };
    const bin = await gitleaksBinary();
    if (typeof bin !== "string") return bin;
    const diff = (await run("git", ["diff", "-U0", "--no-color", "--no-ext-diff", baseRef, "--", ".", ":(exclude)package-lock.json"])).stdout;
    const added = addedLines(diff);
    for (const file of (git("ls-files", "--others", "--exclude-standard") ?? "").split("\n").filter(Boolean)) {
      if (file === "package-lock.json") continue;
      let text;
      try {
        if (statSync(join(ROOT, file)).size > 1024 * 1024) continue;
        text = readFileSync(join(ROOT, file), "utf8");
      } catch {
        continue;
      }
      if (text.includes("\0")) continue;
      text.split("\n").forEach((t, i) => added.push({ file, line: i + 1, text: t }));
    }
    if (!added.length) return { ok: true };
    const report = join(tmpdir(), `check-gitleaks-${process.pid}.json`);
    const r = await run(bin, ["stdin", "--no-banner", "--redact", "--exit-code", "0", "--report-format", "json", "--report-path", report], {
      input: added.map((a) => a.text).join("\n"),
    });
    let leaks;
    try {
      leaks = JSON.parse(readFileSync(report, "utf8"));
    } catch {
      return { ok: false, detail: "gitleaks didn't produce a report:\n" + tail(r.out) };
    } finally {
      rmSync(report, { force: true });
    }
    if (!leaks.length) return { ok: true };
    const lines = leaks.map((l) => {
      const at = added[l.StartLine - 1] ?? { file: "?", line: 0 };
      return `  ${at.file}:${at.line}  [${l.RuleID}]  ${l.Description}`;
    });
    lines.push("  Remove it, and rotate it if it was ever pushed. A false alarm gets `gitleaks:allow` in a comment on that line.");
    return { ok: false, detail: lines.join("\n") };
  },

  async tests(note) {
    const limits = process.env.CI ? [] : [`--testTimeout=${LOCAL_TEST_LIMIT_MS}`, `--hookTimeout=${LOCAL_TEST_LIMIT_MS}`];
    if (changedMode) {
      const files = changedFiles(base()).filter((f) => /\.(ts|mts|mjs|js)$/.test(f) && existsSync(join(ROOT, f)));
      if (!files.length) return { skipped: "no code changed" };
      const r = await run(BIN("vitest"), ["related", "--run", "--passWithNoTests", ...limits, ...files], {
        onOut: (out) => note(`${testFilesDone(out)} test files`),
      });
      return r.code === 0 ? { ok: true } : { ok: false, detail: tail(r.out, 60) };
    }
    // The files vitest has finished so far, out of the files it will run.
    const listed = await run(BIN("vitest"), ["list", "--filesOnly"]);
    const total = listed.code === 0 ? listed.stdout.split("\n").filter((l) => l.trim()).length : 0;
    const r = await run(BIN("vitest"), ["run", ...limits], { onOut: (out) => note(`${testFilesDone(out)}${total ? `/${total}` : ""} test files`) });
    return r.code === 0 ? { ok: true } : { ok: false, detail: tail(r.out, 60) };
  },

  async size() {
    if (changedMode) return { skipped: "not in --changed runs; CI and a plain npm run check run it" };
    // Paid scenes join the bundle where they are checked out. Skip without
    // naming them: CI measures the public tree.
    if (existsSync(join(ROOT, "src/render/scenes/private"))) {
      return { skipped: "src/render/scenes/private/ is checked out here; CI measures the public tree" };
    }
    const budget = JSON.parse(readFileSync(SIZE_BUDGET_PATH, "utf8"));
    const outDir = mkdtempSync(join(tmpdir(), "check-size-"));
    try {
      const built = await run(BIN("vite"), ["build", "--outDir", outDir, "--emptyOutDir", "--manifest", "--logLevel", "error"]);
      if (built.code !== 0) return { ok: false, detail: `vite build failed:\n${tail(built.out)}` };
      const manifest = JSON.parse(readFileSync(join(outDir, ".vite", "manifest.json"), "utf8"));
      const gz = (file) => gzipSync(readFileSync(join(outDir, file)), { level: 9 }).length;
      const pages = {};
      for (const page of Object.keys(manifest).filter((key) => manifest[key].isEntry && key.endsWith(".html"))) {
        pages[page] = firstPaintChunks(manifest, page).reduce((sum, file) => sum + gz(file), 0);
      }
      const sources = globSync("src/**/*.ts", { cwd: ROOT }).map((path) => ({ path, text: readFileSync(join(ROOT, path), "utf8") }));
      const assetPaths = readdirSync(join(outDir, "assets")).map((name) => `assets/${name}`);
      const { files, problems } = pinnedFiles(sources, manifest, assetPaths);
      if (problems.length) {
        return { ok: false, detail: [...problems.map((p) => `  ${p}`), "  Teach pinnedFiles in tools/checkLib.mjs how this import is built."].join("\n") };
      }
      const pinned = files.reduce((sum, file) => sum + statSync(join(outDir, file)).size, 0);
      const verdict = compareSizes({ pages, pinned }, budget);
      if (verdict.ok) return { ok: true, note: verdict.summary };
      // A push to main (deploy.yml) only warns: see this file's header.
      if (process.env.GITHUB_EVENT_NAME === "push") {
        return { ok: true, note: `OVER BUDGET, a warning on a push to main: ${verdict.summary}` };
      }
      return { ok: false, detail: verdict.detail };
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  },
};

/** The pinned gitleaks binary, downloaded into ~/.cache/sine-visuals-lab on first
 *  use and checked against GITLEAKS.sha256. Returns its path, or a step
 *  result when it can't: a skip on a laptop offline, a failure in CI. */
async function gitleaksBinary() {
  const plat = `${process.platform === "darwin" ? "darwin" : process.platform}_${process.arch === "arm64" ? "arm64" : "x64"}`;
  const fail = (why) => (process.env.CI ? { ok: false, detail: `  ${why}` } : { skipped: why });
  const sha = GITLEAKS.sha256[plat];
  if (!sha) return fail(`no pinned gitleaks build for ${plat}`);
  const dir = join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "sine-visuals-lab", `gitleaks-${GITLEAKS.version}`);
  const bin = join(dir, "gitleaks");
  if (existsSync(bin)) return bin;
  const url = `https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS.version}/gitleaks_${GITLEAKS.version}_${plat}.tar.gz`;
  let buf;
  try {
    const res = await fetch(url);
    if (!res.ok) return fail(`couldn't download gitleaks (${res.status})`);
    buf = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    return fail(`couldn't download gitleaks (${e.message})`);
  }
  if (createHash("sha256").update(buf).digest("hex") !== sha) return { ok: false, detail: `  the gitleaks download from ${url} doesn't match its pinned hash` };
  mkdirSync(dir, { recursive: true });
  const tgz = join(dir, "gitleaks.tar.gz");
  writeFileSync(tgz, buf);
  const r = await run("tar", ["-xzf", tgz, "-C", dir, "gitleaks"]);
  rmSync(tgz, { force: true });
  if (r.code !== 0) return fail(`couldn't unpack gitleaks: ${tail(r.out, 5)}`);
  chmodSync(bin, 0o755);
  return bin;
}

// ---- Run ---------------------------------------------------------------------

const baseline = readBaseline();
const wanted = STEPS.filter((s) => !only || only.has(s));
const allFindings = [];
const ranBaselined = new Set();
let failed = false;
const report = [];

// The live line (the header says when it shows): one line for the running step,
// redrawn every tick, then replaced by that step's result.
const live = Boolean(process.stderr.isTTY) && !process.env.CI;
const FRAMES = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
let ticker = null;
/** Starts a step's live line; returns the function a step calls to add a note to it. */
function beginStep(place, name) {
  if (!live) return () => {};
  const t0 = Date.now();
  let note = "";
  const draw = () => {
    const frame = FRAMES[Math.floor((Date.now() - t0) / 100) % FRAMES.length];
    process.stderr.write(`\r\x1b[K${frame} [${place}/${wanted.length}] ${name} ${Math.floor((Date.now() - t0) / 1000)}s${note ? ` · ${note}` : ""}`);
  };
  draw();
  ticker = setInterval(draw, 100);
  return (text) => {
    note = text;
  };
}
/** A step's result: on a terminal the line replaces the live one at once and only a failure's detail waits for the end; elsewhere the whole of it waits. */
function settle(head, body) {
  if (live) {
    clearInterval(ticker);
    process.stderr.write(`\r\x1b[K${head}\n`);
    if (body) report.push(`${head}\n${body}`);
  } else report.push(body ? `${head}\n${body}` : head);
}

for (const [i, name] of wanted.entries()) {
  const t0 = Date.now();
  const res = await steps[name](beginStep(i + 1, name));
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (res.skipped) {
    settle(`- ${name}: skipped, ${res.skipped}`);
    continue;
  }
  if (res.findings) {
    ranBaselined.add(name);
    allFindings.push(...res.findings);
    // --accept-baseline records these findings below instead of failing on them.
    const { fresh } = accept ? { fresh: [] } : compareToBaseline(res.findings, baseline.filter((k) => k.startsWith(`${name} | `)));
    if (fresh.length) {
      failed = true;
      settle(`✗ ${name} (${secs}s): ${fresh.length} new finding${fresh.length === 1 ? "" : "s"}`, listFindings(fresh, res.hint));
    } else settle(`✓ ${name} (${secs}s)`);
    continue;
  }
  if (res.ok) settle(`✓ ${name} (${secs}s)${res.note ? ` · ${res.note}` : ""}`);
  else {
    failed = true;
    settle(`✗ ${name} (${secs}s)`, res.detail);
  }
}

const allBaselinedRan = [...BASELINED].every((s) => ranBaselined.has(s));
if (prune || accept) {
  if (!allBaselinedRan) {
    console.error("--prune-baseline and --accept-baseline need the rules, lint and knip steps to run.");
    process.exit(2);
  }
  if (accept) writeBaseline(allFindings.map(fingerprint));
  else {
    const { gone } = compareToBaseline(allFindings, baseline);
    const drop = new Map();
    for (const k of gone) drop.set(k, (drop.get(k) ?? 0) + 1);
    writeBaseline(
      baseline.filter((k) => {
        const n = drop.get(k) ?? 0;
        if (n > 0) drop.set(k, n - 1);
        return n === 0;
      }),
    );
  }
  report.push(`baseline: ${readBaseline().length} entries written to check-baseline.json`);
} else if (allBaselinedRan) {
  const { gone } = compareToBaseline(allFindings, baseline);
  if (gone.length) report.push(`- ${gone.length} baseline entr${gone.length === 1 ? "y is" : "ies are"} fixed now: \`npm run check -- --prune-baseline\` drops ${gone.length === 1 ? "it" : "them"}`);
}

console.log(report.join("\n"));
if (process.env.CHECK_REPORT_FILE) writeFileSync(process.env.CHECK_REPORT_FILE, `${report.join("\n")}\n`);
if (failed) console.log("\nnpm run check failed. The tools/check.mjs header explains each step.");
process.exit(failed ? 1 : 0);
