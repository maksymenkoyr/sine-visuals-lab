# Status

This file is expected to be rewritten wholesale each session — it's a snapshot,
not a history. Keep it short enough to read in one glance. Use `/wrap` to
regenerate it at session close.

## In flight

- **Reference-video loop** — `tools/ref-scan.py`, `tools/ref-shoot.mjs`,
  `.claude/commands/ref.md`, branch `worktree-ref-video` (this session, draft
  PR). Scan a reference video into a beat-ranked bundle (frames grabbed on
  the 1st/2nd/4th/8th/16th beats at before/on/after offsets, per-rank sheets,
  a timeline, and a report that annotates every visual transition with the
  audio at that moment); then replay the bundle's audio into one of our
  scenes as a fake mic and shoot the same beats side by side. Verified on the
  Kaleidoscope reference short (161 bpm) against `tunnel`: shots land within
  ±20 ms, and the probe's bpm per shot exposed our beat clock halving to 122
  at the reference's section boundary. Not yet used to build a scene — that's
  the real test.
- **Kaleidoscope** — draft PR #79 (scene) and stacked draft PR #83 (four
  styles built from measured references + infinite zoom). The first thing to
  point `/ref` at: the styles were tuned from the scratch script this branch
  replaces.
- **Other draft scene PRs** waiting on review and a real-music judgement:
  Neon Fluid #76, Plume #75. Ambience #80 and Powder #77 merged 2026-09-04.
- **Auto: unstick tempoLock, rank dials** — draft PR #73
  (`worktree-auto-dial-ranking`).
- **docs/architecture.md rebuild** — draft PR #74 (`worktree-docs-architecture`).
- **CLAUDE.md Git & PRs section** — PR #84, ready for review.
- **Business/legal docs** — PR #72 (`docs-business`), ready for review;
  PR #70 (`wrap-status`) is a stale status snapshot that this file replaces.
- Idle worktrees with no PR (`git worktree list`): check `git log main..` on
  each before reviving; several look landed or superseded.

## Open questions

- Ref loop: the beat clock halving to 122 bpm at a section boundary on the
  first test clip — is that `features.ts`'s comb losing the fundamental to
  a half-tempo candidate, or the reference genuinely dropping to half-time
  there? Rescan with `--start 7` and compare `audio.json`'s tempo.
- Ref loop: motion metrics run at `VIS_FPS`; above ~150 bpm that can't
  resolve a half-beat strobe from a 5 Hz timer. Worth doubling the rate at
  the cost of scan time, or leave the report's stated resolution as the
  answer?
- Which of the draft scenes graduate out of `DRAFT_SCENE_IDS`, and in what
  order — they compete for the same gallery row.
- Storm's local render-cap workaround (see its header) is redundant now that
  `renderLatch.ts` is on `main`; simplify once nothing else is touching Storm.

## Next up

- Run `/ref` on one of the Kaleidoscope references against PR #83's styles
  and see whether the side-by-side changes any tuning decision.
- Review and land PRs #83/#79, #76, #75, #73, #74, #84, #72.
- Prune the old scratch branches listed in `git branch -r --no-merged main`
  that are weeks behind; most read like earlier attempts at work that has
  since landed.
