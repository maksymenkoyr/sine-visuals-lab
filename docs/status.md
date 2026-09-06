# Status

This file is expected to be rewritten wholesale each session — it's a snapshot,
not a history. Keep it short enough to read in one glance. Use `/wrap` to
regenerate it at session close.

## In flight

- **Neon Gates rebuilt as real 3D** — draft PR #90, branch `worktree-neon-gates`,
  `src/render/scenes/gates/` (2026-09-06). The first `/ref`-built scene, redone
  from the measured picture after the thumbnail-designed draft was rejected:
  instanced 3D wireframes drawn as one primitive (a tube segment swept through
  the shutter, `glsl.ts`), looks as measured data (`layout.ts`'s `LOOKS`), a
  per-scene bloom chain, the tested cut scheduler kept with spin fixed to the
  measured rate and direction per look. Our screenshots measured with the
  reference's own detector land inside its ranges for stroke, luminance, hues
  and fold. Judged on `?audio=synthetic` only; no real-music run yet.
- **Ref loop measures the picture** — PR #92, branch `worktree-ref-look`.
  `tools/reflook.py` beside `tools/ref-scan.py`: objects by shape class, size vs
  distance from centre, rings and fold, stroke and glow in pixels, hue clusters,
  flow and spin from object tracking; "Picture, measured" in `report.md`,
  `look.png`, `look.json`. This is what made the Gates rebuild possible.
- **Landed since the last snapshot:** the `/ref` loop #85, dev-server scene
  links #89, CLAUDE.md Git & PRs #84, share-audio guidance #87.
- **Other draft PRs** waiting on review or a real-music judgement:
  Song-boundary instrumentation #93, gallery preview scheduling #91, beat-rate
  controls #88, Neon Fluid #76, auto dial ranking #73, architecture rebuild #74.
  Business/legal docs #72 is ready for review. PR #70 is a stale status
  snapshot this file replaces — close it.
- Worktrees with no open PR (`git worktree list`): `agent-ae8a69d86e9c44e97`,
  `bake-defaults`, `claude-md-git-workflow`, `dev-scene-links`, `docs-index`,
  `setting-groups`, `tuning-spotlight`. Several are landed; prune before reviving.

## Open questions

- Neon Gates: the reference has far more small fragments per frame and a much
  wider bloom on its gold and beams regimes than ours reaches with two blur
  levels. Add a third level, or accept the look as is for a draft?
- Neon Gates: the gate pass is the repo's first geometry pass with adaptive
  per-pixel sampling (sweep taps capped by `uDetail`). Fine on a desktop GPU;
  untested on a TV.
- Ref loop: `reflook.py`'s detector is tuned on neon outlines on black; it
  needs a clip with bright fills or a textured ground before it is trusted
  generally. Merging PR #92 before #90 keeps the measurement reproducible.
- Ref loop on silent references: the cut cadence is ours alone. Is that worth
  building at all, or should `/ref` refuse a silent clip?
- There is no bar or phrase counter in `AnimFrame`; every scene that wants one
  wraps `anim.barPhase` itself (Gates, Ambience, Powder). Promote it?
- Which draft scenes graduate out of `DRAFT_SCENE_IDS`, and in what order.

## Next up

- Watch Neon Gates on real music (the fake-audio-capture recipe in the
  `headless-app-driving` memory); tune the cut cadence and the onset flash
  against a track, then review #90 and #92.
- Run `/ref` on a clip with audio and a non-neon look to test the picture
  measurement outside the case it was built on.
- Watch the other draft scenes on real music; review #93, #91, #88, #73, #74,
  #72; close #70; prune the idle worktrees.
