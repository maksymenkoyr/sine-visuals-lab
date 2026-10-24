// The pure parts of `npm run check` (tools/check.mjs, whose header explains
// the whole check). Everything here takes text or parsed JSON and returns
// plain data, so tests/check.test.ts can cover it without running a tool.
// Types: checkLib.d.mts, kept in sync by hand.

import { posix } from "node:path";

/** SPDX ids a dependency may carry: CONTRIBUTING.md's "permissively
 *  licensed" list, spelled the way package.json license fields spell it. */
const PERMISSIVE = new Set([
  "MIT",
  "MIT-0",
  "ISC",
  "0BSD",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "Apache-2.0",
  "OFL-1.1",
  "CC0-1.0",
  "CC-BY-4.0",
  "Unlicense",
  "BlueOak-1.0.0",
  "Zlib",
  "Python-2.0",
]);

/** Packages allowed despite a license outside PERMISSIVE, each with the
 *  reason a person accepted. A name ending in `*` matches by prefix. */
const LICENSE_EXCEPTIONS = [
  {
    name: "@img/sharp-*",
    reason:
      "libvips (LGPL-3.0) inside sharp, which wrangler's local Workers runtime (miniflare) uses. A dev tool on the developer's machine only: never bundled into the client, never shipped.",
  },
];

/** Splits an SPDX expression into tokens: ids, "(", ")", AND, OR, WITH. */
function spdxTokens(expr) {
  return expr.replace(/\(/g, " ( ").replace(/\)/g, " ) ").trim().split(/\s+/).filter(Boolean);
}

/** Whether an SPDX license expression allows use under a permissive
 *  license: an OR needs one permissive side, an AND needs both. `X WITH Y`
 *  is judged by X. A missing or non-SPDX license is not permissive. */
export function isPermissive(expr) {
  if (typeof expr !== "string" || !expr.trim()) return false;
  const tokens = spdxTokens(expr);
  let i = 0;
  const atom = () => {
    const t = tokens[i++];
    if (t === "(") {
      const v = or();
      i++; // ")"
      return v;
    }
    let ok = PERMISSIVE.has((t ?? "").replace(/\+$/, ""));
    if (tokens[i] === "WITH") i += 2;
    return ok;
  };
  const and = () => {
    let v = atom();
    while (tokens[i] === "AND") {
      i++;
      v = atom() && v;
    }
    return v;
  };
  const or = () => {
    let v = and();
    while (tokens[i] === "OR") {
      i++;
      v = and() || v;
    }
    return v;
  };
  return or();
}

function exceptionFor(name, exceptions) {
  return exceptions.find((e) => (e.name.endsWith("*") ? name.startsWith(e.name.slice(0, -1)) : name === e.name));
}

/** Every package in a parsed package-lock.json (v2/v3 `packages` map) whose
 *  license isn't permissive and isn't a listed exception. */
export function licenseProblems(lock, exceptions = LICENSE_EXCEPTIONS) {
  const problems = [];
  for (const [path, info] of Object.entries(lock.packages ?? {})) {
    if (!path || info.link) continue;
    const name = path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
    const license = typeof info.license === "string" ? info.license : info.license ? JSON.stringify(info.license) : "";
    if (isPermissive(license) || exceptionFor(name, exceptions)) continue;
    problems.push({ name, version: info.version ?? "", license: license || "(none listed)" });
  }
  return problems;
}

/** The runtime `dependencies` (what the client build bundles) that
 *  THIRD-PARTY-NOTICES.md never names. */
export function missingNotices(pkg, noticesText) {
  return Object.keys(pkg.dependencies ?? {}).filter((name) => !noticesText.includes(name));
}

// ---- Findings and the baseline -------------------------------------------

/** One finding from any tool, in the shape the report and the baseline use. */
export function finding(tool, rule, file, line, text, message) {
  return { tool, rule, file, line, text: String(text ?? "").replace(/\s+/g, " ").trim(), message };
}

/** The baseline key for a finding. It names the code (the trimmed source
 *  line, or the symbol for knip), not the line number, so edits elsewhere in
 *  the file don't turn an old finding into a new one. */
export function fingerprint(f) {
  return `${f.tool} | ${f.rule} | ${f.file} | ${f.text}`;
}

