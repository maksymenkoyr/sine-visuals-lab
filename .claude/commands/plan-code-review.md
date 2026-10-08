---
description: Run GitHub issues through the plan → code → review workflow with correction rounds (one model plans, a cheaper one codes, a stronger one reviews) and record the results for model comparison
argument-hint: <issue numbers> [plan=model/effort] [code=model/effort] [review=model/effort] [rounds=N] [tag=name]
---

Run `$ARGUMENTS` through the saved workflow `.claude/workflows/plan-code-review.js`.
Its header says what each stage does and how a correction round works. Its
`DEFAULT_MODELS` and `DEFAULT_MAX_ROUNDS` apply when nothing is given.

1. **Parse the arguments.** Numbers are issue numbers. A `plan=`, `code=` or
   `review=` override takes `model/effort`, such as `code=sonnet/medium`.
   `rounds=N` caps the correction rounds. `tag=name` goes into the branch names,
   so a rerun of an issue gets fresh branches. Default it to a short tag that
   isn't in `git branch --list 'worktree-issue-*'` yet. With no issue numbers,
   ask which issues to run, and stop.

2. **Check the issues are still open** with `gh issue view <n> --json state`, and
   drop any closed ones. Leave overlap with `origin/main` and open PRs to the
   plan stage, which checks for it.

3. **Launch from outside a worktree.** If this session entered one
   (EnterWorktree), leave it with ExitWorktree (keep) first. The workflow
   header says why. Then launch with the Workflow tool, `name: "plan-code-review"`, and `args` as
   real JSON: `{ "issues": [346, 353], "tag": "r3", "maxRounds": 2, "models": { "code": { "model": "sonnet", "effort": "medium" } } }`.
   Leave out what wasn't given. Tell the user the run ID and the setup, then
   wait for the completion notice.

4. **Record the run** right after it completes, before anything else:
   `npm run workflow-stats -- record <runId>`. The session's transcripts it
   reads don't outlive the session.

5. **Report** for each issue:
   - its branch and worktree
   - the plan grade, and the code grade at the first and the last review
   - how many review rounds ran, and whether the loop converged or the last
     review had to fix findings itself (`self_fixed`)
   - each first-round finding with its severity, origin (plan or code) and
     outcome
   - any open decision the review raised

   Then print `npm run workflow-stats -- tokens` for where the tokens and the
   estimated cost went per agent, and `npm run workflow-stats -- report` to put
   this run next to earlier setups.

6. **Don't ship on your own.** Ask which branches to finish with `/ship`. Every
   branch stays local until then.
