# Status

This file is expected to be rewritten wholesale each session — it's a snapshot,
not a history. Keep it short enough to read in one glance. Use `/wrap` to
regenerate it at session close.

## In flight

- **Caustics on mobile: seams and dashed lines** — branch
  `claude/mobile-caustics-rendering-7binpj` (2026-09-11), no PR yet. The
  drift phase reached the shader raw and grew without bound, so the value-noise
  hash lost precision: phones showed the pattern breaking along noise-cell
  boundaries, with `fwidth` lighting the breaks up as dashes. Fixed in
  `src/render/scenes/caustics.ts`: `driftFlows` wraps every offset modulo
  `NOISE_PERIOD` in JS, and `hashCell` is an integer hash periodic in the same
  period (see the file header's precision paragraph). Verified headless
  (old vs new at a long-session phase) and by `tests/caustics.test.ts`; not yet
  confirmed on the reporting phone.
- **Scenes from `/ref`, all draft PRs:** Slats #100, Shards #97, Ink Synth
  #96, Crystal Wall #95, Neon Gates #90, Neon Fluid #76. Each is waiting on a
  real-music judgement before leaving `DRAFT_SCENE_IDS`.
- **Ready for review:** gallery preview scheduling #91, dev-server scene link
  #98, business/legal docs #72.
- **Drafts on the runtime:** song-boundary instrumentation #93, beat-rate
  setting controls #88, Auto tempoLock/dial ranking #73, docs/architecture
  rebuild #74. PR #70 is a stale status snapshot this file replaces — close it.
- Recently on `main`: per-PR preview Worker deploys (#101).

## Open questions

- Caustics: the other scenes that add an ever-growing phase to a hashed
  coordinate (grep for `uFlowPhase` and per-scene accumulators under
  `src/render/scenes/`) have the same exposure on long sessions. Audit them
  with the same `driftFlows`/periodic-hash pattern, or leave until one shows?
- Caustics: the phone reports came from a room host (`room:` in the HUD). Is
  a host session simply longer-lived, or does the pairing path change anything
  in how the scene is driven?
- Which draft scenes graduate out of `DRAFT_SCENE_IDS`, and in what order —
  six are now queued.
- Stale scratch branches on origin (`git branch -r --no-merged origin/main`):
  prune, or is anything in them still wanted?

## Next up

- Open the PR for the Caustics fix and have it checked on the reporting phone
  after a long run; if it holds, sweep the other scenes for the same pattern.
- Watch the six draft scenes on real music; land or drop, and decide
  graduation order.
- Review #91, #98, #72; close #70.
