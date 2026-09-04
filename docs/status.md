# Status

This file is expected to be rewritten wholesale each session — it's a snapshot,
not a history. Keep it short enough to read in one glance. Use `/wrap` to
regenerate it at session close.

## In flight

- **Ambience scene** — `src/render/scenes/ambience.ts`, branch
  `worktree-ambience-scene`, draft PR #80 (this session). A Windows Media
  Player homage after a YouTube short: a dot lattice with beat swells that
  opens as a dot unfolding into a sheet (`OPENING_LEGS`). The comet sunburst
  of the first revision was dropped at the user's request. First `drawArraysInstanced`
  in the repo (instanced quads from an empty VAO); premultiplied "over"
  blending for the flat merged blobs. Second pass after the user re-watched
  the reference: formations (`FORM`), bar-timed journeys between them
  (`JOURNEYS`, run by `createChoreographer`), 4D turns of the sheet, tumble
  and stretch poses, motion streaks. Verified headlessly on synthetic audio
  (high/low presets, gallery tile), the probe auto→manual sign-off, and one
  real 140 BPM track. Registered as a draft. The user has seen clips; the
  journeys pass and the sunburst removal are not yet judged on the TV.
- **A run of draft scene PRs** from the last two days, all waiting on review
  and a real-music judgement: Kaleidoscope #79, Powder #77, Neon Fluid #76,
  Plume #75. Each has its own memory note and headless verification in its
  PR description.
- **Auto: unstick tempoLock, rank dials** — draft PR #73
  (`worktree-auto-dial-ranking`).
- **docs/architecture.md rebuild** — draft PR #74 (`worktree-docs-architecture`);
  the older `worktree-docs-index` branch's premise is superseded by it and by
  `docs/index.md` on `main`.
- **Business/legal docs** — PR #72 (`docs-business`), ready for review;
  PR #70 (`wrap-status`) is a stale status snapshot that this file replaces.
- Idle worktrees with no PR: `worktree-agent-ae8a69d86e9c44e97` (always-on
  dev controls), `worktree-auto-hint-description`, `worktree-setting-groups`
  (its `SETTING_GROUPS` change is already on `main`), `worktree-tuning-spotlight`,
  `dev-bake-defaults-into-source`. Check `git log main..` on each before
  reviving; several look landed or superseded.

## Open questions

- Ambience: the tesseract journey reads as a radial warp tunnel rather than
  a recognisable lattice — keep it as one entry in `JOURNEYS`, or drop it?
- Ambience: the reference's sheet is a spectrum-agnostic lattice; ours ties
  disc size to each column's band (`breathe`). Keep, or make it pure motion?
- Which of the five draft scenes graduate out of `DRAFT_SCENE_IDS`, and in
  what order — they compete for the same gallery row.
- Storm's local render-cap workaround (see its header) is redundant now that
  `renderLatch.ts` is on `main`; simplify once nothing else is touching Storm.

## Next up

- Look at Ambience on the TV with real music; then review PR #80.
- Review and land the draft scene PRs #75–#79 (or close the ones that don't
  earn a slot), and PRs #72–#74.
- Prune the old scratch branches listed in `git branch -r --no-merged main`
  that are weeks behind; most read like earlier attempts at work that has
  since landed.