/** Splits findings into the ones the baseline doesn't cover (`fresh`) and
 *  lists the baseline entries nothing matched any more (`gone`). The
 *  baseline is a multiset: two identical lines need two entries. */
export function compareToBaseline(findings, baseline) {
  const left = new Map();
  for (const key of baseline) left.set(key, (left.get(key) ?? 0) + 1);
  const fresh = [];
  for (const f of findings) {
    const key = fingerprint(f);
    const n = left.get(key) ?? 0;
    if (n > 0) left.set(key, n - 1);
    else fresh.push(f);
  }
  const gone = [];
  for (const [key, n] of left) for (let k = 0; k < n; k++) gone.push(key);
  return { fresh, gone };
}

// ---- Tool output to findings ---------------------------------------------

/** ast-grep `scan --json=compact` output. */
export function astGrepFindings(matches) {
  return matches.map((m) =>
    finding("rules", m.ruleId, m.file, m.range.start.line + 1, m.lines.split("\n")[0], m.message),
  );
}

/** Biome `lint --reporter=json` output. `lineOf(path, line)` returns that
 *  source line, so the fingerprint carries the code rather than the number. */
export function biomeFindings(report, lineOf) {
  return (report.diagnostics ?? [])
    .filter((d) => d.location?.path && d.category?.startsWith("lint/"))
    .map((d) => {
      const line = d.location.start?.line ?? 0;
      return finding("lint", d.category.slice("lint/".length), d.location.path, line, lineOf(d.location.path, line), d.message);
    });
}

const KNIP_WORDS = {
  files: "unused file",
  dependencies: "unused dependency",
  devDependencies: "unused dev dependency",
  optionalPeerDependencies: "unused optional peer dependency",
  unlisted: "used but not in package.json",
  binaries: "binary not in package.json",
  unresolved: "import that doesn't resolve",
  exports: "unused export",
  types: "unused exported type",
  enumMembers: "unused enum member",
  namespaceMembers: "unused namespace member",
  duplicates: "exported twice under different names",
  catalog: "unused catalog entry",
};

/** knip `--reporter json` output. */
export function knipFindings(report) {
  const out = [];
  for (const issue of report.issues ?? []) {
    for (const [kind, items] of Object.entries(issue)) {
      if (!Array.isArray(items) || !KNIP_WORDS[kind]) continue;
      for (const item of items) {
        const list = Array.isArray(item) ? item : [item];
        const name = list.map((x) => (typeof x === "string" ? x : x.name)).join(" | ");
        const line = list[0]?.line ?? 0;
        out.push(finding("knip", kind, issue.file, line, name, `${KNIP_WORDS[kind]}: ${name}`));
      }
    }
  }
  return out;
}

// ---- Tests: progress ------------------------------------------------------

/** How many test files vitest's piped output says it has finished: one
 *  `✓ tests/x.test.ts (12 tests) 30ms` style line each, passed or failed. */
