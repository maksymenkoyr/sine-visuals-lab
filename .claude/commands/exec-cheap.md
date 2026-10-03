---
description: Hand a written plan to the cheap OpenRouter model, then verify its work here
argument-hint: <plans/topic.md>
disable-model-invocation: true
---

Execute the plan in `$1` with the cheap model (`tools/cheap.sh`, an OpenRouter
model in its own Claude Code process), then check its work yourself. You stay
on the subscription model; only the cheap process talks to OpenRouter.

**Refuse and stop, telling the user why, if any of these hold:**
- `$1` is missing or the file doesn't exist.
- The current branch is `main`, or the cwd isn't a git worktree branch
  (CLAUDE.md: never edit on `main`).
- The plan mentions `scenes/private` or a paid scene. Whatever the cheap
  process reads goes to OpenRouter and its providers; paid-scene code never
  leaves the private repo.
- `OPENROUTER_API_KEY` isn't set in the environment.

**Steps:**

1. Read the plan. If a step is vague (no file, no symbol, no check), say so and
   stop — a low-effort model needs the plan sharpened first, not guessed at.
2. Make sure `node_modules` exists in this worktree; if not, `npm ci`.
3. Run the cheap process in the background (a foreground Bash call times out
   at 10 minutes) and wait for its exit notification:

   ```
   tools/cheap.sh -p "Execute <plan path> one step at a time. After each step run npm run typecheck and npm run test, then commit that step. Stop and report if a step fails twice. Never push, never touch main, never edit anything under src/render/scenes/private/." \
     --permission-mode acceptEdits \
     --max-budget-usd 1 \
     --allowedTools "Bash(npm run typecheck)" "Bash(npm run test:*)" "Bash(git add:*)" "Bash(git commit:*)" "Bash(git status:*)" "Bash(git diff:*)" \
     --disallowedTools "Bash(git push:*)" "Bash(git checkout main:*)" "Bash(git reset:*)"
   ```

   Anything outside that allowlist fails in headless mode instead of prompting;
   if the plan needs another command, add it to the plan and the allowlist
   deliberately, don't widen it on the fly.
4. **Don't trust its "done".** Independently: run `npm run typecheck` and
   `npm run test` here; read `git log` and `git diff origin/main...HEAD` against
   the plan step by step; for a visualization/UI change take the before/after
   headless Playwright screenshots CLAUDE.md requires.
5. Report to the user: steps completed vs the plan, anything the cheap model
   skipped or did differently, gate results, screenshot paths. Fix small gaps
   yourself; for larger ones, say what to re-plan. Do not push or open the PR
   unless the user asks.
