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
- **Chladni scene** — a simulated sand-on-vibrating-plate scene
  (`src/render/scenes/chladni.ts`): grains in ping-pong RGBA8 position
  textures; every plate mode is a resonance driven by the band energy at its
  own frequency (`createPlateResponse`), the strongest few summed. Sand
  rattles in proportion to the plate everywhere, dances on the antinodes,
  and migrates to the lines only as a second-order effect of bouncing
  (`LIFT_THRESHOLD`, `HOP_RATE`, `PULL_BIAS`), so sand lies between the
  figures like a real plate and nothing slides. Opaque grains, glint halo on
  hats. Plate fills the screen by default. Branch `worktree-chladni-scene`
  (worktree at `.claude/worktrees/chladni-scene`), draft PR #38, merged with
  `main` after #36/#37/#39/#40 landed (conflicts in `scenes/index.ts`,
  `tests/autoTune.test.ts` and this file resolved). Registered as a draft
  scene; typecheck/tests green, headless-verified, being tuned on real music
  by the user.
- **Always-on dev controls** — branch `worktree-agent-ae8a69d86e9c44e97`,
  1 commit ahead of `main`, unmerged.
- **Mesh Grid rebuilt as a hidden-line spectrogram terrain** — branch
  `worktree-mesh-grid-terrain`, 15 commits ahead of `main`, unmerged.
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

- Chladni: should it graduate out of `DRAFT_SCENE_IDS`? The sand constants
  (`LIFT_THRESHOLD`, `HOP_RATE`, `PULL_BIAS`) and the resonance
  window/sharpening range (`WINDOW_BANDS_*`, `SHARPEN_*` in `chladni.ts`)
  were set by eye at 720p against the synthetic feed's low energy; the user
  is tuning motion on real music (last asks: more movement, less sticking).
- Chladni on a Panorama room: grain positions live in plate space and the
  plate is sized from this device's `uResolution` aspect, the same
  approximation every fullscreen scene makes — unverified on a multi-device
  room.
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

- Chladni: keep tuning on real music, then undraft PR #38; consider a
  "spill" toggle (keep vs. refill grains that leave the plate) if the
  constant refill reads busy.
- Watch Dancers on real music, pick a handover, then undraft and merge PR #36.
- Internet dances (Floss, Woah, Griddy) via a film-yourself → offline SMPL
  (WHAM / 4D-Humans) path into the same converter — simple routines only,
  no registered choreography. More CMU moves are cut-list entries.
- Rebase `worktree-docs-index`; merge or continue the other worktrees — Mesh
  Grid terrain is the most likely to collide with `main`.
- Explainer artifact for the auto-gain window (live simulation of the
  `features.ts` trackers with the amount slider):
  https://claude.ai/code/artifact/5aef9f8d-a361-4929-adb2-0831943fc375
