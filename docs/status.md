# Status

This file is expected to be rewritten wholesale each session — it's a snapshot,
not a history. Keep it short enough to read in one glance. Use `/wrap` to
regenerate it at session close.

_2026-10-12_

## In flight

- **Haiku handoff rule** — draft #486. A session hands a change to
  `haiku-coder` when asked, or unasked only when it's plainly large and
  mechanical; when unsure it suggests one instead of weighing it. Replaces
  "the plan would be half the change or less". Why: the last 100 merged PRs
  add a median of ~11K characters, so for most changes an Opus plan costs
  more than Opus writing the change.
- **Landed today:** #487 records the planner's check of a coder's diff as a
  review stage in the handoff stats (cost and lines fixed), and #488 limits
  the Chladni bake test against a same-machine yardstick instead of a fixed
  600 ms, after that test flaked on a slow CI runner.
- **Agent models and cost** — `plans/agent-models-and-cost.md`, issue #455.
  Phase 1 (honest Haiku pricing) merged in #459, with the shared run log
  (`WORKFLOW_STATS_REPO`, the private `svlab-logs` repo; #460) and the
  `blocked: "none"` fix. Runs r10–r12 compared three setups on 3 easy and 5
  mid issues: one run per setup is mostly noise. Dashboard:
  https://claude.ai/artifact/2zLK4nfv1JWGPWnEmpZaiN
- **The best branch from r10–r12 per issue, as drafts:** #461 (#347), #462
  (#358), #463 (#349), #464 (#431), #465 (#449), #467 (#357), #468 (#411),
  #469 (#356). Each lists what a human still has to check.
- **Other open PRs:** #481 and #479 (more `GLProgram.setI` builds of #349,
  alongside #463), #471 status and agent trials (also edits this file), #470
  workflow REST, #458 issue difficulty, #451 lean Haiku coder, #441 legal
  fixes, #433 worktree pruning, #430 drives hot path (#353), #403 tempo, #401
  custom slider value, #400 Echoes, #378 real-song tuning, #335 Physarum 2,
  #236 Cast mode, #160 Magnet slider (ready), #74 architecture doc.

## Open questions

- Which of the three `GLProgram.setI` PRs (#463, #479, #481) to keep; the
  other two close.
- #468 and #401 both change how far a typed custom value reaches past a
  slider: keep one, or fold them together?
- The fixed grader for phase 5: the reviewer model, or one never used as a
  reviewer? (`plans/agent-models-and-cost.md`.)
- Skip the review on easy issues whose checks pass? (#457.)
- The handoff review stage's cost window runs from the coder's finish to
  `handoff-ship`, so it also counts `/ship`'s first steps. Good enough, or
  should it stop earlier? The first real handoff after #486 will show.

## Next up

- Merge #486, then judge the first handoffs by `workflow-stats handoffs`.
- Review and merge #461–#469; #356, #357 and #449 need a look by eye or a
  screen reader first, as their PRs say.
- `/handoff agent-models-and-cost` for phase 2: one doc on which model and
  effort each kind of agent work gets.
- Resolve the `docs/status.md` overlap between #471 and this PR.
- The main checkout's `node_modules` predates #464 and lacks `jscpd`, so
  `npm run check` fails every step there and in worktrees that link it; run
  `npm ci` in the main checkout.
- 153 worktrees are on disk; #433's pruning would clear the merged ones.
