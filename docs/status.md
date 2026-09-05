# Status

This file is expected to be rewritten wholesale each session — it's a snapshot,
not a history. Keep it short enough to read in one glance. Use `/wrap` to
regenerate it at session close.

## In flight

- **Neon Gates scene (`gates`)** — branch `worktree-neon-gates`, draft PR
  opened 2026-09-05. The first scene built through the `/ref` loop
  (`src/render/scenes/gates/`, header owns the design). The reference
  (`4PsXO3JsQdg`) turned out to be *silent by design* and a few-second VJ
  loop repeated for hours, so the scan gave the look and the cut cadence and
  no sync; the cuts are ours — bar wraps, a blackout-then-cut on phrase bars
  and drops, a free-run timer with no tempo lock (`advanceGates`, tested in
  `tests/gates.test.ts`). Tuned three rounds from `ref-shoot` side-by-sides;
  judged only on `?audio=synthetic` so far. In `DRAFT_SCENE_IDS`.
- **Landed since the last snapshot:** the `/ref` loop #85 (its bundle for this
  scene is `tools/.cache/refs/neon-groove/`), CLAUDE.md Git & PRs #84, the
  audio-source guide #87.
- **Draft scene PR** waiting on a real-music judgement: Neon Fluid #76.
- **Auto: unstick tempoLock, rank dials** — draft PR #73.
- **Beat-rate controls** (a setting picks which beat it reacts on) — draft #88.
- **docs/architecture.md rebuild** — draft PR #74.
- **Dev server scene links** #89 and **business/legal docs** #72 — ready for
  review. PR #70 is a stale status snapshot this file replaces — close it.
- Worktrees with no open PR (`git worktree list`): `agent-ae8a69d86e9c44e97`,
  `bake-defaults`, `claude-md-git-workflow` (landed as #84), `docs-index`,
  `setting-groups`, `tuning-spotlight`. Check `git log origin/main..` on each
  before reviving; several look landed or superseded.

## Open questions

- Neon Gates: the reference's gates are 3D objects with foreshortening and a
  much finer centre cluster; ours are flat billboards. Worth a real depth
  model, or is the fold-plus-slots picture enough for a draft that graduates?
- Neon Gates: blackouts land on every `BARS_PER_PHRASE`th bar counted from
  scene start — there is no downbeat/phrase in the runtime. Should
  `beatClock.ts` expose a bar count or a phrase estimate for every scene?
- Ref loop: silent references are a category, not an accident (two of four
  clips so far, same channel). Should `ref-scan.py` say "silent by design" up
  front from the description, and skip the hear/shoot audio clauses?
- Ref loop: our tempo lock came out differently on two runs of the same clip;
  should `ref-hear` run twice and report the spread? And `sectionIntensity`
  never rose at the one audible clip's section boundaries — runtime gap or
  scan threshold?
- Kaleidoscope: spiral dive between children? Do the rainbow texture styles
  read as ignoring the Palette card? Storm's Mode is the obvious next `variant`.
- Which draft scenes graduate out of `DRAFT_SCENE_IDS`, and in what order.
- Storm's local render-cap workaround is redundant now that `renderLatch.ts`
  is on `main`; simplify once nothing else touches Storm.

## Next up

- Watch Neon Gates on real music (the `--use-file-for-fake-audio-capture`
  recipe in the `headless-app-driving` memory); tune the cut cadence and the
  onset flash against a track, then decide on the 3D question above.
- Review #89, #72; close #70; land or drop #76; decide the idle worktrees.
- `/ref` on a reference *with* audio for the next scene, so the hear/shoot
  clauses finally get exercised end to end.
