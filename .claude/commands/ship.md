---
description: Finish a change — verify it, rebase, push and open a draft PR. Use before reporting any change done.
---

Finish the change on this branch:

1. **Same behaviour elsewhere.** For a bug, find every other place the same
   behaviour shows up and check or fix those too. It isn't fixed until they
   are.

2. **Gates.** `npm run check` passes (the `tools/check.mjs` header lists its
   steps and how to fix each kind of finding). CI runs the same command on
   every PR and before every deploy (channels and releasing: the
   `src/version.ts` header), and the pre-push hook runs it before the push.

3. **Screenshots.** Any visualization or UI change: headless Playwright
   screenshots from before and after, with their paths in your summary. Put
   a couple in the PR body — `npm run pr-shots -- before.png after.png`
   prints the markdown. Never for a paid scene.

   For a visualization change, also run `npm run dev` and give the user the
   scene link it prints at startup, not the gallery root.

4. **Handoffs.** If a coder agent made part of this change, run
   `node tools/workflow-stats.mjs handoff-ship` before rebasing: it records
   your review of each coder's diff (its cost and what you changed after it)
   for the handoff stats, and a rebase first would count main's changes as
   yours.

5. **Rebase.** Fetch, rebase (never merge) on `origin/main`, and check again
   for divergence right before pushing.

6. **Check the PR state.** If this branch already has a PR,
   `gh api 'repos/{owner}/{repo}/pulls?head={owner}:<branch>&state=all' --jq '.[] | .state, .merged_at'`
   (REST: cloud sessions refuse `gh pr view`): a merged or closed branch still accepts
   pushes that nobody sees. If it's merged, move the commits to a new branch.

7. **Push and open a draft PR**, or update the open one: push, then rewrite
   its body so it describes the whole branch as it now stands, not just what
   the first push carried — `/release` writes the release notes from PR
   bodies. Keep the screenshots that still hold.
   `gh api -X PATCH 'repos/{owner}/{repo}/pulls/<n>' -F body=@<file>` (REST,
   as in step 6).

8. **Record the difficulty** of each issue the PR closes, also when the label
   held: `npm run difficulty -- record <issue> --actual … --human … --pr <pr>
   --why "…"`. The correction loop in `docs/issue-labels.md` says how to
   judge it. Skip this for a PR that closes no issue.
