# Status

This file is expected to be rewritten wholesale each session — it's a snapshot,
not a history. Keep it short enough to read in one glance. Use `/wrap` to
regenerate it at session close.

## In flight

- **Chladni scene** — a simulated sand-on-vibrating-plate scene
  (`src/render/scenes/chladni.ts`): grains in ping-pong RGBA8 position
  textures, kicked on antinodes and settling on nodal lines; music picks the
  plate mode via `createModeSelector`. Branch `worktree-chladni-scene`
  (worktree at `.claude/worktrees/chladni-scene`), registered as a draft
  scene. Typecheck/tests green, headless-verified at high and floor quality,
  auto→manual probe sign-off done. Draft PR opened this session.
- **Dancers scene** — PR #36 (draft), branch `worktree-dancers-scene`
  (worktree at `.claude/worktrees/dancers-scene`).
- **Mesh Grid rebuilt as a hidden-line spectrogram terrain** — PR #22 (draft),
  branch `worktree-mesh-grid-terrain` (worktree at
  `.claude/worktrees/mesh-grid-terrain`).
- **Tuning: point-at-dials workflow** — branch `worktree-tuning-spotlight`
  (worktree at `.claude/worktrees/tuning-spotlight`), ahead of `main`, no PR.
- **docs/architecture.md diagram-first rewrite** — branch `worktree-docs-index`
  (worktree at `.claude/worktrees/docs-index`), ahead of `main`, no PR. PR #18
  (now on `main`) touched the same file, so it needs a small rebase.

## Open questions

- Chladni: should it graduate out of `DRAFT_SCENE_IDS`? It reads well on
  synthetic audio; needs a pass on real music, and the hop/pull constants
  (`HOP_FLOOR`, `PULL_RATE` in `chladni.ts`) were set by eye at 720p.
- Chladni on a Panorama room: grain positions live in plate space and the
  plate is sized from this device's `uResolution` aspect, the same
  approximation every fullscreen scene makes — unverified on a multi-device
  room.
- Does a *partial* auto-gain amount earn its place on a real room, or do people
  only land on 0 or 100? If the latter, a broadband-adaptive third mode (one
  shared floor/peak across bands) is the better middle ground than a per-band
  blend.

## Next up

- Review the Chladni draft PR on real music; consider a "spill" toggle (keep
  vs. refill grains that leave the plate) if the constant refill reads busy.
- Rebase `worktree-docs-index` onto `main` and open its PR.
- Explainer artifact for the auto-gain window (live simulation of the
  `features.ts` trackers with the amount slider):
  https://claude.ai/code/artifact/5aef9f8d-a361-4929-adb2-0831943fc375
