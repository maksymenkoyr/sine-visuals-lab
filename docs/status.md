# Status

This file is expected to be rewritten wholesale each session — it's a snapshot,
not a history. Keep it short enough to read in one glance. Use `/wrap` to
regenerate it at session close.

## In flight

- **Dancers scene** — branch `worktree-dancers-scene` (worktree at
  `.claude/worktrees/dancers-scene`), draft PR #36, merged with `main` after
  #18/#34/#35/#37/#39 landed underneath it (conflicts in `controlsTheme.ts`
  and this file resolved). A raymarched skeleton dancing captured moves:
  procedural sine-wave choreography was judged "no moves", so the dance now
  comes from CMU mocap clips — `src/render/scenes/dancers/clipFormat.ts` +
  `clips.bin` (built by `tools/clip-convert.mjs` from `tools/clip-cuts.json`),
  phase-locked to the bar clock by `player.ts` with a bar-boundary picker and
  two handovers (crossfade / inertialization, the advanced `Handover`
  setting), under `choreo.ts`'s beat gate, drop pose and jaw. `Pose` is now a
  quaternion per bone. The moves in `tools/clip-cuts.json` span the four
  `style` families; each gets an L/R mirror at load. Three renderers behind
  the `Renderer` setting — the raymarcher, analytic capsules and flat
  projected capsules (`fastRenderers.ts`) — plus a `Fast march` trim; the
  raymarcher hands over to Capsules below Mid, so the scene registers at
  `minQuality: "floor"` and runs on the TV presets. Typecheck + tests green;
  every clip checked on a headless contact sheet at its native tempo; picker
  path, both handovers and all renderers run on synthetic audio. **Not yet
  judged on real music.** The first bundled data file in the repo — see
  step 5 of `docs/adding-a-scene.md`.
- **Chladni scene** — branch `worktree-chladni-scene` (worktree locked),
  3 commits ahead of `main`, unmerged.
- **Always-on dev controls** — branch `worktree-agent-ae8a69d86e9c44e97`,
  1 commit ahead of `main`, unmerged.
- **Mesh Grid rebuilt as a hidden-line spectrogram terrain** — branch
  `worktree-mesh-grid-terrain` (worktree at
  `.claude/worktrees/mesh-grid-terrain`), draft PR #22, merged with `main`
  after #18–#42 landed underneath it (conflict in this file only), unmerged.
  On top of the rebuild: Camera Distance / Height / Tilt, Zoom, Circle and
  Sphere layouts with Circle Squeeze, Waves Outward, Center Spike, a Grid
  Density that rebuilds the mesh, a Background Mesh that can be a flat
  backdrop or a co-axial lattice dome (Dome Distance / Radius / Density),
  and Beat Expand with a Beat Smooth attack/release. What a row *holds* was
  reworked last: each band's change against its own recent average (Wave
  Memory, Wave Gain) — see the header of `src/render/scenes/meshGrid.ts` for
  why neither the AGC'd spectrum nor a single level value works. Defaults
  are a fresh-start sphere centered inside the dome. Ready for a look on
  real music.
- **Caustics: Treble sparkle split into a macro** — branch
  `worktree-sparkle-macro` (worktree at `.claude/worktrees/sparkle-macro`,
  locked), 1 commit ahead of `main`, unmerged.
- **Tuning: point-at-dials workflow** — branch `worktree-tuning-spotlight`,
  2 commits ahead of `main`, far behind it.
- **docs/architecture.md diagram-first rewrite** — branch `worktree-docs-index`,
  1 commit ahead of `main`. PR #18 (now on `main`) also touched that file
  (two sentences on `fixedEnergy` and the Loudness card), so it needs a small
  rebase.
- Older one-commit branches (`band-tilt`, `collapse-panel-cards`,
  `shortcut-s-panel-toggle`, `auto-gain-toggle`) are 17–27 commits behind
  `main` — check whether each already landed under another PR before
  reviving.

## Open questions

- Mesh Grid's defaults were tuned on synthetic audio. Wave Memory / Wave
  Gain and the beat swell are the things most likely to want a nudge on real
  music; the runway and Circle layouts are kept behind toggles — drop them
  if the sphere is the scene.
- Dancers: which handover reads better on real music — crossfade or inertial?
  Both ship behind the `Handover` setting so the user can compare; keep one.
- Dancers: the tempo the CMU dancers moved to is pinned by hand in
  `tools/clip-cuts.json` (CMU has no music); a clip that feels off-beat is a
  wrong `bpm`/`start` there, not a player bug.
- Dancers: the cheap renderers are untested on an actual TV — the desktop
  is vsync-bound at every setting, so the real frame time there is unknown.
- Does a *partial* auto-gain amount earn its place on a real room, or do people
  only land on 0 or 100? If the latter, a broadband-adaptive third mode (one
  shared floor/peak across bands) is the better middle ground than a per-band
  blend.
- The LUFS meter reads a mono downmix, so stereo display-audio reads 3–6 dB
  low against a true two-channel BS.1770 sum. Fine for a phone mic; revisit if
  display capture becomes the main use.
- `tuning/params.json` ships with `"autoPin": true`, so every setting probes
  as `pinned` in DEV until `__viz.setParams({ autoPin: false })` — intended,
  or a leftover from a tuning session?

## Next up

- Watch Mesh Grid's sphere-in-dome on real music; then undraft and merge PR #22.
- Watch Dancers on real music, pick a handover, then undraft and merge PR #36.
- Internet dances (Floss, Woah, Griddy) via a film-yourself → offline SMPL
  (WHAM / 4D-Humans) path into the same converter — simple routines only,
  no registered choreography. More CMU moves are cut-list entries.
- Rebase `worktree-docs-index`; merge or continue the other worktrees.
- Explainer artifact for the auto-gain window (live simulation of the
  `features.ts` trackers with the amount slider):
  https://claude.ai/code/artifact/5aef9f8d-a361-4929-adb2-0831943fc375
