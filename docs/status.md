# Status

This file is expected to be rewritten wholesale each session — it's a snapshot,
not a history. Keep it short enough to read in one glance. Use `/wrap` to
regenerate it at session close.

## In flight

- **Ink Synth mobile seams fix** — branch `claude/mobile-rendering-cutoffs-z3a7l0`
  (2026-09-19). The phone showed the picture cut into shifted polygons: the
  same unbounded value-noise hash Caustics had (#102), now in Ink's marbling
  warps. The integer lattice hash and `wrapFlow` moved out of `caustics.ts`
  into `src/render/noiseHash.ts` so both scenes share them; Ink wraps its
  flow offsets per fbm octave (`noiseFlows`) and its sine phases
  (`sinPhases`) on the JS side. Verified with a headless harness rendering
  the old and new shader at a huge flow phase (old collapses into
  cell-aligned blocks, new does not) plus real-app phone-size captures on
  `main` and the branch. Needs a look on the actual phone that showed it.
- **Draft scene PRs from `/ref`** waiting on review and a real-music judgement:
  Slats #100, Neon Gates #90, Neon Fluid #76, plus whatever the last snapshot
  listed that hasn't landed since (Moiré #104, Ink #96 and Crystal #95 are on
  `main` now).
- **Runtime:** Song-boundary instrumentation #93; beat-rate setting #88;
  Auto tempoLock/dial ranking #73; mic latency status line #103.
- **Dev/docs:** gallery preview scheduling #91; docs/architecture.md rebuild
  #74; business/legal docs #72. PR #70 is a stale status snapshot — close it.

## Open questions

- Other scenes hash with `fract()` of a large product and also add `uTime` or
  `uFlowPhase` to a noise coordinate (`grep -l "fract(" src/render/scenes`
  crossed with `uFlowPhase|uTime` — Storm and Powder lead the list). None has
  been reported broken on a phone yet; move each onto `noiseHash.ts` when it
  is, or pre-emptively if a session has a phone to check on.
- Ref loop: a re-rolling noise field (Moiré) reads as hundreds of "hard cuts"
  to the histogram detector — should `refburst` report a per-frame
  decorrelation figure alongside cuts?
- Ref loop: `reflook` finds nothing on light-ground references — fold a
  light-ground path into `tools/reflook.py`?
- Runtime: `beatClock.ts` half-time preference on slow ambient tracks, and a
  real section-change signal, are recurring to-dos.
- Which draft scenes graduate out of `DRAFT_SCENE_IDS`, and in what order.

## Next up

- Open the PR for the Ink seams branch; confirm on the reporting phone that
  the cutoffs are gone, in Ink and still in Caustics.
- Review the queue of draft scene PRs; decide graduation.
- Close #70; prune idle worktrees and stale scratch branches on origin.
