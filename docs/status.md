# Status

This file is expected to be rewritten wholesale each session — it's a snapshot,
not a history. Keep it short enough to read in one glance. Use `/wrap` to
regenerate it at session close.

## In flight

- **Plume scene** (this session) — branch `worktree-plume-scene`, draft PR
  opened at session close, rebased onto `main` after Storm landed. A
  beat-burst particle cloud built from a UE4 reference short:
  `src/render/scenes/plume.ts` extends Chladni's RGBA8 ping-pong state to 3D
  position + velocity via MRT (first `gl.drawBuffers` use in the repo),
  continuous emission (`churn`) with a per-beat directional splatter, lit
  premultiplied sprites. Registered as a draft; its settings joined the
  NEUTRAL roster in `tests/autoTune.test.ts`; `tests/plume.test.ts` covers
  the packing/seed/gain helpers. Typecheck and tests green; verified
  headlessly at high/low/floor and in the gallery, probe shows weighted
  settings `auto`, unweighted `manual`. Implemented by a Sonnet subagent from
  the approved plan, tuned by hand against the reference frames. **Not yet
  judged on real music.**
- **Sibling scene sessions** — `worktree-neon-fluid` and
  `worktree-powder-scene` worktrees are locked with no commits yet; every new
  scene touches `src/render/scenes/index.ts` and `tests/autoTune.test.ts`, so
  expect trivial keep-both conflicts there (Plume just had them with Storm).
- **Auto dial ranking** — draft PR #73 (`worktree-auto-dial-ranking`).
- **docs/architecture.md rebuild** — draft PR #74 (`worktree-docs-architecture`).
- **Setting groups vocabulary** — PR #69 (`worktree-setting-groups`), not
  draft; Plume uses plain group strings pending it.
- **Business/legal docs** — PR #72; **stage-1 wrap snapshot** — PR #70.
- **Merged this session:** Storm scene (#41) and the audio source picker (#71).

### Old scratch branches — check before reviving

`band-faders`, `fix-vc-toggle-alignment`, `focus-snap-ladder-fix`,
`governor-fix-and-caustics-followup`, `lp-merge`, `power-mode-governor-probe`
and the older `worktree-*` scratch branches (`docs-index`, `tuning-spotlight`,
`agent-ae8a69d86e9c44e97`, …) are weeks behind `main`; diff each against
current `main` before reviving. `worktree-docs-index` rewrote
`docs/architecture.md` to be the doc map, which `docs/index.md` on `main`
and PR #74 may both have superseded.

## Open questions

- Plume's low/floor tiers compensate for fewer particles by growing sprite
  size (`pointGain` in `plume.ts`), which reads as a chunky voxel cloud at
  `floor` — acceptable, or gate with `minQuality`?
- Plume colour is palette-driven (body at `hue`, hot stop two-thirds around
  the gradient) — red-on-blue only with the Neon palette. Worth a dedicated
  two-colour picker, or leave to the palette?
- Should the Plume PR wait for PR #69's shared group vocabulary, or merge
  with plain groups and migrate?
- Storm's local render-cap workaround (pulse-rise edge detection + its own
  measured dt, see its header) predates `renderLatch.ts` — redundant in
  principle, still correct; simplify once Storm is settled on real music.
- Storm and Dancers still owe a pass on real music (Storm's drop burst and
  strike gain were set against the synthetic feed; Dancers' `Handover`
  setting ships both crossfade and inertial — keep one).
- Does a *partial* auto-gain amount earn its place on a real room, or do
  people only land on 0 or 100?

## Next up

- Review the draft Plume PR; watch it on real music alongside Storm.
- Plume follow-ups noted in its PR body: HDR-ish accumulation + tonemap for a
  denser core, depth-aware sorting/lighting, wall-collected particles.
- Review PRs #73 and #74; merge #69 and migrate scene groups to it.
- Decide whether Storm graduates out of `DRAFT_SCENE_IDS`.
- Explainer artifact for the auto-gain window (live simulation of the
  `features.ts` trackers with the amount slider):
  https://claude.ai/code/artifact/5aef9f8d-a361-4929-adb2-0831943fc375
