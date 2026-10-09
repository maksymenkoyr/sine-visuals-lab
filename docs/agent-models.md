# Agent models and effort

Which model and effort each kind of agent work gets, why, and what it costs.
The delegation table in [`CLAUDE.md`](../CLAUDE.md) is the short rule a session
follows; this note is the evidence behind it, gathered in one place so the next
choice about models starts from all of it. Numbers live only in the dated notes
at the end; the rest names where they come from.

## The rules that hold whatever the model

- **Judge cost per finished task, not per token.** A cheap stage that leaves a
  bug for a later round, or a review that misses one, costs more than its
  tokens. Opus alone on a medium issue cost about half the pipeline and left
  a real bug the pipeline fixed (r9, below).
- **Sweep effort before switching to a cheaper model.** Anthropic's guidance
  for its current models; it is also how the Haiku code stage got to xhigh.
- **One run is noise.** Two runs of the same setup on the same issues graded
  as far apart as most setups did from each other (r10 and r11, below). No
  ranking from a single run is evidence yet: comparisons wait on a fixed
  grader, checkable counts and the same conditions every time (phases 5–7 of
  [`plans/agent-models-and-cost.md`](../plans/agent-models-and-cost.md)).
- **Review prompts don't say "only high-severity".** Anthropic's guidance: it
  hides real bugs. `/plan-code-review`'s reviewer grades every finding by
  severity instead.

## Planning

Opus at medium effort writes the plan in `/plan-code-review` (`DEFAULT_MODELS`
in `.claude/workflows/plan-code-review.js`). The user's call: one strong model
for plan and review, since Opus plans graded above Sonnet's on the first
issue set ([`plans/multi-model-flow.md`](../plans/multi-model-flow.md)). On
the second set a Sonnet planner (r12) graded about the same and cost less to
plan, within the noise above, so the planner model is not settled.

## Coding from a plan

Haiku at xhigh effort codes and makes the correction-round fixes in
`/plan-code-review` (`DEFAULT_MODELS`), the user's call: xhigh gave better
first code than medium and stayed the cheapest stage. Two cautions:

- Anthropic places Haiku at sub-agent and high-volume work, "not long agentic
  loops", and names Sonnet at medium as the starting point for agentic coding.
  A plan written for a smaller model to follow mechanically is what makes
  Haiku work here; outside the workflow, `CLAUDE.md` sends plan-following to
  Sonnet.
