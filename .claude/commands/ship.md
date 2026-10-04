---
description: Finish a change — verify it, rebase, push and open a draft PR. Use before reporting any change done.
---

Finish the change on this branch:

1. **Same behaviour elsewhere.** For a bug, find every other place the same
   behaviour shows up and check or fix those too. It isn't fixed until they
   are.

2. **Gates.** Any TS change: `npm run typecheck` (root and `server/`) and
   `npm run test`. CI runs the same two on every PR and before every deploy
   (channels and releasing: the `src/version.ts` header).

3. **Screenshots.** Any visualization or UI change: headless Playwright
   screenshots from before and after, with their paths in your summary. Put
   a couple in the PR body — `npm run pr-shots -- before.png after.png`
   prints the markdown. Never for a paid scene.

4. **Rebase.** Fetch, rebase (never merge) on `origin/main`, and check again
   for divergence right before pushing.

5. **Check the PR state.** If this branch already has a PR,
   `gh pr view --json state`: a merged or closed branch still accepts
   pushes that nobody sees. If it's merged, move the commits to a new branch.

6. **Push and open a draft PR**, or update the open one.
