# Status

This file is expected to be rewritten wholesale each session — it's a snapshot,
not a history. Keep it short enough to read in one glance. Use `/wrap` to
regenerate it at session close.

## In flight

- **Moiré rebuilt from a measured reference** — draft PR #104, branch
  `worktree-moire-lines` (2026-09-12). `/ref` on thedotisblack's horizontal-
  lines moiré (chapter Part 2): two same-period gratings, one displaced by
  noise, field re-rolling every frame. The old three-grating draft lives on as
  `moire2`. Nothing in the source is audio-driven, so every trigger is our
  mapping (see the scene header). Needs a look on real music; the numbers
  match the reference's bands, the taste call is open.
- **Draft scene PRs from `/ref`** waiting on review and a real-music judgement:
  Slats #100, Ink Synth #96, Crystal Wall #95, Neon Gates #90,
  Neon Fluid #76. Tessera has a branch (`tessera-scene`) and no PR yet.
- **Ref-loop tool fixes riding on scene PRs:** `ref-shoot --settings` was a
  silent no-op without the scene id (fixed in #104); fade-vs-cut grouping (#95).
- **Runtime:** Song-boundary instrumentation #93; beat-rate setting #88;
  Auto tempoLock/dial ranking #73; mic
  latency status line #103 (from the mobile session, not draft).
- Landed on `main` since the last snapshot: Shards #105, the Caustics mobile
  noise-hash bound #102, draft-tile loading progress #106.
- **Dev/docs:** dev-server single scene link #98; gallery preview scheduling
  #91; docs/architecture.md rebuild #74; business/legal docs #72. PR #70 is a
  stale status snapshot — close it.
- Worktrees with no open PR (`git worktree list`): `agent-…`, `bake-defaults`,
  `claude-md-git-workflow`, `dev-scene-links`, `docs-index`, `ref-bursts`,
  `setting-groups`, `tessera`, `tuning-spotlight`. Check `git log main..` on
  each before reviving; several look landed or superseded.

## Open questions

- Ref loop: a re-rolling noise field (Moiré) reads as hundreds of "hard cuts"
  to the histogram detector — should `refburst` report a per-frame
  decorrelation figure alongside cuts, so a shimmer isn't mistaken for editing?
- Ref loop: `reflook` finds nothing on light-ground references (Moiré, Ink
  Synth both needed a hand scan-line script) — fold a light-ground path into
  `tools/reflook.py`?
- Runtime: our tempo locked at ×2 on an 86 bpm ambient track for the whole
  clip, and `sectionIntensity` never rose at the reference's section
  boundaries (third clip in a row) — `beatClock.ts` half-time preference, and a
  real section-change signal, are now recurring to-dos.
- Which draft scenes graduate out of `DRAFT_SCENE_IDS`, and in what order.
- Stale scratch branches on origin (`git branch -r --no-merged origin/main`):
  prune, or is anything in them still wanted?

## Next up

- Watch Moiré (#104) on real music: does the 30 Hz shimmer read as intended
  or as noise, and does the curtain ever lift? Then review and land or drop.
- Review the queue of draft scene PRs; decide graduation.
- Review #103 from the mobile session; close #70; prune idle worktrees.
