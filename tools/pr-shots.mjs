#!/usr/bin/env node
// Puts screenshots into a PR body. GitHub's drag-and-drop image upload has no
// API (gh can't do it), so this commits the images to the orphan branch
// `pr-screenshots` on origin and prints markdown that embeds them from
// raw.githubusercontent.com, ready to paste into `gh pr create/edit --body`.
//
//   npm run pr-shots -- before.png after.png [--dir name] [--width 1600]
//
// Each image is re-encoded as WebP (via Playwright's Chromium, already a dev
// dependency) and scaled down to --width, so the branch stays small. Files land
// in <dir>/ (default: the current branch name); a file named before*/after*
// pair is printed as a side-by-side table, everything else as one image per
// line. URLs point at the commit, not the branch, so a re-upload under the same
// name never shows a cached old picture.
//
// The branch never merges into main and nothing here touches the working tree:
// blobs go in through a throwaway index (GIT_INDEX_FILE), the commit is pushed
// with a plain (non-force) push, retried if someone else pushed in between.
// The branch is disposable: deleting it breaks only old PR pictures.
//
// The repo is public. Never upload a paid scene (CLAUDE.md, "Paid scenes are
// closed"): this refuses any path or name mentioning an entry of
// src/render/scenes/private/, but it can't see what is in a picture.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const BRANCH = "pr-screenshots";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const die = (msg) => {
  console.error(`[pr-shots] ${msg}`);
  process.exit(1);
};
const git = (args, opts = {}) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8", ...opts }).trim();

// --- args ---
const files = [];
let dir = null;
let width = 1600;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--dir") dir = argv[++i];
  else if (argv[i] === "--width") width = Number(argv[++i]);
  else files.push(path.resolve(argv[i]));
}
if (!files.length) die("usage: npm run pr-shots -- <image>... [--dir name] [--width px]");
for (const f of files) if (!existsSync(f)) die(`no such file: ${f}`);
dir = (dir ?? git(["rev-parse", "--abbrev-ref", "HEAD"])).replace(/[^\w.-]+/g, "-");

// --- paid-scene guard ---
// The private folder is gitignored, so a worktree has none: look in the main
// checkout too (the parent of the shared .git dir).
const mainRoot = path.dirname(path.resolve(root, git(["rev-parse", "--git-common-dir"])));
const privateNames = [
  ...new Set(
    [root, mainRoot].flatMap((r) => {
      const d = path.join(r, "src/render/scenes/private");
      return existsSync(d) ? readdirSync(d) : [];
    }),
  ),
]
  .filter((n) => !n.startsWith(".") && !/^readme/i.test(n))
  .map((n) => n.replace(/\.[^.]+$/, "").toLowerCase());
for (const name of [dir, ...files]) {
  const lower = name.toLowerCase();
  if (lower.includes(`${path.sep}scenes${path.sep}private${path.sep}`))
    die(`refusing ${name}: it is under the private scenes folder`);
  const hit = privateNames.find((p) => path.basename(lower).includes(p) || lower === p);
  if (hit) die(`refusing ${name}: it names the paid scene "${hit}"; paid scenes never go in a public PR`);
}

// --- encode to WebP ---
const { chromium } = await import("playwright");
const browser = await chromium.launch();
const page = await browser.newPage();
const work = mkdtempSync(path.join(process.env.CLAUDE_JOB_DIR ? path.join(process.env.CLAUDE_JOB_DIR, "tmp") : tmpdir(), "pr-shots-"));
const encoded = [];
try {
  for (const f of files) {
    const ext = path.extname(f).slice(1).toLowerCase().replace("jpg", "jpeg");
    const src = `data:image/${ext};base64,${readFileSync(f).toString("base64")}`;
    const out = await page.evaluate(
      async ({ src, width }) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        const scale = Math.min(1, width / img.naturalWidth);
        const c = document.createElement("canvas");
        c.width = Math.round(img.naturalWidth * scale);
        c.height = Math.round(img.naturalHeight * scale);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        return c.toDataURL("image/webp", 0.88).split(",")[1];
      },
      { src, width },
    );
    const name = path.basename(f).replace(/\.[^.]+$/, "") + ".webp";
    const dest = path.join(work, name);
    writeFileSync(dest, Buffer.from(out, "base64"));
    encoded.push({ name, dest });
  }
} finally {
  await browser.close();
}

// --- commit onto pr-screenshots without a checkout, push, retry on a race ---
const index = path.join(work, "index");
const env = { ...process.env, GIT_INDEX_FILE: index };
const repoSlug = git(["remote", "get-url", "origin"]).replace(/^.*github\.com[:/]/, "").replace(/\.git$/, "");
let commit = null;
for (let attempt = 0; attempt < 3 && !commit; attempt++) {
  let parent = null;
  try {
    git(["fetch", "-q", "origin", `+refs/heads/${BRANCH}:refs/remotes/origin/${BRANCH}`], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    parent = git(["rev-parse", `refs/remotes/origin/${BRANCH}`]);
  } catch {
    // First upload ever: the branch doesn't exist yet.
  }
  rmSync(index, { force: true });
  if (parent) git(["read-tree", parent], { env });
  else git(["read-tree", "--empty"], { env });
  for (const { name, dest } of encoded) {
    const blob = git(["hash-object", "-w", dest]);
    git(["update-index", "--add", "--cacheinfo", `100644,${blob},${dir}/${name}`], { env });
  }
  const tree = git(["write-tree"], { env });
  const c = git(
    ["commit-tree", tree, ...(parent ? ["-p", parent] : []), "-m", `${dir}: ${encoded.map((e) => e.name).join(", ")}`],
  );
  try {
    git(["push", "-q", "origin", `${c}:refs/heads/${BRANCH}`], { stdio: ["ignore", "pipe", "pipe"] });
    commit = c;
  } catch (e) {
    if (attempt === 2) die(`push failed: ${e.stderr || e.message}`);
  }
}
rmSync(work, { recursive: true, force: true });

// --- markdown ---
const url = (name) => `https://raw.githubusercontent.com/${repoSlug}/${commit}/${dir}/${name}`;
const before = encoded.filter((e) => /^before/i.test(e.name));
const after = encoded.filter((e) => /^after/i.test(e.name));
const paired = before.length > 0 && before.length === after.length;
const lines = [];
if (paired) {
  lines.push("| Before | After |", "|---|---|");
  for (let i = 0; i < before.length; i++)
    lines.push(`| ![${before[i].name}](${url(before[i].name)}) | ![${after[i].name}](${url(after[i].name)}) |`);
}
for (const e of encoded)
  if (!(paired && (before.includes(e) || after.includes(e))))
    lines.push(`![${e.name.replace(/\.webp$/, "")}](${url(e.name)})`);
console.log(lines.join("\n"));
