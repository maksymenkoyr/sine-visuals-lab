# Build issues with Opus planning and reviewing and Haiku coding, and keep its stats

Across the trial runs of 2026-10-08, the best results for the cost came from one setup: Opus at medium effort writes the plan, Haiku at xhigh codes it and makes the fixes, and Opus at high effort reviews and sends findings back for correction rounds. This plan makes that the everyday way a medium-difficulty GitHub issue gets built, not only an experiment. Every run in everyday use also lands in the stats store on its own, so the setup keeps being measured on real issues, and the merged PRs show whether its work holds up.

Researched 2026-10-08. Issue: #447

## Decisions

- "For mid diff issues Opus medium + Haiku xhigh would be the best combination" — the user's conclusion from all the runs below. The measured setup includes the Opus high review and its correction rounds; it is `/plan-code-review`'s default (`DEFAULT_MODELS` in `.claude/workflows/plan-code-review.js`).
- "It makes no sense to have a different model for review and plan" — so Opus plans as well as reviews, instead of Sonnet planning. It beat Sonnet plans on grade (3.80 vs 3.57–3.70) for about $0.10 more per issue.
- Haiku codes and fixes at xhigh effort — the user's call. On the runs, xhigh gave better first code than medium (3.70 vs 3.43) and still cost about $0.06–0.12 per issue.
- "We don't do fixing loops. Opus reviews once and fixes once and it's done" (2026-10-10) — workflow version 8 runs no correction round by default; `rounds=N` brings the loop back.
- A grading agent rates every run of the same issue side by side: plan, code, review and final code (2026-10-10). Opus at high effort, since grading the review means verifying its findings; it sees run IDs, never the models. `/plan-code-review grade`, `.claude/workflows/grade-runs.js`.
- "It should save stats when I'm just using it in the normal flow" — every everyday run gets recorded without anyone typing `record`, not only the experiments.
- "I'll adopt this model eventually" — the user picks when. A build session starts only when the user types `/handoff multi-model-flow`.

Evidence, from `npm run workflow-stats -- report` (A = 4; estimated API-list-price cost):

| Setup | $/issue | Plan | Code (first → last review) |
|---|---|---|---|
| Sonnet high plan, Haiku xhigh code, Opus high review (r6) | $1.49 | 3.57 | 3.70 → 3.57 |
| Opus medium plan, Haiku xhigh code, Opus high review (r8) | $1.59 | 3.80 | 3.80 → 3.80 |
| Opus medium alone, no plan or review (r9) | $0.85 | – | A-, A-, B by hand; left a real bug on #346 |

All of these ran on the same three issues (#346, #353, #355), so the margins are a small sample.

## Prototypes

None. The evidence is the recorded runs in `~/.claude/workflow-stats/runs.jsonl`, read with `npm run workflow-stats -- report`.

## Rejected

- Sonnet planning — Opus medium plans graded higher, and the user wants one strong model for plan and review.
- A cheaper model for the re-reviews — the user declined it on 2026-10-08.
- Opus alone for medium issues (r9) — half the cost, but on #346 it left a bug the pipeline fixed: a scene that throws during a crossfade or held effect turns effects and crossfades off for the session. The pipeline's extra $0.74 per issue bought that fix.

## Open questions

- When the user asks to build an issue in plain words ("fix #412"), should the session route it through `/plan-code-review` on its own, or only when the user types the command? — blocks phase 2
- Which issues count as medium difficulty, and do easy ones go to Opus alone (`/plan-code-review <n> solo`, about $0.85 per issue)? — blocks phase 2
- Should nits go to a fix round when one runs anyway, and should a user-visible bug always count as should-fix? Raised after r6, where a real crossfade bug was filed as a nit and left unfixed. — doesn't block

## Phases

Each phase is one build session and one PR. PR #429 (the workflow, `/plan-code-review` with `bench` and `solo`, and `tools/workflow-stats.mjs` with `sweep`) must be merged before phase 1.

- [ ] **1. Every finished `/plan-code-review` run shows up in `npm run workflow-stats -- report` without anyone recording it**
  - Touches: `.claude/hooks/session-start.sh` (call `node tools/workflow-stats.mjs sweep` and print one line only when it recorded a run), `tools/workflow-stats.mjs` (a quiet mode for `sweep` that prints nothing when there's nothing new, and never fails the hook), `.claude/commands/plan-code-review.md` step 4 (the hook is the backstop; recording right after a run stays the first choice).
  - Read first: the `tools/workflow-stats.mjs` and `tools/workflowStatsLib.mjs` headers, the `.claude/hooks/session-start.sh` header, and draft PR #433, which changes the same hook to prune merged worktrees (whichever lands second rebases onto the other).
  - Also check: how long Claude Code keeps session transcripts (`cleanupPeriodDays` in the settings). `sweep` can only record a run while its transcripts are on disk, so say in the header how long that is.
  - Done when: a run completed and left unrecorded shows up after the next session starts; a session start with nothing new prints nothing extra and stays inside the hook's timeout; `npm run typecheck` and `npm test` pass.

- [ ] **2. Asking Claude to build a medium-difficulty issue runs it through Opus plan → Haiku code → Opus review, and its PR lands in the stats**
  - Touches: `CLAUDE.md` and `AGENTS.md` (two self-contained copies; edit the rule in both) — the delegation table and a line on when a GitHub issue goes through `/plan-code-review`; `.claude/commands/plan-code-review.md` (the everyday path: default setup, no fork, a tag like `r<N>`, then `/ship` the branches the user picks).
  - Read first: the `.claude/workflows/plan-code-review.js` header, `.claude/commands/plan-code-review.md`, and both answers to the open questions above.
  - Done when: one real issue goes through the everyday path end to end, its row appears in `npm run workflow-stats -- report` under the default setup (no `bench`, no `fork`), and once its PR merges, the report's merged count includes it.

## Learned while building
