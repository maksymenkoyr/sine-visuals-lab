# Status

This file is expected to be rewritten wholesale each session — it's a snapshot,
not a history. Keep it short enough to read in one glance. Use `/wrap` to
regenerate it at session close.

_2026-10-10_

## In flight

- **Solo grader and ship states** — draft #477. The solo grade agent now sets
  `ship_state` by a rule (ready, ready-with-fixes, not-ready) and reruns a
  failing command once. A solo run also runs a full review agent for the
  record, kept out of the setup's cost (`metaReview`). Workflow version 10.
  Not run yet in this form: the reruns r17 and r18 used version 9.
- **Plan-code-review runs artifact** — `claude.ai/artifact/MYnzRGHahpjR9xbzUtmMSS`,
  30 builds (r13–r18) with insights. The r16 "not ready" calls were the
  grader's judgment, not a broken tool; 7 of 12 Opus/high builds without a
  review still ended with an open should-fix.
- **Other open PRs:** #476 CLAUDE.md read-first list, #471 status and agent
  trials (also edits this file), the r10–r12 batch #461–#469, #458 issue
  difficulty, #451 lean Haiku coder, #441 legal fixes, #433 worktree pruning,
  #403 tempo, #401 custom slider value, #400 Echoes, #378 real-song tuning,
  #335 Physarum 2, #236 Cast mode, #160 Magnet slider, #74 architecture doc.

## Open questions

- Should the benchmark rows (r13–r18, issues #347, #349, #356, pinned to
  8a1fecb) become a bench file next to the older one in
  `tools/plan-code-review-bench.json`? Today they were passed as arguments.
- Is the blind side-by-side grader (`/plan-code-review grade`) worth running
  on r13–r18 to confirm the reviewed branches hold up?

## Next up

- Merge #477, then rerun Opus/high solo once on version 10 to see the
  ready-with-fixes state and what the record-only review fixes.
- Resolve the `docs/status.md` overlap between #471 and this PR when the
  second one merges.
- The `fflate` package is missing from the local install (typecheck fails on
  `src/render/sceneLooks.ts`); `npm ci` fixes it.
