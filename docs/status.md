# Status

This file is expected to be rewritten wholesale each session — it's a snapshot,
not a history. Keep it short enough to read in one glance. Use `/wrap` to
regenerate it at session close.

## In flight

- **Tuning hotkey fix + clip capture** — branch `worktree-tuning-hotkey-fix`
  (worktree at `.claude/worktrees/tuning-hotkey-fix`, locked), 2 commits ahead of
  `main`, unmerged:
  - `5dbf48b` Fix mark hotkey not firing on macOS (Option remaps `e.key`)
  - `d54c9b5` Add clip capture (before/after), UI toggle, flash feedback, and a
    mark watcher — adds `src/tuning/ui.ts` and `tools/tune-watch.mjs`, expands
    `src/tuning/capture.ts` and `src/tuning/debug.ts`.

## Open questions

- None recorded yet.

## Next up

- Merge or continue `worktree-tuning-hotkey-fix` once its clip-capture UI has
  been used in a real tuning session.
