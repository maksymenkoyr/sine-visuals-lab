# Status

This file is expected to be rewritten wholesale each session — it's a snapshot,
not a history. Keep it short enough to read in one glance. Use `/wrap` to
regenerate it at session close.

## In flight

- **Reference-video loop (`/ref`)** — draft PR #85, branch `worktree-ref-video`
  (this session, 2026-09-05). `tools/ref-scan.py` turns a visualisation video
  into a bundle whose `report.md` opens with Findings — sync rules the
  measurements support, each with an "ours:" clause from what our own
  analyser heard on the same audio (`tools/ref-hear.mjs`); one
  `keyframes.png`; the look as numbers. `tools/ref-shoot.mjs` shoots our scene
  at the same beats beside the reference. Verified on three clips; never yet
  used to build a scene — that is the real test. Design decisions (Claude
  as consumer, librosa grid + what-ours-hears, detect-from-picture) are in
  the memory note `reference-video-analysis`.
- **Kaleidoscope** — draft PR #79 (scene) and stacked draft PR #83 (styles
  built from measured references). The first thing to point `/ref` at.
- **Other draft scene PRs** waiting on review and a real-music judgement:
  Neon Fluid #76, Plume #75.
- **Auto: unstick tempoLock, rank dials** — draft PR #73.
- **docs/architecture.md rebuild** — draft PR #74.
- **CLAUDE.md Git & PRs section** — PR #84; **business/legal docs** — PR #72;
  both ready for review. PR #70 is a stale status snapshot this file replaces.
- Worktrees with no open PR (`git worktree list`): `agent-ae8a69d86e9c44e97`,
  `audio-source-guide`, `bake-defaults`, `beat-rate-controls`, `docs-index`,
  `setting-groups`, `tuning-spotlight`. Check `git log main..` on each before
  reviving; several look landed or superseded.

## Open questions

- Ref loop: our tempo lock came out differently on two runs of the same clip
  (162 steady vs a drop to 122 at a section boundary). Is `features.ts`'s comb
  sensitive to start time / adaptive-gain state, and should `ref-hear` run
  twice and report the spread?
- Ref loop: our `section` signal (`sectionIntensity`) never rose at the
  reference's section boundaries on the one clip with audio. Real gap in the
  runtime, or a threshold mismatch in how the scan looks for a rise?
- Ref loop: motion metrics run at `VIS_FPS`; above ~150 bpm a half-beat strobe
  can't be told from a timer. Double the rate, or keep the stated resolution?
- Which draft scenes graduate out of `DRAFT_SCENE_IDS`, and in what order.
- Storm's local render-cap workaround (see its header) is redundant now that
  `renderLatch.ts` is on `main`; simplify once nothing else touches Storm.

## Next up

- Run `/ref` on a Kaleidoscope reference against PR #83's styles and see
  whether the side-by-side changes a tuning decision — then review #85.
- Review and land PRs #83/#79, #76, #75, #73, #74, #84, #72.
- Prune old remote branches (`git branch -r --no-merged origin/main`); most
  read like earlier attempts at work that has since landed.
