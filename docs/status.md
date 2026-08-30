# Status

This file is expected to be rewritten wholesale each session — it's a snapshot,
not a history. Keep it short enough to read in one glance. Use `/wrap` to
regenerate it at session close.

## In flight

- **Dancers scene** — branch `worktree-dancers-scene` (worktree at
  `.claude/worktrees/dancers-scene`), 11 commits ahead of `main`, draft PR #36.
  A raymarched skeleton dancing captured moves: procedural sine-wave
  choreography was judged "no moves", so the dance now comes from CMU mocap
  clips — `src/render/scenes/dancers/clipFormat.ts` + `clips.bin` (built by
  `tools/clip-convert.mjs` from `tools/clip-cuts.json`), phase-locked to the
  bar clock by `player.ts` with a bar-boundary picker and two handovers
  (crossfade / inertialization, the advanced `Handover` setting), under
  `choreo.ts`'s beat gate, drop pose and jaw. `Pose` is now a quaternion per
  bone. Sixteen clips across the four `style` families. Typecheck + tests
  green; every clip checked on a headless contact sheet at its native tempo;
  picker path and both handovers run on synthetic audio. **Not yet judged on
  real music.** The first bundled data file in the repo — see step 5 of
  `docs/adding-a-scene.md`.
- **Chladni scene** — branch `worktree-chladni-scene` (worktree locked),
  1 commit ahead of `main`, unmerged.
- **Always-on dev controls** — branch `worktree-agent-ae8a69d86e9c44e97`,
  1 commit ahead of `main`, unmerged.
- **Mesh Grid rebuilt as a hidden-line spectrogram terrain** — branch
  `worktree-mesh-grid-terrain`, 13 commits ahead of `main`, unmerged.
- **Tuning: point-at-dials workflow** — branch `worktree-tuning-spotlight`,
  2 commits ahead of `main`, unmerged.
- **docs/architecture.md diagram-first rewrite** — branch `worktree-docs-index`,
  1 commit ahead of `main`, unmerged.

## Open questions

- Dancers: which handover reads better on real music — crossfade or inertial?
  Both ship behind the `Handover` setting so the user can compare; keep one.
- Dancers: the tempo the CMU dancers moved to is pinned by hand in
  `tools/clip-cuts.json` (CMU has no music); a clip that feels off-beat is a
  wrong `bpm`/`start` there, not a player bug.
- Dancers: `minQuality: "mid"` was chosen by analogy with Ferrofluid, not
  measured on a low-preset device.
- `tuning/params.json` ships with `"autoPin": true`, so every setting probes
  as `pinned` in DEV until `__viz.setParams({ autoPin: false })` — intended,
  or a leftover from a tuning session?

## Next up

- Watch Dancers on real music, pick a handover, then undraft and merge PR #36.
- Internet dances (Floss, Woah, Griddy) via a film-yourself → offline SMPL
  (WHAM / 4D-Humans) path into the same converter — simple routines only,
  no registered choreography. More CMU moves are cut-list entries.
- Merge or continue the other worktrees — Mesh Grid terrain is the most likely
  to collide with `main`.
