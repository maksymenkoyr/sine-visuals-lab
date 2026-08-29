# Status

This file is expected to be rewritten wholesale each session — it's a snapshot,
not a history. Keep it short enough to read in one glance. Use `/wrap` to
regenerate it at session close.

## In flight

- **Power card collapse + all-folded triangle** — branch `worktree-power-collapse`
  (worktree at `.claude/worktrees/power-collapse`, locked), 1 commit ahead of
  `main`, unmerged:
  - `8dd5184` Power card collapses too; all-folded triangle-collapses the
    column — rebuilt from scratch after #27 landed on `main` mid-session and
    removed the fold-all/onFoldChange/setAllFolded plumbing this depended on.
- **Auto-gain becomes an amount + Signal history trace** — branch
  `worktree-autogain-amount-scope` (worktree at
  `.claude/worktrees/autogain-amount-scope`, locked), 2 commits ahead of
  `main`, unmerged.
- **Mesh Grid rebuilt as a hidden-line spectrogram terrain** — branch
  `worktree-mesh-grid-terrain` (worktree at
  `.claude/worktrees/mesh-grid-terrain`, locked), draft PR #22, rebased onto
  `main` after #31's tier → quality rename, unmerged. On top of the rebuild:
  Camera Distance / Height / Tilt, Zoom, Circle and Sphere layouts with Circle
  Squeeze, a Background Mesh that can be a flat backdrop or a sky dome, and
  every default lifted from the latest saved mark. Ready for a look on real
  music.
- **Caustics: Treble sparkle split into a macro** — branch
  `worktree-sparkle-macro` (worktree at `.claude/worktrees/sparkle-macro`,
  locked), 1 commit ahead of `main`, unmerged.
- **Tuning: point-at-dials workflow** — branch `worktree-tuning-spotlight`
  (worktree at `.claude/worktrees/tuning-spotlight`), 2 commits ahead of
  `main`, unmerged.
- **docs/architecture.md diagram-first rewrite** — branch
  `worktree-docs-index` (worktree at `.claude/worktrees/docs-index`), 1
  commit ahead of `main`, unmerged.

## Open questions

- Mesh Grid's defaults were tuned on synthetic audio plus one saved mark. The
  peak-glow threshold in `MESH_FRAG` and the Circle layout's `CIRCLE_TILT_DEG`
  may want a nudge once it's been watched on real music.

## Next up

- Merge or continue whichever of the worktrees above are actually finished —
  six have accumulated since the last snapshot, several concurrent with this
  session's own work on the same panel files (`#27` landed on `main` mid-session
  and required rebuilding this session's change from scratch; worth checking
  the others for the same kind of collision before merging).
