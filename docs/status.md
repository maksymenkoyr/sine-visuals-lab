# Status

This file is expected to be rewritten wholesale each session — it's a snapshot,
not a history. Keep it short enough to read in one glance. Use `/wrap` to
regenerate it at session close.

## In flight

- **Slats scene** — draft PR #100, branch `worktree-slats` (2026-09-11), the
  fifth scene built through the `/ref` loop (YouTube qtPi0JvmWbs at 0:15–0:20):
  a monochrome wall of translucent slats, `src/render/scenes/slats/`. Syncs to
  onsets and the high band; layout reshuffles gate on bar wraps only while the
  tempo clock is locked. Look was matched by frame statistics against the
  reference frame rather than by eye — the memory note `slats-scene` has the
  method and the three brightness bugs it found. Not yet `/tune`d.
- **Other `/ref`-built draft scenes** waiting on review and a real-music
  judgement: Shards #97, Ink Synth #96, Crystal Wall #95, Neon Gates #90; older
  draft scenes Neon Fluid #76 (Plume #75 is gone from the open list — check
  whether it landed or was closed).
- **Ref loop on `main`:** scan #85, picture measurement #92, bursts/slit-scan
  #94 all landed. Every scene above came out of it.
- **Infrastructure drafts:** beat-rate controls #88, gallery preview
  scheduling #91, song-boundary instrumentation #93, auto dial ranking #73,
  docs/architecture rebuild #74; dev-server single-scene link #98 and the
  business/legal docs #72 are ready for review. PR #70 is a stale status
  snapshot this file replaces — close it.
- Worktrees with no open PR (`git worktree list`): `agent-ae8a69d86e9c44e97`,
  `bake-defaults`, `claude-md-git-workflow`, `dev-scene-links`, `docs-index`,
  `ref-bursts`, `setting-groups`, `tessera`, `tuning-spotlight`. Check
  `git log main..` on each before reviving; several look landed or superseded.

## Open questions

- Beat clock: `AnimFrame` carries no bar or phrase counter (`beatClock.ts`
  keeps `beats` internal), so a scene cannot react to a phrase start even when
  the reference does. Expose a counter, or a rank like the ref tools compute?
- Tempo lock: on the Slats reference our clock sat well above the true tempo
  for the whole clip (the same run-to-run instability noted on earlier refs).
  Scenes are now written to avoid `beatPhase` for one-shots; is that the
  permanent rule, or does the comb in `features.ts` get fixed?
- `SignalId` has only a handful of registered signals, so a setting driven by
  energy or the high band cannot show a chip. Add them, or keep chips for
  one-shots only?
- Which draft scenes graduate out of `DRAFT_SCENE_IDS`, and in what order.
- `tools/ref-shoot.mjs` needs the bundle's absolute path from a worktree
  (`tools/.cache` lives in the main checkout). Worth resolving against the
  main checkout automatically?

## Next up

- `/tune slats` at two BPMs; clean up slab tops (hairs still denser than the
  reference), make the right-edge curl and vanishing point visible; then
  review #100.
- Watch the `/ref` scenes (#100, #97, #96, #95, #90) on real music; decide
  which land and which graduate.
- Review #98, #72; close #70; decide the fate of the idle worktrees.
