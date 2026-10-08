---
description: Run GitHub issues through the plan → code → review workflow (one model plans, a cheaper one codes, a stronger one reviews) and record the results for model comparison
argument-hint: <issue numbers> [plan=model/effort] [code=model/effort] [review=model/effort]
---

Run `$ARGUMENTS` through the saved workflow `.claude/workflows/plan-code-review.js`.
Its header says what each stage does; its `DEFAULT_MODELS` are the models when
none are given.

1. **Parse the arguments.** Numbers are issue numbers. A `plan=`, `code=` or
   `review=` override takes `model/effort`, such as `code=sonnet/medium`. With
   no issue numbers, ask which issues to run, and stop.

2. **Check the issues are still open** with `gh issue view <n> --json state`, and
   drop any closed ones. Leave overlap with `origin/main` and open PRs to the
   plan stage, which checks for it.

3. **Launch** with the Workflow tool, `name: "plan-code-review"`, and `args` as
   real JSON: `{ "issues": [346, 353], "models": { "code": { "model": "sonnet", "effort": "medium" } } }`.
   Leave out `models` when nothing was overridden. Tell the user the run ID and
   the setup, then wait for the completion notice.

4. **Record the run** right after it completes, before anything else:
   `npm run workflow-stats -- record <runId>`. The session's transcripts it
   reads don't outlive the session.

5. **Report** for each issue: its branch and worktree, the plan and code
   grades with their reasons, each finding with severity, origin (plan or code)
   and whether it was fixed, and any open decision the review raised. Then
   print `npm run workflow-stats -- report`, so this run sits next to earlier
   setups.

6. **Don't ship on your own.** Ask which branches to finish with `/ship`. Every
   branch is local until then.
