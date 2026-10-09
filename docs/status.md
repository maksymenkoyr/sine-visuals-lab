# Status

This file is expected to be rewritten wholesale each session — it's a snapshot,
not a history. Keep it short enough to read in one glance. Use `/wrap` to
regenerate it at session close.

_2026-10-09_

## In flight

- **Agent models and cost** — `plans/agent-models-and-cost.md`, issue #455.
  Phase 1 (honest Haiku pricing) merged in #459, with the shared run log
  (`WORKFLOW_STATS_REPO`, the private `svlab-logs` repo; #460) and the
  `blocked: "none"` fix. Runs r10–r12 compared three setups on 3 easy and 5
  mid issues: one run per setup is mostly noise. Dashboard:
  https://claude.ai/artifact/2zLK4nfv1JWGPWnEmpZaiN
- **The best branch from r10–r12 per issue, as drafts:** #461 (#347), #462
  (#358), #463 (#349), #464 (#431), #465 (#449), #467 (#357), #468 (#411),
  #469 (#356). Each lists what a human still has to check.
- **Other open PRs:** drafts #470 workflow REST, #458 issue difficulty, #451
  lean Haiku coder, #441 legal fixes, #433 worktree cleanup, #430 drives
  (#353), #403 tempo, #401 custom value stretch, #400 Echoes, #378 tuning
  check, #335 Physarum 2 sort, #236 Cast mode, #74 architecture doc; #160
  Magnet slider (ready).

## Open questions

- #468 and #401 both change how far a typed custom value reaches past a
  slider: keep one, or fold them together?
- The fixed grader for phase 5: the reviewer model, or one never used as a
  reviewer? (`plans/agent-models-and-cost.md`.)
- Skip the review on easy issues whose checks pass? (#457.)

## Next up

- Review and merge #461–#469; #356, #357 and #449 need a look by eye or a
  screen reader first, as their PRs say.
- `/handoff agent-models-and-cost` for phase 2: one doc on which model and
  effort each kind of agent work gets.
- Prune worktrees whose PRs merged.
