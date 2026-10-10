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

The Strain Console (2026-09-29): `src/ui/widgets/strainConsole.ts` (the
lanes, the mix row with Random/Back/the motion presets, and the Synergy row
with Shuffle/New palette — its header is the source for the gestures),
`src/ui/widgets/consoleMath.ts` (the pure arithmetic,
`tests/consoleMath.test.ts`), mounted by `itemBoxes.ts` as its own
"Strain settings" card (the panel title, `PANEL`'s `console.title`) between
the Strains block and the Affinity card. The colour
harmony fit is `physarum2Synergy.ts` (pure, `tests/physarum2Synergy.test.ts`),
the recruiting rule is `SIM_FRAG`'s Headcount block (`SWITCH_MAX`'s comment
has the rule), and the measured headcount is `POP_FRAG` through
`createPixelReadback` (one census with Territory and Auto level: one fence,
one drain).

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
strain's rows inside the device menu's Scene card, ahead of the remaining
flat rows (Network scale, Trail decay, Cross-smell — the `rivalry` key, once
labelled Rivalry, then Hostility — Crawl speed, Beat seeding, Exposure, Palette
tint, Beat flash), each of the latter still carrying its own `auto` weights as before;
and the Pairs block (`src/ui/widgets/pairPads.ts`'s `buildPairPads`: a
Smell/Touch switch, an own-trail fader strip, one two-strain-culture pad per
pair (`pairsOf`), a Nudge/Keep own trails/Back mix row and named
presets — replacing the old plain-word rows/SVG-web pair,
`relationRows.ts`/`relationWeb.ts`, both deleted) in its own Affinity card
right after the Scene card ("The Affinity card" below). `src/render/scenes/
physarum2Affinity.ts` is the DOM-free home for both tables' shared logic and
words: `ATTRACT_ROWS`, `smellWeight` (Cross-smell folded into a raw Smell
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
and `powder.ts`'s curl noise). Studied again on 2026-10-02 for more ideas
(Decisions, "Fogleman's extras"): per-species auto-levelling in his renderer,
his unused weighted turn rule, grids that start as noise, a random table that
leans own-positive/others-negative, random species configs and the viewer's
palette keys. Again ideas only: none of his numbers, palettes or saved
configs are used.

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
- 2026-10-02, Auto level's peaks on the default dish (headless Chromium,
  SwiftShader, `?quality=low`, synthetic 120 BPM, ~30 s in): PP-A1 0.2,
  PP-B2 0.39, PP-C3 0.26, PP-D4 0.8 (`levelPeaks`, trail units). The fine
  fuzz strain reads about four times the highways strain, which is what
  Auto level evens out: at 1 the gains came to about 1.9 / 0.9 / 1.2 / 0.5.