- Haiku is priced at a higher rate once a request's prompt passes its
  long-prompt line, and its code stage at xhigh passes it. Re-reading cached
  context is almost all of that stage's cost. `npm run workflow-stats --
  report` prices it honestly since PR #459 (`PRICES` and `transcriptStats` in
  `tools/workflowStatsLib.mjs`).

Haiku is not held under that line, the user's call: "I shouldn't force it. It
could affect work and it's still quite cheap too." A Haiku compact window
(`modelSettings` `autoCompactWindow`) did keep requests under it in tests, but
compacting mid-task summarizes the plan Haiku is following, for little money.
A hook can't do it either: hooks see neither the model nor token use.
Auto-compaction itself stays on at its default; with it off, no window
setting works.

A lean Haiku agent, `.claude/agents/haiku-coder.md` (draft PR #451), starts
from a much smaller context: its body replaces Claude Code's system prompt,
it skips `CLAUDE.md` and loads only the tools it needs. Whether the workflow's
code stage should use it, with the repo rules it needs written into the plan,
is phase 4 of the plan.

## Coding without a plan

`/plan-code-review <n> solo` runs one agent (Opus at medium, `models.solo`)
with no plan and no review, graded afterwards by the reviewer model. It is the
cheapest way to a branch and the riskiest; whether easy issues whose checks
pass can skip the Opus review is its own issue, #457.

## Review

Opus at high effort reviews (`DEFAULT_MODELS`), and it is the largest stage in
every run. Anthropic reports Opus 5.5 catching more bugs in review, with fewer
false alarms, than the Opus before it. One run
reviewed with Sonnet at xhigh (b2) and stalled a fix round; one run is not
enough to say more.

When the first review has findings, two ways to act on them were compared on
the same findings (`fork`): the reviewer fixing them itself, then a check, or
the correction loop. In r11 the reviewer's own fixes cost less than a
correction round and left nothing open, though grading its copy took one more
Opus agent; earlier fork runs left nits open that the loop fixed. Still one
run per arm.

## Sweeps, lookups and spelled-out edits

Finding files, sweeping greps, listing call sites, reading logs and edits
spelled out exactly go to Haiku at low effort (`CLAUDE.md`'s table). Short,
bounded tasks are what Anthropic places Haiku at, and they stay far from its
long-prompt line. A general-purpose Haiku agent starts with Claude Code's whole
system prompt and `CLAUDE.md`; `haiku-coder` is the lean alternative.

A stopped rebase goes to `npm run fix-conflicts` (PR #444): a separate
headless process, Sonnet by default (`FIX_CONFLICTS_MODEL` in
`tools/fix-conflicts.sh`), so an expensive session never re-reads its context
for that.

## Measuring a setup

`/plan-code-review` runs are recorded with `npm run workflow-stats -- record`
or `sweep`, and `report` sums them per setup (the `tools/workflowStatsLib.mjs`
header). The rows live in the owner's `~/.claude/workflow-stats/runs.jsonl`.
Every run so far, per issue and per stage with each stage's model and effort,
is in the trials dashboard:

https://claude.ai/artifact/2zLK4nfv1JWGPWnEmpZaiN

## Dated notes

### 2026-10-08, first issue set (#346, #353, #355)

From [`plans/multi-model-flow.md`](../plans/multi-model-flow.md) and PR #429,
as recorded then (Haiku at the short-prompt rate):

| Setup | $/issue | Plan | Code, first → last review |
|---|---|---|---|
| Sonnet high plan, Haiku xhigh code, Opus high review (r6) | 1.49 | 3.57 | 3.70 → 3.57 |
| Opus medium plan, Haiku xhigh code, Opus high review (r8) | 1.59 | 3.80 | 3.80 → 3.80 |
| Opus medium alone (r9) | 0.85 | – | A-, A-, B by hand; left a real bug on #346 |

Haiku xhigh first code graded 3.70 against 3.43 at medium. Fork runs (r7,
r8): the reviewer fixing its own findings cost about half the loop for the
same grade, but left nits open.

### 2026-10-09, Haiku's long-prompt rate and compaction

From [`plans/agent-models-and-cost.md`](../plans/agent-models-and-cost.md):

- Haiku 5.5's long-prompt line is 100K tokens. Its xhigh code stages peaked at
  107–172K. Repriced request by request, Haiku cost per run was 1.8× (r8) to
  3.5× (r6) what was recorded: r6 $1.26 against $0.36, r8 $0.36 against $0.20.
- Per issue, that stage made 34–115 requests and re-read 2.5–12.8M cached
  tokens, against 90–170K written and ~9–37K output (a floor).
- With compaction on, a Haiku `autoCompactWindow` of 100000 compacted at
  ~65–77K and 120000 at 88–99K; neither let a request pass 100K. With
  compaction off, agents grew to 270K whatever the window.
- `haiku-coder` started at 5K tokens on a small task; a general-purpose Haiku
  agent at 19K.
- Anthropic's guidance quoted above is from the claude-api skill, cached
  2026-10-06.
- `npm run fix-conflicts` resolved a test conflict for about $0.05 in 6 turns
  (PR #444).

### 2026-10-09, second issue set (r10–r12)

Easy #349, #356, #431; mid #347, #357, #358, #411, #449, from `8a1fecb`, three
workflows at once (so durations aren't comparable). Haiku repriced.

| Run | Setup | Ready | Code, first → last review | $/issue |
|---|---|---|---|---|
| r10 | Opus medium plan, Haiku xhigh code, Opus high review | 7/8 | 3.72 → 3.67 | 2.16 |
| r11 | r10 plus the fork | 7/8 | 3.89 → 3.84 | 2.38 |
| r12 | r10 with Sonnet high planning | 7/8 | 3.74 → 3.74 | 2.09 |

- r10 and r11 are the same setup up to the first review, yet differ by 0.17
  there: the noise of one run.
- The Haiku code stage cost $0.39–0.57 per issue repriced, about four times
  what was recorded; the Opus review stayed the largest stage.
- Fork in r11, over issues with first-review findings: reviewer fixes $0.19
  plus a $0.58 check, nothing left open; correction loop $0.23, 0.5 findings
  left open.
- Mid issues cost about 1.4× easy ones, with grades about the same.
