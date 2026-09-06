# Status

This file is expected to be rewritten wholesale each session — it's a snapshot,
not a history. Keep it short enough to read in one glance. Use `/wrap` to
regenerate it at session close.

## In flight

- **Ref loop measures the picture** — PR #92, branch `worktree-ref-look`
  (2026-09-06). `tools/reflook.py` sits beside `tools/ref-scan.py` and measures
  each visual regime's frames as structure: lit objects by shape class, size vs
  distance from centre, depth rings and fold, stroke and glow in pixels, hue
  clusters, and flow from object tracking (direction, radial-speed law, spin).
  Output is the "Picture, measured" section of `report.md`, `look.png` and
  `look.json`; `--look-only` re-measures a bundle. Built after the user rejected
  the first `/ref`-built scene: "you need to be extracting more visual
  information in the first place" (memory note `ref-visual-measurement-depth`).
- **Neon Gates** — draft PR #90, branch `worktree-neon-gates`,
  `src/render/scenes/gates/`. First scene built through `/ref`, from a silent
  VJ loop (`tools/.cache/refs/neon-groove/`). Its cut scheduler
  (`advanceGates`) is tested and sound, but the picture was designed from
  thumbnails and the new measurement contradicts it: the reference spins about
  three times faster, flies backward in most regimes, and its hexagons are 3D
  prisms with depth, not flat rings. Needs a rebuild from the measured numbers,
  not tuning; the user has not yet chosen between real 3D geometry and
  correcting the existing fold-and-slots shader.
- **Landed since the last snapshot:** the `/ref` loop itself #85, dev-server
  scene links #89, CLAUDE.md Git & PRs #84, share-audio guidance #87.
- **Other draft PRs** waiting on review or a real-music judgement:
  Song-boundary instrumentation #93, gallery preview scheduling #91, beat-rate
  controls #88, Neon Fluid #76, auto dial ranking #73, architecture rebuild #74.
  Business/legal docs #72 is ready for review. PR #70 is a stale status
  snapshot this file replaces — close it.
- Worktrees with no open PR (`git worktree list`): `agent-ae8a69d86e9c44e97`,
  `bake-defaults`, `claude-md-git-workflow`, `dev-scene-links`, `docs-index`,
  `setting-groups`, `tuning-spotlight`. Several are landed; prune before reviving.

## Open questions

- Neon Gates rebuild: instanced 3D wireframes with a perspective camera (a new
  rendering model for the repo), or keep the SDF tunnel and fix spin, direction,
  colour? The measurement favours 3D; the cost is a second scene architecture.
- Ref loop: `reflook.py`'s object detector is tuned on one reference (neon
  outlines on black). Bright fills, textured or non-black grounds will need the
  mask thresholds revisited — check `look.png`'s overlay panel on any new clip.
- Ref loop on silent references (both "4K Night Light" clips so far): the scan
  reports silence and invents no sync, so the scene's sync rules are ours alone.
  Is a cut cadence without audio worth building at all, or should `/ref`
  refuse a silent clip?
- There is no bar or phrase counter in `AnimFrame`; every scene that wants one
  wraps `anim.barPhase` itself (Gates, Ambience, Powder). Promote it?
- Ref loop: tempo lock differs between runs of the same clip, and our `section`
  signal never rose at a reference's section boundaries — both still open.
- Which draft scenes graduate out of `DRAFT_SCENE_IDS`, and in what order.

## Next up

- Decide the Neon Gates rebuild route, then rebuild it from the "Picture,
  measured" numbers and shoot it with `tools/ref-shoot.mjs` against the bundle.
- Run `/ref` on a clip with audio and a non-neon look to see whether the picture
  measurement holds up outside the case it was built on; then review #92.
- Watch the draft scenes on real music; review #93, #91, #88, #73, #74, #72;
  close #70; prune the idle worktrees.
