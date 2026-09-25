#!/usr/bin/env node
// Fetches the private (paid) scenes checkout into src/render/scenes/private/
// before `npm run dev`, so a developer with access gets paid scenes without a
// manual clone. It runs as the `predev` hook and never fails the dev server:
// with no access (no credentials, an outside contributor, offline), it prints
// one line and exits 0, and the glob in src/render/scenes/index.ts then quietly
// matches nothing, exactly as in CI and the deployed build. The contract for
// what goes in that folder, and why it never ships, is in
// src/render/scenes/privateScenes.ts.
//
//   node tools/private-scenes.mjs
//
// Folder missing → clone it. Folder present → leave it alone (it's your
// working copy; pull there yourself). Env:
//   PRIVATE_SCENES_REPO  override the clone URL
//   SKIP_PRIVATE_SCENES=1  do nothing (also skipped when CI is set)

import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dest = path.join(root, "src/render/scenes/private");
const repo =
  process.env.PRIVATE_SCENES_REPO ??
  "git@github.com:maksymenkoyr/sine-visuals-lab-scenes.git";
const say = (msg) => console.log(`[private-scenes] ${msg}`);

if (process.env.CI || process.env.SKIP_PRIVATE_SCENES) process.exit(0);
if (existsSync(dest)) process.exit(0);

const result = spawnSync("git", ["clone", "--quiet", repo, dest], {
  stdio: ["ignore", "inherit", "pipe"],
  timeout: 60_000,
  env: {
    ...process.env,
    // Never hang the dev server on a password or host-key prompt.
    GIT_TERMINAL_PROMPT: "0",
    GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? "ssh -o BatchMode=yes",
  },
});

const hasCommits =
  result.status === 0 &&
  spawnSync("git", ["-C", dest, "rev-parse", "--verify", "--quiet", "HEAD"]).status === 0;

if (hasCommits) {
  say(`cloned ${repo} → src/render/scenes/private/`);
} else if (result.status === 0) {
  // An empty clone would make every later run skip; drop it so the next run
  // retries once something has been pushed.
  rmSync(dest, { recursive: true, force: true });
  say(`${repo} has no commits yet, building without paid scenes`);
} else {
  const why = (result.stderr?.toString().trim().split("\n").pop() ?? result.error?.message) || "unknown error";
  say(`no access to ${repo}, building without paid scenes (${why})`);
}
