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

## Rejected

- A Haiku compact window (`modelSettings` `autoCompactWindow` 100000 or 120000) — the user's call above. It worked in tests, but compaction mid-task summarizes the plan Haiku is following, and the money saved is small.
- A hook that stops Haiku near 100K — hooks don't receive the model or token use, and stopping mid-change leaves work for a fix round.

## Open questions

- Should the `/plan-code-review` code stage run as `agentType: 'haiku-coder'`, with the repo rules it needs written into the plan? — blocks phase 4
- Which model and effort is the fixed grader: solo mode's (the reviewer model) or one never used as a reviewer, so no setup grades itself? — blocks phase 5

## Phases

Each phase is one build session and one PR.

- [x] **1. `npm run workflow-stats -- report` shows Haiku's real cost, over-100K requests included** — PR #459
  - Touches: `tools/workflowStatsLib.mjs` (`PRICES`, `transcriptStats`, the cost sum), `tools/workflow-stats.mjs`, their tests
  - Read first: the `tools/workflowStatsLib.mjs` header; the claude-api skill's Haiku 5.5 pricing (both rate cards)
  - Done when: `transcriptStats` splits tokens from requests over 100K and the cost prices them at the higher card; a test with a fixture over 100K fails without the split; re-recording the existing runs (`sweep`) shows r6's Haiku cost near $1.26 rather than $0.36; `npm run typecheck` and `npm run test` pass

- [x] **2. One doc says which model and effort each kind of agent work gets, and why** — PR #466
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

- [ ] **5. Every setup is graded by the same fixed grader**
  - Touches: `.claude/workflows/plan-code-review.js` (a `grade` agent after the last review in every mode, as solo mode has), `tools/workflowStatsLib.mjs` (grades from that agent; its cost kept out of the setup's, as solo's is)
  - Read first: the workflow header's solo section; `buildRows` and `gradeCost` in `tools/workflowStatsLib.mjs`
  - Done when: each issue gets one `grade` agent with the same model, effort and prompt whatever the setup; the report shows its grade beside the reviewer's; grading one branch twice is recorded, so the report can say how much the grader alone moves

- [ ] **6. The report shows checkable counts beside the letter grades**
  - Touches: `tools/workflowStatsLib.mjs` (`summarize`, `renderReport`), `tools/workflow-stats.mjs` (the `gh` merge check)
  - Read first: the `tools/workflow-stats.mjs` header on how `report` asks `gh` about merges
  - Done when: per setup the report gives tests passing, blocking findings, correction rounds, and the share of PRs merged with no change after review; letter grades stay, but no longer stand alone

- [ ] **7. Setups are compared under the same conditions**
  - Touches: `.claude/commands/plan-code-review.md`, `tools/workflow-stats.mjs`
  - Read first: `tools/plan-code-review-bench.json`; the workflow header on `base`
  - Done when: a comparison pins its commit as the benchmark does and runs one setup at a time (the command refuses to start beside another running workflow); each row records the machine's load, and the report marks rows taken under load

## Learned while building
- 2026-10-09, phase 1, PR #459: rows record `longTokens` next to `tokens`; older rows have none and keep their short-card cost until re-recorded from transcripts. Re-recorded, Haiku's code stage at xhigh cost $0.39–0.57 per issue on r10–r12.
- 2026-10-09, phase 2, PR #466: `docs/agent-models.md` keeps every number in its dated notes, so phase 3 can align `CLAUDE.md` with the doc's sections without copying figures. Where they differ today: the doc records Haiku at xhigh coding inside `/plan-code-review`, while `CLAUDE.md` sends plan-following to Sonnet at medium outside it; `haiku-coder` is still draft PR #451, so phase 3 should name it only once that merges. The trials dashboard's cost-per-stage tooltip now shows each stage's model and effort.
