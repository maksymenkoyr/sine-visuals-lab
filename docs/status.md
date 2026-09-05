# Status

This file is expected to be rewritten wholesale each session — it's a snapshot,
not a history. Keep it short enough to read in one glance. Use `/wrap` to
regenerate it at session close.

## In flight

- **Reference-video loop (`/ref`)** — draft PR #85, branch `worktree-ref-video`
  (2026-09-05). `tools/ref-scan.py` turns a visualisation video into a bundle
  whose `report.md` opens with Findings — sync rules the measurements support,
  each with an "ours:" clause from what our own analyser heard on the same
  audio (`tools/ref-hear.mjs`); one `keyframes.png`; the look as numbers.
  `tools/ref-shoot.mjs` shoots our scene at the same beats beside the
  reference. Verified on three clips; never yet used to build a scene — that
  is the real test, and Kaleidoscope (now on `main`, `src/render/scenes/kaleido/`)
  is the obvious first target. Design decisions are in the memory note
  `reference-video-analysis`.
- **Landed since the last snapshot:** Kaleidoscope scene #79 and its four
  styles #83 (`style` is the first `variant` setting; Beat grid row in the
  Rhythm card, `src/audio/beatGrid.ts` + `src/render/gridPulse.ts`), Powder
  #77. Still in `DRAFT_SCENE_IDS` pending a real-music verdict.
- **Draft scene PRs** waiting on review and a real-music judgement: Plume #75,
  Neon Fluid #76 (v7, merged with `main` 2026-09-05: screen-space anime
  lightning in `fluidBolts.ts` that lights the dye, hard-cut `STROBE_PATTERN`
  frames; the Storm bolt generator lives in `src/render/bolt.ts` — Storm still
  carries its own copy in `storm.ts`, dedupe after #76 lands).
- **Auto: unstick tempoLock, rank dials** — draft PR #73.
- **docs/architecture.md rebuild** — draft PR #74.
- **CLAUDE.md Git & PRs section** — PR #84; **business/legal docs** — PR #72;
  both ready for review. PR #70 is a stale status snapshot this file replaces —
  close it.
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
- Beat grid: should its default move off Hits once judged on real music, and
  should the TV receive it (a new DeviceCommand field)?
- Kaleidoscope: should the dive target rotate between children (a spiral dive)
  rather than always the top one? Do the rainbow texture styles
  (`RAINBOW_ROOM_MIX`) read as ignoring the Palette card? Storm's Mode is the
  obvious next `variant`.
- Which draft scenes graduate out of `DRAFT_SCENE_IDS`, and in what order.
- Storm's local render-cap workaround (see its header) is redundant now that
  `renderLatch.ts` is on `main`; simplify once nothing else touches Storm.
- Stale scratch branches on origin (`git branch -r --no-merged origin/main`):
  prune, or is anything in them still wanted?

## Next up

- `/ref` on one of the Kaleidoscope reference shorts against the landed
  `kaleidoscope` scene; see whether the findings change a tuning decision,
  then review #85.
- Watch Kaleidoscope, Powder, Plume and Neon Fluid on real music; land or drop
  #75/#76 and decide on graduation.
- Review #73, #74, #84, #72; close #70; decide the fate of the idle worktrees.
