#!/usr/bin/env node
// `npm run release`: opens the pull request from main into production whose
// merge ships Stable (.github/workflows/release.yml). Its body starts with an
// empty "## Highlights" section — whatever is written there before merging
// opens the GitHub Release (tools/releaseNotesLib.mjs's header) — and ends
// with a preview of the generated notes as they stand now. The preview is
// only a preview: release.yml regenerates the list from the commit it
// actually ships, so anything merged to main after this PR opens is in it.
import { execFileSync } from "node:child_process";

const run = (cmd, args, input) => execFileSync(cmd, args, { encoding: "utf8", input, stdio: [input ? "pipe" : "ignore", "pipe", "inherit"] });

run("git", ["fetch", "--quiet", "origin", "main", "production"]);
const preview = run("node", ["tools/release-notes.mjs", "--to", "origin/main"]);

const body = `## Highlights

<!-- Optional: the story of this release, in a few lines or bullets. Whatever
     is written here (above the rule below) opens the GitHub Release, before
     the generated list. Left empty, the Release is just the list. -->

---

Merging this deploys Stable (\`.github/workflows/release.yml\`). Merge with **Create a merge commit**, not squash.

<details><summary>Preview of the generated release notes</summary>

${preview}
</details>
`;

process.stdout.write(
  run("gh", ["pr", "create", "--base", "production", "--head", "main", "--title", "Release to Stable", "--body-file", "-"], body),
);
