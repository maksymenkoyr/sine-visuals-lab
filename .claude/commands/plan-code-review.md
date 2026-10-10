---
description: Run GitHub issues through the plan → code → review workflow (a strong model plans, reviews once and fixes what it found, a cheaper one codes), or rerun the fixed benchmark, then grade every run of an issue side by side, and record the results for model comparison
argument-hint: <issue numbers | bench | grade <issue numbers | bench>> [solo] [plan=model/effort] [code=model/effort] [review=model/effort] [solo=model/effort] [rounds=N] [fork] [tag=name]
---

Run `$ARGUMENTS` through the workflow,
`.claude/workflows/plan-code-review.js`. Its header says what each stage does, how a correction round works, and what
`solo` and a pinned `base` change. Its `DEFAULT_MODELS` and
`DEFAULT_MAX_ROUNDS` apply when nothing is given.

1. **Parse the arguments.**
   - Numbers are issue numbers.
   - `bench` reruns the fixed benchmark instead: take `issues` and `base` from
     `tools/plan-code-review-bench.json` and pass both. Its rows form their
     own series in the report, so setups compare across reruns.
   - `solo` runs one agent per issue with no plan and no review, then a
     `grade` agent whose cost stays out of the total.
   - A `plan=`, `code=`, `review=` or `solo=` override takes `model/effort`,
     such as `code=sonnet/medium`.
   - `rounds=N` brings back up to N correction rounds; by default there are
     none, and the one review fixes what it found.
   - `fork` turns on the Opus-fix fork the workflow header describes. It needs
     `rounds=1` or more.
   - `grade` runs no build: it grades the runs already recorded, and skips to
     the **Grade** section below.
   - `tag=name` goes into the branch names, so a rerun of an issue gets fresh
     branches. Default it to a short tag that isn't in
     `git branch --list 'worktree-issue-*'` yet: `b<N>` for a bench run,
     `r<N>` otherwise.
   - With neither issue numbers nor `bench`, ask which issues to run, and stop.

2. **Check the issues are still open** with
   `gh api 'repos/{owner}/{repo}/issues/<n>' --jq .state` (REST: cloud sessions
   refuse `gh issue view`), and drop any closed ones. Skip this for `bench`:
   its issues may be closed by now, and the run is pinned to a commit from
   before their fixes. Leave
   overlap with `origin/main` and open PRs to the plan stage, which checks for it.

3. **Launch from outside a worktree.** If this session entered one
   (EnterWorktree), leave it with ExitWorktree (keep) first. The workflow
   header says why. Then launch with the Workflow tool, `scriptPath:
   ".claude/workflows/plan-code-review.js"`, and `args` as real JSON: `{ "issues": [346, 353], "tag": "r3", "maxRounds": 2, "fork": true, "models": { "code": { "model": "sonnet", "effort": "medium" } } }`,
   or for `bench solo`: `{ "issues": [346, 353, 355], "base": "<sha from the bench file>", "tag": "b2", "solo": true }`.
   Leave out what wasn't given. Tell the user the run ID and the setup, then
   wait for the completion notice.

4. **Record the run** right after it completes, before anything else:
   `node tools/workflow-stats.mjs record <runId>`. The rows
   go to a local file, synced by nothing (the `tools/workflow-stats.mjs`
   header). In a cloud session, also write
   `node tools/workflow-stats.mjs export <runId>` to a file
   the user can open, send it, and tell them to run `import` on it on their
   machine. The session's transcripts it reads are cleaned up with
   old sessions. If a run was ever left unrecorded,
   `node tools/workflow-stats.mjs sweep` records every
   finished one still on disk.

5. **Report** for each issue:
   - its branch and worktree
   - the plan grade, and the code grade at the first and the last review (for
     `solo`: the grade agent's code grade and findings)
   - how many review rounds ran, and whether the loop converged or the last
     review had to fix findings itself (`self_fixed`)
   - each first-round finding with its severity, origin (plan or code) and
     outcome
   - any open decision the review raised
   - with `fork`: the copy's branch, what the first review fixed there, and the
     check's grade and open findings next to the loop's

   Then print `node tools/workflow-stats.mjs tokens` for where the tokens and the
   estimated cost went per agent, and `node tools/workflow-stats.mjs report` to put
   this run next to earlier setups. For `bench`, compare against the other
   setups in the same "bench <sha>" series and show them as one table.

   One run per setup is mostly noise: two runs of the same setup have differed
   as much as two setups have. Don't call one setup better from a single run.
   Suggest a rerun (a fresh `tag`) when a setup's choice would hang on it, and
   only call a gap real when it holds across runs and is larger than the
   grader's own spread.

6. **Don't ship on your own.** Ask which branches to finish with `/ship`. Every
   branch stays local until then. Never offer to ship a `bench` branch: it
   starts from an old commit and exists only to be measured.

## Grade

`grade` with issue numbers, or `grade bench`, runs `.claude/workflows/grade-runs.js`
instead of a build. Its header says what the grader reads and why it is
blind to the setups. Run it once several runs of the same issues are recorded:
it grades every recorded run of each issue side by side, so a later grade
covers the runs added since.

1. Check that `node tools/workflow-stats.mjs materials <n>` (with
   `--bench <sha>` for `grade bench`) lists at least two runs of each issue.
   An issue with one run has nothing to compare: say so and leave it out. A
   run's commits must still be in this clone; in a cloud session that means
   runs from this session.
2. Launch it from outside a worktree with the Workflow tool, `scriptPath:
   ".claude/workflows/grade-runs.js"`, and `args` `{ "issues": [346, 353] }`,
   plus `"base": "<sha from the bench file>"` for `grade bench`.
3. Record it the same way (`record <runId>`; `export` in a cloud session):
   its grades go to their own file next to the store.
4. Report per issue the grader's ranking and, per run, its grades and
   what the review missed or got wrong. Then print
   `node tools/workflow-stats.mjs report`: its "grader" lines sit under each
   setup, with the reviewer's code grade set against the grader's. The same
   caution holds: a single grading is one opinion.
