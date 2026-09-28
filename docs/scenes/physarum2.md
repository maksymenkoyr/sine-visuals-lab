# Physarum 2 (`physarum2`)

A second slime-mould scene: SPECIES_COUNT independent strains, each with its
own motion profile and its own trail channel, sensing every strain's trail at
once through a weighted sum (the `att<i><j>` settings, defaulting to
ATTRACT_ROWS) — strongly its own, weakly or negatively everyone else's. That
mutual avoidance is what separates the four networks into distinct,
interlocking coloured territories rather than one shared mesh. A second pair
table, Touch (`touch<i><j>`), lets a strain feed or eat another's trail
directly, on top of what smell alone can do. Featured, on main (a draft until
2026-09-27).

## Where the code is

`src/render/scenes/physarum2.ts` — the header comment is the primary source
for the whole simulation design (strain/attraction-table packing, the
per-step fixed-rate stepper, the RGBA=strain trail, evaporation precision,
the composite's exposure/gamma, and — since 2026-09-27 — the per-strain
settings and the "Uniform budget" note on how they reach the shader without
their own uniforms). Registered as `physarum2Scene` via `registerScene` in
`src/render/scenes/index.ts` (first line of registration, newest first within
its gallery group), and absent from that file's `draftIds`, so featured.

Reuses `packUnit` and `createBeatSeeder` from `physarum.ts` (the same 16-bit
packing round trip and the same beat-rise detector with its own refractory),
and `grainTextureSide` from `chladni.ts` for the agent-state texture sizing.
The GLSL packing/hash/room-mapping helpers are copied into this file's own
`PHYSARUM2_GLSL` shared block rather than exported from `physarum.ts`, so
that file's behaviour is untouched. Exported pure helpers —
`physarum2TrailSide`, `stepAccumulator`, `hueRotateRGB`, the
sensor/turn/stride slider<->physical mapping pairs — are covered by
`tests/physarum2.test.ts` without a GL context, along with structural checks
on `STRAINS`/`ATTRACT_ROWS` and the NEUTRAL auto-tune invariant.

