#!/usr/bin/env node
// `npm run check`: every automatic check this repo has, in one command, so a
// session finishing (the Stop hook, .claude/hooks/check-on-stop.sh), a push
// (.githooks/pre-push) and a pull request (deploy.yml) all fail on exactly
// the same things with the same messages.
//
//   npm run check                       # everything, the whole test suite
//   npm run check -- --changed          # the Stop hook's run: only the tests related to changed files
//   npm run check -- --only rules,lint  # some steps (names below)
//   npm run check -- --prune-baseline   # drop baseline entries that no longer occur
//   npm run check -- --accept-baseline  # record every current finding as known (a person's call, never an agent's)
//
// The steps, in order. Each prints ✓ or ✗; any ✗ makes the exit code 1.
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
//              related to the changed files.
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

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  addedLines,
  astGrepFindings,
  biomeFindings,
  compareToBaseline,
  fingerprint,
  knipFindings,
  licenseProblems,
  missingNotices,
} from "./checkLib.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_PATH = join(ROOT, "check-baseline.json");
const BIN = (name) => join(ROOT, "node_modules", ".bin", name);
const SHOW = 30;

const GITLEAKS = {
  version: "8.30.1",
  sha256: {
    darwin_arm64: "b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5",
    darwin_x64: "dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709",
    linux_arm64: "e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080",
    linux_x64: "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb",
  },
};

const STEPS = ["typecheck", "rules", "lint", "knip", "dupes", "licenses", "secrets", "tests"];
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

function run(cmd, cmdArgs, opts = {}) {
  const r = spawnSync(cmd, cmdArgs, { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, ...opts });
  return { code: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? ""), stdout: r.stdout ?? "", error: r.error };
}

function git(...gitArgs) {
  const r = run("git", gitArgs);
  return r.code === 0 ? r.stdout.trim() : null;
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
  typecheck() {
    const r = run("npm", ["run", "-s", "typecheck"]);
    return r.code === 0 ? { ok: true } : { ok: false, detail: tail(r.out) };
  },

  rules() {
    const t = run(BIN("ast-grep"), ["test", "--skip-snapshot-tests"]);
    if (t.code !== 0) return { ok: false, detail: "A rule no longer matches its own examples in rule-tests/:\n" + tail(t.out) };
    const r = run(BIN("ast-grep"), ["scan", "--json=compact"]);
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

  lint() {
    const r = run(BIN("biome"), ["lint", "--reporter=json", "--max-diagnostics=none"]);
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

  knip() {
    const r = run(BIN("knip"), ["--no-progress", "--reporter", "json", "--no-exit-code"]);
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

  dupes() {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    if (!pkg.scripts?.dupes) return { skipped: "no `dupes` script yet" };
    const r = run("npm", ["run", "-s", "dupes"]);
    return r.code === 0 ? { ok: true } : { ok: false, detail: tail(r.out) };
  },

  licenses() {
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
    const diff = run("git", ["diff", "-U0", "--no-color", "--no-ext-diff", baseRef, "--", ".", ":(exclude)package-lock.json"]).stdout;
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
    const r = run(bin, ["stdin", "--no-banner", "--redact", "--exit-code", "0", "--report-format", "json", "--report-path", report], {
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

  tests() {
    if (changedMode) {
      const files = changedFiles(base()).filter((f) => /\.(ts|mts|mjs|js)$/.test(f) && existsSync(join(ROOT, f)));
      if (!files.length) return { skipped: "no code changed" };
      const r = run(BIN("vitest"), ["related", "--run", "--passWithNoTests", ...files]);
      return r.code === 0 ? { ok: true } : { ok: false, detail: tail(r.out, 60) };
    }
    const r = run(BIN("vitest"), ["run"]);
    return r.code === 0 ? { ok: true } : { ok: false, detail: tail(r.out, 60) };
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
  const r = run("tar", ["-xzf", tgz, "-C", dir, "gitleaks"]);
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

for (const name of wanted) {
  const t0 = Date.now();
  const res = await steps[name]();
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (res.skipped) {
    report.push(`- ${name}: skipped, ${res.skipped}`);
    continue;
  }
  if (res.findings) {
    ranBaselined.add(name);
    allFindings.push(...res.findings);
    // --accept-baseline records these findings below instead of failing on them.
    const { fresh } = accept ? { fresh: [] } : compareToBaseline(res.findings, baseline.filter((k) => k.startsWith(`${name} | `)));
    if (fresh.length) {
      failed = true;
      report.push(`✗ ${name} (${secs}s): ${fresh.length} new finding${fresh.length === 1 ? "" : "s"}\n${listFindings(fresh, res.hint)}`);
    } else report.push(`✓ ${name} (${secs}s)`);
    continue;
  }
  if (res.ok) report.push(`✓ ${name} (${secs}s)`);
  else {
    failed = true;
    report.push(`✗ ${name} (${secs}s)\n${res.detail}`);
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
if (failed) console.log("\nnpm run check failed. The tools/check.mjs header explains each step.");
process.exit(failed ? 1 : 0);
