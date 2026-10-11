# Gather what we know about agent models, effort and token cost

Several sessions have worked out which model and effort each kind of agent work needs (planning, coding, review, sweeps) and what it costs in tokens. The findings are spread over PRs, a plan, issues, CLAUDE.md and local notes, and one of them is wrong: the workflow stats price Haiku as if it never passed 100K tokens, so Haiku looks up to 3.5× cheaper than it is. This fixes the stats, writes everything into one doc, and makes CLAUDE.md's delegation table match it. Then the next choice about models starts from all the evidence at once.

Researched 2026-10-09. Issue: #455

## Decisions

- "Gather all this stuff in one place", including loosely related research — one doc in `docs/`, linking each source rather than copying it.
- "Set recommended auto compaction": auto-compaction is back on in the user settings at its default (`autoCompactEnabled`, it had been `false`).
- "On haiku cap I think I shouldn't force it. It could affect work and it's still quite cheap too" — no Haiku compact window. Haiku may pass 100K; the stats should just price it honestly (phase 1).
- A lean Haiku agent for plan-following code: `.claude/agents/haiku-coder.md` (#451), the user's "yeah" to trying it.
- Rerun only the setups worth attention (r5's, r8's and b1's) on fresh issues, not the old benchmark again: "no don't rerun any" stopped a b3 benchmark run; the user then picked the three setups and three easy plus five mid issues (runs r10–r12, below). #199 was left out as needing people.
- Skipping the Opus review on easy issues whose checks pass is its own issue, #457, not a phase here.
- Comparisons need a fixed grader, steadier scores and the same conditions every time — the user's three additions after r10–r12 (phases 5–7), since one run per setup turned out to be mostly noise.

- The grading design, the user's points of 2026-10-09: one `grade` agent per issue that only grades, never learns which setup or models built the branch, and whose cost stays out of the setup's; the grade follows from its findings by fixed rules (a blocking finding caps it, a should-fix caps it lower), with correctness, tests, scope and docs scored apart; a script, not an agent, runs typecheck and tests and records where the agents' own reports differ; the same branch is graded twice now and then, and a gap between setups smaller than that noise counts for nothing; pinned runs leak nothing (a clean clone with no remote, prompts that override CLAUDE.md's "read origin/main and open PRs"); comparing with the real fix is asked at launch, only the grader sees it, and its result has its own field.
- From research the same day (sources in the Evidence below), the measurements the grade rests on: the real fix's tests run on the branch (SWE-bench's fail-to-pass and pass-to-pass), mutation testing for test strength instead of one revert, a blind side-by-side judgement between setups instead of a score per branch, and repeated runs with ranges instead of one run per setup.
- Every branch is graded twice, always, and a disagreement between the two points at the grading, not the code — the user's call on 2026-10-09, in place of grading twice only now and then.
- Issues whose fix has no tests to run (a scene's look, a shader) stay out of the bench for now — the user's call on 2026-10-09, so every bench issue can be graded by its real fix's tests.
- "It would make sense to extract this in separate project" — the workflow, the recorder and the bench move to their own repo (phase 8); this repo becomes the first project it measures.
- 2026-10-10, reversed: "whole system should exist within this project" — the harness came back into this repo at its old paths, from workflow-arena's latest commit, so a run needs no clone at session start and auto mode doesn't block it as outside code. Phase 8 is undone; split it out again only when a second project needs it.
- The new repo is `workflow-arena`, public, under AGPL-3.0-or-later, so any copy or hosted version stays open ("enforcing open source"); the run log stays private, in a local file: after a couple more cloud runs the owner runs it locally, so cloud rows come over by hand (`export`, then `import`), and a shared database waits until the project is published — the user's calls on 2026-10-09. The harness runs beside this repo and is never bundled into its client, so CLAUDE.md's no-GPL rule for dependencies doesn't touch it.

## Prototypes

Plan-Code-Review Model Trials: every run so far, per issue, easy against mid, and cost per stage. Its data files are uploaded in the dashboard; add a run by uploading a new file and pointing the dataset at it.
https://claude.ai/artifact/2zLK4nfv1JWGPWnEmpZaiN

Raw rows are in the owner's `~/.claude/workflow-stats/runs.jsonl` (`npm run workflow-stats -- report`). r10–r12 ran in a cloud session; their rows were handed over as a file to append there.

## Evidence (2026-10-09, this session)

- Haiku 5.5 bills a request at a higher per-token rate once its prompt passes 100K tokens (claude-api skill pricing; current rates on the pricing page).
- Recorded `/plan-code-review` Haiku code stages at xhigh peaked at 107–172K tokens. Repriced request by request with the over-100K tier, Haiku cost per run was 1.8× (r8) to 3.5× (r6) what the stats recorded: r6 $1.26 vs $0.36, r8 $0.36 vs $0.20, for three issues each.
- Per issue, the Haiku code stage at xhigh made 34–115 requests, re-read 2.5–12.8M tokens of cached context, wrote 90–170K new context and ~9–37K output (output is a floor; transcripts undercount it). Re-reading is almost all of its cost.
- Auto-compaction off means no window setting works: Haiku agents grew to 270K in tests with every window setting tried.
- With compaction on, a Haiku `autoCompactWindow` of 100000 compacted at ~65–77K (peak request 72K); 120000 compacted at 88–99K (peak request 90K). Neither let a request pass 100K. Claude Code keeps a ~30K buffer under the window. The setting reaches subagents, including Haiku subagents spawned by an Opus session.
- `haiku-coder` (body replaces Claude Code's system prompt, `omitClaudeMd: true`, six tools) started at 5K tokens on a small task; a general-purpose Haiku agent with the same task started at 19K. Workflow agents also carry their prompt (the plan), which stays.
- Anthropic's guidance (claude-api skill, cached 2026-10-06): Sonnet 5.5 at medium is the starting point for agentic coding; Opus 5.5 at its default medium matched Opus 5 at high on coding and catches more bugs in review with fewer false alarms; Haiku 5.5 is for sub-agent and high-volume work, "not long agentic loops"; sweep effort before switching to a cheaper model; a planner plus workers paid off only when there was bulk to hand out; judge cost per finished task; review prompts that say "only high-severity" hide real bugs.

## Evidence (2026-10-09, runs r10–r12)

Three setups ran in parallel on the same eight issues from `origin/main` `8a1fecb`: easy #349, #356, #431; mid #347, #357, #358, #411, #449. Grades are points out of 4 (A = 4, A- = 3.7, B+ = 3.3). Costs are with phase 1's Haiku repricing.

| Run | Setup | Ready | Code grade, first → last review | $/issue | Easy: grade / $ | Mid: grade / $ |
|---|---|---|---|---|---|---|
| r10 | Opus/medium plans, Haiku/xhigh codes, Opus/high reviews, up to 2 correction rounds | 7/8 | 3.72 → 3.67 | 2.16 | 3.67 / 1.63 | 3.68 / 2.47 |
| r11 | r10 plus the Opus-fix fork | 7/8 | 3.89 → 3.84 | 2.38 | 3.90 / 1.86 | 3.80 / 2.69 |
| r12 | r10 with Sonnet/high planning | 7/8 | 3.74 → 3.74 | 2.09 | 3.70 / 1.84 | 3.76 / 2.24 |

- r10 and r11 are the same setup until after the first review (the fork only acts after it), yet their first-review code grades differ by 0.17: that is the noise of one run, as large as most gaps between setups recorded before. Rankings from single runs aren't evidence yet.
- Repriced, the Haiku code stage cost $0.39–0.45 per issue, about four times what was recorded ($0.10–0.11). It is still the cheapest stage; the Opus review stays the largest.
- Fork, mean over the issues whose first review had findings: the reviewer fixing them itself cost $0.19 plus a $0.58 check and left nothing open; the correction loop cost $0.23 and left 0.5 findings open.
- Mid issues cost about 1.4× easy ones, with grades about the same.
- A Sonnet planner (r12) graded about the same as Opus planners (r10, r11) and cost less to plan; its fix rounds cost more, since Haiku fixed more. Within the noise above, the planner model made no visible difference.
- r12 #356 was the third branch stopped by `blocked: "none"`; its review also found a real bug (one-keyframe animations throw on the Chromium versions `vite.config.ts` targets).
- Two of the three not-ready branches were the workflow's fault: a fix agent answered `blocked: "none"` and the loop stopped before the last review could fix what was left (r10 #349, r11 #347). A third review wrote ordinary notes about slow tests into `blocked`. Fixed with phase 1 (`wasBlocked`).
- Running three workflows at once put the container at load ~21 on 4 cores; timing-only tests failed in every run and durations are not comparable with earlier runs.

## Evidence (2026-10-09, grading research)

- SWE-bench grades a patch by the real fix's tests: the ones that failed before the fix must pass, and the ones that passed must keep passing. It is objective but misses fixes that take another route, and about half of SWE-bench's annotations needed re-parsing ([UTBoost](https://arxiv.org/html/2506.09289v1), [explainer](https://qaskills.sh/blog/swe-bench-explained-guide-2026)).
- Mutation testing (StrykerJS, Apache-2.0) counts how many small breaks in the changed code the tests catch; AI-written suites reach high coverage while catching few ([guide](https://www.augmentcode.com/guides/mutation-testing-ai-generated-code)).
- A model judge is steadier choosing between two answers (shown in both orders, against position bias) than scoring one alone, and steadier on coarse yes/no questions than on fine scales ([survey](https://arxiv.org/pdf/2411.15594), [Wolfe](https://cameronrwolfe.substack.com/p/llm-as-a-judge), [LangChain](https://www.langchain.com/resources/llm-as-a-judge)).
- Run-to-run spread of one agent setup can exceed the gap between setups; with three runs per setup, one study picked the weaker setup 28–44% of the time ([summary](https://github.com/jjakimoto/research-issues/issues/1854), [paper](https://arxiv.org/html/2609.33812v1)). Mostly preprints; none measured a setup like this one.

## Rejected

- A Haiku compact window (`modelSettings` `autoCompactWindow` 100000 or 120000) — the user's call above. It worked in tests, but compaction mid-task summarizes the plan Haiku is following, and the money saved is small.
- A hook that stops Haiku near 100K — hooks don't receive the model or token use, and stopping mid-change leaves work for a fix round.

- A letter grade on the US school scale (A = 4) and a 100-point score built from fixed deductions — the user didn't like either; per-part yes/no checks and the measurements above replace them.

## Open questions

- Should the `/plan-code-review` code stage run as `agentType: 'haiku-coder'`, with the repo rules it needs written into the plan? — blocks phase 4
- Which model and effort is the fixed grader: solo mode's (the reviewer model) or one never used as a reviewer, so no setup grades itself? — blocks phase 5
- How many runs per setup, and how many bench issues, before a comparison counts? The two graders' disagreement sets the floor. — blocks phase 7

## Phases

Each phase is one build session and one PR.

Phase 8 was built first, on 2026-10-09, and undone on 2026-10-10 (see Decisions): the workflow, `/plan-code-review` and the recorder are back at the paths phases 4–7 name, and the bench is `tools/plan-code-review-bench.json` again.

- [x] **1. `npm run workflow-stats -- report` shows Haiku's real cost, over-100K requests included** — PR #459
  - Touches: `tools/workflowStatsLib.mjs` (`PRICES`, `transcriptStats`, the cost sum), `tools/workflow-stats.mjs`, their tests
  - Read first: the `tools/workflowStatsLib.mjs` header; the claude-api skill's Haiku 5.5 pricing (both rate cards)
  - Done when: `transcriptStats` splits tokens from requests over 100K and the cost prices them at the higher card; a test with a fixture over 100K fails without the split; re-recording the existing runs (`sweep`) shows r6's Haiku cost near $1.26 rather than $0.36; `npm run typecheck` and `npm run test` pass

- [ ] **2. One doc says which model and effort each kind of agent work gets, and why**
  - Touches: new `docs/agent-models.md`, `docs/index.md`
  - Read first: this plan's Evidence; `plans/multi-model-flow.md`; #429, #444, #447, #451; CLAUDE.md's delegation table; `docs/issue-labels.md`
  - Done when: the doc covers planning, coding, review and sweeps, Haiku's 100K line and why it isn't capped, the lean agent, and the cost-per-finished-task rule, each linking its source; numbers stay in dated notes, per CLAUDE.md

- [ ] **3. CLAUDE.md's delegation table matches the doc**
  - Touches: `CLAUDE.md`, `AGENTS.md` (two separate copies; edit shared rules in both), `docs/issue-labels.md`
  - Read first: `docs/agent-models.md` from phase 2
  - Done when: the table names `haiku-coder` for spelled-out edits, every row agrees with the doc, and both files say the same thing

- [ ] **4. `/plan-code-review` codes with the lean Haiku agent, and a bench run shows whether it holds up**
  - Touches: `.claude/workflows/plan-code-review.js` (the code and fix stages), `.claude/commands/plan-code-review.md`
  - Read first: the workflow's header; `plans/multi-model-flow.md`; `.claude/agents/haiku-coder.md`
  - Done when: the open question is answered; `/plan-code-review bench` with the lean coder is recorded next to r8 in `npm run workflow-stats -- report`, with its grade and cost

- [ ] **5. Every setup is graded by the same blind grader, by fixed rules**
  - Touches: `.claude/workflows/plan-code-review.js` (a `grade` agent after the last review in every mode, as solo mode has), `tools/workflowStatsLib.mjs` (grades from that agent; its cost kept out of the setup's, as solo's is)
  - Read first: the workflow header's solo and `base` sections; `buildRows` and `gradeCost` in `tools/workflowStatsLib.mjs`
  - Blind: the grader sees the issue's title and body and a diff with no branch name, tag, commit messages or trailers, and nothing about the setup. The grader works in its own clone with the diff applied as one commit on a neutral branch, so the worktree path, the git log and the branch list name no setup either. A pinned run's clone has no remote; its prompt overrides CLAUDE.md's rule to read origin/main and open PRs.
  - Rules: the grader answers yes/no questions per part (correctness, tests, scope, docs) and lists findings by severity, with "blocking" and "should-fix" defined in its prompt. The workflow, not the grader, turns those into the grade: any blocking finding caps it, any should-fix caps it lower.
  - Done when: each issue gets one `grade` agent with the same model, effort and prompt whatever the setup; the report shows its part scores and findings beside the reviewer's grade

- [ ] **6. A script measures what can be checked, beside the grader**
  - Touches: a new script under `tools/` the workflow runs after the last review, `tools/plan-code-review-bench.json` (the reference PR per issue), `.claude/commands/plan-code-review.md`
  - Read first: the `tools/workflow-stats.mjs` header; StrykerJS's docs on running only changed files
  - Checks: typecheck and tests on the base and on the branch, so a test that also fails on the base doesn't count; where the agents' own `typecheck_passed` and `tests_passed` differ from that; the reference fix's tests run on the branch (fail-to-pass and pass-to-pass) when the bench names a reference PR; a mutation score of the new tests on the changed files (StrykerJS as a dev dependency).
  - Reference fix: asked at launch; only the grader and the script see it, and its result goes in its own field, apart from the grade.
  - Bench issues: only ones whose real fix has tests; a look or shader issue stays out.
  - Done when: a bench run records each check per issue; a test that passes with the fix reverted shows as a surviving mutant; the report gives these counts per setup next to the grades

- [ ] **7. Comparisons say how much is noise**
  - Touches: `.claude/workflows/plan-code-review.js` (a side-by-side judge), `tools/workflowStatsLib.mjs` (`summarize`, `renderReport`), `.claude/commands/plan-code-review.md`, `tools/workflow-stats.mjs`
  - Read first: this plan's grading research; the `/plan-code-review` rule on repeats
  - Side by side: for the same issue under two setups, the grader is shown both diffs unlabelled, in both orders, and says which is better; the report counts wins, ties and losses per pair of setups.
  - Noise: every branch is graded twice, by two grader agents that don't see each other. Where the two disagree, the report flags that issue's grading as the problem to look at, not the setup. Across runs, the report shows each setup as a range and marks any gap smaller than the graders' disagreement.
  - Same conditions: one workflow at a time (the command refuses to start beside another), each row records the machine's load, and the report marks rows taken under load.
  - Done when: the report shows ranges, the grader's measured spread and win/tie/loss counts, and says plainly when two setups can't be told apart

- [ ] **8. The harness lives in its own repo** — built 2026-10-09 (workflow-arena's first commit), undone 2026-10-10; redo only when a second project needs it
  - Touches: a new repo holding the workflow, `/plan-code-review`, the recorder, the grader, the script checks and the bench; here, what's left is a pointer and this repo's bench entry
  - Read first: this plan's Decisions on the new repo; `CONTRIBUTING.md` on licences
  - Done when: the new repo runs a bench against this repo at its pinned commit and records rows as before; this repo keeps no copy of the harness

## Learned while building
- 2026-10-09, phase 1, PR #459: rows record `longTokens` next to `tokens`; older rows have none and keep their short-card cost until re-recorded from transcripts. Re-recorded, Haiku's code stage at xhigh cost $0.39–0.57 per issue on r10–r12.