`STRAINS` is the per-strain identity table (code, base colour, fixed sensor
angle); `nutrient<k>`/`excite<k>`/`sensor<k>`/`turn<k>`/`stride<k>`/`stain<k>`
(`src/render/sceneItems.ts`'s `defineItems`, family `"strain"`) and the two
pair tables, `att<i><j>` (Smell, `defineItemPairs`'s default `diagonal: true`
— the own-trail weight is a real setting) and `touch<i><j>` (Touch,
`diagonal: false` — Touch has no own-strain meaning at all), replace the old
shared "Band feed"/"Surge" pair and the fixed `SPECIES`/`PALETTE` constants —
every strain now has its own controls and its own Receives patch. Both pair
tables also set `masterScale: false` (`sceneSettings.ts`'s own field,
honoured by `autoTune.ts`'s `resolveSceneSetting`): a signed relation value's
meaning is its exact position, so the device-wide Scene master must never
scale it. `scene.panel` (one `PanelSection` naming the `itemBoxes` widget —
`src/ui/widgets/itemBoxes.ts`) renders them as specimen boxes + the selected
strain's rows + the Pairs block (`src/ui/widgets/pairPads.ts`'s
`buildPairPads`: a Smell/Touch switch, an own-trail fader strip, one
two-strain-culture pad per pair (`pairsOf`), a Random/Nudge/Keep own
trails/Back mix row and
named presets — replacing the old plain-word rows/SVG-web pair,
`relationRows.ts`/`relationWeb.ts`, both deleted) inside the device menu's
Scene card, ahead of the remaining flat rows (Network scale, Trail decay,
Hostility [renamed from Rivalry, same key `rivalry`], Crawl speed, Beat
seeding, Exposure, Palette tint, Beat flash), each of the latter still
carrying its own `auto` weights as before. `src/render/scenes/
physarum2Affinity.ts` is the DOM-free home for both tables' shared logic and
words: `ATTRACT_ROWS`, `smellWeight` (Hostility folded into a raw Smell
value, shared by the GPU packing and the pads), `packTouch` (Touch's GPU
packing), `PAIR_WORDS` (every word the Pairs widget shows), `AFFINITY_PRESETS`
and the pad/preset/mix-row pure helpers; `src/render/scenes/
physarum2Preview.ts`'s `createPairCulture` is the CPU twin each pad's live
preview steps.

This is also `src/render/sceneItems.ts`/`src/ui/widgets/registry.ts`'s first
real caller — see those files' own headers for the item/panel framework
itself (generic, reusable by any scene), and `tests/sceneItems.test.ts` /
`tests/sceneKeys.test.ts` for its tests.

**Phase 3 (2026-09-27):** live pure-culture previews inside each specimen
box, POP/TERR/VIG readouts, a population bar, Rebalance and the pipette —
`src/render/scenes/physarum2Preview.ts` (a pure, DOM-free port of the
"Physarum Lab" prototype's `createStrainPreview`) driven by
`src/ui/widgets/previews.ts` (a preview-source registry, id "physarum2")
through `resolveStrainEffective` (physarum2.ts, exported — the one
strain-motion mapping the GPU packing and every box's preview both call, so
a box can't drift from what the strain actually does in the main dish).
`scene.ts`'s new optional `Scene.probe()`/`Scene.command()` (phone-local,
never reaching the TV) are how `src/ui/widgets/itemBoxes.ts` reads
population/territory and sends `"inject"`/`"rebalance"` — see physarum2.ts's
own file header for the territory GPU downsample/readback, the population
bookkeeping, and the screen->field mapping the pipette uses. Two settings
were added for it: `seedSpread` ("Spread", replacing the old fixed
`SEED_CLUSTER_RADIUS`) and `seedFrom` ("Auto-inject from"); `seed` itself was
relabelled "Dose". See `tests/physarum2Preview.test.ts` and the Phase 3
additions to `tests/physarum2.test.ts`.

**The Affinity card (2026-09-28).** `pairPads.ts`'s widget no longer appends
into the Scene card body — `itemBoxes.ts` mounts it into its own card via
`WidgetCtx.mountCard` (`src/ui/widgets/registry.ts`), a sibling of the Scene
card built and torn down by `deviceMenu.ts`'s `renderSceneSettings` the same
way, into a `sceneWidgetCardsHost` div placed right after `sceneCard.el`.
Inside it, the Smell/Touch switch, the own-trail strip, the pads grid and the
mix row are each a plain `.vc-row`, made pinnable/soloable through
`WidgetCtx.registerCard` — `deviceMenu.ts`'s `registerPinnableRow`, factored
out of `appendSettingRow`'s own `registerPinRow` for this, so both paths
share one pin/solo/Tab implementation. `registerCard`'s own doc comment
(registry.ts) has the pin-identity rationale: a row like the pads grid or the
mix row edits more than one setting at once, so it's keyed by a *synthetic*
`SceneSetting` (`pairPads.ts`'s `rowSpec` — a unique `key`, unused filler
`label`/`min`/`max`/`step`/`default`, never read by `ctx.get`/`ctx.set` or
uploaded anywhere) rather than a real `att`/`touch` spec that would
misrepresent which cells the row actually edits. Solo/the solo eye/jumpToBlock
now search `sceneWidgetCardsHost` alongside `sceneCard.el` for whichever card
holds the pinned row (`pinnableCards`/`findPinnedRowEl`, deviceMenu.ts).

## References

https://github.com/fogleman/physarum (MIT) — studied for the multi-species/
attraction-table idea and the general shape of a per-step diffuse/decay +
sense/turn/move + deposit loop; https://sagejenson.com/physarum — studied for
the same algorithm description. Neither the species/attraction-table numbers
in `STRAINS`/`ATTRACT_ROWS` nor the strain colours are taken from Fogleman's
own published values — they're this scene's own hand-picked variant (CLAUDE.md:
"just make one of the variants," not randomised). No `/ref` video bundle; no
code was ported (CLAUDE.md's standing rule — written independently from the
published description, the same spirit as `physarum.ts`'s own Jones citation
and `powder.ts`'s curl noise).

## Measurements

- 2026-09-26, GPU cost per sim step, high quality (800k agents), 1920×1080,
  M1 Pro via ANGLE/Metal, headless Chromium, 10 forced steps per frame with a
  1-pixel readback to force GPU completion (`scripts/perf/tput.mjs`).
  ANGLE's timer queries were unusable for per-pass numbers (a 5-tap
  composite read 4.4 ms), so passes were measured by knocking each out:
  - baseline ≈ 5.0 ms/step; deposit ≈ 3.5, sim ≈ 2.2, diffuse ≈ 0.2,
    composite + overhead ≈ 0.24 per frame. At 75 steps/s ≈ a third of the
    GPU.
  - cause: agents are stored in random order, so neighbouring GPU threads
    read and write far-apart trail texels. Static agents seeded in spatial
    order cost 0.72 ms/step vs ≈ 2.75 in random order.
  - prototype fix (periodic spatial re-sort: CPU counting sort by Morton
    cell of a 128² grid, then a GPU gather pass permuting the agent
    textures; `scripts/perf/`): 1.3–1.6 ms/step re-sorting every 75–300
    steps, sort cost included; look unchanged. The synchronous prototype's
    readback + sort took 6–11 ms of CPU per sort.
  - no gain: an exact 9-tap bilinear form of the diffuse blur (bandwidth
    bound, not fetch bound).
- 2026-09-27, pure-culture preview collapse (`scripts/previewcheck.mjs`,
  node): without respawn the widest-turning strain reached 76% of its trail
  in the densest 2% of cells after 900 steps with surges; 0.3–1% respawn per
  step held every strain at ≈ 40–60% visible cells and ≈ 12% densest-2%.
- 2026-09-27, Phase 3 frame time at `?quality=low` with all four box
  previews running: 8.35 ms/frame panel open vs 8.33 closed (no measurable
  cost). Pipette: five taps at Dose 0.01 moved PP-C3 from 25% to 29%.
- 2026-09-27, Touch/Pairs GPU cost per sim step (`scripts/perf/tput.mjs`,
  M1 Pro, headless Chromium ANGLE/Metal, 1920x1080, quality high, 10 forced
  steps/frame, median ms/step; see that script's own header for the
  documented temp hook this needs and never commits):
  - Session 1 (before the deposit's MRT split): Phase 0 baseline 5.14
    (5.11/5.22/5.14 across 3 runs); Phase 1 default 5.64 over 7 runs
    (cluster 5.3-5.7, one 6.89 outlier); Gardens (feed only, MRT off) 5.55;
    War (MRT on) 5.58; Hunt 5.57 — all within noise of the Phase 0/1
    baseline, since none of these presets is far enough from the default
    to show the eating path's own cost yet.
  - Session 2 (after the deposit was split into a plain and an MRT program;
    the machine was noisier this session, every figure roughly 25-30%
    higher including an *unchanged* default, so only the *relative* numbers
    below are informative): default 6.47 over 5 runs (6.16-6.61); an
    interleaved A/B of 6+6 runs comparing the lazy split against always
    running the MRT path gave split ~= 6.34 vs always-MRT ~= 6.44 (the split
    is never slower, ~1.5% faster); War 6.76 (~= +4-5% over default, well
    inside the plan's <= +25% acceptance bar for the eating path turned on).
  - `padcost.mjs` (`?quality=low`, 480 rAF frames): the Pairs block open at
    the pads vs the panel closed, unthrottled: mean delta 0.00 ms. Under a
    4x CPU-throttle stand-in for a phone, opening the device menu AT ALL
    (nothing Physarum2-specific on screen) already costs ~15 ms mean — a
    pre-existing, scene-independent panel characteristic, not this widget's;
    the pads' own marginal cost on top of that (open-at-the-pads vs
    open-at-the-boxes, both throttled) came out negative and not
    measurable: -0.81 ms mean / -2.80 ms p95.

## Decisions and pivots

- 2026-09-26: scene added complete in one pass — species/attraction-table
  sim, per-step fixed-rate stepper (`stepAccumulator`), clustered beat
  reseeding, additive gamma composite, registered as a draft. Built from a
  detailed plan; the initial headless screenshots showed the beat-reseed
  disc saturating to solid white (the default reseed fraction concentrated
  roughly 15% of all agents into a disc covering only ~1% of the trail map)
  and the whole picture reading over-bright with too little black
  background. Fixed by lowering the "seed" setting's default and step
  (0.15 -> 0.03, step 0.05 -> 0.01, since this setting is far more sensitive
  per unit than physarum.ts's own field-wide reseed) and pulling back
  `DEPOSIT`/`GLOW_MIN`/`GLOW_MAX` — see Tuning notes.
- 2026-09-26 (review pass): 0.03 into a radius-0.06 disc still landed as a
  conspicuous white blob a few seconds in; spread it to radius 0.12 at a
  0.01 default so a beat sprouts a faint mixed-colour colony instead.
  Also compared Network scale 0.15 against the 0.5 default: finer scale
  breaks the short-sensor violet species into isolated dots, so the
  default stays.
- 2026-09-26: "Beat surge" relabelled "Surge" (its drive can pick any
  source). User asked for a 4x bigger Surge range: `SURGE_GAIN` 1.5 -> 6.0,
  with the default 0.4 -> 0.1, step 0.05 -> 0.01 and auto weights quartered
  (pulse 0.25 -> 0.06, attack 0.2 -> 0.05), so the default look is unchanged
  and full slider is a 7x step on a hit instead of 2.5x.
- 2026-09-26/27: user asked for "much more interactive and visual" controls
  where each population gets its own drivers, and for an architecture that
  lets any scene have unique custom controls. Prototyped first as a
  clickable artifact ("Physarum Lab", see Materials). v1's 4x4 number grid
  for the attraction table was judged unclear; v2 went lab-themed and
  gamified: a culture dish with a pipette, one specimen box per population
  running a live pure culture, a relationship web with plain-word rows
  (Flees / Avoids / Ignores / Follows / Loves), named experiments, a lab log.
  Framing decided with the user: not four species but four *strains* of
  *Physarum polycephalum* (strains fuse with kin and keep apart from
  incompatible ones, which is what the attraction table models), labelled
  with isolate codes plus an editable nickname. Manual pipette injection
  converts agents to the selected strain, with a Rebalance button.
  Pure-culture previews collapsed to one blob on a small torus; a
  0.5%-per-step random respawn keeps each a live network (measured with a
  node harness: densest 2% of cells fell from 76% to about 12% of the trail
  for the widest-turning strain). Implementation (declarative items +
  widget registry, then per-strain settings here) is planned but not built.
- 2026-09-27: Phases 1+2 of the plan implemented — the approved v3 prototype
  structure (Strains group: four specimen boxes with a placeholder preview
  area, the selected strain's Nutrient/Sensor range/Turn angle/Speed/
  Excitability/Stain as real device-menu rows, an Affinity block below with
  Flees/Avoids/Ignores/Follows/Loves segmented rows, a compact SVG web and
  the five named experiment presets copied from the prototype). Framework
  landed as `src/render/sceneItems.ts` (`defineItems`/`defineItemPairs`/
  `composeSettings`) and `src/ui/widgets/` (`registry.ts`'s `WidgetCtx`,
  `itemBoxes.ts`, `relationRows.ts`, `relationWeb.ts`), wired into
  `src/ui/deviceMenu.ts`'s `renderSceneSettings`. Removed the old shared
  `feed`/`beatSurge` settings and the fixed `SPECIES`/`PALETTE` tables;
  `STRAINS` plus the generated per-strain settings are now the source of
  truth, resolved in JS each frame (drives.value/resolveSceneSetting) and
  packed into `uSpecies`/`uAttractRow`/new `uStrainSurge`/`uStrainFeed`/
  `uStrainColor` uniforms — see the file header's "Uniform budget". Sensor
  range/Turn angle/Speed default to the *inverse* of the old fixed SPECIES
  motion (round-trip asserted in tests), so the default look is unchanged;
  confirmed by headless before/after screenshots at t=10s/20s (same
  palette/density/character; the sim is stochastic so not pixel-identical).
  Selecting another box or an Affinity word triggers a full Scene-card
  rebuild (`WidgetCtx.rerender()`) rather than patching the widget's own
  DOM — reuses deviceMenu's existing jack/cable/pin teardown for free
  instead of a second bookkeeping path; cheap at this scene's row count.
  Live per-strain previews, territory/population readouts and the manual
  pipette are Phase 3, not built yet — the box's preview area is just a
  sized, empty placeholder. Also fixed a latent `tests/sceneKeys.test.ts`
  (new) blocker: importing anything that pulls in `controlsTheme.ts`'s
  `?url` font import failed under Vitest in a git-worktree checkout (the
  symlinked `node_modules` resolves outside the worktree root, and Vite
  denies serving it) — `vitest.config.ts` now sets
  `resolve.preserveSymlinks: true`. No scene record existed yet for this
  under `docs/scenes/physarum2/` beyond the prototype artifacts noted in
  Materials below; this session added no new `/ref` material.
- 2026-09-27 (Phase 3): live specimen boxes, readouts, pipette, Rebalance.
  Refactored the per-strain resolve step first — `resolveStrainEffective`
  (physarum2.ts) is now the one function both `resolveStrains` (the GPU
  packing) and every specimen box's preview call, folding Excitability's
  surge multiplier straight into the packed step distance so `uStrainSurge`/
  `strainSurgeFor` could come out of SIM_FRAG entirely (one fewer uniform,
  one fewer place the two paths could drift apart). `physarum2Preview.ts`
  ports the prototype's `createStrainPreview` faithfully (same
  `RESPAWN_PER_STEP` comment, same 3x3-blur-times-0.9-decay kernel) but takes
  `StrainPreviewMotion` as a plain argument instead of computing it itself,
  so it stays pure/DOM-free and independently testable; `previews.ts`
  (new registry) is what converts `resolveStrainEffective`'s reference-texel
  output into the preview's own cell units, via one constant
  (`REF_TEXELS_PER_PREVIEW_CELL = 4`, picked by eye against a headless
  screenshot — a box's grain now visibly matches each STRAINS entry's own
  one-line character comment: PP-A1 reads as flowing strands, PP-B2 as a
  reticulated mesh, PP-C3 as coarse spots, PP-D4 as fine fuzz).
  `itemBoxes.ts`'s preview canvas uses the exact two-canvas smoothing trick
  the prototype's own `draw()` used (offscreen native-resolution
  `putImageData`, then `drawImage` onto the visible, CSS-scaled canvas) and
  steps (not draws) only every other device-menu tick — measured headless at
  `?quality=low`, panel closed vs the Scene card open with all four
  previews ticking: mean/median frame time were within noise of each other
  (~8.3 ms both ways over 480 frames; p95 identical at ~9.2 ms), so no
  further quality-tier scaling was needed.
  Territory reads a 16x16 box-downsample of the trail (a small dedicated
  `TERRITORY_FRAG` pass — no reliance on GPU mipmap LOD selection, which is
  harder to reason about on a REPEAT-wrapped NPOT texture) through a
  `PIXEL_PACK_BUFFER` + `fenceSync`, polled with a zero-timeout
  `clientWaitSync` every render() so a readback never blocks the render
  loop; a new one only kicks off at most every 500 ms and only while
  `probe()` has actually been called in the last 2 s. Population is tracked
  with no readback at all: `applyInjection`'s
  `pop_k <- pop_k*(1-d) + (k==strain?d:0)` matches, in expectation, what the
  GPU's uniform-random inject pass actually does. The pipette's tap-to-field
  mapping (`screenToFieldUv`) is a pure JS twin of the composite shader's own
  `roomAspect()`/`coverUv()`, plus `uncoverUv` as its exact algebraic
  inverse — headless-verified end to end: arming the pipette, selecting
  PP-C3 and 5 real taps at the same screen point moved its population from
  25% to 29% (matching the "Dose" default of 0.01/tap by hand-calculation)
  and left a visible teal colony at the tap point; Rebalance returned every
  strain to exactly 25%. `seed` was relabelled "Dose" (it now also reads as
  the pipette's own injected share, not just the beat's), and its old fixed
  `SEED_CLUSTER_RADIUS` became the "Spread" setting (`seedSpread`) so the
  pipette and the automatic beat reseed share one live control; a new
  "Auto-inject from" enum (`seedFrom`) restricts which strain the *automatic*
  trigger may move agents from (never converting species, unlike the
  pipette — matching the prototype's own rule). The 3-line lab-log ticker
  from the prototype was skipped (the brief allowed it: "skip if it
  clutters") — the POP/TERR/VIG readouts plus the population bar already
  cover what it would have narrated.
- **2026-09-27, multi-strain editing.** A box click now TOGGLES a strain
  in/out of the edit group instead of replacing the selection — any
  combination stays selected, an "All" chip picks every strain at once, and
  an "Editing PP-A1 + PP-C3" (or "Editing all strains") line above the boxes
  names the current set (`src/ui/widgets/itemSelection.ts`, new pure module,
  `tests/itemSelection.test.ts`). Rows still show only the PRIMARY strain's
  own (the lowest selected index), but every edit made there — a value, an
  Auto toggle, or a drive/patch change — now fans out to every other
  selected strain's same setting. The mechanism is generic, not
  physarum2-specific: `src/ui/widgets/registry.ts`'s `WidgetCtx.appendRow`
  grew an optional third argument, `{ ownLabel, linked }`
  (`LinkedSetting[]`), and `deviceMenu.ts` applies any edit on that row to
  `linked` too through the two choke points that already existed for a
  single-item row — the row's own `onChange`/`auto.toggle` for a value, and
  `patchChanged`/a new `syncLinkedDriveSetting` (plus a new
  `DeviceMenuDeps.onSetDriveSetting`, wrapping `driveStore.ts`'s own
  `setDriveSetting`) for a drive/patch edit — rather than a second parallel
  edit path. A drive/patch edit copies the whole resolved `DriveSetting`
  (`"scene"` included) onto every linked strain's own setting verbatim; that
  first felt wrong for Nutrient (whose scene default is *each strain's own
  band*, not one shared thing) until realizing copying `"scene"` is exactly
  correct — each strain then keeps reading its own band, only a real patch's
  *sources* actually get shared. `createControlRow` grew an optional
  `linkedTicks` (a divergent-value tick per linked strain, drawn on the
  slider track at that strain's own value, in its own colour, only while it
  disagrees) and a `setLinkedTicks` method the caller refreshes right after
  its own commit, since a linked strain's own row never renders while
  selected together — nothing else can change what the tick should show.
  Affinity's per-row fan-out is `itemSelection.ts`'s own
  `affinityRowTargets`: the "→ own trail" row sets every selected strain's
  own diagonal, a "→ target" row sets every selected strain *except the
  target itself* toward it, and a small "mixed" pill shows when the
  selection disagrees on a row (`relationRows.ts`); the web overview
  (`relationWeb.ts`) now lights every selected node, and a node click toggles
  like a box. Also fixed while in there: a box click's `ctx.rerender()`
  rebuilds the whole Scene card, and `itemBoxes.ts` used to recreate every
  specimen box's preview sim from its fixed seed on every rebuild, so all
  four cultures restarted from noise on *any* click (a box, an Affinity
  word, anything). Preview sims now live in a small module-level cache keyed
  by `${sceneId}:${family}:${index}`, looked up (not recreated) on each
  rebuild and reattached to whatever new `<canvas>` that rebuild made —
  headless-verified by screenshotting one box's preview before/mid/after two
  extra rerender-triggering clicks: the trail pattern is visibly the same
  evolving shape throughout, not reset.
- **2026-09-27, solo/group selection + no redraw on click.** Two changes to
  the box-selection UX, requested together: (1) a tap on a box BODY (or a
  relation-web node) now *solos* — the selection becomes exactly that one
  strain, even if a group was active — instead of toggling; a small
  checkbox in each box's header corner (`role="checkbox"`, >=24px touch
  target) is now the deliberate way to build a group (ticking adds,
  unticking removes, never empty), and a Shift/Cmd/Ctrl-modified tap on the
  body does the same toggle for a mouse user. (2) A selection change no
  longer calls `ctx.rerender()` at all — every box click used to rebuild the
  whole Scene card, flashing every row and (before the preview-cache fix
  above) every specimen box. `src/ui/widgets/registry.ts`'s `WidgetCtx` grew
  `mountRows(container, rows)`, a scoped sibling of `appendRow`:
  `deviceMenu.ts` snapshots `sceneRowHandles`/`driveRowHandles`/
  `driveSparkCanvases` before and after building `rows`, so the returned
  `dispose()` can unregister exactly what that call added (and its
  `linkedByKey` entries) and pull its own DOM back out, then trigger the
  existing cable recompute — mirroring the pinned-row reconciliation a full
  `renderSceneSettings()` does, scoped to just the rows it built. `itemBoxes.ts`
  now builds its boxes (and their live preview canvases/sims) exactly once
  per widget mount; a selection change only (a) updates box classes/
  checkboxes/the "Editing …" line in place, (b) disposes and re-mounts the
  rows section through `mountRows`, and (c) clears and rebuilds the Affinity
  web/rows/presets host in place (that block has no deviceMenu registrations
  of its own, so a plain `replaceChildren()` rebuild already is the scoped
  update — confirmed by reading `relationRows.ts`/`relationWeb.ts`). A
  preset apply or an Affinity-row click also stopped calling
  `ctx.rerender()`: they only ever touch `att<i><j>` settings, which the
  rows section never shows, so refreshing just the Affinity host is enough.
  `ctx.rerender()` is still what a Look apply or a card Reset use.
  Headless-verified (real mouse down/wait/up throughout): the solo/toggle/
  checkbox/Shift-click/All sequence from the brief; a tagged box element and
  its preview canvas survive a *different* box's click (same DOM nodes, not
  recreated) with before/after screenshots showing no blank/flash; a
  same-selection slider drag doesn't remount the row it's on; and a cable
  wired from a jack onto a pinned row disappears cleanly (no crash, no stale
  path) once that row's strain is no longer primary and its DOM is disposed
  . Review fix the same day: the first build left `pinned` on the hidden
  row; `mountRows`' dispose now unpins it and hands the pin to the same
  control on the newly shown strain (`pinHandoff` in deviceMenu.ts), so the
  patch bay follows "Nutrient" from PP-A1 to PP-B2.
- **2026-09-27, rebase onto the panel pinning rework (#166, #168, #169,
  #151).** `main` added `pinRowHandles` (every row registers, drive or
  not), click-anywhere card pinning, Solo and `SceneSetting.family` accents
  while this PR was open. Resolved in `deviceMenu.ts`: `appendSettingRow`
  takes both new trailing parameters as `(…, accent, opts)`, and
  `mountRows` also snapshots and disposes `pinRowHandles`, or a strain
  switch would leave stale pin handles behind. The pin handoff uses
  `main`'s pin-only `pinSetting`. Merged as #153 (squash 646b1ce).
- **2026-09-27, featured.** Taken out of `draftIds` on the user's call, in
  the same change that moved Physarum and Slats behind the draft toggle.
  Code untouched.
- **2026-09-27, Affinity rethink (prototype only).** The user found the
  word chips limiting (`RELATION_WORDS` can only write five points of the
  −1.5…+1.5 `att<i><j>` range, and a preset's in-between value is lost on
  the first click) and the block "not fun, not comfortable". Agreed so far:
  continuous sliders with the words as landmarks under the track, **no
  snap**, and a Random button that re-mixes the table. Before building,
  the user asked for interface ideas: "Affinity Studio" (Materials) shows
  Pairs (one 2D pad per pair, both directions in one drag, corners named
  Merge/Wall/Chase, each pad a live two-strain culture), Orbit (drag a
  trail closer to follow it) and Rows (the agreed sliders), plus Random,
  Nudge, Keep own trails, Auto and a strip of past mixes with snapshots.
  Waiting on the user's pick.
- **2026-09-27, is the parameter set complete? (prototype only).** Before
  going deeper into the interface the user asked whether the core sim is
  missing a dimension. Compared with Fogleman's per-species config
  (sensor angle, sensor distance, rotation, step, deposit, decay): the
  sensor angle is fixed in `STRAINS.sensorAngleRad`, `DIFFUSE_FRAG` fades
  all four channels with one `uDecay`, and the population split is always
  equal. Those are per-strain rows. The one missing *pair* dimension:
  strains interact only by smell (`att` weights the sensing; each agent
  deposits only into its own channel, `onehot4(k)` in `DEPOSIT_VERT`), so a
  strain can't eat or feed another's trail. Affinity Studio v2 adds that as
  a second table, Touch (feed = add to that trail at the landing cell, eat =
  keep only part of it), editable through the same views behind a
  Smell / Touch switch, plus a per-strain sensor angle / trail life / share
  bench. Headless look, about 7 s after each preset: War (everyone eats
  everyone) formed clean banded territories with sharp fronts, a look Smell
  alone doesn't make; Hunt (each strain chases and devours the next) stayed
  fog, because a chaser erases the road it follows. In the app, eating
  can't be a negative deposit into the RGBA8 trail; the likely route is a
  second deposit target counting each strain's steps, eroded in the diffuse
  pass. Waiting on the user's call.
  (Correction, 2026-09-27: this entry's "a look Smell alone doesn't make"
  claim for War overstated it — a fair side-by-side (fresh seed, 8 s each,
  Rivals) showed Rivals *without* Touch also forms banded territories;
  eating mainly sharpens and separates the bands that Smell alone already
  draws. The GPU build below agrees: War reads crisper/thinner-lined than
  the no-touch control, and Hunt becomes a thin interlocking filament web
  rather than the flat fog this entry describes.)
- **2026-09-27, Affinity Studio v3: Pairs plus the full Touch table
  (prototype only).** Fills the gap the two entries above left open — the
  prototype commits that recorded this pick ("Affinity Studio v3, Pairs only
  with Touch as a full table" and the naming commits after it) changed only
  `affinity-studio.html`, with no matching record entry. The user's calls,
  in order:
  continuous values with no snapping to the five word landmarks (the first
  entry above); a Random button to re-mix a table; before building anything,
  interface ideas — "Affinity Studio" (Materials) prototyped Pairs (one 2D
  pad per pair, both directions in one drag, each pad a live two-strain
  culture), Orbit (drag a trail closer to follow it) and Rows (plain
  continuous sliders); the user picked **Pairs** ("it looks awesome"), and
  Orbit and Rows were removed from the prototype. Touch itself (second entry
  above) was prototyped both as a full n\*n table and as a one-knob "Bite"
  variant (each strain eats the trails it avoids by smell, one shared knob);
  the user chose the **full table** ("ok lets do fulltable pairs"). Then,
  on the pads: each axis is simply that strain's value toward the other,
  "−" to "+" (the verb captions were "weird words"); no corner labels ("what
  merge in a context of smell even means"); and no band words anywhere
  ("very confusing"). The prototype keeps its Off / One-knob Touch modes and
  a naming-set switcher (None by default) for comparison only; nothing in
  the shipped panel can switch to them.
- **2026-09-27, Pairs + Touch built (Phases 0-3, this session, a
  Sonnet-executed plan).** Touch reached the GPU and the panel in the order
  above: pair tables and Hostility folding first, then Touch's own sim path,
  then the Pairs pads' pure logic and DOM, then the pads' Random/Nudge/Keep
  own trails/Back mix row on top. Design points, referenced by file:
  - **Touch on the GPU: one extra render target, not a second deposit
    draw.** Feeding a trail costs nothing extra — the deposit's own colour
    becomes a *row* instead of a onehot (`touchFeedRowFor(k)` in
    `physarum2.ts`'s `DEPOSIT_VERT`), so at Touch = 0 the result is
    bit-identical to before. Eating needs to know how many of each strain
    landed on a texel last step, which a second draw over all 800k agents
    would double the deposit's own ~3.5 ms/step cost to get; instead the
    same deposit draw writes a second RGBA8 attachment (the "footprint",
    `ensureFootprintTargets`) counting landings per strain, and the next
    step's `DIFFUSE_FRAG` turns that count into an exact per-channel decay
    (`packTouch`'s `eatCols`, one `texelFetch` against the footprint). The
    **lazy `eatOn` path**: the footprint texture, its framebuffers and the
    diffuse's extra fetch only exist once `packTouch` finds any negative
    (eating) Touch value that step — the default scene and any feed-only
    table (Gardens) run exactly the passes they did before Touch existed.
    Measured cost is in Measurements above: War (every pair eating) lands at
    +4-5% over the default, inside the plan's <= +25% acceptance bar; the
    split-vs-always-MRT A/B shows the laziness itself is never slower.
  - **One shared formula for Hostility.** `smellWeight(att, i, j, rivalry)`
    (`physarum2Affinity.ts`) replaced the inline `w = row * (own +
    (1-own)*(uRivalry*2))` `SIM_FRAG` used to compute itself; `resolveStrains`
    now packs `uAttractRow` already Hostility-scaled in JS, and the same
    function is what a pad's own live culture calls, so neither path can
    drift from the other the way two copies of that formula eventually
    would.
  - **The master exemption and `diagonal: false`.** Both pair tables set
    `masterScale: false` (`sceneSettings.ts`'s new field, read by
    `autoTune.ts`'s `resolveSceneSetting`) — the device-wide Scene master's
    range is [0, 2], and ×0 or a clamped ×2 would change which relation a
    signed value *is*, not just how strong it reads, while the panel kept
    showing the unscaled stored number. Touch also sets `defineItemPairs`'s
    new `diagonal: false`: Touch has no own-strain meaning at all, so the
    four `touch<i><i>` keys that a plain pair table would otherwise emit
    (dead weight in every Look and share code) never exist.
  - **Naming kept as data, not deleted.** Every word the Pairs widget can
    show lives in `PAIR_WORDS` (`physarum2Affinity.ts`), including the parts
    this build turned off: `showRelations` is `false`, so a pad's header
    shows its own two live signed values (each in its strain's colour)
    instead of a relation name, and a pad draws no corner labels — both
    because the user found them unreadable ("what does merge in a context of
    smell even mean") once they read each axis as simply that strain's value
    toward the other ("−" to "+", not a sentence). The band words
    (Flees/.../Loves, Devours/.../Nurtures) are unused for the same reason
    ("very confusing" — numbers only, everywhere a pad or the status line
    reads a value) but stay in `PAIR_WORDS` as tested data, exactly like
    `showRelations`, rather than being deleted — a later session can flip
    either back on without re-deriving the words.
  - **Selection as lit/dim pads.** A box click's existing selection channel
    (`itemBoxes.ts`) now also reaches the Pairs block: `setSelection` toggles
    `vc-pad-sel`/`vc-pad-dim` on whichever of the six pads touch a selected
    strain, without rebuilding any DOM — the same "build once, update in
    place" rule the whole widget follows so a pad's own live culture is
    never restarted by a click.
  - **Back is a stack in memory.** `pairPads.ts` keeps a small
    `pairState.history` array per mount key, capped at `MIX_HISTORY_MAX`
    (20, `physarum2Affinity.ts`'s `pushHistory`/`popHistory`) — every
    Random, Nudge and preset push a `{smell, touch}` snapshot before writing,
    and Back pops one off. It's module-level like the pad culture cache, so
    it survives a Look apply or a card Reset (both rebuild this widget from
    scratch), but a page reload starts it empty. Every write goes through
    `writeTable`, which skips any cell already at the value being written —
    Random/Nudge/Back/a preset would otherwise persist all 12-16 settings to
    localStorage on every click (`sceneSettings.ts`'s own per-`ctx.set`
    persist) regardless of how many cells actually moved. Fixed one latent
    bug found while wiring this: `pairPads.ts`'s `tableOf("touch")` used to
    read the Smell diagonal into Touch's diagonal slot (for `tablesMatch`'s
    benefit), which meant a touchy preset's own pill could never read as
    pressed since every preset's Touch diagonal is exactly 0; it now reads
    0 there directly, matching every Touch table Touch ever actually has.
  - **The final `TOUCH_*` gains.** `TOUCH_FEED_GAIN` moved from the
    prototype's 1.0 to 0.15 by eye on the GPU: at 1.0, Gardens (every strain
    feeding every other) roughly triples a channel's incoming deposit and
    clips the whole picture to white; 0.15 keeps black dominant while
    feeding still visibly brightens a fed trail (see Known issues below for
    what's still left of Gardens' own brightness). `TOUCH_EAT_GAIN` (0.3) and
    `TOUCH_MAX_BITE` (0.9) kept the prototype's own values — War and Hunt
    both read clearly without needing a change, and eating after the blur
    (see the plan's own Risks) is absorbed into this same gain rather than
    given a separate correction term.
  - **Two small script fixes, kept.** `shot.mjs --settings` used to be
    silently ignored (`applyTuningParams` only reads `settings` when `scene`
    is also set); it now passes both. `tput.mjs` gained a `--settings JSON`
    flag and a documented temporary hook (its own header) for forcing a
    fixed step count per frame — never committed to `physarum2.ts` itself.
  - Tuned and screenshotted against synthetic audio only (`bpm=120`); not
    yet checked against real music from a mic (same standing gap as every
    other tuning note in this record).
- **2026-09-28: pad and box previews move with the music.** The user: "these
  doesn't move at all. like 0 dynamic." Both live previews (a specimen box's
  own single-strain culture and a pad's two-strain culture) read their drives
  through `WidgetCtx.driveValue`, which reports 0 while a control is still on
  its Scene default — the common case, since Nutrient and Excitability are
  driven by their Scene source by default (each strain's own band, and the
  beat pulse; `resolveStrains`), not by a patched source — so every preview
  ran as if the room were silent even while the main dish reacted normally. `probe()` now
  reports every strain's live drive readings (and the automatic beat reseed's
  `seedEpoch`/`seedDose`/`seedRadius`, as actually resolved) alongside
  population/territory, and `effective()` prefers those over `driveValue`;
  each pad also mirrors the reseed itself via the new `seedColony`. Pads step
  on a wall-clock time budget (`PAD_STEPS_PER_SEC`, capped per tick by
  `PAD_MAX_STEPS_PER_TICK`) instead of once every other panel tick, which had
  been running them at a quarter of the scene's own pace on a 30 fps display,
  and the pad cultures are drawn less dimmed under their chrome. Landed in
  c900a28.
- **2026-09-28: the Affinity block becomes its own card.** The user: "the
  problem is this whole card not clickable and never gets focus" (unlike
  every other row in the panel, it never woke on hover/focus and a press
  never pinned it) and "also can u add some air. make this for example as
  separate card, with gaps [pointing at the pads grid]. mb u can see couple
  others good examples." Landed as `WidgetCtx.mountCard`/`registerCard`
  (registry.ts) — see "Where the code is" above for the mechanism — with the
  Smell/Touch switch, own-trail strip, pads grid and mix row each a plain
  `.vc-row` (wakes on hover/focus, pins on press, Escape unpins, Solo shows
  only it). `.vc-pads`' own gap grew from the original 12px to 18px for the
  "gaps" the user pointed at. Immediate follow-up, same session, after
  reviewing a screenshot with a strain box selected: "why only three works?
  clean up this focus mess around this card" — the box-selection lit/dim
  styling this widget had carried since it was built (`setSelection`,
  `vc-pad-sel`/`vc-pad-dim`/`vc-own-sel`/`vc-own-dim`, "Selection as lit/dim
  pads" above) read as broken once only some pads kept their normal look, so
  it was removed outright: every pad and own-trail fader now renders
  identically regardless of the box selection, and the only highlights left
  in the card are the standard `.vc-row` wake/pin rings and each pad/fader's
  own `:focus-visible` outline — for keyboard focus only: a pad or fader
  focuses itself on a pointer press (so its arrow keys work) with a
  preventDefault'ed press, which Chrome reads as keyboard focus and ringed
  inside the pinned row's own ring; `pairPads.ts`'s `pointerFocus` tags
  that focus so the ring stays off until a key is pressed. itemBoxes.ts's
  own box selection (the strain rows below the boxes) is unaffected.

## Tuning notes

Judge the look by whether black background still dominates and the four
strains read as distinct, interlocking territories rather than one washed-out
mass — `DEPOSIT`, `GLOW_MIN`/`GLOW_MAX` and "Dose"'s default all trade off
against this (see the file header's budget comments on each). "Dose" (key
`seed`) is unusually sensitive: because reseeded/injected agents land in one
small disc ("Spread", `seedSpread` — replacing the old fixed
`SEED_CLUSTER_RADIUS`) rather than scattering across the whole field the way
`physarum.ts`'s own beat seeding does, a share that would look subtle
field-wide saturates that disc solid white instead — this is why its `step`
is finer (0.01) than every other setting here. The pipette (Phase 3) reads
this exact same setting as its own injection share, so the same sensitivity
applies there too. Tuned so far only against the synthetic feed at
`bpm=120`; not yet judged against real music through a mic.

## Known issues and next steps

- Not yet checked against real music from a mic — synthetic-feed tuning only.
- "Dose" confused the user: it is the share of all agents moved into one new
  colony per trigger (default a beat-pulse rise), and the share each Pipette
  tap converts. At 0.48 half the dish jumps every beat and the rest goes
  dark. The label and description don't say that plainly yet.
- Performance: the spatial re-sort in Measurements (≈ 3.5× cheaper steps,
  look unchanged) is prototyped, not built. A real version needs an async
  readback (PBO + fence) and the sort off the main thread; the same fix
  likely applies to `physarum.ts`.
- The reseed burst's brightness/size still trades off against `DEPOSIT` and
  `GLOW_MIN`/`GLOW_MAX`; a future pass might want its own exposure term
  instead of sharing the composite's global exposure, if a louder track needs
  a bigger burst than the ambient network can take without blowing out.
- Fixed one attraction-matrix variant as the default ("Rivals"), per the
  plan's scope — a future session could explore alternate defaults (a
  `variant`-style setting, following Kaleidoscope's `Style` pattern) if more
  looks are wanted from this same mechanism.
- The nutrient/excite/sensor/turn/stride/stain settings carry no `auto`
  table (unlike the global Form/Motion/Look/Post rows) — a scene-wide Auto
  toggle currently leaves every strain's own controls manual. Not asked for
  in this round; worth a look if per-strain auto-tuning is wanted later.
- Not checked against a scene-wide Look save/apply round trip with the new
  per-strain keys — Looks ignore unknown keys by design (a Look saved before
  this change simply won't touch any strain control), but no explicit test
  covers a Look captured *after* this change surviving a reload.
- Vigour (VIG) comes from `probe()`'s `vig<k>`: the signal actually feeding
  the strain's Nutrient in `resolveStrains`, scene default included. The
  first Phase 3 build read `WidgetCtx.driveValue` instead, which is 0 until a
  source is patched in, so VIG sat at 0.00 on defaults; fixed in review
  (2026-09-27). The Nutrient row's own sparkline still follows the panel-wide
  convention of showing only a patched source.
- Territory's 16x16 downsample uses a real box filter (a small dedicated
  `TERRITORY_FRAG` pass, not GPU-generated mipmaps) precisely to avoid
  relying on LOD auto-selection on a REPEAT-wrapped NPOT texture — not
  measured against an alternative approach, so if it ever shows up in a
  profile, mipmaps are the next thing to try.
- Pipette armed-state is a single in-memory map keyed by (scene, family) —
  correct for Physarum 2 today, but a hypothetical second itemBoxes-based
  scene would need its own distinct family name to avoid sharing the
  "armed" bit (Physarum 2's own family is already "strain", so this is only
  a risk for a future scene that reuses that exact name).
- No 3-line lab-log ticker (leader-change-with-hysteresis, last
  inject/rebalance events) — the plan allowed skipping it if it clutters;
  the POP/TERR/VIG readouts and the population bar cover the same ground
  without a fourth thing to read.
- The multi-strain edit's Auto-toggle fan-out (`appendSettingRow`'s
  `linked` propagation, deviceMenu.ts) is generic but unexercised here:
  none of the per-strain settings carry an `auto` table yet (the
  nutrient/excite/sensor/turn/stride/stain bullet above), so there's no
  live case where toggling A actually had anything to fan out to. Worth a
  real check once per-strain auto-tuning exists.
- The pipette now always injects the PRIMARY strain (the lowest selected
  index) regardless of how many are selected — it never had a selection of
  its own, and multi-select didn't add one; picking a specific strain to
  inject still means selecting it alone first.
- Switching strains with a row pinned for patching: `mountRows`' dispose
  (deviceMenu.ts) unpins the removed row and hands the pin to the same
  control on the newly shown strain (pinned PP-A1 Nutrient → PP-B2 Nutrient),
  so the patch bay never stays aimed at a hidden row. A hover preview on a
  removed row is cleared the same way. (The first no-redraw build left the
  pin on the hidden row; fixed in review, 2026-09-27.)
- **Touch/Pairs (2026-09-27).** Tuned and screenshotted against synthetic
  audio only, same as every other tuning claim above. The MRT cost in
  Measurements is measured only on the M1 Pro's tile-based GPU via
  ANGLE/Metal; an immediate-mode-renderer GPU (most desktop/laptop dGPUs)
  pays for the second attachment differently and is unmeasured. The pair
  cultures' own preview (`previews.ts`'s `pair.weights`) reads Hostility
  through `WidgetCtx.get`, i.e. the *stored* `rivalry` value, not its
  Auto-resolved one — the same gap `registry.ts`'s `get` doc already flagged
  before Touch existed, now with one more reader. Touch carries no
  `auto`/drive of its own, matching `att`. Symbiosis (Gardens' own smell
  table) converges strains onto shared paths on its own, and Gardens' Touch
  (every strain feeding every other) adds to that — even after lowering
  `TOUCH_FEED_GAIN`, Gardens still reads as washed toward white rather than
  the black-dominant look the Tuning notes above ask for (confirmed by a
  headless screenshot 8 s after pressing the Gardens preset); a preset-level
  Exposure override, or a lower Gardens-specific feed gain, are the two
  obvious next things to try, not done here. A pad's own one-line `how` text
  (`PAIR_WORDS`) is the only explanation of what a positive/negative number
  means; the user found the numbers alone unclear and was offered a fixed
  legend line ("+ steers toward that trail, − steers away" for Smell / "+
  adds to that trail, − erases part of it" for Touch) — not yet decided, not
  built. `touch-action: none` on all six pad squares (needed for a
  pointer drag to control the pad instead of panning the page) was checked
  only by screenshot at 390 px this session, not with an actual touch-pan
  gesture past a pad; by the same reasoning as the plan's own Risks section,
  a real phone may find scrolling past the Pairs block awkward unless the
  drag starts on a long-press instead.
- Not built (Touch/Pairs follow-ups): a glide/slew between two tables
  instead of an instant jump (a preset, Random, Nudge and Back all write
  every changed setting in one frame today); mix thumbnails on the mix row
  or the presets so a past mix can be recognised before restoring it; an
  Auto re-mix wired as a Receives patch on the Random button; per-strain
  sensor angle / trail life / population share as their own rows (the
  "is the parameter set complete?" entry's own per-strain gaps, still
  equal-population and one shared `uDecay`); the one-knob "Bite" Touch
  variant the prototype also built, kept for comparison only.

## Materials

- Artifact "Physarum Lab" (controls prototype, private):
  https://claude.ai/artifact/UhgRTMw36hB6mFBccP7ada — source in
  `physarum2/artifacts/`: `lab.src.html`, `strainPreview.js` (the shared
  strain-motion mapping and pure-culture preview), `engine.js` (fake-music
  engine from the drives prototypes); `node build.mjs` writes the page,
  `node look.mjs [--click]` screenshots it at wide and phone width.
- Artifact "Affinity Studio" (Affinity interface ideas, the Touch table and
  the per-strain knob bench, private):
  https://claude.ai/artifact/7Ja3hE75HJecRHF29bRHiY — self-contained source
  `physarum2/artifacts/affinity-studio.html` (publish it as is; its culture
  is `lab.src.html`'s dish stepper generalised to any subset of strains). v3
  (2026-09-27, the version actually built) is the same file cut down to
  Pairs, with Touch as a full table, plain "−  A → B  +" axes and no corner
  words; its Off / One-knob Touch modes and naming-set switcher remain for
  comparison only (Decisions and pivots' "Affinity Studio v3" entry).
- No `/ref` bundle. Headless shots for tuning:
  `docs/scenes/_shared/scripts/shot.mjs --scene physarum2 --bpm 120
  --settings '{…}'` (the session's scratch variant only differed in taking a
  list of capture times). `--settings` was a silent no-op before this session
  (`applyTuningParams` only reads it once `scene` is also set, and the script
  didn't pass `scene`); fixed as part of Phase 0 of the Pairs/Touch plan.
- Scripts, in `physarum2/scripts/` (run from the repo root with a dev server
  up; `--port` to match):
  - `panelshot.mjs` — opens the panel (`#menuBtn`), scrolls to the Scene
    card, screenshots at a given width.
  - `solocheck.mjs` — the strain-selection check: solo / checkbox / Shift /
    All, no-redraw (tagged DOM survives a click), no remount on a slider
    drag, cable and pin handoff on a strain switch. Two of its checks are
    stale: "cable-disappears" fails correctly now that the pin moves to the
    new strain (the remaining cable is its scene-default source), and
    "no-console-errors" trips on the worktree font 403s.
  - `previewcheck.mjs` — node harness for the pure-culture collapse numbers
    in Measurements.
  - `perf/` — `tput.mjs` plus the spatial re-sort prototype
    (`p2-prof-sort-prototype.diff`, `_p2sort.ts`, `_p2prof.ts`); see the
    header of `tput.mjs` before using it. `tput.mjs` also grew a `--settings
    JSON` flag (applied after `goto`, `scene: "physarum2"`) and its header
    now documents, rather than links to a stale diff for, the temporary
    forced-step-count hook a Touch/War perf run needs in `physarum2.ts`'s
    `render()` — copy it in by hand, measure, then `git diff` must show
    physarum2.ts untouched again; never commit it.
  - `padcheck.mjs` — the Pairs pads' own headless check: real mouse
    down/wait/up drags on a pad and an own-trail fader, the Smell/Touch
    switch, selection dim/highlight, a panel close/reopen (a culture must
    not restart), and (Random/Nudge/Keep own trails/Back) a preset applying
    exactly, Back restoring the pre-preset tables exactly, a Touch-layer
    Random leaving Smell alone, and a Smell Nudge with Keep own trails
    leaving every own-trail fader unchanged. Also takes the panel
    screenshots (both layers, 1440/390) and, through the same real preset
    pills, the main-scene screenshots 8 s after War/Hunt/Gardens.
  - `padcost.mjs` — the pads' own frame-time budget: mean/median/p95 over
    480 `requestAnimationFrame`s at `?quality=low`, the panel closed vs open
    at the pads, plain and under a 4x CPU-throttle phone stand-in, with an
    "open at the boxes, no pads visible" control so the pads' own marginal
    cost isn't confounded with the pre-existing cost of opening the panel at
    all under throttling (see that script's own header, and Measurements).
- Phase 3's pipette and frame-time checks were one-off session scripts and
  weren't kept; their results are in Measurements.

## Resume here

`npm run dev`, then `/?audio=synthetic&bpm=120#/v/physarum2`. Pure logic
(`physarum2TrailSide`, `stepAccumulator`, `hueRotateRGB`,
`resolveStrainEffective`, the sensor/turn/stride/seedSpread slider<->physical
mappings, `equalPopulation`/`applyInjection`, `classifyTerritory`,
`roomAspectJs`/`coverUvJs`/`uncoverUvJs`/`screenToFieldUv`) and the
STRAINS/ATTRACT_ROWS shape are exercised by `tests/physarum2.test.ts`,
including the NEUTRAL auto-tune invariant and the "defaults reproduce the old
fixed motion" round trip; `physarum2Preview.ts`'s own sim (determinism, the
respawn floor/ceiling claim) is `tests/physarum2Preview.test.ts` — which also
covers `createPairCulture`, the two-strain twin `pairPads.ts`'s live pads
step (determinism, `pixelsInto`'s shape/alpha, that a negative Touch value
actually lowers the fed-on strain's `totals()` and a positive one raises it,
diagonal Touch a no-op); `tests/sceneItems.test.ts`/`tests/sceneKeys.test.ts`
cover the generic item/panel framework this scene is the first caller of;
`tests/sceneMaster.test.ts` covers `masterScale: false`'s exemption from the
device-wide master. `tests/physarum2Affinity.test.ts` is
`physarum2Affinity.ts`'s own suite — `packTouch`/`smellWeight`'s GPU-packing
math, the vocabulary shape (`PAIR_WORDS`, `AFFINITY_PRESETS`), the pad/preset
pure helpers (`wordBand`/`pairZone`/`pairRelation`/`fillTemplate`/
`padPos`/`padValue`/`pairsOf`/`tablesMatch`), and the mix row's own pure
logic (`randomSmell`/`randomTouch`/`nudgeTable`/`pushHistory`/`popHistory`,
each exercised with a seeded `mulberry32`, never `Math.random`). Every word
the Pairs widget shows lives in `PAIR_WORDS`
(`src/render/scenes/physarum2Affinity.ts`) — re-word there, never in
`pairPads.ts`. Both the original lab-controls plan (specimen boxes, Pipette,
Rebalance, selection) and the later Pairs/Touch plan (this record's
Decisions entries from "Affinity rethink" on) are fully built now — what's
left is Known issues above (mic-verified tuning, per-strain Auto, the
skipped ticker, Gardens' white wash, the pads' own legend line) rather than
a missing phase. A headless Playwright screenshot (see
`docs/scenes/_shared/scripts/shot.mjs` for the pattern this followed) is the
fastest way to judge a tuning change without a mic; for the panel itself,
`#menuBtn` opens it and a real mouse down/wait/up (not a scripted `.click()`)
is what actually exercises a box, a Pairs pad drag, Rebalance or Pipette
press; a plain `.click()` is fine for a button that isn't a drag (a preset
pill, Random/Nudge/Keep own trails/Back, `padcheck.mjs`'s own convention).
The pipette's own canvas listener lives on `#gl` directly and outlives a
panel close (only a Scene-card rebuild disposes it — `ctx.onDispose`), so a
headless check can arm it, close the panel for an unobstructed tap, then
reopen to read the readouts back. A `vite.shot.config.ts` wrapper
(`server.fs.allow` for the main checkout, so `@fontsource` woff2s don't 403
behind this worktree's symlinked `node_modules`) is the untracked fix for the
panel rendering in system fonts headlessly (not needed for the scripts to pass).

## History

- #153 (squash 646b1ce, merged 2026-09-27): the scene (2026-09-26), then the
  same PR grew the lab-controls prototype (`physarum2/artifacts/`), the
  generic item/panel/widget framework (`src/render/sceneItems.ts`,
  `src/ui/widgets/`), per-strain settings and Affinity, live specimen boxes
  with readouts, Pipette and Rebalance, multi-strain editing, and solo/group
  selection without a card rebuild — each step is a dated entry under
  Decisions and pivots.