- 2026-10-02, motion search (`scripts/motionsearch.mjs`, seeds 11 and 23,
  nine rolls each, SwiftShader, 25 s hold): the five new `MOTION_PRESETS`
  are rolls s11-01 (Cells), s11-04 (Coral), s23-05 (Weave), s23-06
  (Islands) and s11-07 (Grains); the rest read as variations of the default
  mesh. SwiftShader runs far fewer steps per second than a GPU, so the
  presets are worth a look on real hardware.

  - 2026-10-02, `padresponse.mjs` (the pads' own CPU pair culture, shipped
    default motion, 500 steps, 4 seeds, no beat reseeds, one direction swept
    with the other at its `ATTRACT_ROWS` default; overlap = Σ min over 6×6-cell
    blocks of each strain's normalised trail). Smell A1 → B2: 0.19–0.23 for
    every value from −1.5 to 0, then 0.30 / 0.43 / 0.50 at +0.25 / +0.5 /
    +0.75, then 0.54–0.56 from +1 to +1.5. A1 → D4: 0.31–0.36 flat below 0,
    0.43 → 0.66 from +0.25 to +1, flat after. So only 0…+1 of the ±1.5 range
    changes the picture, and the default table sits wholly below 0. Touch
    A1 → B2 (B2's trail over A1's): feed 1.04 → 1.22 from +0.25 to +1.5 under
    any Smell; eat 0.94–0.98 under the default Smell (they never meet) but
    0.73 → 0.42 from −0.25 to −1.5 when both attract at +0.6. A pad settles on
    a new value in 60–120 steps (1–2 s at `PAD_STEPS_PER_SEC`). The pad's own
    pixels (exposure 0.85, clamp) clip the graded half into what reads as a
    single jump, the first sweep's mistake before raw trails were read
    (`PairCulture.trails()`). `padmodels.mjs`: neither a probability gate
    nor a value-scaled smell reach made avoid strength change the overlap.
- 2026-10-04, promo footage (PR #313, `tools/promo/motion.py`, Stable 0.2.0,
  a 175 BPM drum & bass track through the fake mic, 64 beats after the drop):
  the scene's **defaults** plus Random every 8 beats barely pulse with the
  music — motion 4.61, beat pulse 1.08, sync to onsets 0.11. The user's saved
  look (drives: Speed boost ← beat wave, Speed pump and Seed ← low onset,
  Flash ← onset) pulses clearly: 5.32 / 1.48 / 0.32 untouched, 5.80 / 1.52
  with Random every 8 beats on top (Random keeps the drives). The first promo
  cut re-rolled presets every 2 beats on the synthetic feed; the user found
  half of it flat — a dish needs a few beats to grow into its pattern.
- 2026-10-04, "strong lags" with the panel open (user's Power card: High
  pinned, 2912×1804, 24 fps falling to 11, main thread 54%, GPU 16.2 ms, Panel
  blur on). Headless Chromium on the same M1 Pro (ANGLE/Metal, 1456×902 at
  dpr 2, synthetic 124 BPM, panel open, 6 s CPU profiles plus a wrapped
  `getBufferSubData` timer):
  - Panel closed: 120 fps rAF, every readback ≈ 0.3 ms. Panel open with blur
    off: ≈ 1 ms a readback. Panel open with blur on: 10–15 ms a readback —
    each one waits behind the GPU process's backlog (the blur re-filters the
    canvas every frame). The main thread then shows ~35% in
    `getBufferSubData`: the Master card's Picture meter (15 a second,
    whenever the panel was open) and this scene's Territory/Headcount/Auto
    level (up to ten a second between them, drained after the frame's steps).
  - Forced layouts: the leash gauge read `clientWidth` every tick (≈ 5% of
    the main thread); the strain boxes wrote `--c` and then read the preview
    canvases' size every tick (≈ 10%). The spectrum strip's axis text ≈ 2%.
  - Fixed in one PR: the Picture meter samples only while its block is on
    screen, the three readbacks are one census (one fence, one drain, before
    the steps), observed sizes instead of per-tick reads, boxes redraw only
    on the ticks they step, the axis is cached, and the box sim uses one
    cos/sin pair per agent. Scrolled to the Scene card, blur on: renderer
    main thread 84% → 60% busy (Chrome trace), readbacks 136–152 → 23–24
    per 6 s and 1.5–2.1 s → 0.3–0.4 s of stall, preview `step` 754 → 490 ms.
    fps was too noisy to call on a shared machine (main 63–101, fix
    100–112). Still open: the sim's own ≈ 5 ms/step GPU cost (the spatial
    re-sort below), and the panel redrawing at the display's rate (120 Hz
    on ProMotion) while the scene renders at its cap.

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
- **2026-09-28: the per-strain settings are next (prototype only).** The
  user, pointing at the Strains block (specimen boxes + the selected
  strain's rows) and the Affinity Studio's per-strain knob bench: "now lets
  address the rest of setting and these in particular … rn its unusable".
  Prototyped as "Strain Console" (Materials): all four strains' settings at
  once, as Lanes or Knobs, with Sensor angle, Trail life and a Share bar
  added. Nothing built; the user closed the session to finish the rest of
  the UI in a later one — see Resume here.
- **2026-09-28: Strain Console v2–v5 (prototype only).** The user asked why
  the Share split was set by hand: "should't it be a consequences of out
  other settings". The Share bar became a read-only Headcount: agents
  switch to the strain whose ink *per agent* beats their own ×1.5 under
  them, with a 4% floor, plus a Switching slider and Rebalance. Comparing
  raw ink snowballed (D4 at Trail life 0.97 took 88% and A1 died); per agent,
  the strains coexist (defaults ≈ 15/30/25/28%, same D4 change ≈ 46–48%) —
  `scripts/recruit.mjs`. Then, on request: knobs drag on both axes
  (right/up = more, Shift fine, Alt all four, default tick), a faint + / −
  on each knob that lights toward the drag and fades at a limit, and stain
  **Synergy** (the user's idea): the stains they set are kept, and what's
  shown is pulled toward the nearest four-hue harmony, anchored on the stain
  being set. Checks: `scripts/consolecheck.mjs`, `knobcheck.mjs`,
  `synergycheck.mjs`. Scene not changed for any of it yet.
- **2026-09-28: pads are flat around the zero line.** The user: when the
  pointer crosses the line where a relation flips, the change should be
  "much smoother around this divider line". `padValue`/`padPos` now bend by
  `PAD_CURVE` (value grows as the distance from the line squared; the edges
  still reach the full range), and the own-trail faders read the pointer
  through `padValue` too — they had used a straight full-height mapping
  while drawing with `padPos`, so the thumb drifted off the pointer away
  from the middle. Measured on a 119 px pad (`scripts/padcurve.mjs`): 5% of
  the width from the line went from ±0.18 to ±0.02, 10% from ±0.36 to
  ±0.09, 20% from ±0.71 to ±0.34.
- **2026-09-28, drive-defaults audit.** "If a parameter doesn't have a
  driver it should not affect the scene; wire it appropriately to what they
  were using as default, rather than turning it off by default" (one of
  four featured scenes audited — see sky.md, caustics.md, chladni.md for the
  others). Sensor range, Turn angle, Speed and Stain (all four strains) went
  from a Scene default that read a bare 0 (inert until patched) to that
  strain's own band — `STRAIN_BAND_SIGNALS`, the same per-strain band
  Nutrient already defaults to — each with a per-item `drive.gain`
  (`MOTION_JACK_GAIN` 0.15 for the first three, `STAIN_JACK_GAIN` 0.2 for
  Stain) taming a sustained band level before it reaches `pushToward1`/the
  hue shift. Both couplings were already identity at drive 0, so no formula
  changed. The gains were tuned from side-by-side headless frames (synthetic
  120 BPM, t=15 s and 21 s) against the pre-change look: a first cut at 0.4
  motion turned the curly, looping network into long straight parallel
  streams, and 0.5 stain rotated the red strain to salmon-orange on the loud
  synthetic bass; at 0.15/0.2 the loops and the strains' own colours are
  back while each strain still moves and tints with its band. The Scene
  fallback passed to `drives.value` for these four is the band times the
  same gain, so gallery tiles (`PASSTHROUGH_DRIVES`) match the real dish.
  Nutrient's own Unplug bug got a separate fix: `feed = lerp(1,
  FEED_BASE + FEED_GAIN * drive.nutrient, raw.nutrient)` read drive 0 as its
  rest, which put `feed` at `lerp(1, FEED_BASE, raw.nutrient)` — a raised
  slider laid down *less* trail once its jack was unplugged. `NUTRIENT_REST
  = (1 - FEED_BASE) / FEED_GAIN` is now passed as `drives.value`'s own
  `rest` everywhere Nutrient's drive is read (`resolveStrains`,
  `previews.ts`'s Strains preview), so `feed` is exactly 1 — the plain
  slider, no drive at all — the instant nothing is plugged in.

- **2026-09-29: the Strain Console is built.** The user answered the two
  open calls: **both** layouts (Lanes and Knobs, a switch at the top of the
  card) and **all four** extras real: Sensor angle, Trail life, Headcount and
  Synergy. What changed:
  - Settings. `angle<k>` is a plain slider in degrees (5-120), default each
    strain's own `STRAINS.sensorAngleRad`. `life<k>` is 0-1, default 0.5;
    `lifeToDecayMul` scales the shared Trail decay by 2^(+-1.5) across the
    slider (`DIFFUSE_FRAG`'s `uLifeMul`, one multiplier per channel; right =
    the trail lasts longer). Global `switching` (Motion, default 0.4) and
    `synergy` (Look, default 0). Neither `angle` nor `life` has a jack (they
    were never audio-driven). Every default reproduces the shipped look except
    that Switching is on.
  - Headcount. Agents change strain in `SIM_FRAG`: the prototype's rule
    (ink per agent under them, x1.5 margin, a 4% floor, 5% x Switching per
    step) plus `SWITCH_PRESSURE`. The prototype's plain per-agent ink, ported
    as is, ended 4/35/12/49% (synthetic 120 BPM, 15 s, `?quality=low`): PP-D4's
    tight network lays a far denser trail per agent in this dish than in the
    prototype. Dividing by (share x strains)^2 instead settles at 16/32/18/35
    with all four alive (`scripts/headcountcheck.mjs`), close to the
    prototype's 15/30/25/28. Not tuned against real music.
  - The counts. `POP_FRAG` writes each 8x8-ish block's strain fractions into a
    32x32 target, read back every 250 ms while the panel is open or Switching
    is on; the JS-tracked `population` is now only the instant expected value
    after a Rebalance or a pipette tap. `createPixelReadback` was factored out
    of the territory code and serves both.
  - Synergy. `physarum2Synergy.ts` is the prototype's fit. The scene infers
    the anchor itself from which *stored* stain changed last (one alone =
    the anchor; several at once - Link, Alt, a Look, a reset - frees the
    rotation), so nothing extra travels between phone and TV. `probe()` now
    reports `shownStain<k>` and `harmony`, so the console's Stain controls show
    what the dish shows and start a drag from it (a grabbed stain becomes the
    setting), and the previews tint with the shown colour. Checked with real
    mouse drags (`scripts/consoledrive.mjs`): raw +0.22 / -0.08 with Synergy at
    1 shows +0.197 / -0.08 (the hand-set one exact) / +0.053 / -0.002, nearest
    Rectangle.
  - The panel. The boxes lost their selection: a tap aims the pipette at that
    strain and arms it. The one-strain-at-a-time rows and the multi-edit
    `linked` fan-out are no longer used by this scene (the bridge stays in
    `deviceMenu.ts` for a future item widget). A press on a lane or knob ends
    by mounting that setting's real row under the grid (`ctx.mountRows`) -
    where its jack, Receives patch and reset live. `PanelSection.settings`
    (new) lets a widget claim plain settings so the Scene card's flat list
    skips them: Switching sits under the headcount bar, Synergy under the
    stains. `solocheck.mjs` went with the selection.
  - Checks: `npm run typecheck`, the full suite (2321 tests), headless
    Playwright on the panel in both layouts (`scripts/consoleshot.mjs`), the
    headcount freezing at Switching 0 and moving otherwise, no shader errors.

- **2026-09-30: Synergy made the other stains jump.** User: "when synergy turned
  on stains movement is odd." Dragging one stain slowly round the wheel at
  Synergy 1 (simulated on the real tracker, 1° steps) made the other three
  shown hues snap 30-120° in one step about ten times a revolution. Cause:
  `HARMONY_STICK` kept the harmony's *name* only, so which strain sits at which
  place was re-picked from scratch every change, and any ordering that won by a
  hair moved three hues at once. Fix in `physarum2Synergy.ts`: the sticky choice
  is now harmony *and* place (`HarmonyFit.place`), and the shown pull eases to
  the fitted one over `SETTLE_SECONDS` (the tracker's new `dt`); the stain being
  dragged is exempt and stays under the pointer, and at rest the pull settles
  exactly on the fit. `tests/physarum2Synergy.test.ts` drags a stain a full turn
  at 60 fps and bounds the other hues' per-frame move. Screenshots of the dish
  at Synergy 0 and 1 render clean; the glide itself is timing and was judged
  from the test, not a frame.

- **2026-10-02: a Quality pick now remounts the scene.** Review finding: the
  agent count is `quality.maxParticles * AGENT_MULTIPLIER`, read once in
  `init()`, and the governor only ever moves the cheap composite
  (`renderScale`, steps, detail) - never the agent count. The Quality menu
  changed `quality` in place without a remount, so picking Low while in this
  scene kept the High preset's agents until the next scene switch. The device
  menu's Quality choice now calls `applyRenderQuality(true)` in `src/app.ts`,
  so the culture re-seeds at the new count. The scene file is unchanged.
- **2026-10-02: Hostility became Cross-smell; widget and sim review fixes.**
  The `rivalry` slider read backwards once any off-diagonal Smell cell was
  positive: under Mob or Symbiosis, dragging "Hostility" right made strains
  pull *harder* onto each other's trails, against the "right = more" rule.
  `smellWeight` scales every off-diagonal weight by its size whichever way
  the sign points, so the label now names what grows: **Cross-smell**, "how
  strongly each strain reacts to the others' trails". Relabel only: the key
  stays `rivalry` (saved looks and share codes keep working) and the maths and
  every tuned picture are unchanged; the name is a placeholder the user may
  prefer to change. Same review: a beat reseed that landed on a frame owing
  zero sim steps was swallowed (`pendingSeed` now holds it like the pipette and
  Rebalance one-shots); a Headcount readback kicked before a pipette tap or
  Rebalance no longer overwrites the instant value (`popGen`); `POP_SIDE` 32 to
  128 spreads the population count over many fragments instead of a few long
  loops (same shares); pair cultures now honour each strain's Trail life
  (`decayKeep`, shared with the specimen boxes). Panel perf: previews and
  pads fill one cached `ImageData` per box (`pixelsInto`), the Pairs pads reuse
  the boxes' per-tick strain readings, `previews.ts` caches the settings
  lookup, and the Strain Console and the pad status line write the DOM only
  when something changed. The dead multi-item selection helpers in
  `itemSelection.ts` went; the linked-row path in `registry.ts`/`deviceMenu.ts`
  is still there (nothing supplies it) for a later pass.

- **2026-10-02: Fogleman's extras.** User, after a review of what else
  fogleman/physarum had to offer: "lets implement all and expose controls to
  everything." Each piece is a control:
  - **Auto level** (`level`, Look). His renderer normalises each species'
    grid to its own range. A max-pool pass (`LEVEL_FRAG`) and the existing
    non-blocking readback give each strain's road brightness
    (`levelPeaks`: the block peak `LEVEL_TOP_SHARE` of blocks reach);
    `levelGainsFull` evens them around their geometric mean. The first
    build normalised each strain to a fixed target instead: at full strength
    it lifted a dim strain's haze and darkened less of the field, so it now
    only evens the strains and Exposure keeps the overall brightness.
    Default `LEVEL_DEFAULT`.
  - **Wander** (`wander`, Form, default 0 = the old rule): his alternative
    turn rule, unused in his own code, written as `weightedTurn` in
    `SIM_FRAG`. One change from the description: an all-equal reading holds
    course instead of always turning one way (that rule turns every agent on
    an empty patch the same way, into circles).
  - **Start ink** (`startInk`, Form) and **Fresh dish** (a chip beside
    Rebalance, `command("fresh")`): a new trail is filled with uniform
    noise. Half of the first `START_INK_MAX` washed the first frames pink,
    so the range came down and the default is small (`START_INK_DEFAULT`).
    Fresh dish is phone-local, like Rebalance and the pipette.
  - **Random over the whole range** (the Pairs card's half of the Strains
    card's one Random): every Smell cell rolls over the whole range, even
    across the control that draws it — own trails across the fader
    (`rollOwn`, so a strain can come out self-avoiding), other pairs across
    the pad (`rollSmellPair`). A Rivals toggle that kept every roll in the
    Rivals preset's shape (own trail followed, everyone else's avoided) was
    removed on 2026-10-03; the Rivals preset gives that table in one press.
  - **Random motion and motion presets** (the Strain Console's new mix row):
    Random rolls `MOTION_PARAMS` for every strain over the sliders' whole
    ranges (which already span his random
    config ranges); Back undoes; the pills are `MOTION_PRESETS`, found by a
    headless random search (`scripts/motionsearch.mjs`, Materials) and named
    by what they grow. "Lab" is the shipped motion.
  - **Shuffle / New palette** (under the Synergy wheel): his viewer's
    palette keys. Shuffle hands the colours on screen round the strains in a
    new order; New palette deals a random harmony from `HARMONIES` at a
    random rotation. Both only write the stains, so Looks, the TV and Back
    see a plain stain change, and Synergy keeps working on top.
  - Checks: `npm run typecheck`, `npm run test`, headless screenshots of
    the dish before and after and of the panel, and a scripted click through
    every new button.
- **2026-10-02: Pairs pads read as noise; ideas page before building.** The
  user (screenshot of the Smell pads): the monitors are "not very
  informative", they "barely show any change"; the "− A1 → B2 +" axes are
  "still very not informative", it's simply attracts / repels ("mb more
  biological term"), maybe "some kind of hint around mouse cursor"; and
  adjusting the scene with the pads is "hard and confusing" because "often we
  don't see any change". Asked for an artifact with all ideas first. Measured
  before proposing (Measurements, 2026-10-02): the Smell range is flat below 0
  and above +1, the defaults are all below 0, the pad monitor clips and adds
  two similar hues, Eat bites only pairs that meet. Ideas page "Readable Pairs
  pads" (Materials): contact colours, own exposure, an overlap meter, settle on
  release, hold still while touched, crisp pixels (ask); axis-end words and a
  cursor hint (avoids · seeks / eats · feeds recommended; "attracts" reads
  backwards against "A1 → B2"); a controller-only spotlight dimming the other
  strains, hatched flat ends, a Touch "rarely meet" tag, squeezed flat ends
  (ask). No sim change proposed (`padmodels.mjs`). The user: "a bit hard to
  wrap my head around", wants to "experience how a regular user would" → a
  second page, "Pairs Card Trial" (Materials), with no charts or idea
  switches: a stand-in dish and three whole versions of the card to try cold
  (Today; Clearer pads = contact colours, squeezed Smell range, corner
  pictures for apart/together/who chases whom, settle on release, spotlight,
  one-sentence hint; Pick a look = per pair, nine live mini-cultures from the
  three looks each direction really has, tap one). The user picked **Clearer
  pads** ("clearer pads looks good"; of the corner pictures + cursor hint: "the
  best indication of axis so far").
- **2026-10-02: Clearer pads built.** The trial page's version 2, in the app:
  contact-colour pad pictures with each strain at its own exposure
  (`pairContactPixelsInto`, `trailQuantile`); Smell pads on the squeezed
  `SMELL_PAD_KNOTS` map, zero at 29% (Touch and the own-trail faders keep the
  flat-around-zero curve); corner pictures on Smell pads (apart / together / who
  chases whom); axis ends "avoids … follows" and "eats … feeds"; a cursor hint
  with one sentence per direction (`pairSentence` over each layer's `verbs`)
  and the numbers, which left the pad header; the status line reads the same
  sentences; a Touch note when the pair rarely meets (`pairOverlap` below
  `RARELY_MEET_OVERLAP`); no beat reseed on the pad under the pointer;
  `PAD_SETTLE_STEPS` on release; and `command("spotlight")`, which dims the
  other two strains in this tab's own dish while a pad is hovered, dragged or
  keyboard-focused (eased, lapses `SPOT_HOLD_MS` after the last message, never
  reaches the pop-out output or a TV — they get settings, not commands). The
  user asked why the pads are 2D and why there is no "flee": the square puts
  each combination of the two directions at one spot the corners can name, and
  the steering rule can only avoid (a negative value says "don't step there";
  nothing turns an agent around or speeds it up). A flee behaviour (turn away
  and speed up near a fled strain) was offered as a separate experiment, not
  started. Executed by Sonnet from ~/.claude/plans/physarum2-clearer-pads.md;
  review caught the corner pictures' own `<svg>` breaking `drawPadChrome`'s
  `querySelector("svg")` on every redraw after the first (the pads never
  mounted) and the pictures stacking over the marker.
- **2026-10-03: Knobs removed; the console is lanes only.** User: "remove
  knobs we keep just lanes." The Lanes/Knobs switch, the knob grid, its
  remembered layout (`vibe.strainConsole.layout.*`) and the knob-only maths
  (`knobDelta`, `arcPath`) are gone. They also asked for a Random, then
  withdrew it: the mix row's Random already rolls the strains.

- **2026-10-03: one Random, and an own-trail roll that varies.** The user,
  with a screenshot of the own-trail faders: "random smell works bad on own
  trail, always [re]sets it to something like this" (every thumb near the
  top), and "can we group this all in one cool random button. random smell,
  touch, per strain card". Cause: the own trail rolled evenly in value over
  `RIVAL_OWN_RANDOM`'s old 0.6…1.4 (Rivals on, the default; 0.2…1.4 off),
  and the fader's `padPos` curve packs that whole span into its top stretch,
  where the default already sits — so a roll barely moved the thumbs, and
  above +1 nothing reads differently anyway. Now `rollOwn` rolls evenly
  across the fader's height over a lower, wider range (`OWN_TRAIL_RANDOM`,
  `RIVAL_OWN_RANDOM`), still always positive (a self-avoiding strain reads as
  broken; Self-avoid stays a preset). The Pairs card's "Random smell/touch"
  and the Strain Console's "Random" buttons are gone; one violet Random
  with a die (`.vc-roll`) under the specimen boxes calls each card's
  `randomize` — motion (`MOTION_PARAMS`), Smell and Touch together, Smell
  still under Keep own trails and Rivals. Each roll is one entry on each
  card's own Back, so half a roll can be undone. Checks: typecheck, tests (a
  new one that own-trail rolls split about evenly over the fader), headless
  screenshots of the panel before and after, six scripted rolls reading the
  own-trail values back.

- **2026-10-03: Random rolls Smell over the whole range; the Rivals toggle
  is gone.** The user, with a screenshot of the own-trail faders after a
  Random (all four positive): "something weird with how random works in
  physarum 2 … these never goes below", then "double check on others param
  randomisation. if they randoming in whole range". The audit: motion
  (`MOTION_PARAMS`) and Touch already rolled their sliders' whole ranges;
  Nutrient, Excitability and Trail life are not rolled at all, and Stain
  only by Shuffle/New palette. Smell did not: the own trail rolled
  +0.05…+1.1 with Rivals off and +0.1…+1.1 with it on (the default), and
  with Rivals on every other pair rolled −1.4…−0.4 — where, by
  `padresponse.mjs`, every value looks the same — so a default Random only
  varied own-trail strength. Twelve scripted rolls of the old build
  (`rollshot.mjs`): 0 of 48 own trails negative, all 141 stored other
  values in −1.4…−0.4. Asked what Rivals was, the user: "doesn't it
  duplicate some other params" — it did: the toggle only kept Random's
  rolls in the Rivals preset's shape, a pill right under it. "remove". Now
  `randomSmell` rolls every cell over the whole range, even across the
  control that draws it (`rollOwn` over the fader's `padPos`,
  `rollSmellPair` over a Smell pad's `smellPadPos`), so a strain can come
  out self-avoiding and the pads' live 0…+1 band gets most of the pair
  rolls; Keep own trails still holds the own trails. A side effect of the
  even-across-the-fader roll: the fader is flat around zero, so the 0.05
  snap lands about a seventh of own trails on exactly 0 (a strain that
  ignores its own trail). Nutrient, Excitability and Trail life stay
  unrolled (not asked for). Twelve rolls of the new build: 22 of 48 own
  trails negative, reaching both −1.50 and +1.50; other values 30 below 0,
  96 in 0…+1, 18 above +1. A roll with three self-avoiding strains
  rendered as one strain's network over the others' dust, as Self-avoid
  does. Checks: typecheck, the full suite (one unrelated, load-dependent
  `moire.test.ts` timeout that passes alone), the Affinity card before and
  after.

- **2026-10-04: the card is "Strain settings", and every slider has a
  port.** The user: "per strain card. we should find different name for
  it. also now lets add signal input on each slider and also one for a
  group". Asked, they picked "Strain settings" (over Traits, Behaviour,
  Tuning) and, for the group port, "wires all four" over a separate group
  drive added on top: the group port mounts strain 0's row with the other
  strains `linked` (the panel's multi-item path), so a wire plugged in
  there is written to every strain's own patch and each lane can still be
  changed alone; the group port then reads mixed (dashed ring in every
  wire's colour). A lane's port is a stand-in with the real port's look
  (`WidgetCtx.portLook`) until it is pressed; then the real row mounts
  pinned under the lanes and its port moves into the lane
  (`mountRows`'s `portHost`), so the cables end on the lane. Sensor angle
  and Trail life had no jack; they now take the strain's own band at
  `MOTION_JACK_GAIN` through `pushToward1` like Sensor range, so with the
  default wire a loud band widens the angle and lengthens the trail a
  little (a small change to the default look; identity with nothing
  plugged in). Checked headless: Nutrient's group port wired the drawn line
  into all four `nutrient<k>`, a second signal on PP-C3's lane port alone
  turned the group port mixed, the cable landed on the lane port.

- **2026-10-04: each card's Random is back, and Random rewires.** The user:
  "before we had random button like for different section but we replaced
  with one that has all. can we return those buttons and also add random
  button to strain settings but also keep global random. and make random
  for strains to connect to random signals with random parameters". The
  Affinity card's Random rolls the layer on screen again ("Random smell" /
  "Random touch", as before 2026-10-03), the Strain settings card has its
  Random again, and the Strains card's Random stays and calls both. The
  strain Random still rolls `MOTION_PARAMS` and now also plugs every lane
  that has a port into one wire, or two under a random mix, from the signal
  catalogue (`consoleMath.ts`'s `randomPatch`: random weight, a random
  height on a hit, random beats per swing on Beat wave; Tempo and Tempo
  lock left out because they hardly move). Back puts the wires back too.
  Assumed, not asked: every lane is rewired (not only the rolled rows),
  and Nutrient, Excitability, Trail life and Stain values stay unrolled as
  before.
- 2026-10-08 — Dose gets a Reaction row under its graph (`drive.hit`, with
  `ownDetector`). Flat, the default, starts a colony exactly as before.
  Sized moves a share of agents as big as the hit stood out: the trigger is
  stepped with `stepStandoutHit`, `pendingSeed` holds the firing's size, and
  the sim's reseed draw tests `uSeed * uSeedFresh` with `uSeedFresh` set to
  that size. The user, on why Dose isn't flat-only: it can take loudness.

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

- The defaults barely answer real music (2026-10-04, Measurements: beat pulse
  1.08 vs 1.48 for the user's own look). The look's drives — Speed boost on
  the beat wave, Speed pump and Seed on the low onset, Flash on onsets — are
  what make the dish move with a song; a candidate for the defaults.
- Fogleman's extras (2026-10-02) were judged only headlessly on SwiftShader
  with the synthetic feed: the motion presets, Auto level's default and
  Wander all want a look on a real GPU with music. Fresh dish is
  phone-local (the TV keeps its own dish, like Rebalance). The specimen
  boxes and Pairs pads don't show Wander or Auto level (they show the
  per-strain motion only, like Network scale). Start ink only applies when
  a dish starts (scene open, a Quality change, Fresh dish), not when its
  slider moves.
- Pressing a pad right after switching the layer moves the pads 55 px under
  the pointer: focus leaves the Smell/Touch switch, whose row's `.vc-hint`
  (the layer's `how`) folds up. The panel's rows-unfold-on-focus grammar, not
  the pads; seen with `padshot.mjs --layer touch` (2026-10-02).
- "Flee" doesn't exist: no Smell value makes a strain run from another (see
  Decisions 2026-10-02). Would need a new steering behaviour.

- Switching's default is tuned on the synthetic feed only. With real
  music the split may want another default or `SWITCH_PRESSURE`, and a
  strain with a very sparse network can sit at the `SWITCH_FLOOR` share by
  design - worth a listen.
- The console has no Auto (A) chip per lane; those live in the
  row it mounts under the lanes. Whether Sensor angle and Trail life want a
  jack of their own is open.
- The Synergy anchor is inferred per device from which stored stain changed
  last, so a TV that joins mid-session starts with no anchor (free
  rotation) until a stain moves.
- Trail life isn't in the Affinity pads' own live cultures
  (`createPairCulture` keeps the shared decay); the specimen boxes and the
  pads' sensor angle do use their settings.

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
  cultures' own preview (`previews.ts`'s `pair.weights`) reads Cross-smell
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

- The user's own look that opened the v0.2.0 promo (2026-10-04), a Looks-card
  share link: `physarum2/looks/promo-0.2.0.txt`. Its drives are the ones that
  make the dish answer music (Measurements, 2026-10-04); `tools/promo` uses it
  as the Physarum footage's starting point.
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
- Artifact "Strain Console" (per-strain settings redesign, private):
  https://claude.ai/artifact/Y32bYpyxHC5otWgG967f7D — self-contained source
  `physarum2/artifacts/strain-console.html`: every per-strain setting for
  all four strains at once as Lanes (one row per setting, a lane per strain
  on a shared scale, a Link toggle) or Knobs (a setting-by-strain matrix),
  plus Sensor angle, Trail life and a Share bar dragged at its dividers, on
  a live culture with a fixed 124 BPM pulse on Excitability. Built
  2026-09-29 (Decisions and pivots); the page stays as the prototype it was
  built from (v5, with Headcount and Synergy). `node physarum2/artifacts/look-studio.mjs --page
  strain-console.html --out <dir>` (or `--page affinity-studio.html`)
  screenshots either prototype page as the artifact viewer shows it.
- Artifact "Readable Pairs Pads" (ideas for the Pairs pads, private):
  https://claude.ai/artifact/GspZfQHpz4ETJDkPjiLsCK — self-contained source
  `physarum2/artifacts/pairs-readable.html` (publish it as is). The two charts
  are `padresponse.mjs`'s 2026-10-02 numbers; the lab runs six pair cultures
  and a four-strain stand-in dish (a K-strain port of `createPairCulture`)
  with every idea as a switch and Today / Proposed presets.
- Artifact "Pairs Card Trial" (three versions of the card to try cold,
  private): https://claude.ai/artifact/7tPBxZnEpeDpszPssPcW8x — self-contained
  source `physarum2/artifacts/pairs-trial.html` (publish it as is; same
  culture port as `pairs-readable.html`), notes folded under the lab.
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
  - `headcountcheck.mjs` — Switching's headcount read off the population
    bar with the panel open (moves at the default, frozen at 0), plus
    Trail life / Sensor angle overrides and any shader error.
  - `consoleshot.mjs` — screenshots the Strain Console's lanes or the
    Strains card above it (`--scene-card`).
  - `consoledrive.mjs` — the console under real mouse drags: a lane, Link,
    double-click reset, then Synergy pulled up through its real slider with two stains
    set by hand.
  - `previewcheck.mjs` — node harness for the pure-culture collapse numbers
    in Measurements.
  - `perf/` — `tput.mjs` plus the spatial re-sort prototype
    (`p2-prof-sort-prototype.diff`, `_p2sort.ts`, `_p2prof.ts`); see the
    header of `tput.mjs` before using it. `tput.mjs` also grew a `--settings
    JSON` flag (applied after `goto`, `scene: "physarum2"`) and its header
    now documents, rather than links to a stale diff for, the temporary
    forced-step-count hook a Touch/War perf run needs in `physarum2.ts`'s
    `render()` — copy it in by hand, measure, then `git diff` must show
    physarum2.ts untouched again; never commit it. `panelprof.mjs`
    (panel-open CPU profile + every blocking GL read timed by caller) and
    `paneltrace.mjs` (the main thread's own style/layout/paint from a Chrome
    trace) are the 2026-10-04 panel-lag measurements.
  - `padcheck.mjs` — the Pairs pads' own headless check: real mouse
    down/wait/up drags on a pad and an own-trail fader, the Smell/Touch
    switch, the Affinity card's rows waking on hover and pinning on a press
    (Escape unpins, Solo hides the rest, the fold persists), a pad canvas
    surviving a strain-box selection change and a panel close/reopen (a
    culture must not restart), and (Random/Nudge/Keep own trails/Back) a preset applying
    exactly, Back restoring the pre-preset tables exactly, the Strains
    card's one Random moving Smell and rolling Touch onto the grid (and the
    Pairs card's Back undoing its half), and a Smell Nudge with Keep own trails
    leaving every own-trail fader unchanged. Also takes the panel
    screenshots (both layers, 1440/390) and, through the same real preset
    pills, the main-scene screenshots 8 s after War/Hunt/Gardens.
  - `padcost.mjs` — the pads' own frame-time budget: mean/median/p95 over
    480 `requestAnimationFrame`s at `?quality=low`, the panel closed vs open
    at the pads, plain and under a 4x CPU-throttle phone stand-in, with an
    "open at the boxes, no pads visible" control so the pads' own marginal
    cost isn't confounded with the pre-existing cost of opening the panel at
    all under throttling (see that script's own header, and Measurements).
  - `padresponse.mjs` — node, no server: sweeps one Smell or Touch
    direction on the real pair culture and prints overlap / trail ratio per
    value (`--json` for the ideas page's charts). Needs Node ≥ 22.6 (it
    imports the `.ts` modules directly).
  - `padshot.mjs` — the Pairs pads at rest, held mid-drag (cursor hint and
    spotlight) and 1 s after release, `--layer touch` for the second table;
    the before/after shots of the Clearer pads build.
  - `rollshot.mjs` — presses the Strains card's one Random a dozen times
    with real presses, prints every Smell value after each roll and where
    they landed (own trails below 0; other values below 0, in 0…+1, above
    +1), and shoots the Affinity card before and after plus the window;
    the before/after of the 2026-10-03 whole-range Random.
  - `padmodels.mjs` — node, no server: the shipped steering against two
    rejected models (probability gate, value-scaled reach) for avoid
    strength; see its header.
  - `padmotion.mjs` — how much a pad's live culture changes over 0.5 s vs
    10 s (block means, not agent flicker) plus two crops 3 s apart; the
    probe behind the 2026-09-28 "pads don't move" fix.
  - `motionsearch.mjs` — the random motion search behind `MOTION_PRESETS`
    (seeded rolls of the `MOTION_PARAMS` sliders, a screenshot each);
    `--swiftshader` for a GPU-less box.
  - `docs/scenes/_shared/scripts/panelscroll.mjs` (shared) — screenshots
    every panel column top to bottom, for judging cards, gaps and rows as a
    whole.
- Phase 3's pipette and frame-time checks were one-off session scripts and
  weren't kept; their results are in Measurements.

## Crawl speed jack (2026-09-30)

Crawl speed (`speed`) now has a drive jack, like the per-strain Speed: its
default is Loudness, scaled by `CRAWL_JACK_GAIN` and lifted toward the top
of the slider with `pushToward1`, so an unplugged jack leaves the pace where
the slider sits. It is read in JS in `render()` (`drives.value`) before the
step rate is mapped — the stepper is fixed-rate, not a GLSL uniform. Not
judged on real music yet.

2026-10-02: the user reported Crawl "doesn't react much to the driver". It
was sharing `MOTION_JACK_GAIN` (0.15, right for one strain among four), which
moved the default pace ~6% at full-scale Loudness (75 → 80 steps/s). Crawl now
has its own `CRAWL_JACK_GAIN` (1): about +40% at a loud peak, ~+15% on a
typical level. Not yet judged by eye on real music.

2026-10-03: Crawl speed is now the three-part pace Caustics has (user: "work
same way as in caustics. base speed, pump, acceleration"). `speed` is the base
only and lost its jack; **Speed boost** (`speedBoost`, Loudness) and **Speed
pump** (`speedPump`, Bass hit; its accelerate-then-coast velocity is
`advanceCrawlPump`, the twin of caustics.ts's `advancePump`) add steps/s on top
via `crawlStepRate`, capped at `STEP_RATE_CAP`. Additive, so both still move
the sim with the base at its slowest. The old `speed` jack's stored choice, if
any, is not migrated (the jack moved to Speed boost; unchecked what a stale
entry does). The constants
(`CRAWL_LEVEL_GAIN`, `CRAWL_PUMP_*`) are first guesses sized from Caustics's
shape, not yet judged by eye or on real music.

## Dose threshold (2026-10-03)

The user asked for the same "tell one signal from another" behaviour on Dose
that Caustics' Beat ripple has. Before, Dose's default Scene trigger fired on
any rise in the beat pulse (physarum.ts's `createBeatSeeder`), so a busy
passage reseeded on every tick; only a *patched* source got the engine's
generic gate, and the default had none. Dose now reads the driver the way the
ripple does: `advanceStandout` (`rippleEmitter.ts`) wraps `advanceEmission`
and answers yes once per climb that earns half a ring, i.e. one that stands
out from the learned floor of everyday climbs. `seed` declares a
`drive.threshold` ("Dose threshold"), so the panel gives it the same dotted
line, On/Off switch and slider as Beat ripple, and `publishSettingMarks`
draws the line and a dot per colony started. The reseed keeps physarum.ts's
refractory (`SEED_RISE_REFRACTORY_SEC`, now exported). The pipette is
untouched. Not yet judged on real music; the default line is
`RING_THRESHOLD_DEFAULT`, the ripple's own.

2026-10-06: the detector moved to the shared `src/render/standout.ts`, and
Dose now holds a `StandoutTrigger` (`createStandoutTrigger` with
`SEED_RISE_REFRACTORY_SEC` as its gap, stepped by `stepStandoutTrigger`)
instead of its own state and refractory counter; `standoutThreshold` and
`standoutLine` replace the inline reads. Same behaviour; Alien's Cut fires on
the same trigger. How to wire another setting to it is in that file's header.
The graph's key now calls Dose's dots "colony started"; it had said "ring
sent", Beat ripple's word, for every scene.

## Resume here

**The Strain Console is built** (2026-09-29; Decisions and pivots has what
and why), and Fogleman's extras are in (2026-10-02: Auto level, Wander,
Start ink and Fresh dish, the one Random (2026-10-03), presets and
Shuffle/New palette). What's left is Known issues: a real-GPU, real-music
look at those, and a real-music listen at Switching's default and
`SWITCH_PRESSURE`. Every lane and every row has a port since 2026-10-04.
The console's
rows are the existing per-strain settings (`nutrient`/`excite`/`sensor`/
`angle`/`turn`/`stride`/`life`/`stain` `<k>`), so a change there reads,
resets and shares through Looks like any slider. The user reviews panel UX
in a prototype first and prefers plain - / + and numbers to outcome words.

`npm run dev`, then `#/v/physarum2` (headless checks add
`?audio=synthetic&bpm=120` before the hash). Pure logic
(`physarum2TrailSide`, `stepAccumulator`, `hueRotateRGB`,
`resolveStrainEffective`, the sensor/turn/stride/seedSpread slider<->physical
mappings, `equalPopulation`/`applyInjection`, `classifyTerritory`,
`roomAspectJs`/`coverUvJs`/`uncoverUvJs`/`screenToFieldUv`, Auto level's
`levelPeaks`/`levelGainsFull`/`levelGain`, `fillStartInk`, the
`MOTION_PRESETS` shape) and the
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
logic (`randomSmell`'s whole-range rolls, even across fader and pad/`randomTouch`/
`nudgeTable`/`pushHistory`/`popHistory`, each exercised with a seeded
`mulberry32`, never `Math.random`). Shuffle/New palette's pure half is in
`tests/physarum2Synergy.test.ts`, the console's Random/preset matching in
`tests/consoleMath.test.ts`. Every word
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
The one Random is `.vc-roll`, under the specimen boxes (itemBoxes.ts).
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
- #213 (draft, 2026-09-29): the Strain Console in the app — Lanes and Knobs,
  Sensor angle, Trail life, Switching (Headcount) and Synergy; the box
  selection and its rows went.
- #405 (draft, 2026-10-06): Dose on the shared `StandoutTrigger`
  (`src/render/standout.ts`), same behaviour; its graph's dots keyed
  "colony started".
- #349 cleanup — sampler units now set with GLProgram.setI; the scene's own sampler-location cache is gone. No change on screen.