export function testFilesDone(output) {
  const plain = output.replace(/\x1b\[[0-9;]*m/g, "");
  return (plain.match(/^\s*[✓❯×↓]\s+\S+\.test\.\w+/gm) ?? []).length;
}

// ---- Secrets: the lines a change adds ------------------------------------

/** The lines a `git diff -U0` adds, with the file and new line number of
 *  each, so a secret found in them can be reported at its real place. */
export function addedLines(diffText) {
  const out = [];
  let file = null;
  let line = 0;
  for (const raw of diffText.split("\n")) {
    if (raw.startsWith("+++ ")) {
      file = raw === "+++ /dev/null" ? null : raw.replace(/^\+\+\+ (b\/)?/, "");
    } else if (raw.startsWith("@@")) {
      const m = /\+(\d+)/.exec(raw);
      line = m ? Number(m[1]) : 0;
    } else if (file && raw.startsWith("+")) {
      out.push({ file, line, text: raw.slice(1) });
      line++;
    }
  }
  return out;
}

// ---- Size: what a build makes a page load --------------------------------

/** The JS a page (a Vite build manifest's HTML entry) loads before its first
 *  paint: its chunk and every chunk imported statically from there, all the
 *  way down. Dynamic imports load later. Paths are relative to the outDir. */
export function firstPaintChunks(manifest, page) {
  const seen = new Set();
  const files = [];
  const visit = (key) => {
    if (seen.has(key) || !manifest[key]) return;
    seen.add(key);
    if (manifest[key].file.endsWith(".js")) files.push(manifest[key].file);
    for (const dep of manifest[key].imports ?? []) visit(dep);
  };
  visit(page);
  return files;
}

const PINNED_IMPORT_RE = /import\s+(\w+)\s+from\s+["']([^"']+\?(?:worker&url|url))["']/g;
const FONT_IMPORT_RE = /\.(?:woff2?|ttf|otf)\?url$/i;

/** The built files pinAsset() fetches after load (src/pinnedAssets.ts): each
 *  `?url` or `?worker&url` import in `sources` (`{ path, text }`, paths from
 *  the repo root) that its file passes to pinAsset(), fonts aside, the
 *  pairing tests/pinnedAssets.test.ts enforces. A `?url` file is found in the
 *  manifest under its source path, and one missing there was inlined
 *  (build.assetsInlineLimit), so it costs no fetch. Vite leaves workers out
 *  of the manifest: a worker is the one `assets/<name>-<hash>.js` among
 *  `assetPaths`. What can't be placed comes back in `problems`. */
export function pinnedFiles(sources, manifest, assetPaths) {
  const files = new Set();
  const problems = [];
  for (const { path, text } of sources) {
    for (const [, name, spec] of text.matchAll(PINNED_IMPORT_RE)) {
      if (FONT_IMPORT_RE.test(spec) || !new RegExp(`pinAsset\\(\\s*${name}\\s*[,)]`).test(text)) continue;
      const [bare, query] = spec.split("?");
      const source = posix.join(posix.dirname(path), bare);
      const stem = `assets/${posix.basename(bare).replace(/\.[^.]+$/, "")}-`;
      const workers = assetPaths.filter((p) => p.startsWith(stem) && p.endsWith(".js"));
      if (!bare.startsWith(".")) problems.push(`can't place the package import ${spec} (${path})`);
      else if (manifest[source]) files.add(manifest[source].file);
      else if (query === "worker&url") {
        if (workers.length === 1) files.add(workers[0]);
        else problems.push(`can't find the built worker of ${source}`);
      }
    }
  }
  return { files: [...files].sort(), problems };
}

/** The step's verdict on `measured` (`{ pages: { [page]: gzip bytes },
 *  pinned: bytes }`) against size-budget.json. A page without a budget, or a
 *  budget for a page the build lacks, fails too, so the file always names
 *  exactly the build's pages. `summary` is a pass's line, `detail` a failure's. */
export function compareSizes(measured, budget) {
  const kb = (bytes) => (bytes / 1024).toFixed(1);
  const parts = [];
  const problems = [];
  for (const page of [...new Set([...Object.keys(measured.pages), ...Object.keys(budget.pages ?? {})])].sort()) {
    const bytes = measured.pages[page];
    const limit = budget.pages?.[page];
    if (bytes === undefined) problems.push(`  ${page} has a budget in size-budget.json, but the build has no such page: remove it.`);
    else if (typeof limit !== "number") problems.push(`  ${page} has no budget in size-budget.json: add one.`);
    else {
      parts.push(`${page} ${kb(bytes)} of ${kb(limit)} kB`);
      if (bytes > limit) problems.push(`  ${page} loads ${kb(bytes)} kB of gzipped JS before its first paint, ${kb(bytes - limit)} kB over its budget.`);
    }
  }
  if (typeof budget.pinned !== "number") problems.push("  size-budget.json has no `pinned` budget: add one.");
  else {
    parts.push(`pinned ${kb(measured.pinned)} of ${kb(budget.pinned)} kB`);
    if (measured.pinned > budget.pinned) problems.push(`  pinAsset() fetches ${kb(measured.pinned)} kB after load, ${kb(measured.pinned - budget.pinned)} kB over its budget.`);
  }
  if (!problems.length) return { ok: true, summary: parts.join(" · "), detail: "" };
  problems.push(
    "  The budgets are in size-budget.json: make the change smaller, or edit the number there.",
    "  Lowering a budget is always welcome; raising one needs a reason in the pull request description.",
  );
  return { ok: false, summary: parts.join(" · "), detail: problems.join("\n") };
}
