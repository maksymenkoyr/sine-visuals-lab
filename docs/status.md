# Status

This file is expected to be rewritten wholesale each session — it's a snapshot,
not a history. Keep it short enough to read in one glance. Use `/wrap` to
regenerate it at session close.

## In flight

- **Dancers scene** — branch `worktree-dancers-scene` (worktree at
  `.claude/worktrees/dancers-scene`), 5 commits ahead of `main`, draft PR
  open. A raymarched skeleton dancing to the beat: CPU-solved rig
  (`src/render/scenes/dancers/rig.ts`) → packed `uBones` → SDF skins, a move
  ladder with a downbeat-latched picker (`choreo.ts`), auto-weighted settings,
  and the new `type: "enum"` setting + chip picker row in `deviceMenu.ts`.
  Registered as a draft at `minQuality: "mid"`. Typecheck + tests green;
  verified headless at high/mid, in the gallery tile, and at 90/124/170 bpm
  with synthetic audio. Not yet judged on real music.
- **Mesh Grid rebuilt as a hidden-line spectrogram terrain** — branch
  `worktree-mesh-grid-terrain` (worktree locked), 9 commits ahead of `main`,
  unmerged.
- **Auto-gain becomes an amount + Signal history trace** — branch
  `worktree-autogain-amount-scope` (worktree locked), 5 commits ahead of
  `main`, unmerged.
- **Tuning: point-at-dials workflow** — branch `worktree-tuning-spotlight`,
  2 commits ahead of `main`, unmerged.
- **docs/architecture.md diagram-first rewrite** — branch `worktree-docs-index`,
  1 commit ahead of `main`, unmerged.

## Open questions

- Dancers: does the procedural groove hold up on real music, or does it want
  captured motion (which would mean an asset pipeline the repo doesn't have)?
- Dancers: `minQuality: "mid"` was chosen by analogy with Ferrofluid, not
  measured on a low-preset device — the bounding-sphere early-out may make
  `"low"` affordable.
- `tuning/params.json` ships with `"autoPin": true`, so every setting probes
  as `pinned` in DEV until `__viz.setParams({ autoPin: false })` — intended,
  or a leftover from a tuning session?

## Next up

- Merge the Dancers draft PR once it's been watched with real music; then the
  agreed follow-ups in order: more procedural skins (neon, blob), then decide
  whether "other characters" justifies an asset pipeline. A crowd would need
  a rasterised-bone path rather than more raymarching.
- Merge or continue the other four worktrees — Mesh Grid terrain has grown to
  nine commits and is the most likely to collide with `main`.
