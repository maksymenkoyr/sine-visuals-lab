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
- **Other open PRs:** #481, #479 and #463 (three `GLProgram.setI` builds of
  #349 from the model trials), #471 status and agent trials (also edits this
  file), the r10–r12 batch #461–#469, #458 issue difficulty, #441 legal
  fixes, #433 worktree pruning, #430 drives hot path, #403 tempo, #401 custom
  slider value, #400 Echoes, #378 real-song tuning, #335 Physarum 2, #236
  Cast mode, #160 Magnet slider, #74 architecture doc.

## Open questions

- Which of the three `GLProgram.setI` PRs to keep; the other two close.
- The handoff review stage's cost window runs from the coder's finish to
  `handoff-ship`, so it also counts `/ship`'s first steps. Good enough, or
  should it stop earlier? The first real handoff after #486 will show.

## Next up

- Merge #486, then judge the first handoffs by `workflow-stats handoffs`.
- Resolve the `docs/status.md` overlap between #471 and this PR.
- The main checkout's `node_modules` predates #464 and lacks `jscpd`, so
  `npm run check` fails every step there and in worktrees that link it; run
  `npm ci` in the main checkout.
- 153 worktrees are on disk; #433's pruning would clear the merged ones.
