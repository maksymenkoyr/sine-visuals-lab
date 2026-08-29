# Status

This file is expected to be rewritten wholesale each session — it's a snapshot,
not a history. Keep it short enough to read in one glance. Use `/wrap` to
regenerate it at session close.

## In flight

- **Auto-gain amount + Signal history trace** — PR #18 (draft), branch
  `worktree-autogain-amount-scope`, 1 commit ahead of `main`. Auto-gain is now
  a 0–100 % blend (`src/audio/autoGain.ts`, blended in
  `FeatureExtractor.update`), the Input card's toggle is a slider row, and the
  Signal card has a History trace of level/energy/`fixedEnergy`. Also renames
  the Acceleration control to **Expansion** (the audio-engineering term for
  widening the quiet-to-loud gap), with both persisted keys migrated —
  `legacyKeys` in `createPerSceneSetting`, `LEGACY_EXPANSION_AUTO_KEYS` in
  `autoTune.ts`. Also adds a **Loudness** card: BS.1770 / EBU R128 LUFS
  (`src/audio/lufs.ts` pure math, `lufsAnalyser.ts` the K-weighting chain),
  Momentary on the bar with the `LUFS_TARGET_*` marks, Short-term big,
  Integrated with a Reset chip — display-only, hidden without a local mic.
  Typecheck and tests green; panel verified in headless Chromium with a fake
  mic (LUFS readings finite, Reset restarts Integrated, synthetic feed hides
  the card).
- **Docs pilot** — branch `worktree-docs-index` (worktree at
  `.claude/worktrees/docs-index`), 1 commit ahead: a diagram-first rewrite of
  `docs/architecture.md`. No PR yet. Note #18 also touches
  `docs/architecture.md` (one sentence on `fixedEnergy`), so whichever lands
  second needs a small rebase.
- **Tuning spotlight** — branch `worktree-tuning-spotlight` (worktree at
  `.claude/worktrees/tuning-spotlight`), 2 commits ahead: point the tuning loop
  at `MUSIC_DIALS` instead of guessing, and run two sessions at once. No PR yet.
- `.claude/worktrees/shortcut-s-panel-toggle` exists but is at `main` with no
  commits — either unstarted or abandoned.

## Open questions

- Does a *partial* auto-gain amount earn its place once used on a real room, or
  do people only ever land on 0 or 100? If the latter, the slider should go
  back to a toggle and the interesting middle ground is a broadband-adaptive
  third mode (one shared floor/peak across bands) rather than a per-band blend.
- Should the History trace's fixed reference line also show when the panel is
  on a renderer device? Today it's null there by design (no local extractor).

## Next up

- Review and land PR #18; then rebase `worktree-docs-index` onto it (or vice
  versa) to resolve the `docs/architecture.md` overlap.
- Decide the fate of `shortcut-s-panel-toggle` and remove the worktree if it's
  dead.
- Explainer artifact for the auto-gain window (live simulation of the
  `features.ts` trackers with the amount slider) lives at
  https://claude.ai/code/artifact/5aef9f8d-a361-4929-adb2-0831943fc375 — handy
  when tuning the amount on a real mic.
