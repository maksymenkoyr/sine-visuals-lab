# Status

This file is expected to be rewritten wholesale each session — it's a snapshot,
not a history. Keep it short enough to read in one glance. Use `/wrap` to
regenerate it at session close.

## In flight

- **Storm scene** — `src/render/scenes/storm.ts`, branch `worktree-storm-scene`
  (worktree at `.claude/worktrees/storm-scene`), draft PR #41, now merged with
  current `main` (conflicts were docs-only; `frame.beat` → `frame.onset`
  applied). A volumetric raymarched cumulus lit from inside by a JS-side
  strike pool; `minQuality: "low"`, registered as a draft tile. v3: `Mode`
  leads with Mesh (surface-nets lattice, `buildSurfaceNet`) + Voxel beside
  Gas and Points; `cloudShape` morphs baked variants (`shapePhaseWeights`).
  v4: morphSpeed/morphBeat, spectrumMap Off/Screen/Cloud + spectrumGlow,
  lighting pass (HG strike scattering, flashTint, hue-preserving tonemap).
  v5: **Filaments** default mode (strands through a baked curl field,
  `buildFlowVolume`, `flow` slider); ambient floor slides to near-black below
  its default (`AMBIENT_LIFT_GLSL`); `gasType` enum (`GAS_RECIPES`).
  v6: Filaments' gas underlay gone (pure strands + bolt bloom); the bolt is a
  branched tree (`buildBoltTree`) drawn as a tapered camera-facing ribbon —
  longer, thicker, forked — riding the `bolt` slider; **Dark sections**
  (`sections`): warp-wobbled Lloyd-relaxed Voronoi partition
  (`buildCellSites`, `SECTION_GLSL`) with per-cell glow envelopes
  (`createCellGlow`) lit on beat rises, mid/high rises, and each strike's
  channel — gain touches resting light only.
  Post-v6 fix, prompted by "lightning reacts to sounds weirdly":
  `sectionIntensity.ts`'s `dropOnset` was a level, not the edge its doc
  promised — every tick of a real-music swell read as its own drop, so Storm
  machine-gunned its drop burst; now a latched one-shot edge with release
  hysteresis. Verified headlessly at high/low quality, in the gallery, with
  the probe sign-off; `tests/storm.test.ts` covers the pure helpers and both
  `ALL_SETTINGS` invariant suites include it. **Not yet judged on real
  music.**
- **Controls panel: History/Centroid/Scope traces drawing as dashed under
  load** — branch `worktree-trace-strip-dash-fix`, draft PR #60 (see the PR
  for the carry-fix details; Scope still needs a real-mic check).
- **Caustics: Kick surge gets a position jolt** — branch
  `worktree-caustics-kick-surge` (worktree locked), draft PR #59. Tests and
  headless verification green per the PR description.
- **Always-on dev controls** — branch `worktree-agent-ae8a69d86e9c44e97`
  (worktree idle, not locked), no PR opened yet.
- **`caustics-beat-lurch` worktree** (locked) is at the same commit as
  `main` — no work done there yet; either a session about to start or a
  stale lock worth releasing if nothing's using it.
- **`docs/architecture.md` rebuilt as diagrams-first** — branch
  `worktree-docs-architecture`. Same content as before, reshaped: two mermaid
  flowcharts, basename naming, bold lead-ins; plus a routing-table row in
  `CLAUDE.md` so the doc has a reader, and a broken-path grep in `/wrap` so
  formatting rot is caught like rename rot. Replaces the stranded
  `worktree-docs-index` rewrite, which was pushed after its PR had merged and
  named symbols that no longer exist. **First time a mermaid diagram exists in
  this vault — judge whether it reads better before repeating the treatment.**

### Old scratch branches — check before reviving

`band-faders`, `fix-vc-toggle-alignment`, `focus-snap-ladder-fix`,
`governor-fix-and-caustics-followup`, `lp-merge`, `quality-preset-setting`,
`worktree-audio-visualization+auto-gain-toggle`, `worktree-band-tilt`,
`worktree-collapse-panel-cards`, `worktree-shortcut-s-panel-toggle`,
`worktree-tuning-spotlight` are all a week or more behind `main`, each just a
few commits ahead. `main` has since gained a spectrum-strip fader redesign,
quality presets, and panel-fold work through other PRs, so several of these
read like earlier attempts at the same thing — diff each against current
`main` before reviving rather than assuming it's still needed.
`worktree-docs-index` is superseded by `worktree-docs-architecture` (in
flight above) and can be deleted.

## Open questions

- Storm's local render-cap workaround (pulse-rise edge detection + its own
  measured dt, see its header) predates `renderLatch.ts` landing on `main` —
  now that the loop latches one-shots and passes a render-dt, the workaround
  is redundant in principle. It still behaves correctly; simplify it once
  Storm is otherwise settled, not mid-review.
- Does the Scope waveform's carry fix (PR #60) actually clear the centre-line
  notches under load, the way History/Centroid were confirmed to? Needs a
  manual check with a real or fake-device mic session, not synthetic feed.
- Storm's drop burst and strike gain were set by eye against the synthetic
  feed; a pass with real music and the `/tune` loop is still owed.
- Dancers: which handover reads better on real music — crossfade or inertial?
  Both ship behind the `Handover` setting; keep one.
- Does a *partial* auto-gain amount earn its place on a real room, or do
  people only land on 0 or 100?
- The dozen old scratch branches above: prune, or is anything in them still
  wanted?

## Next up

- Review and land the Storm draft PR #41 (now conflict-free against `main`);
  then decide whether it graduates out of `DRAFT_SCENE_IDS`.
- Watch Dancers and Storm on real music.
- Review/merge draft PR #60 (trace/waveform fix) and draft PR #59 (Caustics
  Kick surge).
- Decide the fate of the idle `worktree-agent-ae8a69d86e9c44e97` branch and
  the old scratch branches listed above.
- Explainer artifact for the auto-gain window (live simulation of the
  `features.ts` trackers with the amount slider):
  https://claude.ai/code/artifact/5aef9f8d-a361-4929-adb2-0831943fc375
