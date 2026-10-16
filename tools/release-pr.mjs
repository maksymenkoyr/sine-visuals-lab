#!/usr/bin/env node
// `npm run release [-- --notes <file>] [--print]`: opens the pull request from
// main into production whose merge ships Stable (.github/workflows/release.yml),
// titled with the version that merge will get — or, when one is already open,
// rewrites its title and body. `--print` prints the title and body instead,
// and opens nothing.
//
// The body opens with the release's written notes: the `--notes` file, which
// `/release` (.claude/commands/release.md) writes; without one, an empty
// comment to write them over. A `NOTES_END` line closes them, and everything
// above it opens the GitHub Release (tools/releaseNotesLib.mjs's header).
// Below it: how to merge, then a folded preview of the generated list as it
// stands now. The preview is only a preview: release.yml regenerates the list
// from the commit it actually ships, so anything merged to main after this
// PR opens is in it.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { formatVersion, latestRelease, nextStable } from "./appVersionLib.mjs";
import { NOTES_END } from "./releaseNotesLib.mjs";

const run = (cmd, args, input) =>
  execFileSync(cmd, args, { encoding: "utf8", input, stdio: [input ? "pipe" : "ignore", "pipe", "inherit"] }).trim();
const lines = (text) => (text ? text.split("\n") : []);

const { values: opts } = parseArgs({ options: { notes: { type: "string" }, print: { type: "boolean" } } });

run("git", ["fetch", "--quiet", "--tags", "origin", "main", "production"]);
const pkgMajor = Number(JSON.parse(readFileSync("package.json", "utf8")).version.split(".")[0]);
const version = formatVersion(nextStable(latestRelease(lines(run("git", ["tag", "--merged", "origin/production"]))), pkgMajor));
const label = run("node", ["tools/app-version.mjs", "label", "stable", version]);
const preview = run("node", ["tools/release-notes.mjs", "--to", "origin/main"]);

const notes = opts.notes
  ? readFileSync(opts.notes, "utf8").trim()
  : "<!-- The release's notes go here — /release writes them. Left empty, the GitHub Release is just the generated list. -->";

const title = `Release to Stable: ${label}`;
const body = `${notes}

${NOTES_END}: everything above this line opens the GitHub Release (tools/releaseNotesLib.mjs) -->

---

Merging this deploys Stable as **${label}** (\`.github/workflows/release.yml\`). Merge with **Create a merge commit**, not squash.

<details><summary>Every change, as the generated list reads now</summary>

${preview}

</details>
`;

if (opts.print) {
  process.stdout.write(`${title}\n\n${body}`);
  process.exit(0);
}

const open = run("gh", ["pr", "list", "--base", "production", "--head", "main", "--state", "open", "--json", "number", "-q", ".[0].number // empty"]);
if (open) {
  run("gh", ["pr", "edit", open, "--title", title, "--body-file", "-"], body);
  console.log(`updated #${open}: ${run("gh", ["pr", "view", open, "--json", "url", "-q", ".url"])}`);
} else {
  console.log(run("gh", ["pr", "create", "--base", "production", "--head", "main", "--title", title, "--body-file", "-"], body));
}
