# Status

This file is expected to be rewritten wholesale each session — it's a snapshot,
not a history. Keep it short enough to read in one glance. Use `/wrap` to
regenerate it at session close.

## In flight

- **Auto-gain amount + Signal history + Expansion rename + LUFS Loudness card**
  — PR #18 (draft), branch `worktree-autogain-amount-scope` (worktree at
  `.claude/worktrees/autogain-amount-scope`, locked). Merged with `main` after
  fifteen PRs (#19–#35) landed underneath it — conflicts in `features.ts`
  (blend + `smoothingScale`), `app.ts`, `deviceMenu.ts`, `audioMeters.ts`
  (fold guards, `rawBands`/`rateScale`), `autoTune.ts`, and two test files
  resolved; typecheck and tests green on the merged tree.
- **Power card collapse + all-folded triangle** — branch
  `worktree-power-collapse` (worktree at `.claude/worktrees/power-collapse`),
  1 commit ahead of `main`; check whether #29 on `main` already covers it.
- **Mesh Grid rebuilt as a hidden-line spectrogram terrain** — branch
  `worktree-mesh-grid-terrain` (worktree at
  `.claude/worktrees/mesh-grid-terrain`), 1 commit ahead of `main`.
- **Caustics: Treble sparkle split into a macro** — branch
  `worktree-sparkle-macro` (worktree at `.claude/worktrees/sparkle-macro`);
  #28 on `main` looks like the same change — probably done.
- **Tuning: point-at-dials workflow** — branch `worktree-tuning-spotlight`
  (worktree at `.claude/worktrees/tuning-spotlight`), 2 commits ahead.
- **docs/architecture.md diagram-first rewrite** — branch `worktree-docs-index`
  (worktree at `.claude/worktrees/docs-index`), 1 commit ahead. PR #18 also
  touches that file (two sentences on `fixedEnergy` and the Loudness card), so
  whichever lands second needs a small rebase.

## Open questions

- Does a *partial* auto-gain amount earn its place on a real room, or do people
  only land on 0 or 100? If the latter, a broadband-adaptive third mode (one
  shared floor/peak across bands) is the better middle ground than a per-band
  blend.
- The LUFS meter reads a mono downmix, so stereo display-audio reads 3–6 dB
  low against a true two-channel BS.1770 sum. Fine for a phone mic; revisit if
  display capture becomes the main use.

## Next up

- Review and land PR #18 (`gh pr ready 18`), then rebase `worktree-docs-index`.
- Prune worktrees whose change already landed on `main` (`sparkle-macro`,
  possibly `power-collapse`).
- Explainer artifact for the auto-gain window (live simulation of the
  `features.ts` trackers with the amount slider):
  https://claude.ai/code/artifact/5aef9f8d-a361-4929-adb2-0831943fc375
